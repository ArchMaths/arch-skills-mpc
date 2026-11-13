// Turns paint operations (in painting order) into layers that Arch draws bottom to top.
//
// Arch 12202+ can draw every object in creation order ("顺序绘图", ordered drawing, saved in the
// file), inequality fills included. So, unlike the flattening in regions.js, shapes are kept
// whole and simply stacked like the SVG paints them: nothing is cut out of what lies beneath,
// and no seam lines are needed between neighbouring pieces. A shape's outline is drawn once, by
// the shape itself, so there are no hairline gaps or notches where two pieces meet.
//
// What Arch cannot draw as it is, is handled here:
// - Near-white colours (saturation < 15, brightness > 85) show as light grey in Arch's light
//   theme, and pure white as black. An opaque near-white shape is cut out of everything beneath
//   it, so Arch's white canvas shows through, with a translucent darker "ink" on top for colours
//   that are not quite white.
// - Translucent paint. Arch's ordered drawing blends fills (and lines) into a transparent WebGL
//   canvas with SRC_ALPHA on all four channels, then draws that canvas over its white background,
//   so a layer of colour c and opacity a shows as a*c + (1-a)*below + a*(1-a)*white: lighter than
//   ordinary blending (see archOver). Each translucent shape gets the colour and opacity that
//   make Arch show what the SVG shows over what actually lies beneath it, within 8/255; where no
//   single layer can, it is blended here and drawn as opaque pieces, which Arch shows exactly.
// - Arch interpolates each fill on its own sampling grid and cuts corners off within a cell. Where
//   a shape borders an earlier one (or a gradient band the next band), the lower one is extended
//   about a cell beneath the upper one, so no seam or notch shows along their common boundary.
//
// Layers that later opaque shapes hide completely are dropped (partly hidden ones are trimmed when
// that saves vertices), and a shape is merged into an earlier layer that Arch draws alike when
// nothing drawn in between overlaps it.
import * as P from './poly.js';
import {over, archDimsColor, toHex} from './color.js';
import {gradientBands} from './regions.js';

const WHITE = {r: 1, g: 1, b: 1, a: 1};
const RGB = ['r', 'g', 'b'];
const drawable = c => !archDimsColor(c);
const vertices = paths => paths.reduce((n, r) => n + r.length, 0);
const round3 = v => Math.round(v * 1000) / 1000;
const clamp01 = v => Math.min(1, Math.max(0, v));
const isWhite = c => RGB.every(k => c[k] >= 254.5 / 255);

// Arch's WebGL canvas in ordered drawing: premultiplied colour {r, g, b} and alpha a, starting
// clear. A layer of colour c (non-premultiplied, opacity c.a) is blended with SRC_ALPHA,
// ONE_MINUS_SRC_ALPHA on all four channels, so alpha becomes c.a^2 + (1 - c.a) * a, not
// c.a + (1 - c.a) * a. The canvas is then drawn over the white background (archShown).
export const CLEAR = {r: 0, g: 0, b: 0, a: 0};
export const archOver = (c, s) => ({r: c.a * c.r + (1 - c.a) * s.r, g: c.a * c.g + (1 - c.a) * s.g,
    b: c.a * c.b + (1 - c.a) * s.b, a: c.a * c.a + (1 - c.a) * s.a});
export const archShown = s => ({r: s.r + 1 - s.a, g: s.g + 1 - s.a, b: s.b + 1 - s.a, a: 1});

// The nearest colour Arch draws as it is: a tinted near-white gets 15% saturation (hue and
// brightness kept), a neutral one becomes the lightest grey Arch draws (it dims lighter ones).
export function nearestDrawable(color) {
    if (drawable(color)) return color;
    const max = Math.max(color.r, color.g, color.b), min = Math.min(color.r, color.g, color.b);
    const tinted = max - min > 0.02;
    const top = tinted ? max : 0.85, floor = tinted ? max * 0.84 : 0.85;
    const scale = v => max - min > 1e-9 ? top - (max - v) / (max - min) * (top - floor) : top;
    return {r: scale(color.r), g: scale(color.g), b: scale(color.b), a: color.a};
}

