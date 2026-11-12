// Geometry for SVG: affine matrices, the transform attribute, path data, basic shapes,
// curve flattening and dash patterns.
//
// A path is a list of subpaths {x, y, segs, closed}: (x, y) is the start point and each
// segment is {type: 'L', x, y}, {type: 'Q', x1, y1, x, y} or {type: 'C', x1, y1, x2, y2, x, y}.
// Arcs are converted to cubic Beziers while parsing.

export const IDENTITY = [1, 0, 0, 1, 0, 0];

// (a, b, c, d, e, f) maps (x, y) to (a x + c y + e, b x + d y + f), as in SVG.
export function multiply(m, n) {
    return [
        m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
        m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
        m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]
    ];
}

export const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
export const translate = (tx, ty) => [1, 0, 0, 1, tx, ty];
export const scale = (sx, sy = sx) => [sx, 0, 0, sy, 0, 0];
// Geometric mean scale factor: how much the matrix scales lengths on average.
export const meanScale = m => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
// Largest stretch factor (largest singular value).
export function maxScale(m) {
    const [a, b, c, d] = m;
    const s = a * a + b * b + c * c + d * d, det = a * d - b * c;
    return Math.sqrt((s + Math.sqrt(Math.max(0, s * s - 4 * det * det))) / 2);
}
export function invert(m) {
    const det = m[0] * m[3] - m[1] * m[2];
    if (!det) return null;
    return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det,
        (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;

export function parseNumberList(text) {
    const out = [];
    let i = 0;
    text = String(text ?? '');
    while (i < text.length) {
        while (i < text.length && /[\s,]/.test(text[i])) i++;
        if (i >= text.length) break;
        NUMBER.lastIndex = i;
        const m = NUMBER.exec(text);
        if (!m) break;
        out.push(parseFloat(m[0]));
        i = NUMBER.lastIndex;
    }
    return out;
}

// transform="translate(10) rotate(45 5 5)" (also CSS-style units: rotate(45deg), translate(3px, 4px)).
export function parseTransform(text) {
    let m = IDENTITY;
    if (!text || text === 'none') return m;
    const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/gi;
    let found;
    while ((found = re.exec(text)) !== null) {
        const name = found[1].toLowerCase();
        const raw = found[2];
        const toRad = v => /rad/i.test(raw) ? v : /turn/i.test(raw) ? v * 2 * Math.PI : v * Math.PI / 180;
        const v = parseNumberList(raw.replace(/(deg|rad|turn|grad|px)/gi, ' '));
        let t = IDENTITY;
        switch (name) {
        case 'matrix': if (v.length === 6) t = v; break;
        case 'translate': t = translate(v[0] || 0, v[1] || 0); break;
        case 'scale': t = scale(v[0] ?? 1, v[1] ?? v[0] ?? 1); break;
        case 'rotate': {
            const a = toRad(v[0] || 0), cos = Math.cos(a), sin = Math.sin(a);
            t = [cos, sin, -sin, cos, 0, 0];
            if (v.length >= 3) t = multiply(multiply(translate(v[1], v[2]), t), translate(-v[1], -v[2]));
            break;
        }
        case 'skewx': t = [1, 0, Math.tan(toRad(v[0] || 0)), 1, 0, 0]; break;
        case 'skewy': t = [1, Math.tan(toRad(v[0] || 0)), 0, 1, 0, 0]; break;
        }
        m = multiply(m, t);
    }
    return m;
}

// Endpoint arc (SVG implementation notes F.6.5) as cubic Bezier segments.
function arcToCubics(x1, y1, rx, ry, angle, largeArc, sweep, x2, y2) {
    if (x1 === x2 && y1 === y2) return [];
    rx = Math.abs(rx); ry = Math.abs(ry);
    if (!rx || !ry) return [{type: 'L', x: x2, y: y2}];
    const phi = angle * Math.PI / 180, cos = Math.cos(phi), sin = Math.sin(phi);
    const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
    const xp = cos * dx + sin * dy, yp = -sin * dx + cos * dy;
    const lambda = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
    if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda); }
    const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
    const den = rx * rx * yp * yp + ry * ry * xp * xp;
    let coef = Math.sqrt(Math.max(0, num / den));
    if (largeArc === sweep) coef = -coef;
    const cxp = coef * rx * yp / ry, cyp = -coef * ry * xp / rx;
    const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
    const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const t1 = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
    let dt = ang((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
    if (!sweep && dt > 0) dt -= 2 * Math.PI;
    if (sweep && dt < 0) dt += 2 * Math.PI;
    const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9));
    const step = dt / n, k = 4 / 3 * Math.tan(step / 4);
    const point = t => {
        const ex = rx * Math.cos(t), ey = ry * Math.sin(t);
        return [cx + cos * ex - sin * ey, cy + sin * ex + cos * ey];
    };
    const deriv = t => {
        const ex = -rx * Math.sin(t), ey = ry * Math.cos(t);
        return [cos * ex - sin * ey, sin * ex + cos * ey];
    };
    const out = [];
    for (let i = 0; i < n; i++) {
        const a = t1 + i * step, b = a + step;
        const [ax, ay] = point(a), [bx, by] = i === n - 1 ? [x2, y2] : point(b);
        const [dax, day] = deriv(a), [dbx, dby] = deriv(b);
        out.push({type: 'C', x1: ax + k * dax, y1: ay + k * day, x2: bx - k * dbx, y2: by - k * dby, x: bx, y: by});
    }
    return out;
}

