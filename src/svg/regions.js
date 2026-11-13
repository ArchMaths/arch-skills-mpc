// Turns paint operations (in painting order) into disjoint single-colour regions.
//
// Arch fills inequality regions in the order its grid scan first meets them, not in entry
// order, so overlapping regions would stack unpredictably. Instead the picture is flattened:
// each opaque paint cuts its area out of everything beneath it, and a translucent paint splits
// what lies beneath into a blended part and the rest. The resulting pieces never overlap, so
// the drawing order no longer matters.
import * as P from './poly.js';
import * as G from './geom.js';
import {over, archDimsColor, toHex} from './color.js';
import {gradientColorAt} from './render.js';

const WHITE = {r: 1, g: 1, b: 1, a: 1};
const sameColor = (a, b) => ['r', 'g', 'b'].every(k => Math.round(a[k] * 255) === Math.round(b[k] * 255)) && Math.abs(a.a - b.a) < 0.004;

// How much a gradient's colour changes from one end to the other: the sum, over its stops, of
// the largest channel (or opacity) difference between neighbouring stops.
function variation(stops) {
    let total = 0;
    for (let i = 1; i < stops.length; i++) {
        const a = stops[i - 1].color, b = stops[i].color;
        total += Math.max(...['r', 'g', 'b', 'a'].map(k => Math.abs(a[k] - b[k])));
    }
    return total;
}

