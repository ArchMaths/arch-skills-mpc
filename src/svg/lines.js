// Thin strokes as Arch equations: cos(pi*(W))/sqrt(D) = 0, drawn as lines of a fixed pixel
// thickness on top of all inequality fills (Arch draws equation curves after the fills).
//
// For a closed polyline, W is the crossing count of inequality.js and the left side changes
// sign exactly on the polyline. An open polyline has no inside, so the crossing parity also
// jumps along a "cut": the ray from each endpoint pointing against the counting direction.
// There the function jumps between about -d and +d instead of passing through 0, and Arch's
// automatic breakpoint detection (saved in the file) rejects such a jump instead of drawing it.
// That only fails where a cut crosses a line of the same entry, so each open polyline counts
// crossings along one of 8 directions, chosen so the cuts from its endpoints miss every line
// in its entry; a polyline for which no direction works is split.
export const DIRECTIONS = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]];

const segDistance = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
};

// Smallest distance between the ray from (ox,oy) along (rx,ry) (unit) and segment a-b, up to `reach`.
function rayDistance(ox, oy, rx, ry, ax, ay, bx, by, reach) {
    // Does the ray cross the segment?
    const ex = bx - ax, ey = by - ay;
    const den = rx * ey - ry * ex;
    if (den) {
        const t = ((ax - ox) * ey - (ay - oy) * ex) / den;
        const s = ((ax - ox) * ry - (ay - oy) * rx) / den;
        if (t >= 0 && t <= reach && s >= 0 && s <= 1) return 0;
    }
    // Otherwise the closest approach involves an endpoint of one of them.
    const fx = ox + rx * reach, fy = oy + ry * reach;
    return Math.min(segDistance(ax, ay, ox, oy, fx, fy), segDistance(bx, by, ox, oy, fx, fy),
        segDistance(ox, oy, ax, ay, bx, by));
}

// Is the cut from endpoint `end` (index into points) of polyline `line` clear of all `others`?
function cutClear(line, endIndex, dir, others, clearance, reach) {
    const pts = line.points;
    const [ox, oy] = pts[endIndex];
    const n = Math.hypot(dir[0], dir[1]);
    const rx = -dir[0] / n, ry = -dir[1] / n;          // the cut points against the counting direction
    // The cut must leave the polyline's own end segment at a clear angle.
    const nb = endIndex === 0 ? pts[1] : pts[pts.length - 2];
    const sx = nb[0] - ox, sy = nb[1] - oy, sl = Math.hypot(sx, sy);
    if (sl && (sx * rx + sy * ry) / sl > Math.cos(Math.PI / 6)) return false;
    for (const other of others) {
        const p = other.points;
        const segments = other.closed ? p.length : p.length - 1;
        for (let i = 0; i < segments; i++) {
            const a = p[i], b = p[(i + 1) % p.length];
            if (other === line && (i === endIndex || i === endIndex - 1)) continue;   // the segment(s) at this endpoint
            if (rayDistance(ox, oy, rx, ry, a[0], a[1], b[0], b[1], reach) < clearance) return false;
        }
    }
    return true;
}

function directionFor(line, others, clearance, reach) {
    if (line.closed) return [1, 0];
    return DIRECTIONS.find(dir => cutClear(line, 0, dir, others, clearance, reach) &&
        cutClear(line, line.points.length - 1, dir, others, clearance, reach)) || null;
}

// lines: [{points: [[x,y]...] (device floats), closed}], all of one colour and width.
// Returns entries: [[{points, closed, dir}]], each entry at most maxEdges edges.
export function planLines(lines, {clearance, reach, maxEdges}) {
    const entries = [];
    const queue = lines.filter(l => l.points.length >= 2).map(l => ({...l}));
    let guard = 0;
    while (queue.length && guard++ < 100000) {
        const line = queue.shift();
        let placed = false;
        for (const entry of entries) {
            if (entry.edges + line.points.length > maxEdges) continue;
            const members = [...entry.lines, line];
            const dir = directionFor(line, members, clearance, reach);
            // The new line must not cross the cuts of lines already in the entry either.
            if (dir && entry.lines.every(other => other.closed || (
                cutClear(other, 0, other.dir, members, clearance, reach) &&
                cutClear(other, other.points.length - 1, other.dir, members, clearance, reach)))) {
                entry.lines.push({...line, dir});
                entry.edges += line.points.length;
                placed = true;
                break;
            }
        }
        if (placed) continue;
        const dir = directionFor(line, [line], clearance, reach);
        if (dir) {
            entries.push({lines: [{...line, dir}], edges: line.points.length});
        } else if (line.points.length > 2) {
            // No direction keeps both cuts clear of the line itself (a spiral, a hook): split it.
            const mid = Math.floor(line.points.length / 2);
            queue.unshift({points: line.points.slice(0, mid + 1), closed: false}, {points: line.points.slice(mid), closed: false});
        } else {
            entries.push({lines: [{...line, dir: [0, 1]}], edges: 2});
        }
    }
    return entries.map(e => e.lines);
}