const ARGS = {m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0};

// Parses path data. On an error, keeps everything before it (as browsers do) and reports it.
export function parsePath(d) {
    const subpaths = [];
    let error = null;
    const text = String(d ?? '');
    let i = 0;
    let cmd = null;
    let cx = 0, cy = 0, sx = 0, sy = 0;           // current point and subpath start
    let lastCtrl = null, lastType = null;         // for S/T reflection
    let sub = null;
    const skip = () => { while (i < text.length && /[\s,]/.test(text[i])) i++; };
    const number = () => {
        skip();
        NUMBER.lastIndex = i;
        const m = NUMBER.exec(text);
        if (!m) throw new Error(`expected a number at character ${i + 1}`);
        i = NUMBER.lastIndex;
        return parseFloat(m[0]);
    };
    const flag = () => {
        skip();
        const ch = text[i];
        if (ch !== '0' && ch !== '1') throw new Error(`expected an arc flag (0 or 1) at character ${i + 1}`);
        i++;
        return ch === '1';
    };
    const ensureSub = () => {
        if (!sub) { sub = {x: cx, y: cy, segs: [], closed: false}; subpaths.push(sub); }
    };
    try {
        for (;;) {
            skip();
            if (i >= text.length) break;
            const ch = text[i];
            if (/[MmLlHhVvCcSsQqTtAaZz]/.test(ch)) { cmd = ch; i++; }
            else if (cmd === null) throw new Error(`path data must start with M, found "${ch}"`);
            else if (cmd === 'M') cmd = 'L';          // extra coordinate pairs after M are lineto
            else if (cmd === 'm') cmd = 'l';
            else if (cmd === 'z' || cmd === 'Z') throw new Error(`unexpected "${ch}" after Z at character ${i + 1}`);
            const rel = cmd === cmd.toLowerCase();
            const c = cmd.toLowerCase();
            if (c === 'z') {
                if (sub) { sub.closed = true; sub = null; }
                cx = sx; cy = sy;
                lastType = 'z';
                continue;
            }
            const ox = rel ? cx : 0, oy = rel ? cy : 0;
            let ctrl = null;
            switch (c) {
            case 'm': {
                const x = number() + ox, y = number() + oy;
                cx = sx = x; cy = sy = y;
                sub = {x, y, segs: [], closed: false};
                subpaths.push(sub);
                break;
            }
            case 'l': { const x = number() + ox, y = number() + oy; ensureSub(); sub.segs.push({type: 'L', x, y}); cx = x; cy = y; break; }
            case 'h': { const x = number() + ox; ensureSub(); sub.segs.push({type: 'L', x, y: cy}); cx = x; break; }
            case 'v': { const y = number() + oy; ensureSub(); sub.segs.push({type: 'L', x: cx, y}); cy = y; break; }
            case 'c': {
                const x1 = number() + ox, y1 = number() + oy, x2 = number() + ox, y2 = number() + oy, x = number() + ox, y = number() + oy;
                ensureSub(); sub.segs.push({type: 'C', x1, y1, x2, y2, x, y}); ctrl = [x2, y2]; cx = x; cy = y;
                break;
            }
            case 's': {
                const [x1, y1] = lastType === 'c' && lastCtrl ? [2 * cx - lastCtrl[0], 2 * cy - lastCtrl[1]] : [cx, cy];
                const x2 = number() + ox, y2 = number() + oy, x = number() + ox, y = number() + oy;
                ensureSub(); sub.segs.push({type: 'C', x1, y1, x2, y2, x, y}); ctrl = [x2, y2]; cx = x; cy = y;
                break;
            }
            case 'q': {
                const x1 = number() + ox, y1 = number() + oy, x = number() + ox, y = number() + oy;
                ensureSub(); sub.segs.push({type: 'Q', x1, y1, x, y}); ctrl = [x1, y1]; cx = x; cy = y;
                break;
            }
            case 't': {
                const [x1, y1] = lastType === 'q' && lastCtrl ? [2 * cx - lastCtrl[0], 2 * cy - lastCtrl[1]] : [cx, cy];
                const x = number() + ox, y = number() + oy;
                ensureSub(); sub.segs.push({type: 'Q', x1, y1, x, y}); ctrl = [x1, y1]; cx = x; cy = y;
                break;
            }
            case 'a': {
                const rx = number(), ry = number(), angle = number(), large = flag(), sweep = flag();
                const x = number() + ox, y = number() + oy;
                ensureSub(); sub.segs.push(...arcToCubics(cx, cy, rx, ry, angle, large, sweep, x, y)); cx = x; cy = y;
                break;
            }
            }
            lastType = c === 's' ? 'c' : c === 't' ? 'q' : c;
            lastCtrl = ctrl;
        }
    } catch (e) {
        error = e.message;
    }
    return {subpaths, error};
}

