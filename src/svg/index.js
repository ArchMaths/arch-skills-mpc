// SVG -> Arch scene script. Every filled shape of the picture becomes an inequality (see
// inequality.js), and text becomes @text boxes. Filters are ignored.
//
// By default the shapes are stacked in the SVG's painting order and the file switches on Arch's
// ordered drawing (Arch 12202+), see layers.js. Each opaque shape is traced with an exact point
// list just inside its outline, and strokes too thin for Arch's sampling grid are point lists
// too (outline.js). flatten: true instead cuts the picture into regions that never overlap,
// with seam lines between them and thin strokes as equations (regions.js, seams.js, lines.js),
// for older Arch builds, which fill overlapping inequalities in grid-scan order.
import {SvgRenderer} from './render.js';
import {flattenOps, groupRegions, groupLines} from './regions.js';
import {layerOps} from './layers.js';
import {outlineRuns, toIntPaths, runCoverage, concaveCorners} from './outline.js';
import {regionExpression, lineEquation, pointListExpression, edgesOf, fmt} from './inequality.js';
import {planLines} from './lines.js';
import {seamLines} from './seams.js';
import {toHex} from './color.js';
import {elementChildren, textContent} from './xml.js';
import * as P from './poly.js';

// The part of Arch's 1280x800 window left of its sidebar, where @view x=/y= ranges are fitted.
export const CANVAS = {width: 870, height: 800};
const MARGIN = 1.08;
// Rough cost of one edge for one full redraw at the default precision, measured in headless Chrome.
const MS_PER_EDGE = 0.6;

export const DEFAULTS = {
    tolerance: 0.5,          // px: how far a flattened curve may stray from the true curve
    flatten: false,          // cut the picture into non-overlapping regions (Arch before 12202)
    seams: true,             // hide seams between neighbouring shapes: lower shapes reach under
                             // their neighbours (or, with flatten, point lists along shared boundaries)
    outlines: true,          // trace opaque shapes with exact point lists, for sharp edges and corners
    precision: 4,            // Arch's implicitPrecision setting: sampling grid of 20/precision px
    gradientSteps: 24,       // at most this many colour bands per gradient
    maxEdges: 400,           // edges per inequality entry (larger regions are split by component)
    axes: false              // keep Arch's axes and grid visible
};

const NOTES = {
    filter: n => `${n} element(s) have a filter (blur, shadow, ...); filters are ignored.`,
    image: n => `${n} <image> element(s) skipped: raster images cannot be drawn with inequalities.`,
    foreignObject: n => `${n} <foreignObject> element(s) skipped.`,
    pattern: n => `${n} pattern fill(s) are not supported; those areas use the fallback colour if one is given, or stay empty.`,
    mask: n => `${n} mask(s) approximated as clips: drawn where the mask is at least half on, hidden elsewhere (no partial transparency).`,
    marker: n => `${n} element(s) use markers (arrowheads etc.), which are not drawn.`,
    text: (n, flat) => `${n} text run(s) became Arch text boxes (@text): Arch's font, approximate position, ${flat ? 'drawn above all shapes' : 'drawn in painting order'} and not clipped.`,
    'text-rotated': n => `${n} rotated or skewed text element(s) are drawn unrotated.`,
    'path-error': n => `${n} path(s) have errors in their path data; each is drawn up to the error, as browsers do.`,
    focal: n => `${n} radial gradient(s) have a focal point away from the centre; drawn as centred.`,
    blend: n => `${n} element(s) use mix-blend-mode, which is ignored.`,
    'missing-clip': n => `${n} clip-path reference(s) not found; drawn unclipped.`,
    'missing-paint': n => `${n} paint reference(s) (url(#...)) not found; drawn as none.`,
    'missing-use': n => `${n} <use> reference(s) not found.`,
    'use-cycle': n => `${n} <use> element(s) refer to themselves; skipped.`,
    'clip-shape': n => `${n} CSS clip-path shape(s) (inset(), circle(), ...) ignored.`,
    'clip-text': n => `${n} text element(s) inside clip paths ignored.`,
    'bad-color': n => `${n} unreadable colour value(s), drawn black.`
};
const INFO_NOTES = new Set(['filter', 'text']);

