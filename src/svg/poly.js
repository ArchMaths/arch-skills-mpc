// Polygon operations on integer coordinates, through Clipper (Angus Johnson's Clipper 6, JS port).
// A "Paths" value is an array of rings, each an array of {X, Y} integers; one integer step is
// the drawing's quantum q (output coordinate = integer * q).
import ClipperLib from 'clipper-lib';
import {apply, maxScale} from './geom.js';

const {Clipper, ClipperOffset, PolyTree, ClipType, PolyType, PolyFillType, JoinType, EndType} = ClipperLib;

export const fillType = rule => rule === 'evenodd' ? PolyFillType.pftEvenOdd : PolyFillType.pftNonZero;

function ring(points, q, m = null) {
    const out = [];
    for (const p of points) {
        const [x, y] = m ? apply(m, p[0], p[1]) : p;
        const X = Math.round(x / q), Y = Math.round(y / q);
        const last = out[out.length - 1];
        if (!last || last.X !== X || last.Y !== Y) out.push({X, Y});
    }
    return out;
}

// Device-space polylines (floats) -> Paths. Rings with fewer than 3 distinct points are dropped
// unless keepOpen (open paths for strokes and lines).
export function toPaths(polylines, q, {keepOpen = false, matrix = null} = {}) {
    const out = [];
    for (const {points} of polylines) {
        const r = ring(points, q, matrix);
        if (r.length > 1 && r[0].X === r[r.length - 1].X && r[0].Y === r[r.length - 1].Y && !keepOpen) r.pop();
        if (r.length >= (keepOpen ? 1 : 3)) out.push(r);
    }
    return out;
}

function run(type, subject, clip, subjectFill = PolyFillType.pftNonZero, clipFill = PolyFillType.pftNonZero) {
    const c = new Clipper();
    if (subject.length) c.AddPaths(subject, PolyType.ptSubject, true);
    if (clip && clip.length) c.AddPaths(clip, PolyType.ptClip, true);
    const out = [];
    c.Execute(type, out, subjectFill, clipFill);
    return out;
}

// Resolves self-intersections and overlaps under a fill rule into simple rings (non-zero form).
export const normalize = (paths, rule = 'nonzero') => paths.length ? run(ClipType.ctUnion, paths, null, fillType(rule), fillType(rule)) : [];
export const union = (a, b) => run(ClipType.ctUnion, a, b);
export const intersect = (a, b) => (a.length && b.length) ? run(ClipType.ctIntersection, a, b) : [];
export const difference = (a, b) => !a.length ? [] : !b.length ? a : run(ClipType.ctDifference, a, b);

// Clips open paths (polylines) by closed Paths: keeps the parts inside (intersection) or outside (difference).
export function clipOpen(open, closed, inside) {
    if (!open.length) return [];
    if (!closed.length) return inside ? [] : open;
    const c = new Clipper();
    c.AddPaths(open, PolyType.ptSubject, false);
    c.AddPaths(closed, PolyType.ptClip, true);
    const tree = new PolyTree();
    c.Execute(inside ? ClipType.ctIntersection : ClipType.ctDifference, tree, PolyFillType.pftNonZero, PolyFillType.pftNonZero);
    return Clipper.OpenPathsFromPolyTree(tree).filter(p => p.length > 1);
}

const JOINS = {miter: JoinType.jtMiter, 'miter-clip': JoinType.jtMiter, arcs: JoinType.jtMiter, round: JoinType.jtRound, bevel: JoinType.jtSquare};
const CAPS = {butt: EndType.etOpenButt, round: EndType.etOpenRound, square: EndType.etOpenSquare};

// The area a stroke paints, as device Paths. polylines are in user space and `matrix` maps user to
// device space, so the outline is computed in user space and then transformed: correct for
// non-uniform scaling and skew too. tolerance is the device-space flattening tolerance.
export function strokeOutline(polylines, matrix, {width, join, cap, miterLimit}, q, tolerance) {
    const stretch = maxScale(matrix);
    if (!(width > 0) || !(stretch > 0)) return [];
    const qu = q / stretch;                     // user units per integer step
    const co = new ClipperOffset(Math.max(2, miterLimit || 4), Math.max(0.25, tolerance / q));
    const joinType = JOINS[join] ?? JoinType.jtMiter;
    let added = 0;
    for (const {points, closed} of polylines) {
        const r = ring(points, qu);
        if (closed && r.length > 1 && r[0].X === r[r.length - 1].X && r[0].Y === r[r.length - 1].Y) r.pop();
        if (!r.length) continue;
        if (r.length === 1 && cap === 'butt') continue;     // a zero-length subpath shows only with round or square caps
        co.AddPath(r, joinType, closed && r.length > 2 ? EndType.etClosedLine : (CAPS[cap] ?? EndType.etOpenButt));
        added++;
    }
    if (!added) return [];
    const out = [];
    co.Execute(out, width / 2 / qu);
    const user = out.map(r => ({points: r.map(p => [p.X * qu, p.Y * qu])}));
    return normalize(toPaths(user, q, {matrix}));
}

// Grows (delta > 0) or shrinks closed Paths by delta integer steps, with mitred corners.
export function offset(paths, delta) {
    if (!paths.length || !delta) return paths;
    const co = new ClipperOffset(2, 0.25);
    co.AddPaths(paths, JoinType.jtMiter, EndType.etClosedPolygon);
    const out = [];
    co.Execute(out, delta);
    return out;
}

export function area(paths) {
    let s = 0;
    for (const r of paths) s += Clipper.Area(r);
    return Math.abs(s);
}

export function perimeter(paths) {
    let s = 0;
    for (const r of paths)
        for (let i = 0; i < r.length; i++) {
            const a = r[i], b = r[(i + 1) % r.length];
            s += Math.hypot(b.X - a.X, b.Y - a.Y);
        }
    return s;
}

export function bbox(paths) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const r of paths)
        for (const {X, Y} of r) {
            if (X < minX) minX = X;
            if (Y < minY) minY = Y;
            if (X > maxX) maxX = X;
            if (Y > maxY) maxY = Y;
        }
    return minX <= maxX ? {minX, minY, maxX, maxY} : null;
}

export const overlaps = (a, b) => a && b && a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;


// Removes vertices that lie (almost) on the line through their neighbours.
export const clean = (paths, distance = 1.415) => Clipper.CleanPolygons(paths, distance).filter(r => r.length >= 3);

// Splits simple rings into components: each outer ring with the holes directly inside it.
export function components(paths) {
    if (!paths.length) return [];
    const c = new Clipper();
    c.AddPaths(paths, PolyType.ptSubject, true);
    const tree = new PolyTree();
    c.Execute(ClipType.ctUnion, tree, PolyFillType.pftNonZero, PolyFillType.pftNonZero);
    const out = [];
    const visit = node => {
        for (const child of node.Childs()) {
            if (!child.IsHole()) {
                out.push([child.Contour(), ...child.Childs().map(h => h.Contour())]);
                for (const hole of child.Childs()) visit(hole);
            }
        }
    };
    visit(tree);
    return out.map(rings => rings.filter(r => r.length >= 3)).filter(rings => rings.length);
}