// Splits a gradient-filled area into bands of solid colour: about one band per 5/255 of colour
// change, at most maxSteps per gradient length (linear) or radius (radial).
// Bands are also kept at least minBandPx wide (on screen at the saved zoom), so Arch's sampling
// grid can show each of them.
//
// layered: the bands come in drawing order for Arch's ordered drawing (linear: along the
// gradient; radial: outermost first), with the element's opacity `alpha` applied to their
// colours, and each band reaches `overlap` integer steps under the next one, so the boundary
// between two bands is drawn once, by the upper band, with no seam. A radial band is then a
// whole disk when that has no more vertices than a ring. overlap must be 0 for translucent
// gradients (overlapping parts would blend twice); their bands then never overlap.
export function gradientBands(paths, paint, {q, tolerance, steps: maxSteps, pxPerUnit = Infinity, minBandPx = 0, layered = false, overlap = 0, alpha = 1}) {
    const box = P.bbox(paths);
    if (!box) return [];
    const lengthPx = (paint.type === 'linear'
        ? Math.hypot(...G.apply([...paint.toDevice.slice(0, 4), 0, 0], paint.x2 - paint.x1, paint.y2 - paint.y1))
        : paint.r * G.maxScale(paint.toDevice)) * pxPerUnit;
    const bySize = minBandPx > 0 ? Math.max(1, Math.floor(lengthPx / minBandPx)) : Infinity;
    const steps = Math.min(maxSteps, bySize, Math.max(1, Math.ceil(variation(paint.stops) * 255 / 5)));
    const inv = G.invert(paint.toDevice);
    if (!inv) return [{paths, color: paint.stops[paint.stops.length - 1].color}];
    const corners = [[box.minX, box.minY], [box.maxX, box.minY], [box.maxX, box.maxY], [box.minX, box.maxY]]
        .map(([X, Y]) => G.apply(inv, X * q, Y * q));
    const bands = [];
    // Intervals [a, b] of t, each with one colour; neighbours with the same colour are merged.
    const intervals = (tmin, tmax) => {
        const out = [];
        const push = (a, b, color) => {
            if (b - a <= 1e-6) return;          // a zero-width pad interval (the gradient starts at the shape's edge)
            const last = out[out.length - 1];
            if (last && sameColor(last.color, color)) last.b = b;
            else out.push({a, b, color});
        };
        const split = (a, b) => {
            const n = Math.max(1, Math.ceil((b - a) * steps - 1e-9));
            for (let i = 0; i < n; i++) {
                const t0 = a + (b - a) * i / n, t1 = a + (b - a) * (i + 1) / n;
                push(t0, t1, gradientColorAt(paint, (t0 + t1) / 2));
            }
        };
        if (paint.spread === 'pad') {
            if (tmin < 0) push(tmin, Math.min(0, tmax), paint.stops[0].color);
            if (tmax > 0 && tmin < 1) split(Math.max(0, tmin), Math.min(1, tmax));
            if (tmax > 1) push(Math.max(1, tmin), tmax, paint.stops[paint.stops.length - 1].color);
        } else split(tmin, tmax);
        return out;
    };
    const toInt = points => P.toPaths([{points: points.map(([x, y]) => G.apply(paint.toDevice, x, y))}], q);

    if (paint.type === 'linear') {
        const vx = paint.x2 - paint.x1, vy = paint.y2 - paint.y1, len2 = vx * vx + vy * vy;
        if (!(len2 > 0)) return [{paths, color: paint.stops[paint.stops.length - 1].color}];
        const len = Math.sqrt(len2), nx = -vy / len, ny = vx / len;
        const ts = corners.map(([x, y]) => ((x - paint.x1) * vx + (y - paint.y1) * vy) / len2);
        const ss = corners.map(([x, y]) => (x - paint.x1) * nx + (y - paint.y1) * ny);
        const tmin = Math.min(...ts), tmax = Math.max(...ts);
        const pad = 0.01 * (Math.max(...ss) - Math.min(...ss)) + 1e-9;
        const smin = Math.min(...ss) - pad, smax = Math.max(...ss) + pad;
        const at = (t, s) => [paint.x1 + t * vx + s * nx, paint.y1 + t * vy + s * ny];
        const list = intervals(tmin - 1e-9, tmax + 1e-9);
        // How far t moves per integer step on screen (the gradient of t in device space).
        const tAt = (X, Y) => { const [x, y] = G.apply(inv, X, Y); return ((x - paint.x1) * vx + (y - paint.y1) * vy) / len2; };
        const dt = layered && overlap ? overlap * q * Math.hypot(tAt(1, 0) - tAt(0, 0), tAt(0, 1) - tAt(0, 0)) : 0;
        list.forEach((iv, i) => {
            // The outermost bands extend past the bounding box so rounding cannot leave a sliver.
            const last = i === list.length - 1;
            const a = i === 0 ? iv.a - 0.01 : iv.a, b = last ? iv.b + 0.01 : iv.b + dt;
            const strip = toInt([at(a, smin), at(b, smin), at(b, smax), at(a, smax)]);
            bands.push({paths: P.intersect(P.normalize(strip), paths), color: layered ? {...iv.color, a: iv.color.a * alpha} : iv.color});
        });
    } else {
        const {cx, cy, r} = paint;
        if (!(r > 0)) return [{paths, color: paint.stops[paint.stops.length - 1].color}];
        const tmax = Math.max(...corners.map(([x, y]) => Math.hypot(x - cx, y - cy))) / r;
        const stretch = G.maxScale(paint.toDevice);
        const disk = t => {
            const rho = t * r, devR = rho * stretch;
            const n = Math.min(720, Math.max(12, Math.ceil(Math.PI * Math.sqrt(devR / (2 * tolerance)))));
            const pts = [];
            for (let i = 0; i < n; i++) pts.push([cx + rho * Math.cos(2 * Math.PI * i / n), cy + rho * Math.sin(2 * Math.PI * i / n)]);
            return P.normalize(toInt(pts));
        };
        const list = intervals(0, tmax * 1.01 + 1e-9);
        if (layered) {
            // Outermost first; each band reaches `overlap` under the next (inner) band.
            const reach = overlap * q / (G.minScale(paint.toDevice) || 1) / r;
            const vertices = p => p.reduce((n, ring) => n + ring.length, 0);
            const parts = [];
            for (let i = list.length - 1; i >= 0; i--) {
                const iv = list[i];
                const whole = i === list.length - 1 ? paths : P.intersect(disk(iv.b), paths);
                const hole = iv.a - reach;
                const ring = i > 0 && hole > 0 ? P.difference(whole, disk(hole)) : whole;
                parts.push({whole, ring, color: {...iv.color, a: iv.color.a * alpha}});
            }
            for (const p of parts) bands.push({paths: overlap && vertices(p.whole) <= vertices(p.ring) ? p.whole : p.ring, color: p.color});
            return bands.filter(b => b.paths.length && b.color.a > 0.002);
        }
        let inner = [];
        list.forEach((iv, i) => {
            const outer = i === list.length - 1 ? paths : disk(iv.b);
            const ring = i === list.length - 1 ? P.difference(paths, inner) : P.intersect(P.difference(outer, inner), paths);
            bands.push({paths: ring, color: iv.color});
            inner = outer;
        });
    }
    return bands.filter(b => b.paths.length);
}

