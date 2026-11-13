// Writes a region (simple rings on the integer grid of poly.js) as one Arch inequality:
//
//     cos(pi*(W))/sqrt(D) < 0
//
// W counts how often a ray from (x, y) towards +x crosses the region's edges, one term per
// non-horizontal edge from (x1,y1) up to (x2,y2):
//     (heaviside(y-y1)-heaviside(y-y2)) * heaviside((x2-x1)*(y-y1)-(y2-y1)*(x-x1))
// i.e. "y is in (y1, y2] and the point is left of the edge". W is odd exactly inside, so
// cos(pi*W) is -1 inside and +1 outside. The crossing tests use the vertex coordinates
// themselves, so two edges that meet at a vertex agree there exactly.
//
// D is a sum over all edges of 1/q, where q is twice the squared distance to the edge:
//     q = 2*perp^2 + 2*max(|u| - h, 0)^2
// with perp the distance to the edge's line, u the position along it from its midpoint, and h
// half its length. 1/sqrt(D) behaves like the distance to the nearest edge, and is 0 on the
// boundary, so the left side is about minus the distance to the boundary inside and plus it
// outside. Arch samples the inequality on a pixel grid and interpolates linearly between
// samples, so a distance-like function puts the drawn edge where the true edge is. Written
// with products instead of powers and max(t,0)^2 as t*(t+abs(t))/2, which Arch evaluates fastest.

// Exact decimal for integer n times q (q a power of ten).
export function quantumFormatter(q) {
    const decimals = Math.max(0, -Math.round(Math.log10(q)));
    const factor = Math.round(q * 10 ** decimals);       // q = factor / 10^decimals, factor = 1 for q <= 1
    return n => {
        if (decimals === 0) return String(n * Math.round(q));
        const neg = n < 0;
        const digits = String(Math.abs(n) * factor).padStart(decimals + 1, '0');
        let text = `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`.replace(/\.?0+$/, '');
        if (text === '') text = '0';
        return neg && text !== '0' ? `-${text}` : text;
    };
}

// Number with up to `digits` significant digits, never in exponent form (Arch does not read 1e-3).
export function fmt(v, digits = 6) {
    if (!Number.isFinite(v) || Math.abs(v) < 1e-15) return '0';
    const mag = Math.floor(Math.log10(Math.abs(v)));
    const decimals = Math.min(20, Math.max(0, digits - 1 - mag));
    let text = v.toFixed(decimals);
    if (text.includes('.')) text = text.replace(/\.?0+$/, '');
    return text === '-0' ? '0' : text;
}

// "name - c" written without "--" or "+-".
export const minus = (name, c) => c === '0' ? name : c.startsWith('-') ? `${name}+${c.slice(1)}` : `${name}-${c}`;

// a*x + b*y + c, skipping zero terms.
function linear(a, b, c) {
    const parts = [];
    const term = (k, name) => {
        if (k === '0') return;
        const body = k === '1' ? name : k === '-1' ? `-${name}` : `${k}*${name}`;
        parts.push(parts.length && !body.startsWith('-') ? `+${body}` : body);
    };
    term(a, 'x');
    term(b, 'y');
    if (c !== '0') parts.push(parts.length && !c.startsWith('-') ? `+${c}` : c);
    return parts.join('') || '0';
}

const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; };

// Edges of a set of rings (or open polylines), skipping zero-length ones.
export function edgesOf(rings, open = false) {
    const edges = [];
    for (const ring of rings)
        for (let i = 0; i < ring.length - (open ? 1 : 0); i++) {
            const a = ring[i], b = ring[(i + 1) % ring.length];
            if (a.X !== b.X || a.Y !== b.Y) edges.push([a, b]);
        }
    return edges;
}

// Names of the coordinates u (along) and v (across) for counting crossings along integer
// direction (dx, dy): u = dx*x + dy*y, v = -dy*x + dx*y, a rotation (scaled), so "left of an
// edge" means the same as in x, y.
function frameNames([dx, dy]) {
    const form = (a, b) => {
        if (a && b) return `(${a > 0 ? 'x' : '-x'}${b > 0 ? '+y' : '-y'})`;
        return a ? (a > 0 ? 'x' : '(-x)') : (b > 0 ? 'y' : '(-y)');
    };
    return {u: form(dx, dy), v: form(-dy, dx)};
}

