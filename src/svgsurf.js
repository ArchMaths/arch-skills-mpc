#!/usr/bin/env node
// svgsurf (experimental): wrap an SVG drawing onto an Arch parametric surface, like a texture.
//
//   node src/svgsurf.js drawing.svg [--surface sphere|torus|cylinder|wave|"X;Y;Z"] [-o out.arch]
//   node src/cli.js out.arch -o out.txt          # then build the save file as usual
//
// Arch's 3D shader gives every surface one flat colour (no textures, no per-vertex colour), so
// the picture becomes decals. Hidden parts are cut away first, so the opaque paint is a set of
// disjoint colour regions. Each region is cut into x-monotone strips in the picture plane; a
// strip is an exact parametric patch (s, w) -> (u, v) in the surface's parameter space, lifted
// onto the surface:
//     surface(S(U,V) + L*N(U,V), s,0,R, w,0,1)
// U(s) and V(s,w) = lo(s) + w*(hi(s)-lo(s)) are piecewise linear in s, with their knots placed
// on Arch's mesh columns (Arch samples a parametric surface on an R x R grid, R = floor(3.125 *
// implicitPrecision), at most 60), so the strip's corners and straight edges are exact in (u, v).
// Wide or tall strips are subdivided so no mesh cell sags into the layer beneath it.
// L lifts the decal a little along the unit normal N: Arch draws all 3D objects into one depth
// buffer (LEQUAL), so a decal lying exactly on the surface would z-fight with it. Neighbouring
// regions get different levels (a colouring of their adjacency graph, usually 3 or 4 levels), and
// each reaches a hair under its higher neighbours, so no crack shows between them. Translucent
// shapes sit above the opaque ones and blend in Arch's ordered drawing.
import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {SvgRenderer} from './svg/render.js';
import * as P from './svg/poly.js';
import {gradientBands} from './svg/regions.js';
import {toHex} from './svg/color.js';
import {fmt} from './svg/inequality.js';

// Surfaces in (u, v). n is the outward unit normal. A picture is placed on the rectangle
// u in [u0, u1] (left to right), v from vb (bottom of the picture) to vt (top).
const PRESETS = {
    sphere: {x: '2*sin(v)*cos(u)', y: '2*sin(v)*sin(u)', z: '2*cos(v)',
        nx: 'sin(v)*cos(u)', ny: 'sin(v)*sin(u)', nz: 'cos(v)',
        domain: {u: [-Math.PI, Math.PI], v: [0, Math.PI]}, place: {u: [-Math.PI, Math.PI], v: [Math.PI, 0]}},
    torus: {x: '(2+0.8*cos(v))*cos(u)', y: '(2+0.8*cos(v))*sin(u)', z: '0.8*sin(v)',
        nx: 'cos(v)*cos(u)', ny: 'cos(v)*sin(u)', nz: 'sin(v)',
        domain: {u: [-Math.PI, Math.PI], v: [-Math.PI, Math.PI]}, place: {u: [-Math.PI, Math.PI], v: [-Math.PI, Math.PI]}},
    cylinder: {x: '1.5*cos(u)', y: '1.5*sin(u)', z: 'v',
        nx: 'cos(u)', ny: 'sin(u)', nz: '0',
        domain: {u: [-Math.PI, Math.PI], v: [-1.5, 1.5]}, place: {u: [-Math.PI, Math.PI], v: [-1.5, 1.5]}},
    // A wavy sheet z = f(x, y): open surface, normal computed numerically by Arch (no nx..nz).
    wave: {x: 'u', y: 'v', z: '0.35*sin(1.5*u)*cos(1.2*v)',
        domain: {u: [-3, 3], v: [-2, 2]}, place: {u: [-3, 3], v: [-2, 2]}}
};