function contentBounds(renderer, viewBox) {
    // No viewBox or size: measure the drawing at a provisional scale.
    const probe = new SvgRenderer(renderer.root, {q: 1e-3, tolerance: 0.05, pxPerUnit: 1, lineMaxPx: 0, notes: new Map()});
    const box = P.bbox(probe.render().flatMap(op => op.paths || []));
    if (!box) return viewBox;
    return {x: box.minX * 1e-3, y: -box.maxY * 1e-3, width: (box.maxX - box.minX) * 1e-3 || 1, height: (box.maxY - box.minY) * 1e-3 || 1};
}

const escapeComment = text => text.replace(/\s+/g, ' ').trim();

// Splits a component (outer ring + holes) with more than maxEdges edges into tiles, cutting at
// its median vertex across its longer side, so no entry gets too long for Arch to parse quickly
// (a background with hundreds of holes can reach thousands of edges). Each tile reaches
// `overlap` integer steps under the next one, which is drawn after it, so an opaque fill shows
// no seam where they meet; translucent fills need overlap 0 (they would blend twice).
function tile(rings, maxEdges, overlap, depth = 0) {
    const n = edgesOf(rings).length;
    if (n <= maxEdges || depth > 12) return [rings];
    const box = P.bbox(rings);
    const vertical = box.maxX - box.minX >= box.maxY - box.minY;
    const coords = rings.flat().map(p => vertical ? p.X : p.Y).sort((a, b) => a - b);
    const mid = coords[Math.floor(coords.length / 2)];
    const outer = P.grow(box, 1);
    const lower = P.rect(vertical ? {...outer, maxX: mid + overlap} : {...outer, maxY: mid + overlap});
    const upper = P.rect(vertical ? {...outer, minX: mid} : {...outer, minY: mid});
    const pieces = [...P.components(P.intersect(rings, lower)), ...P.components(P.intersect(rings, upper))];
    if (pieces.some(piece => edgesOf(piece).length >= n)) return [rings];
    return pieces.flatMap(piece => tile(piece, maxEdges, overlap, depth + 1));
}

// Splits components (outer ring + holes) into groups of at most maxEdges edges.
function chunk(components, maxEdges) {
    const out = [];
    let current = [], count = 0;
    for (const rings of components) {
        const n = edgesOf(rings).length;
        if (current.length && count + n > maxEdges) { out.push(current); current = []; count = 0; }
        current.push(rings);
        count += n;
    }
    if (current.length) out.push(current);
    return out;
}

