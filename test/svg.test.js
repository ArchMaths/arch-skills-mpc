// svg2arch converter tests: pure Node, no browser.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseXml} from '../src/svg/xml.js';
import {parseColor, archDimsColor} from '../src/svg/color.js';
import {parsePath, parseTransform, apply, flatten} from '../src/svg/geom.js';
import {SvgRenderer, parseLength} from '../src/svg/render.js';
import {flattenOps, groupRegions, displayColor, gradientBands} from '../src/svg/regions.js';
import {regionExpression, lineEquation, quantumFormatter, fmt} from '../src/svg/inequality.js';
import {planLines} from '../src/svg/lines.js';
import {convertSvg} from '../src/svg/index.js';
import {layerOps, fitLayer, archOver, archShown, CLEAR, nearestDrawable} from '../src/svg/layers.js';
import {joinedRuns, outlineRuns, runCoverage, concaveCorners, toIntPaths} from '../src/svg/outline.js';
import {parseScript} from '../src/script.js';
import * as P from '../src/svg/poly.js';

// Evaluates a generated Arch expression (left side of "<0" or "=0") at (x, y).
function evaluator(expr) {
    const lhs = expr.replace(/(<|=)0$/, '');
    const js = lhs.replace(/heaviside\(/g, 'H(').replace(/abs\(/g, 'Math.abs(').replace(/sqrt\(/g, 'Math.sqrt(')
        .replace(/cos\(/g, 'Math.cos(').replace(/\bpi\b/g, 'Math.PI');
    assert.doesNotMatch(expr, /\^|pow\(/, 'only products, no powers');
    const f = new Function('x', 'y', 'H', `return ${js};`);
    return (x, y) => f(x, y, v => (v > 0 ? 1 : 0));
}

const ring = (q, ...pts) => pts.map(([x, y]) => ({X: Math.round(x / q), Y: Math.round(y / q)}));
const pointInRings = (x, y, rings) => {
    let inside = false;
    for (const r of rings)
        for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
            const a = r[i], b = r[j];
            if ((a.Y > y) !== (b.Y > y) && x < (b.X - a.X) * (y - a.Y) / (b.Y - a.Y) + a.X) inside = !inside;
        }
    return inside;
};
const render = (svg, extra = {}) => new SvgRenderer(svg, {q: 0.001, tolerance: 0.01, pxPerUnit: 10, lineMaxPx: 0, ...extra});
const fillsOf = ops => ops.filter(o => o.kind === 'fill');
const areaUnits = (paths, q = 0.001) => P.area(paths) * q * q;

test('XML: entities from the DOCTYPE, CDATA, comments and namespace prefixes', () => {
    const root = parseXml(`<?xml version="1.0"?>
<!DOCTYPE svg [ <!ENTITY ns_svg "http://www.w3.org/2000/svg"> <!ENTITY c "#ff0000"> ]>
<!-- comment -->
<svg:svg xmlns:svg="&ns_svg;" viewBox="0 0 10 10"><svg:style><![CDATA[ .a { fill: blue } ]]></svg:style>
<svg:rect fill="&c;" title="a &amp; b &#x41;" width='1'/></svg:svg>`);
    assert.equal(root.name, 'svg');
    assert.equal(root.attrs['xmlns:svg'], 'http://www.w3.org/2000/svg');
    const rect = root.children.find(c => c.name === 'rect');
    assert.equal(rect.attrs.fill, '#ff0000');
    assert.equal(rect.attrs.title, 'a & b A');
    assert.equal(rect.attrs.width, '1');
    assert.throws(() => parseXml('<html></html>'), /No <svg>/);
});

test('colours: names, hex, rgb, hsl, transparency', () => {
    assert.deepEqual(parseColor('#f00'), {r: 1, g: 0, b: 0, a: 1});
    assert.deepEqual(parseColor('RebeccaPurple'), parseColor('#663399'));
    assert.deepEqual(parseColor('rgba(255, 0, 0, 0.5)'), {r: 1, g: 0, b: 0, a: 0.5});
    assert.deepEqual(parseColor('rgb(100% 0% 0% / 25%)'), {r: 1, g: 0, b: 0, a: 0.25});
    const hsl = parseColor('hsl(120, 100%, 25%)');
    assert.ok(Math.abs(hsl.g - 0.5) < 1e-9 && hsl.r === 0 && hsl.b === 0);
    assert.equal(parseColor('currentColor'), 'currentColor');
    assert.equal(parseColor('nonsense'), null);
    assert.equal(parseColor('#12345'), null);
});

test('path data: relative and implicit commands, smooth curves, compact arc flags, errors', () => {
    const {subpaths, error} = parsePath('m10 10 20 0v10h-20z M0 0 c1 1 2 1 3 0 s2 -1 3 0 a2 2 0 0110 0 L1e1 5');
    assert.equal(error, null);
    assert.equal(subpaths.length, 2);
    const [a, b] = subpaths;
    assert.deepEqual([a.x, a.y, a.closed], [10, 10, true]);
    assert.deepEqual(a.segs.map(s => [s.x, s.y]), [[30, 10], [30, 20], [10, 20]]);
    // The S command reflects the previous control point.
    assert.deepEqual([b.segs[1].x1, b.segs[1].y1], [4, -1]);
    // The arc ends where it should; L1e1 reads the exponent.
    const arcEnd = b.segs[b.segs.length - 2];
    assert.ok(Math.abs(arcEnd.x - 16) < 1e-9 && Math.abs(arcEnd.y) < 1e-9);
    assert.deepEqual([b.segs.at(-1).x, b.segs.at(-1).y], [10, 5]);
    const bad = parsePath('M0 0 L10 0 L10 x10');
    assert.match(bad.error, /expected a number/);
    assert.equal(bad.subpaths[0].segs.length, 1);
});

test('transforms compose like SVG', () => {
    const m = parseTransform('translate(10,20) rotate(90) scale(2)');
    const [x, y] = apply(m, 1, 0);
    assert.ok(Math.abs(x - 10) < 1e-9 && Math.abs(y - 22) < 1e-9);
    const r = parseTransform('rotate(180 5 5)');
    assert.deepEqual(apply(r, 0, 0).map(v => Math.round(v)), [10, 10]);
    assert.deepEqual(apply(parseTransform('skewX(45)'), 0, 1).map(v => Math.round(v * 1e9) / 1e9), [1, 1]);
});

test('lengths and units', () => {
    assert.equal(parseLength('2in'), 192);
    assert.equal(parseLength('50%', 300), 150);
    assert.equal(parseLength('1.5em', 0, 10), 15);
    assert.ok(Number.isNaN(parseLength('auto')));
});

test('style cascade: presentation attribute < stylesheet < style attribute < !important', () => {
    const colorOf = svg => fillsOf(render(svg).render())[0].paint.color;
    const base = (css, attrs) => `<svg viewBox="0 0 10 10"><style>${css}</style><rect width="5" height="5" class="a" id="b" ${attrs}/></svg>`;
    assert.deepEqual(colorOf(base('rect{fill:green}', 'fill="red"')), parseColor('green'));
    assert.deepEqual(colorOf(base('rect{fill:green} .a{fill:blue}', 'fill="red"')), parseColor('blue'));
    assert.deepEqual(colorOf(base('#b{fill:navy} .a{fill:blue}', '')), parseColor('navy'));
    assert.deepEqual(colorOf(base('.a{fill:blue}', 'style="fill:purple"')), parseColor('purple'));
    assert.deepEqual(colorOf(base('.a{fill:blue !important}', 'style="fill:purple"')), parseColor('blue'));
    assert.deepEqual(colorOf(base('g > rect{fill:red}', '')), parseColor('black'));     // not a child of a g
    // Inheritance, inherit and currentColor.
    const inherited = `<svg viewBox="0 0 10 10"><g fill="orange" color="teal"><rect width="1" height="1"/>
        <rect width="1" height="1" fill="currentColor"/><g fill="red"><rect width="1" height="1" fill="inherit"/></g></g></svg>`;
    assert.deepEqual(fillsOf(render(inherited).render()).map(o => o.paint.color),
        [parseColor('orange'), parseColor('teal'), parseColor('red')]);
});

test('region inequality: negative exactly inside, a distance near edges, no exponents', () => {
    const q = 0.001;
    // A square with a triangular hole, and an island inside the hole.
    const rings = [ring(q, [0, 0], [4, 0], [4, 3], [0, 3]), ring(q, [1, 1], [2, 2], [3, 1]), ring(q, [1.8, 1.2], [2.2, 1.2], [2, 1.5])];
    const expr = regionExpression(rings, q);
    assert.match(expr, /^cos\(pi\*\(.*\)\)\/sqrt\(.*\)<0$/);
    assert.doesNotMatch(expr, /\^|e-\d|pow/);
    const f = evaluator(expr);
    let checked = 0;
    for (let i = 0; i < 4000; i++) {
        const x = -1 + Math.random() * 6, y = -1 + Math.random() * 5;
        const inside = pointInRings(x / q, y / q, rings);
        assert.equal(f(x, y) < 0, inside, `(${x}, ${y})`);
        checked++;
    }
    // Rays through vertices (y exactly 1 or 3) and points on vertex columns.
    for (const [x, y, inside] of [[0.5, 1, true], [2, 1.1, false], [3.5, 1, true], [2, 2.5, true], [5, 1, false], [-1, 3, false], [2, 1.3, true], [2.5, 0.5, true]])
        assert.equal(f(x, y) < 0, inside, `(${x}, ${y})`);
    assert.ok(Math.abs(f(2, 2)) < 1e-12, 'zero on a vertex');
    // sqrt(2) times the distance to a single nearby edge; near a corner the two edges combine
    // as 1/sqrt(1/q1 + 1/q2) (0.1 from both edges here); 0 on the boundary.
    assert.ok(Math.abs(f(4.05, 2) - Math.SQRT2 * 0.05) < 0.002, `outside the right edge: ${f(4.05, 2)}`);
    assert.ok(Math.abs(f(0.1, 2.9) + 0.1) < 0.002, `near the corner: ${f(0.1, 2.9)}`);
    assert.ok(Math.abs(f(4, 2)) < 1e-12);
    assert.ok(Math.abs(f(1.5, 1.5)) < 1e-9, 'zero on a slanted hole edge');
    assert.ok(checked > 0);
});

test('line equations change sign across the lines, and their cuts avoid the lines', () => {
    const q = 0.001;
    // A zigzag whose end lies level with its other vertices, a closed loop and a hook.
    const zig = [[-4, -1], [-2, 1], [0, -1], [2, 1], [3.5, -0.5]];
    const loop = [[5, 0], [7, 0], [7, 2], [5, 2]];
    const hook = [[0, 3], [3, 3], [3, 5], [1, 5], [1, 4]];
    const toInt = pts => pts.map(([x, y]) => [Math.round(x / q), Math.round(y / q)]);
    const lines = [{points: toInt(zig), closed: false}, {points: toInt(loop), closed: true}, {points: toInt(hook), closed: false}];
    const entries = planLines(lines, {clearance: 0.2 / q, reach: 50 / q, maxEdges: 400});
    for (const entry of entries) {
        const f = evaluator(lineEquation(entry.map(l => ({...l, path: l.points.map(([X, Y]) => ({X, Y}))})), q));
        for (const line of entry) {
            const pts = line.points.map(([X, Y]) => [X * q, Y * q]);
            const n = line.closed ? pts.length : pts.length - 1;
            for (let i = 0; i < n; i++) {
                const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
                for (const t of [0.2, 0.5, 0.8]) {
                    const mx = ax + (bx - ax) * t, my = ay + (by - ay) * t;
                    const len = Math.hypot(bx - ax, by - ay), nx = -(by - ay) / len * 0.02, ny = (bx - ax) / len * 0.02;
                    const s1 = f(mx + nx, my + ny), s2 = f(mx - nx, my - ny);
                    assert.ok(Math.sign(s1) !== Math.sign(s2), `sign change across ${line.closed ? 'loop' : 'line'} segment ${i}`);
                    assert.ok(Math.abs(s1) < 0.05 && Math.abs(s2) < 0.05);
                }
            }
        }
    }
    assert.ok(entries.flat().every(l => l.closed || l.dir));
});

test('opaque paint cuts what lies beneath; translucent paint blends; same colours merge', () => {
    const svg = `<svg viewBox="0 0 10 10">
        <rect width="6" height="6" fill="#ff0000"/>
        <rect x="3" y="3" width="6" height="6" fill="#0000ff"/>
        <rect x="2" y="7" width="2" height="2" fill="#0000ff"/>
        <rect x="4" y="0" width="5" height="2" fill="#00ff00" fill-opacity="0.5"/>
    </svg>`;
    const r = render(svg);
    const {pieces} = flattenOps(r.render(), {q: 0.001, tolerance: 0.01});
    // Pieces never overlap.
    const total = pieces.reduce((s, p) => s + areaUnits(p.paths), 0);
    const union = areaUnits(P.normalize(pieces.flatMap(p => p.paths)));
    assert.ok(Math.abs(total - union) < 1e-6, `${total} vs ${union}`);
    const byHex = hex => pieces.filter(p => p.color.a === 1 && ['r', 'g', 'b'].every((k, i) => Math.round(p.color[k] * 255) === parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16)));
    assert.ok(Math.abs(byHex('#ff0000').reduce((s, p) => s + areaUnits(p.paths), 0) - (36 - 9 - 4)) < 1e-6);
    assert.equal(byHex('#0000ff').length, 1, 'the two blue rects form one piece');
    // Half-transparent green over red, and over nothing.
    const blended = pieces.find(p => p.color.a === 1 && Math.abs(p.color.r - 0.5) < 0.01 && Math.abs(p.color.g - 0.5) < 0.01);
    assert.ok(blended && Math.abs(areaUnits(blended.paths) - 4) < 1e-6);
    const alone = pieces.find(p => p.color.a === 0.5);
    assert.ok(alone && Math.abs(areaUnits(alone.paths) - 6) < 1e-6);
});

test('colours as Arch shows them on its white canvas', () => {
    assert.equal(displayColor({r: 1, g: 1, b: 1, a: 1}), null);
    assert.deepEqual(displayColor({r: 1, g: 0, b: 0, a: 1}), {color: {r: 1, g: 0, b: 0, a: 1}, hex: '#ff0000', opacity: 1});
    // Light grey would be dimmed by Arch: drawn as translucent black that looks the same over white.
    const grey = displayColor(parseColor('#f0f0f0'));
    assert.equal(grey.hex, '#000000');
    assert.ok(Math.abs(grey.opacity - 15 / 255) < 0.001);
    assert.equal(archDimsColor(parseColor('#f0f0f0')), true);
    assert.equal(archDimsColor(grey.color), false);
    // Half-transparent blue over nothing is composited over white.
    assert.equal(displayColor({r: 0, g: 0, b: 1, a: 0.5}).hex, '#8080ff');
});

test('gradients become bands of solid colour covering the shape', () => {
    const svg = `<svg viewBox="0 0 100 10"><linearGradient id="g"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient>
        <rect width="100" height="10" fill="url(#g)"/></svg>`;
    const [op] = render(svg).render();
    assert.equal(op.paint.type, 'linear');
    const bands = gradientBands(op.paths, op.paint, {q: 0.001, tolerance: 0.01, steps: 10});
    assert.equal(bands.length, 10);
    const total = bands.reduce((s, b) => s + areaUnits(b.paths), 0);
    assert.ok(Math.abs(total - 1000) < 1e-3);
    for (let i = 1; i < bands.length; i++) assert.ok(bands[i].color.r > bands[i - 1].color.r, 'brightens left to right');
    // Bands stay at least minBandPx wide on screen.
    assert.equal(gradientBands(op.paths, op.paint, {q: 0.001, tolerance: 0.01, steps: 10, pxPerUnit: 1, minBandPx: 25}).length, 4);
    // A radial gradient gives rings.
    const radial = `<svg viewBox="0 0 10 10"><radialGradient id="r"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></radialGradient>
        <circle cx="5" cy="5" r="5" fill="url(#r)"/></svg>`;
    const [rop] = render(radial).render();
    const rings = gradientBands(rop.paths, rop.paint, {q: 0.001, tolerance: 0.001, steps: 5}).filter(b => areaUnits(b.paths) > 0.01);
    assert.equal(rings.length, 5);
    assert.ok(Math.abs(rings.reduce((s, b) => s + areaUnits(b.paths), 0) - areaUnits(rop.paths)) < 0.01);
});

test('strokes: outlines with caps and joins, dashes, and thin strokes as lines', () => {
    const svg = `<svg viewBox="0 0 100 100"><path d="M10 10 H90" stroke="black" stroke-width="4"/>
        <path d="M10 50 H90" stroke="black" stroke-width="4" stroke-linecap="square" stroke-dasharray="10 10"/>
        <path d="M10 80 H90" stroke="black" stroke-width="0.2"/></svg>`;
    const ops = render(svg, {lineMaxPx: 5}).render();
    assert.deepEqual(ops.map(o => o.kind), ['fill', 'fill', 'line']);
    assert.ok(Math.abs(areaUnits(ops[0].paths) - 320) < 0.5, `butt line ${areaUnits(ops[0].paths)}`);
    // Four dashes of 10, each extended by 2 at both ends (square caps).
    assert.ok(Math.abs(areaUnits(ops[1].paths) - 4 * 14 * 4) < 0.5, `dashes ${areaUnits(ops[1].paths)}`);
    assert.equal(ops[1].paths.length, 4);
    assert.equal(ops[2].widthPx, 0.2 * 10);
});

test('clip paths, nested viewports, use and symbol', () => {
    const svg = `<svg viewBox="0 0 100 100">
        <clipPath id="c"><circle cx="50" cy="50" r="10"/></clipPath>
        <symbol id="s" viewBox="0 0 10 10"><rect width="10" height="10"/></symbol>
        <rect width="100" height="100" fill="red" clip-path="url(#c)"/>
        <use href="#s" x="0" y="0" width="20" height="20" fill="blue"/>
        <svg x="80" y="80" width="10" height="10" viewBox="0 0 1 1"><rect width="2" height="2" fill="green"/></svg>
        <rect id="r" width="5" height="5"/><use xlink:href="#r" x="30" fill="orange" xmlns:xlink="http://www.w3.org/1999/xlink"/>
    </svg>`;
    const ops = render(svg).render();
    assert.ok(Math.abs(areaUnits(ops[0].paths) - Math.PI * 100) < 0.5);
    assert.deepEqual(ops[1].paint.color, parseColor('blue'));
    assert.ok(Math.abs(areaUnits(ops[1].paths) - 400) < 1e-6);
    assert.ok(Math.abs(areaUnits(ops[2].paths) - 100) < 1e-6, 'nested svg clips to its viewport');
    const box = P.bbox(ops[4].paths);
    assert.deepEqual([box.minX, box.maxX], [30000, 35000]);
});

test('everything outside the root viewBox is clipped; hidden things are not drawn', () => {
    const ops = render(`<svg viewBox="0 0 10 10"><rect x="-5" y="-5" width="10" height="10"/>
        <rect width="3" height="3" display="none"/><g visibility="hidden"><rect width="3" height="3"/></g>
        <rect width="3" height="3" fill="none"/><rect width="3" height="3" opacity="0"/></svg>`).render();
    assert.equal(ops.length, 1);
    assert.ok(Math.abs(areaUnits(ops[0].paths) - 25) < 1e-6);
});

test('quantum formatting and numbers are exact and never use exponents', () => {
    const f = quantumFormatter(0.001);
    assert.equal(f(12345), '12.345');
    assert.equal(f(-5), '-0.005');
    assert.equal(f(1000), '1');
    assert.equal(f(0), '0');
    assert.equal(quantumFormatter(10)(7), '70');
    assert.equal(fmt(0.0000123456789), '0.0000123457');
    assert.equal(fmt(-1234567.89), '-1234568');
});

test('convertSvg writes a scene script the parser accepts, in both modes', () => {
    const svg = readFileSync(new URL('../examples/svg/lighthouse.svg', import.meta.url), 'utf8');
    for (const flatten of [false, true]) {
        const {script, stats, warnings, info} = convertSvg(svg, {flatten});
        const {steps, title} = parseScript(script);
        assert.equal(title, 'Lighthouse at dusk');
        assert.equal(steps.filter(s => s.kind === 'create').length, stats.entries);
        assert.ok(stats.regions > 20 && stats.lineEntries > 0 && stats.texts === 1);
        assert.equal(stats.mode, flatten ? 'flatten' : 'ordered');
        const settings = steps.find(s => s.kind === 'set').settings;
        // Thin strokes are point lists in ordered mode, equations (with breakpoint detection) when flattening.
        assert.deepEqual(settings.map(s => s.name), ['implicitPrecision', 'showAxes', 'showAxisNumbers', 'gridStyle',
            ...(flatten ? ['autoBreakpointDetection'] : ['orderedDrawing'])]);
        assert.ok(info.some(i => /filters are ignored/.test(i)));
        assert.ok(Array.isArray(warnings));
        // Every region is a strict inequality (fill only, no outline) with an explicit opacity.
        const regions = steps.filter(s => s.kind === 'create' && s.expr.startsWith('cos(pi*'));
        assert.ok(regions.every(s => /<0$|=0$/.test(s.expr) && s.style.color));
        // Ordered drawing needs no seam lines but outlines opaque shapes; the text box stays in
        // painting order (last here).
        assert.equal(stats.seamEntries > 0, flatten);
        assert.equal(stats.outlineEntries > 0, !flatten);
        if (!flatten) assert.equal(steps.filter(s => s.kind === 'create' && s.expr.startsWith('/-/')).length, stats.outlineEntries + stats.lineEntries);
        if (!flatten) assert.equal(steps.findIndex(s => s.kind === 'text'), steps.findLastIndex(s => s.kind === 'create') + 1);
    }
    const ordered = convertSvg(svg).stats, flat = convertSvg(svg, {flatten: true}).stats;
    assert.ok(ordered.entries < 0.6 * flat.entries && ordered.edges < 0.6 * flat.edges, `${JSON.stringify(ordered)} vs ${JSON.stringify(flat)}`);
    assert.throws(() => convertSvg(svg, {precision: 50}), /precision/);
});

// Layers of an SVG at 10 px per unit with a 5 px grid (one cell = 500 integer steps of 0.001).
const layersOf = (svg, extra = {}) => layerOps(render(svg).render(), {q: 0.001, tolerance: 0.01, pxPerUnit: 10, stepPx: 5, ...extra}).layers;
const fills = layers => layers.filter(l => l.kind === 'fill');

test('layers: shapes are stacked whole, in painting order; hidden ones are dropped; same colours merge', () => {
    const layers = fills(layersOf(`<svg viewBox="0 0 100 100">
        <rect x="40" y="40" width="10" height="10" fill="#00ff00"/>
        <rect width="100" height="100" fill="#ff0000"/>
        <circle cx="30" cy="30" r="10" fill="#0000ff"/>
        <rect x="60" y="60" width="10" height="10" fill="#ff0000"/>
        <circle cx="70" cy="30" r="10" fill="#0000ff"/></svg>`, {seams: false}));
    // The green square is hidden by the red background; the background keeps its 4 corners
    // (nothing is cut out of it); the two blue circles merge, and so does the second red square.
    assert.deepEqual(layers.map(l => l.hex), ['#ff0000', '#0000ff']);
    assert.equal(layers[0].paths.length, 1);
    assert.equal(layers[0].paths[0].length, 4);
    assert.equal(layers[1].paths.length, 2);
    // A shape is not moved beneath a layer it overlaps.
    const kept = fills(layersOf(`<svg viewBox="0 0 100 100"><rect width="50" height="50" fill="#ff0000"/>
        <rect x="25" y="25" width="50" height="50" fill="#0000ff"/><rect x="40" y="40" width="50" height="50" fill="#ff0000"/></svg>`));
    assert.deepEqual(kept.map(l => l.hex), ['#ff0000', '#0000ff', '#ff0000']);
});

test('layers: a shape bordering a later one reaches about a cell beneath it, so no seam shows', () => {
    const svg = `<svg viewBox="0 0 100 100"><rect width="50" height="100" fill="#ff0000"/><rect x="50" width="50" height="100" fill="#0000ff"/></svg>`;
    const [red] = fills(layersOf(svg));
    const box = P.bbox(red.paths);
    assert.ok(box.maxX >= 50500 && box.maxX <= 51500, `red reaches under blue: ${box.maxX}`);
    assert.equal(P.bbox(fills(layersOf(svg, {seams: false}))[0].paths).maxX, 50000);
    // Crossing outlines are left alone: a bar across a disk does not grow into it.
    const [bar] = fills(layersOf(`<svg viewBox="0 0 100 100"><rect y="45" width="100" height="10" fill="#ff0000"/><circle cx="50" cy="50" r="30" fill="#0000ff"/></svg>`));
    assert.equal(bar.paths[0].length, 4);
});

test('layers: opaque near-white is cut out of what lies beneath; translucent paint is fitted to Arch', () => {
    const layers = fills(layersOf(`<svg viewBox="0 0 100 100"><rect width="100" height="100" fill="#1e88e5"/>
        <rect x="20" y="20" width="20" height="20" fill="#ffffff"/><rect x="60" y="20" width="20" height="20" fill="#f0f0f0"/>
        <rect x="20" y="60" width="60" height="20" fill="#000000" fill-opacity="0.3"/></svg>`));
    const [blue, ink, shade] = layers;
    assert.equal(blue.hex, '#1e88e5');
    assert.equal(blue.paths.length, 3, 'two holes');
    assert.ok(Math.abs(P.area(blue.paths) - (10000 - 800) * 1e6) < 1e6);
    // #f0f0f0 over the canvas: a translucent ink that Arch shows as #f0f0f0.
    const shown = archShown(archOver({...parseColor(ink.hex), a: ink.opacity}, CLEAR));
    for (const k of ['r', 'g', 'b']) assert.ok(Math.abs(shown[k] * 255 - 240) < 1.5, `${k}: ${shown[k] * 255}`);
    assert.equal(archDimsColor(parseColor(ink.hex)), false);
    // Black 30% over blue: Arch shows a*c + (1-a)*below + a*(1-a)*white, so the layer is fitted.
    const blueColor = {...parseColor('#1e88e5'), a: 1};
    const result = archShown(archOver({...parseColor(shade.hex), a: shade.opacity}, archOver(blueColor, CLEAR)));
    for (const k of ['r', 'g', 'b']) assert.ok(Math.abs(result[k] - 0.7 * blueColor[k]) < 4 / 255, `${k}`);
});

test("fitting translucent paint to Arch's blending", () => {
    const red = {r: 1, g: 0, b: 0, a: 1}, canvas = {gl: CLEAR, color: {r: 1, g: 1, b: 1, a: 1}, weight: 1};
    const onRed = {gl: {...red}, color: red, weight: 1};
    const check = (target, bgs, fit) => {
        for (const b of bgs) {
            const shown = archShown(archOver(fit, b.gl)), want = {r: 0, g: 0, b: 0};
            for (const k of ['r', 'g', 'b']) want[k] = target.a * target[k] + (1 - target.a) * b.color[k];
            for (const k of ['r', 'g', 'b']) assert.ok(Math.abs(shown[k] - want[k]) <= 8 / 255, `${k}: ${shown[k]} vs ${want[k]}`);
        }
    };
    const white = {r: 1, g: 1, b: 1, a: 0.4};
    const fit = fitLayer(white, [onRed]);
    check(white, [onRed], fit);
    assert.ok(Math.abs(fit.a - 0.4) < 0.01, 'keeps the paint opacity when that works');
    // Over red and over the canvas at once, black 50% has no single answer.
    assert.equal(fitLayer({r: 0, g: 0, b: 0, a: 0.5}, [onRed, canvas]), null);
    // Over the canvas alone it always has one.
    const grey = {r: 0.9, g: 0.92, b: 0.95, a: 1};
    check(grey, [canvas], fitLayer(grey, [canvas]));
    assert.deepEqual(nearestDrawable({r: 1, g: 1, b: 1, a: 1}), {r: 0.85, g: 0.85, b: 0.85, a: 1});
});

test('point-list joins: segments reach the miter point, never past the other edge', () => {
    // A right-angle turn: both segments reach half the width past the corner, closing the notch.
    assert.deepEqual(joinedRuns([[0, 0], [1000, 0], [1000, 1000]], {half: 50}).map(run => run.map(p => p.map(Math.round))),
        [[[0, 0], [1050, 0]], [[1000, -50], [1000, 1000]]]);
    // A smooth curve stays one run; open ends get caps only when asked.
    const arc = Array.from({length: 20}, (_, i) => [Math.round(1e4 * Math.cos(i / 40)), Math.round(1e4 * Math.sin(i / 40))]);
    assert.equal(joinedRuns(arc, {half: 50, minGap: 5}).length, 1);
    assert.deepEqual(joinedRuns([[0, 0], [100, 0]], {half: 10, caps: true})[0].map(p => p.map(Math.round)), [[-10, 0], [110, 0]]);
    // What a point list paints along a star's outline stays inside the star and covers its edge band.
    const star = [];
    for (let i = 0; i < 10; i++) { const r = i % 2 ? 4000 : 10000, a = Math.PI / 2 + i * Math.PI / 5; star.push({X: Math.round(r * Math.cos(a)), Y: Math.round(r * Math.sin(a))}); }
    const shape = P.normalize([star]), half = 400;
    const cover = runCoverage(toIntPaths(outlineRuns(shape, half, 5)), half);
    assert.ok(P.area(P.difference(cover, shape)) < 0.5 * half * half, 'nothing sticks out');
    const band = P.difference(shape, P.offset(shape, -2 * half, 4));
    assert.ok(P.area(P.difference(band, cover)) < 0.1 * P.area(band), 'the edge band is painted, except the sharpest tips');
});

test('concave corners are carved from the fill only where the outline paints them back', () => {
    const shape = P.difference([[{X: 0, Y: 0}, {X: 20000, Y: 0}, {X: 20000, Y: 20000}, {X: 0, Y: 20000}]],
        [[{X: 5000, Y: 5000}, {X: 5000, Y: 15000}, {X: 15000, Y: 15000}, {X: 15000, Y: 5000}]]);
    const half = 750, cover = runCoverage(toIntPaths(outlineRuns(shape, half, 37)), half);
    const carve = concaveCorners(shape, 1.9 * half, cover);
    assert.equal(P.components(carve).length, 4, 'the hole has four concave corners');
    assert.ok(P.area(P.difference(carve, cover)) < 1e-6 * P.area(carve), 'all within the outline');
    const fill = P.difference(shape, carve);
    // No concave corner of the carved fill lies on the true outline (where Arch would round it outwards).
    const onOutline = (X, Y) => [5000, 15000].includes(X) && Y >= 5000 && Y <= 15000 || [5000, 15000].includes(Y) && X >= 5000 && X <= 15000;
    for (const ring of fill)
        ring.forEach((v, i) => {
            const a = ring[(i - 1 + ring.length) % ring.length], b = ring[(i + 1) % ring.length];
            const cross = (v.X - a.X) * (b.Y - v.Y) - (v.Y - a.Y) * (b.X - v.X);
            if (cross < 0) assert.ok(!onOutline(v.X, v.Y), `concave vertex on the outline at ${v.X},${v.Y}`);
        });
    // Corners that later shapes hide are left alone.
    assert.deepEqual(concaveCorners(shape, 1.9 * half, cover, () => true), []);
});

test('a shape with many holes is tiled into entries under the edge limit', () => {
    let holes = '';
    for (let i = 0; i < 20; i++) for (let j = 0; j < 10; j++) holes += `<rect x="${5 + i * 10}" y="${5 + j * 10}" width="4" height="4" fill="#fff"/>`;
    const svg = `<svg viewBox="0 0 210 110"><rect width="210" height="110" fill="#1e88e5"/>${holes}</svg>`;
    const {script, stats} = convertSvg(svg, {maxEdges: 200});
    const fills = parseScript(script).steps.filter(s => s.kind === 'create' && s.expr.startsWith('cos('));
    assert.ok(fills.length > 4, `${fills.length} entries`);
    for (const f of fills) assert.ok((f.expr.match(/heaviside\(/g) || []).length / 3 <= 200 + 8);
    assert.ok(stats.edges >= 4 + 200 * 4);
});

test('layered gradient bands reach under the next band and cover the shape', () => {
    const svg = `<svg viewBox="0 0 100 10"><linearGradient id="g"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#00f"/></linearGradient>
        <rect width="100" height="10" fill="url(#g)"/></svg>`;
    const [op] = render(svg).render();
    const bands = gradientBands(op.paths, op.paint, {q: 0.001, tolerance: 0.01, steps: 10, layered: true, overlap: 500});
    assert.equal(bands.length, 10);
    bands.forEach((band, i) => {
        const box = P.bbox(band.paths);
        assert.equal(box.minX, i === 0 ? 0 : i * 10000);
        assert.equal(box.maxX, i === 9 ? 100000 : (i + 1) * 10000 + 500);
    });
    // Radial bands come outermost first.
    const radial = `<svg viewBox="0 0 10 10"><radialGradient id="r"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></radialGradient>
        <circle cx="5" cy="5" r="5" fill="url(#r)"/></svg>`;
    const [rop] = render(radial).render();
    const rings = gradientBands(rop.paths, rop.paint, {q: 0.001, tolerance: 0.001, steps: 5, layered: true, overlap: 100});
    assert.ok(rings[0].color.b > rings[rings.length - 1].color.b);
    assert.ok(Math.abs(P.area(rings[0].paths) - P.area(rop.paths)) < 1e3, 'the outermost band covers the whole shape');
});

test('an SVG without viewBox or size is framed around its content', () => {
    const {stats, script} = convertSvg('<svg><rect x="100" y="50" width="20" height="10" fill="red"/></svg>');
    assert.deepEqual(stats.viewBox, {x: 100, y: 50, width: 20, height: 10});
    assert.match(script, /@view x=99\.2\.\.120\.8 y=-60\.4\.\.-49\.6/);
});