const {values: o, positionals} = parseArgs({allowPositionals: true, options: {
    surface: {type: 'string', default: 'sphere'},        // preset name, or "X;Y;Z" in u,v
    normal: {type: 'string'},                            // "NX;NY;NZ" outward unit normal (optional)
    domain: {type: 'string'},                            // "u0,u1,v0,v1": base surface ranges
    place: {type: 'string'},                             // "u0,u1,vb,vt": where the picture goes
    out: {type: 'string', short: 'o'},
    precision: {type: 'string', default: '8'},           // Arch implicitPrecision (mesh R = floor(3.125*p), max 60)
    lift: {type: 'string'},                              // lift per level, in surface units
    base: {type: 'string', default: '#d9d4c7'},          // base surface colour ('none' to omit)
    tolerance: {type: 'string', default: '0.001'},       // curve flattening, fraction of picture size
    'gradient-steps': {type: 'string', default: '12'},
    seam: {type: 'string', default: '0.002'},             // regions reach this far under neighbours (fraction of size)
    view: {type: 'string', default: 'azimuth=20 elevation=20'},
    title: {type: 'string'},
    help: {type: 'boolean', short: 'h'}
}});
const USAGE = `usage: svgsurf.js drawing.svg [options]       writes drawing.surface.arch; build it with cli.js
  --surface sphere|torus|cylinder|wave   a preset (default sphere), or "X;Y;Z" in u and v (write * explicitly)
  --normal "NX;NY;NZ"    outward unit normal of a custom surface (default: computed by Arch, slower)
  --domain u0,u1,v0,v1   parameter ranges of a custom surface (pi allowed)
  --place u0,u1,vb,vt    where the picture goes: u left to right, v from its bottom (vb) to its top (vt)
  -o out.arch            scene script to write
  --precision 8          Arch implicitPrecision: mesh of floor(3.125*p) steps per side, at most 60
  --lift L               lift per level in surface units (default 0.001 x the surface's size)
  --base #d9d4c7|none    colour of the surface under the picture
  --tolerance 0.001      curve flattening, as a fraction of the picture size
  --gradient-steps 12    colour bands per gradient
  --seam 0.002           how far regions reach under their neighbours, as a fraction of the picture size
  --view "azimuth=20 elevation=20"   @view 3d options (keep the surface's size x unit under about 300)
  --title text`;
if (o.help || !positionals[0]) { console.error(USAGE); process.exit(o.help ? 0 : 2); }

const num = t => Function(`"use strict";return (${String(t).replace(/\bpi\b/g, 'Math.PI')})`)();
const list = t => t.split(',').map(num);
const preset = PRESETS[o.surface];
const surf = preset ? {...preset} : (() => {
    const [x, y, z] = o.surface.split(';');
    const n = o.normal ? o.normal.split(';') : [];
    return {x, y, z, nx: n[0], ny: n[1], nz: n[2], domain: null, place: null};
})();
if (o.domain) { const d = list(o.domain); surf.domain = {u: d.slice(0, 2), v: d.slice(2, 4)}; }
if (o.place) { const d = list(o.place); surf.place = {u: d.slice(0, 2), v: d.slice(2, 4)}; }
if (!surf.domain) throw new Error('--domain u0,u1,v0,v1 is required for a custom surface');
if (!surf.place) surf.place = {u: surf.domain.u, v: surf.domain.v};