// Basic shapes as paths (SVG 2 shape-to-path equivalents).
export function rectPath(x, y, w, h, rx, ry) {
    if (!(w > 0) || !(h > 0)) return [];
    if (rx === undefined && ry === undefined) rx = ry = 0;
    else if (rx === undefined) rx = ry;
    else if (ry === undefined) ry = rx;
    rx = Math.min(Math.max(0, rx), w / 2); ry = Math.min(Math.max(0, ry), h / 2);
    if (!rx || !ry) return [{x, y, closed: true, segs: [{type: 'L', x: x + w, y}, {type: 'L', x: x + w, y: y + h}, {type: 'L', x, y: y + h}]}];
    const k = 0.5522847498;
    const segs = [
        {type: 'L', x: x + w - rx, y},
        {type: 'C', x1: x + w - rx + k * rx, y1: y, x2: x + w, y2: y + ry - k * ry, x: x + w, y: y + ry},
        {type: 'L', x: x + w, y: y + h - ry},
        {type: 'C', x1: x + w, y1: y + h - ry + k * ry, x2: x + w - rx + k * rx, y2: y + h, x: x + w - rx, y: y + h},
        {type: 'L', x: x + rx, y: y + h},
        {type: 'C', x1: x + rx - k * rx, y1: y + h, x2: x, y2: y + h - ry + k * ry, x, y: y + h - ry},
        {type: 'L', x, y: y + ry},
        {type: 'C', x1: x, y1: y + ry - k * ry, x2: x + rx - k * rx, y2: y, x: x + rx, y}
    ];
    return [{x: x + rx, y, closed: true, segs}];
}

export function ellipsePath(cx, cy, rx, ry) {
    if (!(rx > 0) || !(ry > 0)) return [];
    const k = 0.5522847498;
    return [{x: cx + rx, y: cy, closed: true, segs: [
        {type: 'C', x1: cx + rx, y1: cy + k * ry, x2: cx + k * rx, y2: cy + ry, x: cx, y: cy + ry},
        {type: 'C', x1: cx - k * rx, y1: cy + ry, x2: cx - rx, y2: cy + k * ry, x: cx - rx, y: cy},
        {type: 'C', x1: cx - rx, y1: cy - k * ry, x2: cx - k * rx, y2: cy - ry, x: cx, y: cy - ry},
        {type: 'C', x1: cx + k * rx, y1: cy - ry, x2: cx + rx, y2: cy - k * ry, x: cx + rx, y: cy}
    ]}];
}