// The terms of W and D for edge a-b, counting crossings along integer direction `dir`.
//
// W term: 1 when the ray from (x, y) along `dir` crosses the edge, else 0. The edge's v-band is
// half-open, (v1, v2], so a ray through a shared vertex counts once. Null for an edge parallel
// to `dir`.
//
// D term: 1/q with q = 2*perp^2 + 2*max(|u| - h, 0)^2 (see the top of this file). perp is
// written with the same exact cross product C = (u2-u1)*(v-v1)-(v2-v1)*(u-u1) as the crossing
// test, scaled: the distance then vanishes on exactly the line where the crossing count flips,
// so the function has no tiny jump there. (Rounded coefficients would put the two lines ~1e-4
// apart; a grid sample landing in between makes Arch reject or misplace that bit of boundary.)
export function edgeTerms(a, b, coord, q, dir = [1, 0]) {
    const [dx, dy] = dir;
    const A = {U: dx * a.X + dy * a.Y, V: -dy * a.X + dx * a.Y}, B = {U: dx * b.X + dy * b.Y, V: -dy * b.X + dx * b.Y};
    const [lo, hi] = A.V < B.V || (A.V === B.V && A.U < B.U) ? [A, B] : [B, A];
    const {u, v} = frameNames(dir);
    const u1 = coord(lo.U), v1 = coord(lo.V);
    // Only the sign and zero line of C matter here, so integer steps divided by their common
    // factor give short, exact coefficients.
    const g = gcd(hi.U - lo.U, hi.V - lo.V) || 1;
    const du = (hi.U - lo.U) / g, dv = (hi.V - lo.V) / g;
    const parts = [];
    if (du) parts.push(du === 1 ? minus(v, v1) : du === -1 ? `-(${minus(v, v1)})` : `${du}*(${minus(v, v1)})`);
    if (dv) parts.push(`${dv === 1 ? '' : `${dv}*`}(${minus(u, u1)})`);
    const cross = du ? (dv ? `${parts[0]}-${parts[1]}` : parts[0]) : `-${parts[0]}`;
    // C as a*x + b*y + c in device units: perp = C / |(a, b)|.
    const ca = -du * dy - dv * dx, cb = du * dx - dv * dy;
    const k = fmt(2 / (ca * ca + cb * cb));
    const crossing = hi.V === lo.V ? null : `(heaviside(${minus(v, v1)})-heaviside(${minus(v, coord(hi.V))}))*heaviside(${cross})`;

    const ax = a.X * q, ay = a.Y * q, bx = b.X * q, by = b.Y * q;
    const ex = bx - ax, ey = by - ay, len = Math.hypot(ex, ey);
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    // t = |u| - h is how far past the nearer end of the edge (x, y) lies; t*(t+|t|) = 2*max(t,0)^2.
    const along = linear(fmt(ex / len), fmt(ey / len), fmt(-(ex * mx + ey * my) / len));
    const t = minus(`abs(${along})`, fmt(len / 2));
    const scaled = k === '1' ? `(${cross})*(${cross})` : `${k}*(${cross})*(${cross})`;
    const distance = `1/(${scaled}+(${t})*(${t}+abs(${t})))`;
    return {crossing, distance};
}

// A filled region: rings is a list of simple, non-overlapping rings (outer rings and holes).
export function regionExpression(rings, q) {
    const coord = quantumFormatter(q);
    const crossings = [], distances = [];
    for (const [a, b] of edgesOf(rings)) {
        const {crossing, distance} = edgeTerms(a, b, coord, q);
        if (crossing) crossings.push(crossing);
        distances.push(distance);
    }
    if (!crossings.length) return null;
    return `cos(pi*(${crossings.join('+')}))/sqrt(${distances.join('+')})<0`;
}

// Lines drawn by Arch as an equation (see lines.js): [{path, closed, dir}].
export function lineEquation(lines, q) {
    const coord = quantumFormatter(q);
    const crossings = [], distances = [];
    for (const line of lines)
        for (const [a, b] of edgesOf([line.path], !line.closed)) {
            const {crossing, distance} = edgeTerms(a, b, coord, q, line.dir);
            if (crossing) crossings.push(crossing);
            distances.push(distance);
        }
    if (!distances.length) return null;
    return `cos(pi*(${crossings.join('+') || '0'}))/sqrt(${distances.join('+')})=0`;
}

// Point list (polyline) entry: /-/(x,y)(x,y)/(x,y)... ; a top-level / starts a new piece.
export function pointListExpression(paths, q) {
    const coord = quantumFormatter(q);
    return '/-/' + paths.map(path => path.map(p => `(${coord(p.X)},${coord(p.Y)})`).join('')).join('/');
}
