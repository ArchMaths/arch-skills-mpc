// SVG -> Arch scene script. Every visible colour of the picture becomes inequality regions
// (see inequality.js); strokes too thin for Arch's sampling grid become point-list lines, and
// text becomes @text boxes. Filters are ignored.
import {SvgRenderer} from './render.js';
import {flattenOps, groupRegions, groupLines} from './regions.js';
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
    seams: true,             // trace shared boundaries with point lists drawn beneath the fills
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
    text: n => `${n} text run(s) became Arch text boxes (@text): Arch's font, approximate position, drawn above all shapes and not clipped.`,
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
    const {pieces, lines, texts} = flattenOps(ops, {q, tolerance, gradientSteps: opts.gradientSteps, pxPerUnit, minBandPx: 2 * stepPx});
    const grouped = groupRegions(pieces, {cleanDistance: Math.max(1.415, 0.25 * tolerance / q)});
    // Boolean operations leave slivers along shared edges; parts smaller than a quarter of a
    // pixel cannot show and would only cost edges.
    const pxArea = (pxPerUnit * q) ** 2;
    for (const region of grouped.regions) {
        region.components = P.components(region.paths).filter(rings => P.area(rings) * pxArea >= 0.25);
        region.paths = region.components.flat();
    }
    const regions = grouped.regions.filter(r => r.paths.length), {whitePieces} = grouped;
    const lineGroups = groupLines(lines);

    const title = (opts.title || textContent(elementChildren(renderer.root).find(c => c.name === 'title') || {text: ''}).trim() || 'SVG drawing').replace(/\s+/g, ' ');
    const body = [];
    let edgeCount = 0, entries = 0, thin = 0, lineEntries = 0, seamEntries = 0;
    regions.forEach((region, i) => {
        const {components} = region;
        for (const rings of components) {
            // Mean width and length of the part, in pixels at the saved zoom.
            const perimeter = P.perimeter(rings) * q * pxPerUnit;
            const width = 2 * P.area(rings) * pxArea / Math.max(1e-9, perimeter);
            if (width < stepPx && perimeter / 2 > 3 * stepPx) thin++;
        }
        const parts = chunk(components, opts.maxEdges);
        const style = `color=${region.hex} opacity=${region.opacity === 1 ? 1 : fmt(region.opacity, 3)}`;
        body.push(`# region ${i + 1}: ${region.hex}${region.opacity < 1 ? ` at opacity ${fmt(region.opacity, 3)} (composites to the picture's colour over Arch's white canvas)` : ''}, ${components.length} part(s)`);
        for (const part of parts) {
            const rings = part.flat();
            const expr = regionExpression(rings, q);
            if (!expr) continue;
            edgeCount += edgesOf(rings).length;
            entries++;
            body.push(`${expr} | ${style}`);
        }
    });
    const {seams, thickness: seamThickness} = opts.seams ? seamLines(regions, {pxInt: 1 / pxPerUnit / q, stepPx}) : {seams: []};
    if (seams.length) {
        body.push(`# shared boundaries, ${seamThickness} px wide, drawn beneath the regions so no seams show between them`);
        for (const seam of seams) {
            body.push(`${pointListExpression(seam.paths, q)} | color=${seam.hex} thickness=${seamThickness}`);
            entries++;
            seamEntries++;
        }
    }
    if (lineGroups.length) body.push('# strokes thinner than the inequality sampling grid: equations, which Arch draws as lines on top of the fills');
    const cellUnits = stepPx / pxPerUnit / q;           // one sampling cell, in integer steps
    const reach = 2 * Math.hypot(box.width, box.height) / q;
    for (const g of lineGroups) {
        const lines = g.paths.map(path => {
            const closed = path.length > 3 && path[0].X === path[path.length - 1].X && path[0].Y === path[path.length - 1].Y;
            const pts = (closed ? path.slice(0, -1) : path).map(p => [p.X, p.Y]);
            return {points: pts, closed};
        });
        for (const entry of planLines(lines, {clearance: 1.5 * cellUnits, reach, maxEdges: opts.maxEdges})) {
            const expr = lineEquation(entry.map(l => ({...l, path: l.points.map(([X, Y]) => ({X, Y}))})), q);
            if (!expr) continue;
            edgeCount += entry.reduce((n, l) => n + l.points.length - (l.closed ? 0 : 1), 0);
            entries++;
            lineEntries++;
            body.push(`${expr} | color=${g.hex} thickness=${g.thickness}${g.opacity < 1 ? ` opacity=${fmt(g.opacity, 3)}` : ''}`);
        }
    }
    const textLines = [];
    for (const t of texts) {
        const size = t.size;
        const width = 0.55 * size * t.content.length;
        const x = t.anchor === 'middle' ? t.x - width / 2 : t.anchor === 'end' ? t.x - width : t.x;
        const alpha = t.color.a * t.alpha;
        textLines.push(`@text x=${fmt(x, 7)} y=${fmt(t.y + 0.9 * size, 7)} size=${fmt(size, 4)} color=${toHex(t.color)}${alpha < 1 ? ` opacity=${fmt(alpha, 3)}` : ''} plain | ${t.content}`);
    }

    const warnings = [], info = [];
    for (const [key, {count, details}] of renderer.notes) {
        const make = NOTES[key];
        if (!make) continue;
        const text = make(count) + (details.length ? ` (${details.join('; ')})` : '');
        (INFO_NOTES.has(key) ? info : warnings).push(text);
    }
    if (thin) warnings.push(`${thin} part(s) are thinner than Arch's ${fmt(stepPx, 3)} px sampling grid at the saved zoom and may show gaps or vanish; use a higher precision (e.g. --precision ${Math.min(20, opts.precision * 2)}) or zoom in.`);
    const drawMs = Math.round(edgeCount * MS_PER_EDGE * (opts.precision / 4) ** 2);
    if (drawMs > 3000) warnings.push(`About ${edgeCount} edges in total: Arch may take ~${Math.round(drawMs / 1000)} s per full redraw. A larger --tolerance or fewer gradient steps makes it lighter.`);
    if (!entries && !textLines.length) warnings.push('Nothing visible to convert (everything is white, transparent, hidden or unsupported).');
    if (whitePieces) info.push(`White areas are left empty: Arch's canvas is already white there.`);

    const pad = (MARGIN - 1) / 2;
    const w = view.xmax - view.xmin, h = view.ymax - view.ymin;
    const header = [
        `@title ${title}`,
        `# Converted from SVG by svg2arch: ${regions.length} colour region(s) in ${entries - lineEntries - seamEntries} inequality entr${entries - lineEntries - seamEntries === 1 ? 'y' : 'ies'}` +
            `${lineEntries ? `, ${lineEntries} line entr${lineEntries === 1 ? 'y' : 'ies'}` : ''}${textLines.length ? `, ${textLines.length} text box(es)` : ''}; ${edgeCount} edges.`,
        '# Coordinates are SVG user units with y flipped (Arch y = -SVG y).',
        '# Each region is cos(pi*(W))/sqrt(D)<0. W counts the edges a ray towards +x crosses',
        '# (odd inside), and 1/sqrt(D) is about the distance to the nearest edge, so the left side',
        '# is a signed distance: Arch draws the boundary where it changes sign. Regions never overlap,',
        '# because Arch does not fill overlapping inequalities in entry order.',
        ...(seamEntries ? ['# Point lists (/-/...) are drawn beneath the fills and only show through seams between regions.'] : []),
        `# ${escapeComment(`Options: tolerance ${opts.tolerance} px, precision ${opts.precision}, gradient steps ${opts.gradientSteps}.`)}`,
        ''
    ];
    const footer = [
        '',
        ...textLines,
        `@view x=${fmt(view.xmin - pad * w, 7)}..${fmt(view.xmax + pad * w, 7)} y=${fmt(view.ymin - pad * h, 7)}..${fmt(view.ymax + pad * h, 7)}`,
        `@set implicitPrecision=${opts.precision}${opts.axes ? '' : ' showAxes=false showAxisNumbers=false gridStyle=hidden'}${lineEntries ? ' autoBreakpointDetection=true' : ''}`
    ];
    const script = [...header, ...body, ...footer].join('\n') + '\n';
    return {
        script,
        warnings,
        info,
        stats: {regions: regions.length, entries, edges: edgeCount, lineEntries, seamEntries, texts: textLines.length,
            pxPerUnit, quantum: q, estimatedDrawMs: drawMs, viewBox: box}
    };
}

// Human-readable summary of a conversion, for the CLI and the MCP tool.
export function formatConversion({stats, warnings, info}, {scriptPath} = {}) {
    const s = stats;
    const out = [`Converted: ${s.regions} colour region(s), ${s.entries} entr${s.entries === 1 ? 'y' : 'ies'}` +
        ` (${s.seamEntries ? `${s.seamEntries} seam line(s), ` : ''}${s.lineEntries ? `${s.lineEntries} thin-stroke line(s), ` : ''}${s.texts} text box(es)),` +
        ` ${s.edges} edges; about ${fmt(s.pxPerUnit, 3)} px per SVG unit at the saved zoom` +
        `${s.estimatedDrawMs >= 500 ? `; Arch needs roughly ${fmt(s.estimatedDrawMs / 1000, 2)} s per full redraw` : ''}.`];
    if (scriptPath) out.push(`Scene script: ${scriptPath}`);
    if (warnings.length) out.push('Conversion warnings:', ...warnings.map(w => `  - ${w}`));
    if (info.length) out.push('Notes:', ...info.map(w => `  - ${w}`));
    return out.join('\n');
}