export function polyPath(pointsText, closed) {
    const v = parseNumberList(pointsText);
    if (v.length < 4) return [];
    const segs = [];
    for (let i = 2; i + 1 < v.length; i += 2) segs.push({type: 'L', x: v[i], y: v[i + 1]});
    return [{x: v[0], y: v[1], closed, segs}];
}

export const linePath = (x1, y1, x2, y2) => [{x: x1, y: y1, closed: false, segs: [{type: 'L', x: x2, y: y2}]}];

// Flattens a path through matrix m into polylines [{points: [[x,y],...], closed}], with each
// curve within `tolerance` (in output units) of its polyline.
export function flatten(subpaths, m, tolerance) {
    const out = [];
    const tol = Math.max(tolerance, 1e-12);
    for (const sub of subpaths) {
        let [px, py] = apply(m, sub.x, sub.y);
        const points = [[px, py]];
        for (const s of sub.segs) {
            const [x, y] = apply(m, s.x, s.y);
            if (s.type === 'L') points.push([x, y]);
            else if (s.type === 'Q') {
                const [x1, y1] = apply(m, s.x1, s.y1);
                const dd = Math.hypot(px - 2 * x1 + x, py - 2 * y1 + y);
                const n = Math.min(1000, Math.max(1, Math.ceil(Math.sqrt(dd / (4 * tol)))));
                for (let i = 1; i <= n; i++) {
                    const t = i / n, u = 1 - t;
                    points.push([u * u * px + 2 * u * t * x1 + t * t * x, u * u * py + 2 * u * t * y1 + t * t * y]);
                }
            } else {
                const [x1, y1] = apply(m, s.x1, s.y1), [x2, y2] = apply(m, s.x2, s.y2);
                const dd = Math.max(Math.hypot(px - 2 * x1 + x2, py - 2 * y1 + y2), Math.hypot(x1 - 2 * x2 + x, y1 - 2 * y2 + y));
                const n = Math.min(1000, Math.max(1, Math.ceil(Math.sqrt(3 * dd / (4 * tol)))));
                for (let i = 1; i <= n; i++) {
                    const t = i / n, u = 1 - t;
                    points.push([
                        u * u * u * px + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x,
                        u * u * u * py + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y
                    ]);
                }
            }
            px = x; py = y;
        }
        out.push({points, closed: sub.closed});
    }
    return out;
}

// Bounding box of a path's polylines: {x, y, width, height} or null.
export function bounds(polylines) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const {points} of polylines)
        for (const [x, y] of points) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
        }
    return minX <= maxX ? {x: minX, y: minY, width: maxX - minX, height: maxY - minY} : null;
}

// Splits polylines into dashes. dashes: [on, off, on, ...] (already doubled to even length).
export function dashPolylines(polylines, dashes, offset) {
    const total = dashes.reduce((s, d) => s + d, 0);
    if (!(total > 0) || dashes.some(d => d < 0)) return polylines;
    const out = [];
    for (const {points, closed} of polylines) {
        const pts = closed && points.length > 1 ? [...points, points[0]] : points;
        // Position in the pattern at the start of this subpath.
        let pos = ((offset % total) + total) % total;
        let index = 0;
        while (pos >= dashes[index]) { pos -= dashes[index]; index = (index + 1) % dashes.length; }
        let left = dashes[index] - pos;           // length left in the current dash or gap
        let on = index % 2 === 0;
        let current = on ? [pts[0]] : null;
        for (let i = 1; i < pts.length; i++) {
            let [ax, ay] = pts[i - 1];
            const [bx, by] = pts[i];
            let seg = Math.hypot(bx - ax, by - ay);
            while (seg > left) {
                const t = left / seg;
                const mx = ax + (bx - ax) * t, my = ay + (by - ay) * t;
                if (on) { current.push([mx, my]); out.push({points: current, closed: false}); current = null; }
                else current = [[mx, my]];
                on = !on;
                seg -= left;
                ax = mx; ay = my;
                index = (index + 1) % dashes.length;
                left = dashes[index];
            }
            left -= seg;
            if (on) current.push([bx, by]);
        }
        if (on && current && current.length > 1) out.push({points: current, closed: false});
    }
    return out;
}
