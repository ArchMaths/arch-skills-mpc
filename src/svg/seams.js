// Seam lines: point lists along the boundaries that opaque regions share, in each region's
// colour, drawn beneath the fills.
//
// Arch interpolates each region's boundary on its own and cuts every corner off within a
// sampling cell, so where regions meet it can leave hairline seams, and at T-junctions (a band
// boundary meeting another region or the picture's outline) small notches up to a cell long.
// Arch draws point lists before (beneath) all inequality fills, so a line about a cell wide
// along each shared boundary fills those gaps with the right colour and is hidden everywhere
// else. Lines stay inside the picture's outline: where a seam meets the outline at a slant, its
// end is cut back so its corner does not stick out. They also keep clear of translucent
// regions, which would let them show through; next to those, the opaque region's seam runs
// just inside its own boundary.
import * as P from './poly.js';

// Nearest outline edge to (x, y): {distance, ux, uy} with (ux, uy) the edge's unit direction.
function nearestEdge(x, y, edges) {
    let best = {distance: Infinity, ux: 1, uy: 0};
    for (const [ax, ay, bx, by] of edges) {
        const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
        if (!len2) continue;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
        const d = Math.hypot(x - ax - t * dx, y - ay - t * dy);
        if (d < best.distance) {
            const len = Math.sqrt(len2);
            best = {distance: d, ux: dx / len, uy: dy / len};
        }
    }
    return best;
}

// Shortens the end of pts (the last point) by `length`.
function shorten(pts, length) {
    while (pts.length > 1 && length > 0) {
        const [bx, by] = pts[pts.length - 1], [ax, ay] = pts[pts.length - 2];
        const seg = Math.hypot(bx - ax, by - ay);
        if (seg > length) {
            const t = (seg - length) / seg;
            pts[pts.length - 1] = [ax + (bx - ax) * t, ay + (by - ay) * t];
            return pts;
        }
        length -= seg;
        pts.pop();
    }
    return pts.length > 1 ? pts : [];
}

// Cuts back the ends of seam lines that meet the outline, by half the line width times the
// cotangent of the angle they meet it at; a seam running along the outline disappears.
function trimAtOutline(paths, edges, half, near) {
    const out = [];
    const trimEnd = pts => {
        if (pts.length < 2) return [];
        const [ex, ey] = pts[pts.length - 1];
        const edge = nearestEdge(ex, ey, edges);
        if (edge.distance > near) return pts;
        const [px, py] = pts[pts.length - 2];
        const sx = ex - px, sy = ey - py, sl = Math.hypot(sx, sy) || 1;
        const sin = Math.abs(sx * edge.uy - sy * edge.ux) / sl, cos = Math.abs(sx * edge.ux + sy * edge.uy) / sl;
        return sin < 0.1 ? [] : shorten(pts, half * cos / sin + 1);
    };
    for (const path of paths) {
        let pts = path.map(p => [p.X, p.Y]);
        pts = trimEnd(pts);
        pts = trimEnd(pts.reverse());
        if (pts.length > 1) out.push(pts.map(([X, Y]) => ({X: Math.round(X), Y: Math.round(Y)})));
    }
    return out;
}

// regions: [{hex, opacity, paths}]. pxInt: integer steps per screen pixel at the saved zoom.
// Returns [{hex, paths (open)}] and the line thickness in pixels.
export function seamLines(regions, {pxInt, stepPx}) {
    const thickness = Math.max(2, Math.min(20, Math.round(1.2 * stepPx)));
    const half = thickness / 2 * pxInt;
    const opaque = regions.filter(r => r.opacity === 1 && r.paths.length);
    const translucent = P.normalize(regions.filter(r => r.opacity < 1).flatMap(r => r.paths));
    const all = P.normalize(opaque.flatMap(r => r.paths));
    // Inside the outline, and not where the line would reach under a translucent region.
    let allowed = P.offset(all, -0.5 * pxInt);
    if (translucent.length) allowed = P.difference(allowed, P.offset(translucent, half + pxInt));
    const edges = [];
    for (const ring of all)
        for (let i = 0; i < ring.length; i++) {
            const a = ring[i], b = ring[(i + 1) % ring.length];
            edges.push([a.X, a.Y, b.X, b.Y]);
        }
    // Next to a translucent region, a seam runs half its width inside the opaque region instead:
    // it covers that region's own cut corners up to the boundary and never reaches under the
    // translucent one (whose own gaps show the white canvas, close to its near-white colour).
    const nearTranslucent = translucent.length ? P.offset(translucent, half + 3 * pxInt) : [];
    const out = [];
    for (const region of opaque) {
        const others = P.intersect(P.offset(P.difference(all, region.paths), Math.max(2, pxInt)), allowed);
        const outline = region.paths.map(r => [...r, r[0]]);
        const shared = trimAtOutline(P.clipOpen(outline, others, true), edges, half, 2 * pxInt);
        if (nearTranslucent.length && P.overlaps(P.bbox(nearTranslucent), P.bbox(region.paths))) {
            const inset = P.offset(region.paths, -(half + 0.5 * pxInt)).map(r => [...r, r[0]]);
            shared.push(...P.clipOpen(inset, nearTranslucent, true));
        }
        if (shared.length) out.push({hex: region.hex, paths: shared, area: P.area(region.paths)});
    }
    // Arch draws point lists in entry order. Where a cut-off corner of one region meets another,
    // the gap shows whichever seam comes last; drawing the larger regions' seams last makes those
    // gaps take the larger neighbour's colour, which reads as a slightly rounded corner of the
    // smaller shape rather than a spike out of it.
    out.sort((a, b) => a.area - b.area);
    return {seams: out.map(({hex, paths}) => ({hex, paths})), thickness};
}