// The colour and opacity to give Arch for paint `target` (non-premultiplied, opacity target.a)
// over backgrounds [{gl (Arch's canvas there), color (what it shows, opaque), weight}], so that
// Arch shows over(target, color) on each of them. Returns {r, g, b, a} or null when the error
// would exceed maxError on a background of at least minWeight.
export function fitLayer(target, backgrounds, {minWeight = 0, maxError = 8 / 255} = {}) {
    let bgs = backgrounds.filter(b => b.weight >= minWeight);
    if (!bgs.length) bgs = backgrounds;
    const goals = bgs.map(b => over(target, b.color));
    // Arch shows alpha*ink + beta on background j, beta = (1-alpha)*C_j + 1 - alpha^2 - (1-alpha)*A_j.
    const evaluate = (alpha, fixed = null) => {
        const ink = {a: alpha};
        let error = 0;
        for (const k of RGB) {
            const betas = bgs.map((b, j) => (1 - alpha) * b.gl[k] + 1 - alpha * alpha - (1 - alpha) * b.gl.a - goals[j][k]);
            const lo = Math.min(...betas), hi = Math.max(...betas);
            ink[k] = fixed ? fixed[k] : clamp01(-(lo + hi) / 2 / alpha);      // minimises the largest error
            for (const beta of betas) error = Math.max(error, Math.abs(alpha * ink[k] + beta));
        }
        if (!fixed && !drawable(ink)) return evaluate(alpha, nearestDrawable(ink));
        return {ink, error};
    };
    // Among equally good opacities, prefer the paint's own (a slight penalty per unit away from
    // it), so inks stay close to the paint's colour instead of leaning on Arch's extra white.
    let best = null;
    const consider = alpha => {
        const r = evaluate(alpha);
        r.score = r.error + (2 / 255) * Math.abs(alpha - target.a);
        if (!best || r.score < best.score) best = r;
    };
    for (let i = 1; i <= 200; i++) consider(i / 200);
    consider(round3(Math.max(0.001, target.a)));
    const centre = best.ink.a;
    for (let d = -5; d <= 5; d++) { const alpha = round3(centre + d / 1000); if (alpha > 0 && alpha <= 1) consider(alpha); }
    return best.error <= maxError ? best.ink : null;
}

// Disjoint pieces of what items (in drawing order, [{paths, draw, shows}]) show: Arch's canvas
// there (gl) and the colour the picture means there (shows, may be translucent over nothing).
function flattenPieces(items) {
    let pieces = [];
    for (const {paths, draw, shows} of items) {
        const box = P.bbox(paths);
        if (draw.a >= 0.998) {
            for (const p of pieces) if (P.overlaps(p.bbox, box)) { p.paths = P.difference(p.paths, paths); p.bbox = P.bbox(p.paths); }
            pieces = pieces.filter(p => p.paths.length);
            pieces.push({paths, bbox: box, gl: {...draw, a: 1}, shows: {...shows, a: 1}});
            continue;
        }
        const blended = [], covered = [];
        for (const p of pieces) {
            if (!P.overlaps(p.bbox, box)) continue;
            const inside = P.intersect(p.paths, paths);
            if (!inside.length) continue;
            p.paths = P.difference(p.paths, paths);
            p.bbox = P.bbox(p.paths);
            blended.push({paths: inside, bbox: P.bbox(inside), gl: archOver(draw, p.gl), shows: over(shows, p.shows)});
            covered.push(...inside);
        }
        pieces = pieces.filter(p => p.paths.length);
        const rest = covered.length ? P.difference(paths, covered) : paths;
        if (rest.length) pieces.push({paths: rest, bbox: P.bbox(rest), gl: archOver(draw, CLEAR), shows});
        pieces.push(...blended);
    }
    return pieces;
}