// ---- numeric evaluation of the surface in JS (orientation, size) ----
const toJs = e => e.replace(/\^/g, '**').replace(/\bpi\b/g, 'Math.PI').replace(/\bln\(/g, 'Math.log(')
    .replace(/\b(sin|cos|tan|asin|acos|atan|sinh|cosh|tanh|sqrt|exp|abs|floor|ceil|sign|min|max)\(/g, 'Math.$1(');
const S = ['x', 'y', 'z'].map(k => new Function('u', 'v', `return ${toJs(surf[k])};`));
const at = (u, v) => S.map(f => f(u, v));
const sub = (a, b) => a.map((x, i) => x - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const samples = [];
for (let i = 0; i <= 24; i++) for (let j = 0; j <= 24; j++) {
    const u = surf.domain.u[0] + (surf.domain.u[1] - surf.domain.u[0]) * (i + 0.5) / 25.0;
    const v = surf.domain.v[0] + (surf.domain.v[1] - surf.domain.v[0]) * (j + 0.5) / 25.0;
    const h = 1e-5, p = at(u, v);
    samples.push({p, n: cross(sub(at(u + h, v), at(u - h, v)), sub(at(u, v + h), at(u, v - h)))});
}
const lo3 = [0, 1, 2].map(k => Math.min(...samples.map(s => s.p[k]))), hi3 = [0, 1, 2].map(k => Math.max(...samples.map(s => s.p[k])));
const centre = lo3.map((v, k) => (v + hi3[k]) / 2), diag = Math.hypot(...sub(hi3, lo3));
// Is S_u x S_v outward? Closed surfaces: away from the centre; open ones (flat-ish): toward +z.
const closed = Math.min(...sub(hi3, lo3)) > 0.25 * diag;
const outScore = samples.reduce((acc, s) => acc + Math.sign(closed ? dot(s.n, sub(s.p, centre)) : s.n[2]), 0);
const sgnS = outScore >= 0 ? 1 : -1;
// The given normal must agree with that outward side.
let sgnN = 1;
if (surf.nx) {
    const N = ['nx', 'ny', 'nz'].map(k => new Function('u', 'v', `return ${toJs(surf[k])};`));
    const s0 = samples[Math.floor(samples.length / 2)];
    const u = surf.domain.u[0] + (surf.domain.u[1] - surf.domain.u[0]) * 0.5, v = surf.domain.v[0] + (surf.domain.v[1] - surf.domain.v[0]) * 0.5;
    sgnN = Math.sign(dot(N.map(f => f(u, v)), s0.n) * sgnS) || 1;
}

// ---- SVG -> paint layers in device coordinates (SVG user units, y up), integer steps of q ----
const source = fs.readFileSync(positionals[0], 'utf8');
const renderer = new SvgRenderer(source, {notes: new Map()});
const box = renderer.viewBox();
if (!box) throw new Error('the SVG needs a viewBox or width/height');
const size = Math.max(box.width, box.height);
const q = 10 ** Math.floor(Math.log10(size / 50000));
const tolerance = Number(o.tolerance) * size;
const pxPerUnit = 800 / size;
Object.assign(renderer.options, {q, tolerance, pxPerUnit, lineMaxPx: 0});   // every stroke becomes a filled outline
const ops = renderer.render();
const layers = [];
const notes = [];
for (const op of ops) {
    if (op.kind === 'text') { notes.push(`text "${op.content}" skipped`); continue; }
    if (op.kind !== 'fill') continue;
    if (op.paint.type === 'solid') layers.push({paths: op.paths, color: {...op.paint.color, a: op.paint.color.a * op.alpha}, label: op.label});
    // Bands side by side (not stacked): later steps cut hidden parts anyway, and translucent
    // bands must not overlap or they would blend twice.
    else for (const band of gradientBands(op.paths, op.paint, {q, tolerance, steps: Number(o['gradient-steps']), pxPerUnit, minBandPx: 4, layered: false}))
        layers.push({paths: band.paths, color: {...band.color, a: band.color.a * op.alpha}, label: op.label});
}
const xmin = box.x, xmax = box.x + box.width, ymin = -(box.y + box.height), ymax = -box.y;

// ---- strips: vertical-slab trapezoids chained into x-monotone pieces ----
function strips(rings) {
    const edges = [], xsSet = new Set();
    for (const ring of rings) for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        xsSet.add(a.X);
        if (a.X === b.X) continue;
        const [p, r] = a.X < b.X ? [a, b] : [b, a];
        edges.push({x1: p.X, y1: p.Y, x2: r.X, y2: r.Y});
    }
    const xs = [...xsSet].sort((a, b) => a - b);
    edges.sort((a, b) => a.x1 - b.x1);
    const yAt = (e, x) => e.y1 + (e.y2 - e.y1) * (x - e.x1) / (e.x2 - e.x1);
    let active = [], ei = 0, open = [];
    const done = [], eps = 1e-6;
    for (let i = 0; i + 1 < xs.length; i++) {
        const xa = xs[i], xb = xs[i + 1], xm = (xa + xb) / 2;
        while (ei < edges.length && edges[ei].x1 <= xa) active.push(edges[ei++]);
        active = active.filter(e => e.x2 >= xb);
        const sorted = active.map(e => ({e, y: yAt(e, xm)})).sort((a, b) => a.y - b.y);
        const next = [];
        for (let k = 0; k + 1 < sorted.length; k += 2) {
            const lo = sorted[k].e, hi = sorted[k + 1].e;
            const la = yAt(lo, xa), ha = yAt(hi, xa);
            const idx = open.findIndex(s => Math.abs(s.at(-1).lo - la) < eps && Math.abs(s.at(-1).hi - ha) < eps);
            const s = idx >= 0 ? open.splice(idx, 1)[0] : [{x: xa, lo: la, hi: ha}];
            s.push({x: xb, lo: yAt(lo, xb), hi: yAt(hi, xb)});
            next.push(s);
        }
        done.push(...open);
        open = next;
    }
    return [...done, ...open];
}
// Drop knots where both chains run straight on; split pieces with more slabs than mesh columns.
function simplify(knots, maxSlabs) {
    const keep = [knots[0]];
    for (let j = 1; j + 1 < knots.length; j++) {
        const a = keep.at(-1), b = knots[j], c = knots[j + 1];
        const straight = k => Math.abs((b[k] - a[k]) * (c.x - a.x) - (c[k] - a[k]) * (b.x - a.x)) <= 1e-6 * (c.x - a.x) * (1 + Math.abs(c[k] - a[k]));
        if (b.forced || !(straight('lo') && straight('hi'))) keep.push(b);
    }
    keep.push(knots.at(-1));
    const out = [];
    for (let j = 0; j + 1 < keep.length; j += maxSlabs) out.push(keep.slice(j, Math.min(keep.length, j + maxSlabs + 1)));
    return out;
}
// Mesh columns 0..R for the knots: roughly proportional to width, at least one per slab.
function columns(knots, R) {
    const m = knots.length - 1, W = knots[m].x - knots[0].x, c = [0];
    for (let j = 1; j < m; j++) c.push(Math.min(R - (m - j), Math.max(c[j - 1] + 1, Math.round(R * (knots[j].x - knots[0].x) / W))));
    c.push(R);
    return c;
}
// Piecewise linear function through (c_j, f_j) as A + B*s + sum D_j*abs(s - c_j).
function pl(c, f, s = 's') {
    const m = c.length - 1, slope = [];
    for (let j = 0; j < m; j++) slope.push((f[j + 1] - f[j]) / (c[j + 1] - c[j]));
    const B = (slope[0] + slope[m - 1]) / 2;
    let A = f[0] - B * c[0], terms = '';
    for (let j = 1; j < m; j++) {
        const D = (slope[j] - slope[j - 1]) / 2;
        if (Math.abs(D) < 1e-12) continue;
        A -= D * Math.abs(c[0] - c[j]);
        terms += `${D < 0 ? '-' : '+'}${fmt(Math.abs(D), 7)}*abs(${s}-${c[j]})`;
    }
    const lin = Math.abs(B) < 1e-12 ? '' : `${B < 0 ? '-' : '+'}${fmt(Math.abs(B), 7)}*${s}`;
    const head = fmt(A, 7);
    return `${head}${lin}${terms}`.replace(/^0(?=[+-])/, '');
}

// ---- build the scene ----
const precision = Number(o.precision);
const R = Math.max(4, Math.min(60, Math.floor(62.5 / (20 / precision))));
const lift = o.lift ? Number(o.lift) : 0.001 * diag;
const pu = surf.place.u, pv = surf.place.v;
const mapU = X => pu[0] + (X * q - xmin) / (xmax - xmin) * (pu[1] - pu[0]);
const mapV = Y => pv[0] + (Y * q - ymin) / (ymax - ymin) * (pv[1] - pv[0]);
const jac = Math.sign((pu[1] - pu[0]) * (pv[1] - pv[0]));
const swapDecal = sgnS * jac < 0, swapBase = sgnS < 0;

const lines = [];
lines.push(`@title ${o.title || path.basename(positionals[0], '.svg')} on a surface`);
lines.push(`# Made by svgsurf from ${path.basename(positionals[0])}: each colour region is cut into strips that are exact in (u,v),\n# each a parametric surface lifted a little above the surface srfx, srfy, srfz along its unit normal nrmx, nrmy, nrmz.`);
lines.push(`srfx(u,v)=${surf.x}`, `srfy(u,v)=${surf.y}`, `srfz(u,v)=${surf.z}`);
let N;
if (surf.nx) {
    lines.push(`nrmx(u,v)=${surf.nx}`, `nrmy(u,v)=${surf.ny}`, `nrmz(u,v)=${surf.nz}`);
    N = ['nrmx', 'nrmy', 'nrmz'];
} else {
    // Unit normal by central differences of the surface (bigger expressions, works for any surface).
    const h = '0.0001', d = (f, w) => w === 'u' ? `(${f}(u+${h},v)-${f}(u-${h},v))` : `(${f}(u,v+${h})-${f}(u,v-${h}))`;
    lines.push(`tgx(u,v)=${d('srfy', 'u')}*${d('srfz', 'v')}-${d('srfz', 'u')}*${d('srfy', 'v')}`,
        `tgy(u,v)=${d('srfz', 'u')}*${d('srfx', 'v')}-${d('srfx', 'u')}*${d('srfz', 'v')}`,
        `tgz(u,v)=${d('srfx', 'u')}*${d('srfy', 'v')}-${d('srfy', 'u')}*${d('srfx', 'v')}`,
        `tgl(u,v)=sqrt(tgx(u,v)^2+tgy(u,v)^2+tgz(u,v)^2)`,
        `nrmx(u,v)=tgx(u,v)/tgl(u,v)`, `nrmy(u,v)=tgy(u,v)/tgl(u,v)`, `nrmz(u,v)=tgz(u,v)/tgl(u,v)`);
    N = ['nrmx', 'nrmy', 'nrmz'];
    sgnN = sgnS;
}
const d0 = surf.domain;
if (o.base !== 'none') {
    const r = [`u,${fmt(d0.u[0], 9)},${fmt(d0.u[1], 9)}`, `v,${fmt(d0.v[0], 9)},${fmt(d0.v[1], 9)}`];
    lines.push(`surface(srfx(u,v),srfy(u,v),srfz(u,v),${(swapBase ? r.reverse() : r).join(',')}) | color=${o.base}`);
}

// A mesh cell is a flat chord of the surface: it sinks below the surface by its sag. Keep that
// well under the lift between levels, or a decal sinks into the one beneath and they z-fight.
const maxSag = lift / 4;
const P3 = (X, Y) => at(mapU(X), mapV(Y));
const sag = (a, b) => { const m = P3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), pa = P3(...a), pb = P3(...b);
    return Math.hypot(...sub(m, pa.map((x, i) => (x + pb[i]) / 2))); };
// Extra knots in wide slabs, so each column is narrow enough (columns: at least one per slab).
function densify(knots) {
    const out = [knots[0]];
    for (let j = 1; j < knots.length; j++) {
        const a = knots[j - 1], b = knots[j], mid = (a.lo + a.hi + b.lo + b.hi) / 4;
        const worst = Math.max(sag([a.x, a.lo], [b.x, b.lo]), sag([a.x, a.hi], [b.x, b.hi]), sag([a.x, mid], [b.x, mid]));
        const n = Math.min(64, Math.ceil(Math.sqrt(worst / maxSag)));
        for (let i = 1; i < n; i++) { const f = i / n; out.push({x: a.x + f * (b.x - a.x), lo: a.lo + f * (b.lo - a.lo), hi: a.hi + f * (b.hi - a.hi), forced: true}); }
        out.push(b);
    }
    return out;
}
// Bands across a strip, so each of its R rows is narrow enough too.
const rowsFor = (a, b) => { const x = (a.x + b.x) / 2, lo = (a.lo + b.lo) / 2, hi = (a.hi + b.hi) / 2;
    return Math.min(16, Math.ceil(Math.sqrt(sag([x, lo], [x, lo + (hi - lo) / R]) / maxSag))); };

// Hidden parts first: every layer loses what later opaque layers cover, so the opaque paint
// becomes disjoint colour regions that all share level 1 (no stacking, nothing floats). Opaque
// regions of one colour are merged. Translucent layers keep their place above what they cover:
// level 2, or one above the highest earlier translucent layer they overlap.
const tiny = (tolerance / q) ** 2;
let cover = [];
const visible = [];
for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    let rings = P.normalize(layer.paths);
    if (!rings.length || layer.color.a < 0.02) continue;
    const opaque = layer.color.a >= 0.995;
    const seen = P.difference(rings, cover);
    if (opaque) cover = P.union(cover, rings);
    if (P.area(seen) > tiny) visible.unshift({...layer, rings: seen, opaque});
}
const byColour = new Map(), translucent = [];
for (const layer of visible) {
    if (!layer.opaque) { translucent.push(layer); continue; }
    const hex = toHex(layer.color), prev = byColour.get(hex);
    if (prev) { prev.rings = P.union(prev.rings, layer.rings); prev.labels.push(layer.label); }
    else byColour.set(hex, {...layer, labels: [layer.label]});
}
// Neighbouring regions share edges exactly in (u,v), but not mesh vertices, so hairline cracks
// could show the base surface between them. So neighbours go on different levels (a greedy
// colouring of the adjacency graph: a handful of levels, not one per layer), and each region
// reaches a hair (--seam) under its neighbours on higher levels, which cover that band exactly.
const seam = Number(o.seam) * size / q;
const regions = [...byColour.values()];
const grown = regions.map(r => seam > 0 ? P.offset(r.rings, seam, 4) : r.rings);
const gbox = grown.map(g => P.bbox(g)), rbox = regions.map(r => P.bbox(r.rings));
const adj = regions.map(() => []);
for (let i = 0; i < regions.length; i++) for (let j = i + 1; j < regions.length; j++)
    if (P.overlaps(gbox[i], rbox[j]) && P.area(P.intersect(grown[i], regions[j].rings)) > tiny) { adj[i].push(j); adj[j].push(i); }