// Returns {script, stats, warnings, info}.
export function convertSvg(source, options = {}) {
    const opts = {...DEFAULTS, ...Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined))};
    if (!(opts.precision >= 0.5 && opts.precision <= 20)) throw new Error('precision must be between 0.5 and 20 (Arch implicitPrecision).');
    if (!(opts.tolerance > 0)) throw new Error('tolerance must be a positive number of pixels.');
    const stepPx = 20 / opts.precision;
    const lineMaxPx = opts.lineMaxPx ?? Math.min(20, 1.5 * stepPx);

    const renderer = new SvgRenderer(source, {notes: new Map()});
    let box = renderer.viewBox();
    if (!box) box = contentBounds(renderer, {x: 0, y: 0, width: 100, height: 100});
    // Device (Arch) coordinates: SVG user units with y flipped.
    const view = {xmin: box.x, xmax: box.x + box.width, ymin: -(box.y + box.height), ymax: -box.y};
    const pxPerUnit = Math.min(CANVAS.width / (box.width * MARGIN), CANVAS.height / (box.height * MARGIN));
    const tolerance = opts.tolerance / pxPerUnit;
    const size = Math.max(box.width, box.height);
    const q = 10 ** Math.floor(Math.log10(Math.min(size / 20000, tolerance / 4)));

    Object.assign(renderer.options, {q, tolerance, pxPerUnit, lineMaxPx});
    const ops = renderer.render();
    const title = (opts.title || textContent(elementChildren(renderer.root).find(c => c.name === 'title') || {text: ''}).trim() || 'SVG drawing').replace(/\s+/g, ' ');
    const pxArea = (pxPerUnit * q) ** 2;
    const cleanDistance = Math.max(1.415, 0.25 * tolerance / q);
    const counts = {edges: 0, entries: 0, thin: 0, lines: 0, seams: 0, outlines: 0, regions: 0, white: 0};
    const body = [];

    // Parts thinner than the sampling grid may break up.
    const checkThin = components => {
        for (const rings of components) {
            // Mean width and length of the part, in pixels at the saved zoom.
            const perimeter = P.perimeter(rings) * q * pxPerUnit;
            const width = 2 * P.area(rings) * pxArea / Math.max(1e-9, perimeter);
            if (width < stepPx && perimeter / 2 > 3 * stepPx) counts.thin++;
        }
    };
    const emitRegion = (components, style, opaque) => {
        const tiles = components.flatMap(rings => tile(rings, opts.maxEdges, opaque ? Math.round(stepPx / pxPerUnit / q) : 0));
        for (const part of chunk(tiles, opts.maxEdges)) {
            const rings = part.flat();
            const expr = regionExpression(rings, q);
            if (!expr) continue;
            counts.edges += edgesOf(rings).length;
            counts.entries++;
            body.push(`${expr} | ${style}`);
        }
    };
    const cellUnits = stepPx / pxPerUnit / q;           // one sampling cell, in integer steps
    const reach = 2 * Math.hypot(box.width, box.height) / q;
    const emitLines = (paths, {hex, opacity, thickness}) => {
        const lines = paths.map(path => {
            const closed = path.length > 3 && path[0].X === path[path.length - 1].X && path[0].Y === path[path.length - 1].Y;
            const pts = (closed ? path.slice(0, -1) : path).map(p => [p.X, p.Y]);
            return {points: pts, closed};
        });
        for (const entry of planLines(lines, {clearance: 1.5 * cellUnits, reach, maxEdges: opts.maxEdges})) {
            const expr = lineEquation(entry.map(l => ({...l, path: l.points.map(([X, Y]) => ({X, Y}))})), q);
            if (!expr) continue;
            counts.edges += entry.reduce((n, l) => n + l.points.length - (l.closed ? 0 : 1), 0);
            counts.entries++;
            counts.lines++;
            body.push(`${expr} | color=${hex} thickness=${thickness}${opacity < 1 ? ` opacity=${fmt(opacity, 3)}` : ''}`);
        }
    };
    const textLine = t => {
        const size = t.size;
        const width = 0.55 * size * t.content.length;
        const x = t.anchor === 'middle' ? t.x - width / 2 : t.anchor === 'end' ? t.x - width : t.x;
        const alpha = t.color.a * t.alpha;
        return `@text x=${fmt(x, 7)} y=${fmt(t.y + 0.9 * size, 7)} size=${fmt(size, 4)} color=${toHex(t.color)}${alpha < 1 ? ` opacity=${fmt(alpha, 3)}` : ''} plain | ${t.content}`;
    };
    const textLines = [];
    const opacityNote = opacity => opacity < 1 ? ` at opacity ${fmt(opacity, 3)}` : '';

    if (!opts.flatten) {
        const {layers, whitePieces} = layerOps(ops, {q, tolerance, gradientSteps: opts.gradientSteps, pxPerUnit, stepPx,
            minBandPx: 2 * stepPx, maxEdges: opts.maxEdges, seams: opts.seams});
        counts.white = whitePieces;
        const from = labels => labels.length ? `, from ${labels[0]}${labels.length > 1 ? ` and ${labels.length - 1} more` : ''}` : '';
        // Outlines: one sampling cell wide, drawn half a width inside each opaque shape.
        const outlinePx = Math.min(20, Math.max(2, Math.round(stepPx * 2) / 2));
        const pxInt = 1 / pxPerUnit / q;
        const pointList = (paths, style) => {
            body.push(`${pointListExpression(paths, q)} | ${style}`);
            counts.entries++;
        };
        // Later opaque layers paint exactly from a line width inside their edge (their sampled
        // fill and their outline both cover that), so only there do they hide what lies beneath.
        const solid = new Map();
        const solidOf = layer => {
            if (!solid.has(layer)) { const s = P.offset(layer.paths, -outlinePx * pxInt, 4); solid.set(layer, {paths: s, bbox: P.bbox(s)}); }
            return solid.get(layer);
        };
        const laterSolids = (index, box) => layers.slice(index + 1)
            .filter(l => l.kind === 'fill' && l.opacity === 1 && P.overlaps(P.bbox(l.paths), box)).map(solidOf).filter(s => s.paths.length);
        layers.forEach((layer, index) => {
            if (layer.kind === 'text') {
                const line = textLine(layer.op);
                textLines.push(line);
                body.push(line);
            } else if (layer.kind === 'fill') {
                // Boolean operations leave slivers; parts smaller than a quarter of a pixel cannot show.
                let components = P.components(P.clean(P.normalize(layer.paths), cleanDistance)).filter(rings => P.area(rings) * pxArea >= 0.25);
                if (!components.length) return;
                checkThin(components);
                counts.regions++;
                body.push(`# layer ${counts.regions}: ${layer.hex}${opacityNote(layer.opacity)}${from(layer.labels)}`);
                const outlined = opts.outlines && layer.opacity === 1;
                const half = outlinePx / 2 * pxInt;
                let runs = outlined ? toIntPaths(outlineRuns(components.flat(), half, 0.25 * pxInt)) : [];
                const solids = runs.length ? laterSolids(index, P.bbox(layer.paths)) : [];
                if (runs.length) {
                    // Keep the sampled fill from rounding concave corners outwards (the outline paints them).
                    const hidden = (X, Y) => solids.some(s => s.bbox.minX <= X && X <= s.bbox.maxX && s.bbox.minY <= Y && Y <= s.bbox.maxY && P.contains(s.paths, X, Y));
                    const carve = concaveCorners(components.flat(), 1.9 * half, runCoverage(runs, half), hidden);
                    if (carve.length) components = P.components(P.difference(components.flat(), carve)).filter(rings => P.area(rings) * pxArea >= 0.25);
                }
                emitRegion(components, `color=${layer.hex} opacity=${layer.opacity === 1 ? 1 : fmt(layer.opacity, 3)}`, layer.opacity === 1);
                if (!runs.length) return;
                // Its exact outline on top of the sampled fill, except where later opaque shapes hide it.
                for (const s of solids) {
                    if (!runs.length) break;
                    runs = P.clipOpen(runs, s.paths, false);
                }
                if (!runs.length) return;
                pointList(runs, `color=${layer.hex} thickness=${outlinePx}`);
                counts.outlines++;
            } else {
                body.push(`# thin stroke, ${layer.thickness} px: ${layer.hex}${opacityNote(layer.opacity)}${from(layer.labels)}`);
                pointList(layer.paths, `color=${layer.hex} thickness=${layer.thickness}${layer.opacity < 1 ? ` opacity=${fmt(layer.opacity, 3)}` : ''}`);
                counts.lines++;
            }
        });
    } else {
        const {pieces, lines, texts} = flattenOps(ops, {q, tolerance, gradientSteps: opts.gradientSteps, pxPerUnit, minBandPx: 2 * stepPx});
        const grouped = groupRegions(pieces, {cleanDistance});
        // Boolean operations leave slivers along shared edges; parts smaller than a quarter of a
        // pixel cannot show and would only cost edges.
        for (const region of grouped.regions) {
            region.components = P.components(region.paths).filter(rings => P.area(rings) * pxArea >= 0.25);
            region.paths = region.components.flat();
        }
        const regions = grouped.regions.filter(r => r.paths.length);
        counts.white = grouped.whitePieces;
        counts.regions = regions.length;
        regions.forEach((region, i) => {
            checkThin(region.components);
            body.push(`# region ${i + 1}: ${region.hex}${region.opacity < 1 ? ` at opacity ${fmt(region.opacity, 3)} (composites to the picture's colour over Arch's white canvas)` : ''}, ${region.components.length} part(s)`);
            emitRegion(region.components, `color=${region.hex} opacity=${region.opacity === 1 ? 1 : fmt(region.opacity, 3)}`, false);
        });
        const {seams, thickness: seamThickness} = opts.seams ? seamLines(regions, {pxInt: 1 / pxPerUnit / q, stepPx}) : {seams: []};
        if (seams.length) {
            body.push(`# shared boundaries, ${seamThickness} px wide, drawn beneath the regions so no seams show between them`);
            for (const seam of seams) {
                body.push(`${pointListExpression(seam.paths, q)} | color=${seam.hex} thickness=${seamThickness}`);
                counts.entries++;
                counts.seams++;
            }
        }
        const lineGroups = groupLines(lines);
        if (lineGroups.length) body.push('# strokes thinner than the inequality sampling grid: equations, which Arch draws as lines on top of the fills');
        for (const g of lineGroups) emitLines(g.paths, g);
        textLines.push(...texts.map(textLine));
    }
    const {edges: edgeCount, entries, thin, lines: lineEntries, seams: seamEntries, outlines: outlineEntries} = counts;
    const fillEntries = entries - lineEntries - seamEntries - outlineEntries;
    // Equations need Arch's breakpoint detection to drop the jumps along their cuts (flatten mode).
    const equationLines = opts.flatten && lineEntries > 0;

    const warnings = [], info = [];
    for (const [key, {count, details}] of renderer.notes) {
        const make = NOTES[key];
        if (!make) continue;
        const text = make(count, opts.flatten) + (details.length ? ` (${details.join('; ')})` : '');
        (INFO_NOTES.has(key) ? info : warnings).push(text);
    }
    if (thin) warnings.push(`${thin} part(s) are thinner than Arch's ${fmt(stepPx, 3)} px sampling grid at the saved zoom and may show gaps or vanish; use a higher precision (e.g. --precision ${Math.min(20, opts.precision * 2)}) or zoom in.`);
    const drawMs = Math.round(edgeCount * MS_PER_EDGE * (opts.precision / 4) ** 2);
    if (drawMs > 3000) warnings.push(`About ${edgeCount} edges in total: Arch may take ~${Math.round(drawMs / 1000)} s per full redraw. A larger --tolerance or fewer gradient steps makes it lighter.`);
    if (!entries && !textLines.length) warnings.push('Nothing visible to convert (everything is white, transparent, hidden or unsupported).');
    if (counts.white) info.push(`White areas are left empty: Arch's canvas is already white there${opts.flatten ? '' : ' (they are cut out of the shapes beneath them, because Arch cannot draw white)'}.`);

    const pad = (MARGIN - 1) / 2;
    const w = view.xmax - view.xmin, h = view.ymax - view.ymin;
    const summary = `${counts.regions} ${opts.flatten ? 'colour region(s)' : 'layer(s)'} in ${fillEntries} inequality entr${fillEntries === 1 ? 'y' : 'ies'}` +
        `${outlineEntries ? `, ${outlineEntries} outline(s)` : ''}${lineEntries ? `, ${lineEntries} line entr${lineEntries === 1 ? 'y' : 'ies'}` : ''}` +
        `${textLines.length ? `, ${textLines.length} text box(es)` : ''}; ${edgeCount} edges.`;
    const header = [
        `@title ${title}`,
        `# Converted from SVG by svg2arch: ${summary}`,
        '# Coordinates are SVG user units with y flipped (Arch y = -SVG y).',
        '# Each filled shape is cos(pi*(W))/sqrt(D)<0. W counts the edges a ray towards +x crosses',
        '# (odd inside), and 1/sqrt(D) is about the distance to the nearest edge, so the left side',
        '# is a signed distance: Arch draws the boundary where it changes sign.',
        ...(opts.flatten ? [
            '# Regions never overlap, because older Arch builds do not fill overlapping inequalities in entry order.',
            ...(seamEntries ? ['# Point lists (/-/...) are drawn beneath the fills and only show through seams between regions.'] : [])
        ] : [
            '# Shapes are drawn bottom to top in the order of this file, as the SVG paints them: the @set',
            "# line switches on Arch's ordered drawing (saved in the file; needs Arch 12202 or later).",
            '# Point lists (/-/...) are drawn exactly: thin strokes, and the outline of each opaque shape',
            '# half a line width inside it, which gives the sampled fill sharp edges and corners.'
        ]),
        `# ${escapeComment(`Options: tolerance ${opts.tolerance} px, precision ${opts.precision}, gradient steps ${opts.gradientSteps}${opts.flatten ? ', flatten' : ''}${opts.seams ? '' : ', no seams'}${opts.outlines || opts.flatten ? '' : ', no outlines'}.`)}`,
        ''
    ];
    const footer = [
        '',
        ...(opts.flatten ? textLines : []),
        `@view x=${fmt(view.xmin - pad * w, 7)}..${fmt(view.xmax + pad * w, 7)} y=${fmt(view.ymin - pad * h, 7)}..${fmt(view.ymax + pad * h, 7)}`,
        `@set implicitPrecision=${opts.precision}${opts.axes ? '' : ' showAxes=false showAxisNumbers=false gridStyle=hidden'}${equationLines ? ' autoBreakpointDetection=true' : ''}${opts.flatten ? '' : ' orderedDrawing=true'}`
    ];
    const script = [...header, ...body, ...footer].join('\n') + '\n';
    return {
        script,
        warnings,
        info,
        stats: {mode: opts.flatten ? 'flatten' : 'ordered', regions: counts.regions, entries, edges: edgeCount, lineEntries, seamEntries, outlineEntries, texts: textLines.length,
            pxPerUnit, quantum: q, estimatedDrawMs: drawMs, viewBox: box}
    };
}

