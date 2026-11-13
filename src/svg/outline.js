// Polylines as Arch point lists (/-/(x,y)(x,y)...), drawn exactly rather than sampled on a grid.
//
// Arch draws each segment of a point list as its own rectangle, `thickness` pixels wide, with
// butt ends and no joins, so the outer side of every turn shows a wedge-shaped notch. Splitting
// the polyline at such a turn and extending both segments past the vertex by
// (w/2)*tan(turn/2) closes the notch: the two extended rectangles meet exactly at the miter
// point, as an SVG miter join does. Past a right angle the extension would push the inner half
// of each rectangle across the other segment's far edge, so it stops at (w/2)*cot(turn/2):
// corners of 90 degrees or more come out exact, sharper tips a little short. Small turns are
// left alone (their notch is under minGap deep), so smooth curves stay single runs.
import * as P from './poly.js';

// polyline: [[x, y], ...] in integer steps. half: half the line width, in integer steps.
// closed: the last point connects back to the first. turns: 'all' (strokes) or 'left' (outlines
// of regions, whose inside is on the left: only those turns have their notch outside).
// caps: extend open ends by half the width (square and round SVG caps).
// Returns runs: [[x, y], ...] polylines, each drawn as one point-list piece.
export function joinedRuns(polyline, {half, closed = false, turns = 'all', caps = false, minGap = 0}) {
    let pts = polyline.filter((p, i) => i === 0 || p[0] !== polyline[i - 1][0] || p[1] !== polyline[i - 1][1]);
    if (closed && pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
    const n = pts.length;
    if (n < 2) return [];
    const unit = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); return [dx / l, dy / l]; };
    // Extension at each vertex: how far both segments reach past it.
    const extension = new Array(n).fill(0);
    for (let i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) {
        const a = unit(pts[(i - 1 + n) % n], pts[i]), b = unit(pts[i], pts[(i + 1) % n]);
        const cross = a[0] * b[1] - a[1] * b[0], dot = a[0] * b[0] + a[1] * b[1];
        if (turns === 'left' && cross <= 0) continue;
        const turn = Math.atan2(Math.abs(cross), dot);
        if (half * (1 / Math.cos(turn / 2) - 1) <= minGap) continue;      // notch depth
        extension[i] = half * Math.min(Math.tan(turn / 2), 1 / Math.tan(turn / 2));
    }
    const splits = [];
    for (let i = 0; i < n; i++) if (extension[i] > 0) splits.push(i);
    const extend = (run, startExt, endExt) => {
        const out = run.map(p => [...p]);
        if (startExt) { const d = unit(out[1], out[0]); out[0] = [out[0][0] + d[0] * startExt, out[0][1] + d[1] * startExt]; }
        if (endExt) { const m = out.length - 1, d = unit(out[m - 1], out[m]); out[m] = [out[m][0] + d[0] * endExt, out[m][1] + d[1] * endExt]; }
        return out;
    };
    if (closed) {
        if (!splits.length) return [[...pts, pts[0]]];
        const runs = [];
        for (let k = 0; k < splits.length; k++) {
            const from = splits[k], to = splits[(k + 1) % splits.length];
            const run = [];
            for (let i = from; ; i = (i + 1) % n) { run.push(pts[i]); if (i === to && run.length > 1) break; }
            runs.push(extend(run, extension[from], extension[to]));
        }
        return runs;
    }
    const cuts = [0, ...splits, n - 1];
    const runs = [];
    for (let k = 0; k + 1 < cuts.length; k++) {
        const from = cuts[k], to = cuts[k + 1];
        const startExt = from === 0 ? (caps ? half : 0) : extension[from];
        const endExt = to === n - 1 ? (caps ? half : 0) : extension[to];
        runs.push(extend(pts.slice(from, to + 1), startExt, endExt));
    }
    return runs;
}

// Runs as integer Paths ([{X, Y}]) for clipping and writing.
export const toIntPaths = runs => runs.map(run => run.map(([x, y]) => ({X: Math.round(x), Y: Math.round(y)})))
    .filter(run => run.length > 1 && run.some(p => p.X !== run[0].X || p.Y !== run[0].Y));

// The outline of a region for a point list `half` integer steps wide on each side: the
// region's boundary moved half a line width inwards, so the line's outer edge is the exact
// outline and its inner part covers what Arch's sampled fill misses along the boundary (cut-off
// corners, steps along shallow slopes). Parts narrower than the line get no outline.
export function outlineRuns(paths, half, minGap) {
    const inner = P.normalize(P.offset(paths, -half, 4));
    const runs = [];
    for (const ring of inner) runs.push(...joinedRuns(ring.map(p => [p.X, p.Y]), {half, closed: true, turns: 'left', minGap}));
    return runs;
}

// What Arch paints for point-list runs (integer Paths) drawn `half` integer steps wide on each
// side: one rectangle per segment, as closed Paths.
export function runCoverage(runs, half) {
    const quads = [];
    for (const run of runs)
        for (let i = 0; i + 1 < run.length; i++) {
            const {X: ax, Y: ay} = run[i], {X: bx, Y: by} = run[i + 1], l = Math.hypot(bx - ax, by - ay);
            if (!l) continue;
            const nx = -(by - ay) / l * half, ny = (bx - ax) / l * half;
            quads.push([[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]]
                .map(([x, y]) => ({X: Math.round(x), Y: Math.round(y)})));
        }
    return P.normalize(quads);
}

// Arch's sampled fill rounds a concave corner outwards, past the true corner, which an outline
// inside the shape cannot hide. Small diamonds around the region's sharp concave corners, with
// their diagonals along the corner's two edges and limited to `coverage` (what its outline
// paints exactly): cut out of the fill, they leave it only convex corners on the true outline
// (which the outline covers) and keep its sampled edge clear of the corner; the outline paints
// them back. The diamond's own concave corners lie inside the shape, where rounding is harmless.
// hidden(X, Y): true for corners that later shapes cover anyway.
export function concaveCorners(paths, radius, coverage, hidden = () => false, minTurn = Math.PI / 6) {
    const disks = [];
    for (const ring of paths) {
        const n = ring.length;
        for (let i = 0; i < n; i++) {
            const a = ring[(i - 1 + n) % n], v = ring[i], b = ring[(i + 1) % n];
            const ax = v.X - a.X, ay = v.Y - a.Y, bx = b.X - v.X, by = b.Y - v.Y;
            const cross = ax * by - ay * bx;
            if (cross >= 0 || Math.atan2(-cross, ax * bx + ay * by) < minTurn) continue;   // convex, or nearly straight
            if (hidden(v.X, v.Y)) continue;
            const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
            const ua = [ax / la * radius, ay / la * radius], ub = [bx / lb * radius, by / lb * radius];
            disks.push([[-ua[0], -ua[1]], [-ub[0], -ub[1]], [ua[0], ua[1]], [ub[0], ub[1]]]
                .map(([dx, dy]) => ({X: Math.round(v.X + dx), Y: Math.round(v.Y + dy)})));
        }
    }
    return disks.length ? P.intersect(P.normalize(disks), coverage) : [];
}