const order = regions.map((_, i) => i).sort((a, b) => adj[b].length - adj[a].length);
for (const i of order) {
    const used = new Set(adj[i].map(j => regions[j].level).filter(Boolean));
    let level = 1;
    while (used.has(level)) level++;
    regions[i].level = level;
}
regions.forEach((r, i) => {
    const higher = adj[i].filter(j => regions[j].level > r.level).map(j => regions[j].rings);
    if (higher.length) r.extended = P.union(r.rings, P.intersect(grown[i], higher.reduce((a, b) => P.union(a, b))));
});
for (const r of regions) if (r.extended) r.rings = r.extended;
const opaqueLevels = Math.max(0, ...regions.map(r => r.level));
const placed = [];
for (const layer of regions.concat(translucent)) {
    if (!layer.opaque) {
        layer.level = opaqueLevels + 1;
        layer.bb = P.bbox(layer.rings);
        for (const other of placed) if (!other.opaque && other.level >= layer.level && P.overlaps(other.bb, layer.bb) &&
            P.area(P.intersect(other.rings, layer.rings)) > tiny) layer.level = other.level + 1;
    }
    placed.push(layer);
}
let pieces = 0, maxLevel = 0;
for (const layer of placed) {
    const {rings, level} = layer;
    maxLevel = Math.max(maxLevel, level);
    const L = fmt(sgnN * level * lift, 6);
    const style = `color=${toHex(layer.color)}${layer.color.a < 0.995 ? ` opacity=${fmt(layer.color.a, 3)}` : ''}`;
    const labels = layer.labels || [layer.label];
    lines.push(`# ${toHex(layer.color)}${layer.opaque ? '' : ` at opacity ${fmt(layer.color.a, 3)}`}, level ${level}: ${labels[0] || 'shape'}${labels.length > 1 ? ` and ${labels.length - 1} more` : ''}`);
    for (const strip of strips(rings)) for (const knots of simplify(densify(strip), R)) {
        if (knots.every(k => k.hi - k.lo < 1e-9)) continue;
        const c = columns(knots, R);
        const U = pl(c, knots.map(k => mapU(k.x)));
        const VL = pl(c, knots.map(k => mapV(k.lo)));
        const DV = pl(c, knots.map(k => mapV(k.hi) - mapV(k.lo)));
        // Tall strips are cut into bands so the R rows also follow the surface closely.
        const rows = Math.max(...knots.map((k, j) => j ? rowsFor(knots[j - 1], k) : 1));
        for (let b = 0; b < rows; b++) {
            const wv = rows === 1 ? 'w' : `(${fmt(b / rows, 9)}+w/${rows})`;
            const V = `${VL}+${wv}*(${DV})`;
            const coord = (f, n) => `${f}(${U},${V})+${L}*${n}(${U},${V})`;
            const r = [`s,0,${R}`, 'w,0,1'];
            lines.push(`surface(${coord('srfx', N[0])},${coord('srfy', N[1])},${coord('srfz', N[2])},${(swapDecal ? r.reverse() : r).join(',')}) | ${style}`);
            pieces++;
        }
    }
}
lines.push(`@view 3d ${o.view}`);
lines.push(`@set implicitPrecision=${precision} orderedDrawing=true showAxes=false gridStyle=hidden`);
const script = lines.join('\n') + '\n';
const out = o.out || positionals[0].replace(/\.svg$/i, '') + '.surface.arch';
fs.writeFileSync(out, script);
console.log(`${placed.length} layer(s), ${pieces} patch(es), ${maxLevel} level(s), mesh ${R}x${R}, lift ${fmt(lift, 3)} per level; ${(script.length / 1024).toFixed(0)} KB -> ${out}`);
if (notes.length) console.log(notes.join('\n'));