// Human-readable summary of a conversion, for the CLI and the MCP tool.
export function formatConversion({stats, warnings, info}, {scriptPath} = {}) {
    const s = stats;
    const out = [`Converted: ${s.regions} ${s.mode === 'flatten' ? 'colour region(s)' : 'layer(s) drawn in order'}, ${s.entries} entr${s.entries === 1 ? 'y' : 'ies'}` +
        ` (${s.outlineEntries ? `${s.outlineEntries} outline(s), ` : ''}${s.seamEntries ? `${s.seamEntries} seam line(s), ` : ''}${s.lineEntries ? `${s.lineEntries} thin-stroke line(s), ` : ''}${s.texts} text box(es)),` +
        ` ${s.edges} edges; about ${fmt(s.pxPerUnit, 3)} px per SVG unit at the saved zoom` +
        `${s.estimatedDrawMs >= 500 ? `; Arch needs roughly ${fmt(s.estimatedDrawMs / 1000, 2)} s per full redraw` : ''}.`];
    if (scriptPath) out.push(`Scene script: ${scriptPath}`);
    if (warnings.length) out.push('Conversion warnings:', ...warnings.map(w => `  - ${w}`));
    if (info.length) out.push('Notes:', ...info.map(w => `  - ${w}`));
    return out.join('\n');
}