// ops: from SvgRenderer.render(). Returns {layers, whitePieces, blended}; each layer is one of
//   {kind: 'fill', paths, hex, opacity, labels}
//   {kind: 'line', paths (open), hex, opacity, thickness, labels}
//   {kind: 'text', op}
// in drawing order. stepPx is Arch's sampling grid in pixels; seams: false skips the underlap.
// blended counts translucent shapes that had to be drawn as opaque pieces.
export function layerOps(ops, {q, tolerance, gradientSteps = 24, pxPerUnit, stepPx, minBandPx = 0, maxEdges = 400, seams = true}) {
    const pxInt = 1 / (pxPerUnit * q);                    // integer steps per screen pixel
    const margin = Math.max(2, Math.round(stepPx * pxInt));     // about one sampling cell
    const tiny = 0.25 * pxInt * pxInt;                    // a quarter of a square pixel
    let layers = [];
    let whitePieces = 0, blended = 0, nextGroup = 1;

    const shapeOf = layer => layer.kind === 'fill' ? layer.paths : layer.footprint;
    const refresh = layer => {
        layer.bbox = P.bbox(layer.paths);
        if (layer.kind === 'line') layer.footprint = P.openOffset(layer.paths, layer.thickness / 2 * pxInt);
        layer.edges = vertices(layer.paths);
    };
    const prune = () => { layers = layers.filter(l => l.kind === 'text' || l.paths.length); };
    const intersects = (a, b) => P.overlaps(a.bbox, b.bbox) && P.area(P.intersect(shapeOf(a), shapeOf(b))) > tiny;
    const sameStyle = (a, b) => a.kind === b.kind && a.kind !== 'text' && a.hex === b.hex && a.opacity === b.opacity &&
        (a.kind !== 'line' || a.thickness === b.thickness);

    // Adds a layer on top, or merges it into an earlier layer of the same style when every layer
    // in between leaves it alone (so drawing it earlier changes nothing). Translucent shapes only
    // merge where they do not overlap: overlapping parts would otherwise blend once instead of twice.
    const place = layer => {
        refresh(layer);
        for (let i = layers.length - 1; i >= 0; i--) {
            const other = layers[i];
            if (sameStyle(other, layer) && other.edges + layer.edges <= maxEdges && (layer.opacity === 1 || !intersects(other, layer))) {
                if (layer.kind === 'fill') other.paths = P.union(other.paths, layer.paths);
                else other.paths = [...other.paths, ...layer.paths];
                other.labels.push(...layer.labels);
                refresh(other);
                return;
            }
            if (intersects(other, layer)) break;
        }
        layers.push(layer);
    };
    // draw: the colour and opacity Arch is given; shows: what the layer stands for (ordinary blending).
    const fillLayer = (paths, draw, shows, label, group = 0) => {
        const opacity = draw.a >= 0.9995 ? 1 : round3(draw.a);
        return {kind: 'fill', paths, draw: {...draw, a: opacity}, shows, hex: toHex(draw), opacity, labels: [label], group};
    };

    // An opaque near-white area: cut out of everything beneath it, so the canvas shows.
    const cut = paths => {
        const box = P.bbox(paths);
        for (const layer of layers) {
            if (layer.kind === 'text' || !P.overlaps(layer.bbox, box)) continue;
            layer.paths = layer.kind === 'fill' ? P.difference(layer.paths, paths) : P.clipOpen(layer.paths, paths, false);
            refresh(layer);
        }
        prune();
    };

    // Extends earlier opaque layers that border `paths` about a cell beneath it: only near its
    // outline (deeper inside nothing can show), only where the earlier layer shows, and only
    // along a shared boundary (not where the two outlines merely cross).
    const underlap = (paths, box, group) => {
        const inner = P.offset(paths, -margin);
        const zone = inner.length ? P.difference(paths, inner) : paths;
        if (!zone.length) return;
        const reach = P.grow(box, 2 * margin), area = P.rect(reach);
        layers.forEach((layer, index) => {
            if (layer.kind !== 'fill' || layer.opacity !== 1 || (group && layer.group === group) || !P.overlaps(layer.bbox, reach)) return;
            const near = P.intersect(layer.paths, area);
            if (!near.length) return;
            const extra = P.difference(P.intersect(P.offset(near, margin), zone), layer.paths);
            if (!extra.length) return;
            const candidates = P.components(extra).filter(rings => P.area(rings) >= 3 * margin * margin);
            if (!candidates.length) return;
            // Only where this layer shows: opaque layers above it may hide it there anyway.
            const local = P.grow(P.bbox(candidates.flat()), 2 * margin);
            let shown = P.intersect(near, P.rect(local));
            const above = layers.slice(index + 1).filter(l => l.kind === 'fill' && l.opacity === 1 && P.overlaps(l.bbox, local));
            if (shown.length && above.length) shown = P.difference(shown, P.normalize(above.flatMap(l => P.intersect(l.paths, P.rect(local)))));
            // A shared boundary: the growth touches the part of this layer outside `paths` that shows,
            // along at least two cells (a crossing point of the two outlines only touches it at a point).
            const outside = P.difference(shown, paths);
            if (!outside.length) return;
            const keep = candidates.filter(rings => P.area(P.intersect(P.offset(rings, 2), outside)) >= 8 * margin).flat();
            if (!keep.length) return;
            layer.paths = P.union(layer.paths, keep);
            refresh(layer);
        });
    };

    // What an opaque area hides: thin strokes beneath it are cut back to its outline, layers it
    // covers completely are dropped, and others lose what lies more than a cell inside it (they
    // keep reaching under its edge), when that does not cost vertices.
    // group: the gradient `paths` belongs to (its own bands are culled but never trimmed);
    // whole: `paths` is that whole gradient, which does not hide its own bands.
    const occlude = (paths, group = 0, whole = false) => {
        const box = P.bbox(paths);
        let inner = null;
        for (const layer of layers) {
            const own = group && layer.group === group;
            if (layer.kind === 'text' || (own && whole) || !P.overlaps(layer.bbox, box)) continue;
            if (layer.kind === 'line') { layer.paths = P.clipOpen(layer.paths, paths, false); refresh(layer); continue; }
            if (P.area(P.difference(layer.paths, paths)) <= tiny) { layer.paths = []; continue; }
            if (own) continue;
            inner ??= P.offset(paths, -margin);
            if (!inner.length) continue;
            const trimmed = P.difference(layer.paths, inner);
            if (vertices(trimmed) <= layer.edges && P.area(trimmed) < P.area(layer.paths) - tiny) { layer.paths = trimmed; refresh(layer); }
        }
        prune();
    };

    // An opaque colour Arch can draw: hides what it covers, its neighbours beneath reach under
    // its edge, then it goes on top.
    const addOpaque = (paths, color, label, group) => {
        occlude(paths, group);
        if (seams) underlap(paths, P.bbox(paths), group);
        place(fillLayer(paths, color, color, label, group));
    };

    // What lies beneath `paths` now: [{paths, gl, color (opaque, over the canvas), weight}].
    const backgroundsOf = paths => {
        const box = P.bbox(paths);
        const items = [];
        for (const layer of layers) {
            if (layer.kind !== 'fill' || !P.overlaps(layer.bbox, box)) continue;
            const part = P.intersect(layer.paths, paths);
            if (part.length) items.push({paths: part, draw: layer.draw, shows: layer.shows});
        }
        const pieces = flattenPieces(items);
        const out = pieces.map(p => ({paths: p.paths, gl: p.gl, color: over(p.shows, WHITE), weight: P.area(p.paths)}));
        const covered = P.normalize(pieces.flatMap(p => p.paths));
        const rest = covered.length ? P.difference(paths, covered) : paths;
        if (rest.length) out.push({paths: rest, gl: CLEAR, color: WHITE, weight: P.area(rest)});
        return out;
    };
    // What Arch shows at one point now: {gl, color}, as backgroundsOf gives per piece.
    const backgroundAt = (X, Y) => {
        let gl = CLEAR, shows = {r: 1, g: 1, b: 1, a: 0};
        for (const layer of layers)
            if (layer.kind === 'fill' && layer.bbox.minX <= X && X <= layer.bbox.maxX && layer.bbox.minY <= Y && Y <= layer.bbox.maxY &&
                P.contains(layer.paths, X, Y)) { gl = archOver(layer.draw, gl); shows = over(layer.shows, shows); }
        return {gl, color: over(shows, WHITE), weight: 1};
    };

    const addFill = (paths, color, label, group = 0) => {
        if (!paths.length || color.a <= 0.002) return;
        if (color.a >= 0.998) {
            const c = {...color, a: 1};
            if (drawable(c)) return addOpaque(paths, c, label, group);
            cut(paths);
            if (isWhite(c)) { whitePieces++; return; }
            const ink = fitLayer(c, [{gl: CLEAR, color: WHITE, weight: 1}]);
            if (ink) place(fillLayer(paths, ink, c, label, group));
            return;
        }
        const backgrounds = backgroundsOf(paths);
        const fit = fitLayer(color, backgrounds, {minWeight: 16 * tiny});
        if (fit) return place(fillLayer(paths, fit, color, label, group));
        // No single layer will do: blend it here, piece by piece, as opaque colours (near-white
        // results first, as they cut what lies beneath; then the others, largest first).
        blended++;
        const byColor = new Map();
        for (const b of backgrounds) {
            const result = {...over(color, b.color), a: 1};
            const key = toHex(result);
            if (byColor.has(key)) byColor.get(key).paths.push(...b.paths);
            else byColor.set(key, {paths: [...b.paths], color: result});
        }
        const parts = [...byColor.values()].map(m => ({...m, paths: P.normalize(m.paths)}));
        parts.sort((a, b) => (drawable(a.color) - drawable(b.color)) || P.area(b.paths) - P.area(a.paths));
        for (const part of parts) addFill(part.paths, part.color, label, group);
    };

    const addLine = op => {
        const color = {...op.color, a: op.color.a * op.alpha};
        if (color.a <= 0.002 || !op.paths.length) return;
        let draw = color.a >= 0.998 && drawable(color) ? {...color, a: 1} : null;
        if (!draw) {
            // Translucent or near-white: fitted to what lies beneath the line (sampled along it),
            // or else the average result as an opaque colour Arch draws.
            const all = op.paths.flat(), stride = Math.max(1, Math.floor(all.length / 64));
            const samples = [];
            for (let i = 0; i < all.length; i += stride) samples.push(backgroundAt(all[i].X, all[i].Y));
            draw = fitLayer(color, samples, {maxError: 12 / 255});
            if (!draw) {
                const mean = {r: 0, g: 0, b: 0, a: 1};
                for (const s of samples) { const r = over(color, s.color); for (const k of RGB) mean[k] += r[k] / samples.length; }
                if (isWhite(mean)) { whitePieces++; return; }
                draw = nearestDrawable(mean);
            }
        }
        const opacity = draw.a >= 0.9995 ? 1 : round3(draw.a);
        place({kind: 'line', paths: op.paths, hex: toHex(draw), opacity,
            thickness: Math.min(20, Math.max(1, Math.round(op.widthPx))), labels: [op.label]});
    };

    for (const op of ops) {
        if (op.kind === 'line') addLine(op);
        else if (op.kind === 'text') {
            const width = 0.55 * op.size * op.content.length;
            const x = op.anchor === 'middle' ? op.x - width / 2 : op.anchor === 'end' ? op.x - width : op.x;
            const bbox = {minX: Math.floor(x / q), maxX: Math.ceil((x + width) / q), minY: Math.floor(op.y / q), maxY: Math.ceil((op.y + op.size) / q)};
            layers.push({kind: 'text', op, bbox, footprint: P.rect(bbox)});
        } else if (op.kind === 'fill') {
            if (op.paint.type === 'solid') addFill(op.paths, {...op.paint.color, a: op.paint.color.a * op.alpha}, op.label);
            else {
                const opaque = op.alpha >= 0.998 && op.paint.stops.every(s => s.color.a >= 0.998);
                const group = nextGroup++;
                const bands = gradientBands(op.paths, op.paint, {q, tolerance, steps: Math.max(1, gradientSteps), pxPerUnit, minBandPx,
                    layered: true, overlap: opaque && seams ? margin : 0, alpha: op.alpha});
                for (const band of bands) addFill(band.paths, band.color, op.label, group);
                // Together the bands hide what lies beneath the whole shape.
                if (opaque) occlude(op.paths, group, true);
            }
        }
    }
    return {layers: layers.map(({kind, paths, hex, opacity, thickness, labels, op}) =>
        kind === 'text' ? {kind, op} : kind === 'fill' ? {kind, paths, hex, opacity, labels} : {kind, paths, hex, opacity, thickness, labels}),
    whitePieces, blended};
}