// Paints ops in order. Returns {pieces: [{paths, bbox, color}], lines: [{paths, bbox, color, widthPx}], texts}.
export function flattenOps(ops, {q, tolerance, gradientSteps = 24, pxPerUnit, minBandPx}) {
    let pieces = [];
    const lines = [], texts = [];
    const addPiece = (S, color) => {
        if (!S.length || color.a <= 0.002) return;
        const box = P.bbox(S);
        if (color.a >= 0.998) {
            for (const line of lines)
                if (P.overlaps(line.bbox, box)) { line.paths = P.clipOpen(line.paths, S, false); line.bbox = P.bbox(line.paths); }
            // A piece of exactly this colour absorbs the new area instead of being cut by it:
            // cutting and re-merging would leave slivers where the two outlines nearly coincide.
            const same = pieces.find(p => p.color.a === 1 && sameColor(p.color, color) && P.overlaps(p.bbox, box));
            for (const piece of pieces)
                if (piece !== same && P.overlaps(piece.bbox, box)) { piece.paths = P.difference(piece.paths, S); piece.bbox = P.bbox(piece.paths); }
            pieces = pieces.filter(p => p.paths.length);
            if (same) { same.paths = P.union(same.paths, S); same.bbox = P.bbox(same.paths); }
            else pieces.push({paths: S, bbox: box, color: {...color, a: 1}});
            return;
        }
        const blended = [], covered = [];
        for (const piece of pieces) {
            if (!P.overlaps(piece.bbox, box)) continue;
            const inside = P.intersect(piece.paths, S);
            if (!inside.length) continue;
            piece.paths = P.difference(piece.paths, S);
            piece.bbox = P.bbox(piece.paths);
            blended.push({paths: inside, bbox: P.bbox(inside), color: over(color, piece.color)});
            covered.push(...inside);
        }
        pieces = pieces.filter(p => p.paths.length);
        const rest = covered.length ? P.difference(S, covered) : S;
        if (rest.length) pieces.push({paths: rest, bbox: P.bbox(rest), color});
        pieces.push(...blended);
    };
    for (const op of ops) {
        if (op.kind === 'line') {
            if (op.paths.length) lines.push({paths: op.paths, bbox: P.bbox(op.paths), color: {...op.color, a: op.color.a * op.alpha}, widthPx: op.widthPx});
        } else if (op.kind === 'text') {
            texts.push(op);
        } else if (op.kind === 'fill') {
            if (op.paint.type === 'solid') addPiece(op.paths, {...op.paint.color, a: op.paint.color.a * op.alpha});
            else for (const band of gradientBands(op.paths, op.paint, {q, tolerance, steps: Math.max(1, gradientSteps), pxPerUnit, minBandPx}))
                addPiece(band.paths, {...band.color, a: band.color.a * op.alpha});
        }
    }
    return {pieces, lines: lines.filter(l => l.paths.length), texts};
}

// How a piece is drawn on Arch's white canvas: its colour composited over white, as an opaque
// fill. Arch's light theme dims colours with saturation < 15 and brightness > 85 to brightness
// 85, so those are drawn as a translucent darker colour that composites to the same result over
// white instead; pure white is left out (the canvas already shows it).
export function displayColor(color) {
    const eff = over(color, WHITE);
    if (!archDimsColor(eff)) return {color: {...eff, a: 1}, hex: toHex(eff), opacity: 1};
    const alpha = Math.max(1 - eff.r, 1 - eff.g, 1 - eff.b);
    if (alpha < 0.75 / 255) return null;
    const ink = {r: 1 - (1 - eff.r) / alpha, g: 1 - (1 - eff.g) / alpha, b: 1 - (1 - eff.b) / alpha};
    const opacity = Math.round(alpha * 1000) / 1000;
    return {color: {...ink, a: opacity}, hex: toHex(ink), opacity};
}

// Merges pieces that are drawn alike into regions: [{hex, opacity, paths, area}], largest first.
export function groupRegions(pieces, {cleanDistance = 1.415} = {}) {
    const groups = new Map();
    let white = 0;
    for (const piece of pieces) {
        const shown = displayColor(piece.color);
        if (!shown) { white++; continue; }
        const key = `${shown.hex}|${shown.opacity}`;
        if (!groups.has(key)) groups.set(key, {hex: shown.hex, opacity: shown.opacity, parts: []});
        groups.get(key).parts.push(...piece.paths);
    }
    const regions = [];
    for (const g of groups.values()) {
        const paths = P.clean(P.normalize(g.parts), cleanDistance);
        if (!paths.length) continue;
        regions.push({hex: g.hex, opacity: g.opacity, paths, area: P.area(paths)});
    }
    regions.sort((a, b) => b.area - a.area);
    return {regions, whitePieces: white};
}

// Thin strokes, merged by colour, opacity and width: [{hex, opacity, thickness, paths}].
export function groupLines(lines) {
    const groups = new Map();
    for (const line of lines) {
        const thickness = Math.min(20, Math.max(1, Math.round(line.widthPx)));
        const hex = toHex(line.color), opacity = Math.round(line.color.a * 1000) / 1000;
        const key = `${hex}|${opacity}|${thickness}`;
        if (!groups.has(key)) groups.set(key, {hex, opacity, thickness, paths: []});
        groups.get(key).paths.push(...line.paths);
    }
    return [...groups.values()];
}
