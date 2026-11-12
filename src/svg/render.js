// Walks an SVG document and produces paint operations in painting order, with all geometry
// resolved to device space (Arch coordinates: SVG user units of the root viewBox, y flipped)
// as integer Paths (see poly.js):
//
//   {kind: 'fill', paths, paint, alpha, label}        an area painted with a paint
//   {kind: 'line', paths, color, alpha, widthPx, label} a stroke too thin for Arch's sampling grid,
//                                                     kept as a polyline (open Paths)
//   {kind: 'text', x, y, size, color, alpha, anchor, content, label}
//
// paint is {type: 'solid', color} or a gradient {type: 'linear'|'radial', stops, spread, toDevice, ...}.
// Filters are ignored on purpose. Clip paths are applied exactly; masks are approximated as
// clips (the parts of the mask that are at least half on).
import {parseXml, elementChildren, textContent, walk} from './xml.js';
import {parseStylesheet, parseDeclarations, matches} from './css.js';
import {parseColor, luminance} from './color.js';
import * as G from './geom.js';
import * as P from './poly.js';

const PROPERTIES = ['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap',
    'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'display', 'visibility',
    'color', 'clip-path', 'clip-rule', 'mask', 'filter', 'stop-color', 'stop-opacity', 'font-size', 'font-family',
    'font-weight', 'font-style', 'text-anchor', 'paint-order', 'transform', 'overflow', 'marker-start', 'marker-mid',
    'marker-end', 'marker', 'vector-effect', 'mix-blend-mode'];
const PRESENTATION = new Set(PROPERTIES.filter(p => p !== 'transform'));
const INHERITED = new Set(['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap',
    'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'visibility', 'color', 'clip-rule',
    'font-size', 'font-family', 'font-weight', 'font-style', 'text-anchor', 'paint-order', 'marker-start', 'marker-mid', 'marker-end']);
const INITIAL = {
    fill: 'black', 'fill-opacity': '1', 'fill-rule': 'nonzero', stroke: 'none', 'stroke-width': '1', 'stroke-opacity': '1',
    'stroke-linecap': 'butt', 'stroke-linejoin': 'miter', 'stroke-miterlimit': '4', 'stroke-dasharray': 'none',
    'stroke-dashoffset': '0', opacity: '1', display: 'inline', visibility: 'visible', color: 'black', 'clip-path': 'none',
    'clip-rule': 'nonzero', mask: 'none', filter: 'none', 'stop-color': 'black', 'stop-opacity': '1', 'font-size': '16',
    'text-anchor': 'start', 'paint-order': 'normal', overflow: 'hidden', 'marker-start': 'none', 'marker-mid': 'none', 'marker-end': 'none'
};
// Elements that never paint where they stand.
const NOT_RENDERED = new Set(['defs', 'symbol', 'clipPath', 'mask', 'pattern', 'marker', 'linearGradient', 'radialGradient',
    'filter', 'style', 'title', 'desc', 'metadata', 'script', 'font', 'font-face', 'glyph', 'missing-glyph', 'cursor',
    'view', 'animate', 'animateTransform', 'animateMotion', 'set', 'stop', 'namedview', 'sodipodi:namedview']);
const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const CONTAINERS = new Set(['g', 'a', 'switch']);

const UNITS = {px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, q: 96 / 101.6};

// "12", "1.5em", "50%" -> user units; NaN if unreadable. ref is the length that 100% means.
export function parseLength(text, ref = 0, fontSize = 16) {
    if (text === undefined || text === null) return NaN;
    const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([a-z%]*)\s*$/i.exec(String(text));
    if (!m) return NaN;
    const v = parseFloat(m[1]);
    const unit = m[2].toLowerCase();
    if (!unit) return v;
    if (unit === '%') return v * ref / 100;
    if (unit === 'em' || unit === 'rem') return v * fontSize;
    if (unit === 'ex') return v * fontSize / 2;
    return unit in UNITS ? v * UNITS[unit] : NaN;
}

const urlRef = value => /^\s*url\(\s*['"]?#([^'")\s]+)['"]?\s*\)\s*(.*)$/i.exec(value || '');
const hrefOf = el => el.attrs.href ?? el.attrs['xlink:href'];
const idFromHref = href => href && href.startsWith('#') ? href.slice(1) : null;

export class SvgRenderer {
    // options: {q, tolerance (device units), pxPerUnit, lineMaxPx, notes: Map(counter)}
    constructor(source, options = {}) {
        this.root = typeof source === 'string' ? parseXml(source) : source;
        this.ids = new Map();
        const styles = [];
        for (const el of walk(this.root)) {
            if (el.attrs.id && !this.ids.has(el.attrs.id)) this.ids.set(el.attrs.id, el);
            if (el.name === 'style' && (!el.attrs.type || /css/i.test(el.attrs.type))) styles.push(textContent(el));
        }
        this.rules = [];
        for (const css of styles) this.rules.push(...parseStylesheet(css, this.rules.length));
        this.declaredCache = new WeakMap();
        this.options = options;
        this.notes = options.notes || new Map();
    }

    note(key, detail) {
        const entry = this.notes.get(key) || {count: 0, details: []};
        entry.count++;
        if (detail && entry.details.length < 3 && !entry.details.includes(detail)) entry.details.push(detail);
        this.notes.set(key, entry);
    }

    // The root viewBox (x, y, width, height) in user units, or null when neither viewBox nor size is given.
    viewBox() {
        const vb = G.parseNumberList(this.root.attrs.viewBox);
        if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) return {x: vb[0], y: vb[1], width: vb[2], height: vb[3]};
        const w = parseLength(this.root.attrs.width), h = parseLength(this.root.attrs.height);
        if (w > 0 && h > 0) return {x: 0, y: 0, width: w, height: h};
        return null;
    }

    // Cascaded values (no inheritance): presentation attributes < stylesheet rules < style attribute,
    // with !important stylesheet rules above the style attribute.
    declared(el) {
        let out = this.declaredCache.get(el);
        if (out) return out;
        const candidates = new Map();
        const offer = (name, value, rank) => {
            const prev = candidates.get(name);
            if (!prev || rank >= prev.rank) candidates.set(name, {value, rank});
        };
        for (const [name, value] of Object.entries(el.attrs))
            if (PRESENTATION.has(name)) offer(name, value.trim(), 0);
        for (const rule of this.rules) {
            if (!matches(el, rule.selector)) continue;
            for (const d of rule.declarations)
                offer(d.name, d.value, (d.important ? 3e12 : 1e12) + rule.selector.specificity * 1e4 + rule.order);
        }
        if (el.attrs.style)
            for (const d of parseDeclarations(el.attrs.style)) offer(d.name, d.value, d.important ? 4e12 : 2e12);
        out = new Map([...candidates].map(([k, v]) => [k, v.value]));
        this.declaredCache.set(el, out);
        return out;
    }

    computeStyle(el, parent) {
        const declared = this.declared(el);
        const style = {};
        for (const name of PROPERTIES) {
            let value = declared.get(name);
            if (value === 'inherit') value = parent ? parent[name] : INITIAL[name];
            else if (value === undefined || value === 'initial' || value === 'unset')
                value = (value !== 'initial' && INHERITED.has(name) && parent) ? parent[name] : INITIAL[name];
            style[name] = value;
        }
        // font-size is resolved to user units here, so em lengths below can use it.
        const parentSize = parent ? parent['font-size'] : 16;
        const size = parseLength(style['font-size'], parentSize, parentSize);
        style['font-size'] = Number.isFinite(size) && size > 0 ? size : parentSize;
        return style;
    }

    // Renders the whole document; returns the paint operations.
    render() {
        const vb = this.viewBox();
        const m = G.multiply([1, 0, 0, -1, 0, 0], G.parseTransform(this.root.attrs.transform));
        // Like a browser, show only what lies inside the root viewport.
        const clip = vb && this.options.clipToViewBox !== false
            ? P.normalize(P.toPaths(G.flatten(G.rectPath(vb.x, vb.y, vb.width, vb.height), [1, 0, 0, -1, 0, 0], 1), this.options.q)) : null;
        const ctx = {m, style: null, viewport: vb || {width: 100, height: 100}, alpha: 1, clip, ops: [], uses: new Set()};
        this.renderChildren(this.root, {...ctx, style: this.computeStyle(this.root, null)});
        return ctx.ops;
    }

    renderChildren(el, ctx) {
        let children = elementChildren(el);
        if (el.name === 'switch') {
            // Render only the first child whose conditions hold; editors put a fallback after foreignObject.
            const first = children.find(c => c.name !== 'foreignObject' && !c.attrs.requiredExtensions && !c.attrs.requiredFeatures && !NOT_RENDERED.has(c.name));
            children = first ? [first] : [];
        }
        for (const child of children) this.renderElement(child, ctx);
    }

    renderElement(el, parentCtx, styleParent = parentCtx.style) {
        // Editor data in other namespaces (sodipodi:namedview, i:pgf, ...) is not drawn.
        if (NOT_RENDERED.has(el.name) || (el.qname.includes(':') && !el.qname.startsWith('svg:'))) return;
        const style = this.computeStyle(el, styleParent);
        if (style.display === 'none') return;
        const local = G.parseTransform(el.attrs.transform ?? (style.transform && style.transform !== 'none' ? style.transform : undefined));
        let m = G.multiply(parentCtx.m, local);
        const ctx = {...parentCtx, style, m};
        const opacity = parseFloat(style.opacity);
        if (Number.isFinite(opacity) && opacity < 1) ctx.alpha = parentCtx.alpha * Math.max(0, opacity);
        if (style.filter && style.filter !== 'none') this.note('filter');
        if (style['mix-blend-mode'] && style['mix-blend-mode'] !== 'normal') this.note('blend');
        if (!this.applyClips(el, style, ctx)) return;

        if (el.name === 'svg') return this.renderNestedSvg(el, ctx);
        if (el.name === 'use') return this.renderUse(el, ctx);
        if (CONTAINERS.has(el.name)) return this.renderChildren(el, ctx);
        if (SHAPES.has(el.name)) {
            if (style.visibility === 'hidden' || style.visibility === 'collapse') return;
            const subpaths = this.shapeGeometry(el, ctx);
            if (subpaths.length) this.paintShape(el, subpaths, ctx);
            return;
        }
        if (el.name === 'text') return this.renderText(el, ctx);
        if (el.name === 'image') return this.note('image', el.attrs.id);
        if (el.name === 'foreignObject') return this.note('foreignObject');
        // Unknown elements: render their children as a group would (e.g. editor wrappers).
        this.renderChildren(el, ctx);
    }

    // Applies clip-path and mask to ctx.clip; returns false when nothing can show.
    applyClips(el, style, ctx) {
        const restrict = paths => {
            ctx.clip = ctx.clip ? P.intersect(ctx.clip, paths) : paths;
            return ctx.clip.length > 0;
        };
        const clip = urlRef(style['clip-path']);
        if (clip) {
            const target = this.ids.get(clip[1]);
            if (target?.name === 'clipPath') {
                if (!restrict(this.clipRegion(target, el, ctx))) return false;
            } else this.note('missing-clip', clip[1]);
        } else if (style['clip-path'] && style['clip-path'] !== 'none') this.note('clip-shape');
        const mask = urlRef(style.mask);
        if (mask) {
            const target = this.ids.get(mask[1]);
            if (target?.name === 'mask') {
                this.note('mask', mask[1]);
                if (!restrict(this.maskRegion(target, el, ctx))) return false;
            }
        }
        return true;
    }

    // Bounding box of an element's geometry in its own user space (for objectBoundingBox units).
    userBBox(el, ctx) {
        let polylines = [];
        const collect = (node, m, depth) => {
            if (depth > 20) return;
            // The element's own transform is not part of its user space; its descendants' are.
            const local = node === el ? m : G.multiply(m, G.parseTransform(node.attrs.transform));
            if (SHAPES.has(node.name)) polylines.push(...G.flatten(this.shapeGeometry(node, ctx), local, 1e-3 * (ctx.viewport.width || 1)));
            else if (CONTAINERS.has(node.name) || node.name === 'svg') for (const c of elementChildren(node)) collect(c, local, depth + 1);
        };
        collect(el, G.IDENTITY, 0);
        return G.bounds(polylines);
    }

    clipRegion(clipEl, el, ctx, depth = 0) {
        let m = ctx.m;
        if (clipEl.attrs.clipPathUnits === 'objectBoundingBox') {
            const bb = this.userBBox(el, ctx);
            if (!bb) return [];
            m = G.multiply(m, [bb.width, 0, 0, bb.height, bb.x, bb.y]);
        }
        m = G.multiply(m, G.parseTransform(clipEl.attrs.transform));
        const clipStyle = this.computeStyle(clipEl, ctx.style);
        let region = [];
        const add = (node, nodeCtx, styleParent) => {
            const style = this.computeStyle(node, styleParent);
            if (style.display === 'none' || style.visibility === 'hidden') return;
            const nm = G.multiply(nodeCtx.m, G.parseTransform(node.attrs.transform));
            if (node.name === 'use') {
                const target = this.ids.get(idFromHref(hrefOf(node)));
                if (target && SHAPES.has(target.name) && depth < 10) {
                    const x = parseLength(node.attrs.x) || 0, y = parseLength(node.attrs.y) || 0;
                    add(target, {...nodeCtx, m: G.multiply(nm, G.translate(x, y))}, style);
                }
                return;
            }
            if (!SHAPES.has(node.name)) {
                if (node.name === 'text') this.note('clip-text');
                return;
            }
            const shape = P.normalize(P.toPaths(G.flatten(this.shapeGeometry(node, nodeCtx), nm, this.options.tolerance), this.options.q), style['clip-rule']);
            let paths = shape;
            const own = urlRef(style['clip-path']);
            if (own && this.ids.get(own[1])?.name === 'clipPath' && depth < 10)
                paths = P.intersect(paths, this.clipRegion(this.ids.get(own[1]), node, {...nodeCtx, m: nm}, depth + 1));
            region = region.length ? P.union(region, paths) : paths;
        };
        const childCtx = {...ctx, m};
        for (const child of elementChildren(clipEl)) add(child, childCtx, clipStyle);
        const own = urlRef(clipStyle['clip-path']);
        if (own && this.ids.get(own[1])?.name === 'clipPath' && depth < 10)
            region = P.intersect(region, this.clipRegion(this.ids.get(own[1]), el, ctx, depth + 1));
        return region;
    }

    // A mask approximated as a clip: the area where the mask content's luminance times opacity is at least 0.5.
    maskRegion(maskEl, el, ctx) {
        const q = this.options.q;
        const bb = this.userBBox(el, ctx);
        const units = maskEl.attrs.maskUnits || 'objectBoundingBox';
        const len = (name, def, ref) => {
            const raw = maskEl.attrs[name];
            if (raw === undefined) return def;
            if (units === 'objectBoundingBox') return /%$/.test(raw) ? parseFloat(raw) / 100 : parseFloat(raw);
            return parseLength(raw, ref);
        };
        let rect;
        if (units === 'objectBoundingBox') {
            if (!bb) return [];
            const x = len('x', -0.1), y = len('y', -0.1), w = len('width', 1.2), h = len('height', 1.2);
            rect = {x: bb.x + x * bb.width, y: bb.y + y * bb.height, width: w * bb.width, height: h * bb.height};
        } else {
            const vw = ctx.viewport.width, vh = ctx.viewport.height;
            rect = {x: len('x', -0.1 * vw, vw), y: len('y', -0.1 * vh, vh), width: len('width', 1.2 * vw, vw), height: len('height', 1.2 * vh, vh)};
        }
        const area = P.normalize(P.toPaths(G.flatten(G.rectPath(rect.x, rect.y, rect.width, rect.height), ctx.m, this.options.tolerance), q));
        let m = ctx.m;
        if (maskEl.attrs.maskContentUnits === 'objectBoundingBox' && bb) m = G.multiply(m, [bb.width, 0, 0, bb.height, bb.x, bb.y]);
        const sub = new SvgRenderer(this.root, {...this.options, notes: new Map()});
        sub.ids = this.ids; sub.rules = this.rules; sub.declaredCache = this.declaredCache;
        const subCtx = {m, style: this.computeStyle(maskEl, ctx.style), viewport: ctx.viewport, alpha: 1, clip: area, ops: [], uses: ctx.uses};
        sub.renderChildren(maskEl, subCtx);
        // Paint the mask content in order: "on" paint adds area, "off" paint removes it.
        let region = [];
        for (const op of subCtx.ops) {
            if (op.kind !== 'fill') continue;
            const color = op.paint.type === 'solid' ? op.paint.color : averagePaintColor(op.paint);
            const on = luminance(color) * color.a * op.alpha >= 0.5;
            region = on ? P.union(region, op.paths) : P.difference(region, op.paths);
        }
        return region;
    }

    renderNestedSvg(el, ctx) {
        const vw = ctx.viewport.width, vh = ctx.viewport.height;
        const x = parseLength(el.attrs.x, vw) || 0, y = parseLength(el.attrs.y, vh) || 0;
        const w = el.attrs.width !== undefined ? parseLength(el.attrs.width, vw) : vw;
        const h = el.attrs.height !== undefined ? parseLength(el.attrs.height, vh) : vh;
        if (!(w > 0) || !(h > 0)) return;
        this.renderViewport(el, ctx, x, y, w, h, el);
    }

    // Establishes a new viewport (nested svg, or a symbol drawn by use) and renders `content`'s children.
    renderViewport(el, ctx, x, y, w, h, content) {
        const vb = G.parseNumberList(content.attrs.viewBox);
        let m = G.multiply(ctx.m, G.translate(x, y));
        const overflow = ctx.style.overflow;
        if (overflow !== 'visible' && overflow !== 'auto') {
            const rect = P.normalize(P.toPaths(G.flatten(G.rectPath(0, 0, w, h), m, this.options.tolerance), this.options.q));
            ctx = {...ctx, clip: ctx.clip ? P.intersect(ctx.clip, rect) : rect};
            if (!ctx.clip.length) return;
        }
        let viewport = {width: w, height: h};
        if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
            const par = (content.attrs.preserveAspectRatio || 'xMidYMid meet').trim().split(/\s+/);
            const align = par[0] === 'defer' ? par[1] || 'xMidYMid' : par[0];
            const slice = par.includes('slice');
            let sx = w / vb[2], sy = h / vb[3];
            let tx = 0, ty = 0;
            if (align !== 'none') {
                const s = slice ? Math.max(sx, sy) : Math.min(sx, sy);
                sx = sy = s;
                const extraX = w - vb[2] * s, extraY = h - vb[3] * s;
                if (/xMid/.test(align)) tx = extraX / 2; else if (/xMax/.test(align)) tx = extraX;
                if (/YMid/.test(align)) ty = extraY / 2; else if (/YMax/.test(align)) ty = extraY;
            }
            m = G.multiply(m, [sx, 0, 0, sy, tx - vb[0] * sx, ty - vb[1] * sy]);
            viewport = {width: vb[2], height: vb[3]};
        }
        this.renderChildren(content, {...ctx, m, viewport});
    }

    renderUse(el, ctx) {
        const id = idFromHref(hrefOf(el));
        const target = id && this.ids.get(id);
        if (!target) return this.note('missing-use', id || hrefOf(el));
        if (ctx.uses.has(target) || ctx.uses.size > 30) return this.note('use-cycle', id);
        const vw = ctx.viewport.width, vh = ctx.viewport.height;
        const x = parseLength(el.attrs.x, vw) || 0, y = parseLength(el.attrs.y, vh) || 0;
        const uses = new Set(ctx.uses).add(target);
        if (target.name === 'symbol' || target.name === 'svg') {
            const w = el.attrs.width !== undefined ? parseLength(el.attrs.width, vw) : target.attrs.width !== undefined ? parseLength(target.attrs.width, vw) : vw;
            const h = el.attrs.height !== undefined ? parseLength(el.attrs.height, vh) : target.attrs.height !== undefined ? parseLength(target.attrs.height, vh) : vh;
            if (!(w > 0) || !(h > 0)) return;
            const style = this.computeStyle(target, ctx.style);
            if (style.display === 'none') return;
            const symCtx = {...ctx, uses, style, m: G.multiply(ctx.m, G.parseTransform(target.attrs.transform))};
            return this.renderViewport(target, symCtx, x, y, w, h, target);
        }
        // The referenced element inherits from the use element, not from its own parent.
        this.renderElement(target, {...ctx, uses, m: G.multiply(ctx.m, G.translate(x, y))}, ctx.style);
    }

    shapeGeometry(el, ctx) {
        const vw = ctx.viewport.width, vh = ctx.viewport.height, diag = Math.sqrt((vw * vw + vh * vh) / 2);
        const fs = ctx.style ? ctx.style['font-size'] : 16;
        const len = (name, ref, def = 0) => {
            const v = parseLength(el.attrs[name], ref, fs);
            return Number.isFinite(v) ? v : def;
        };
        const opt = (name, ref) => el.attrs[name] === undefined || el.attrs[name] === 'auto' ? undefined : len(name, ref);
        switch (el.name) {
        case 'path': {
            const {subpaths, error} = G.parsePath(el.attrs.d);
            if (error) this.note('path-error', `${el.attrs.id ? `#${el.attrs.id}: ` : ''}${error}`);
            return subpaths;
        }
        case 'rect': return G.rectPath(len('x', vw), len('y', vh), len('width', vw), len('height', vh), opt('rx', vw), opt('ry', vh));
        case 'circle': { const r = len('r', diag); return G.ellipsePath(len('cx', vw), len('cy', vh), r, r); }
        case 'ellipse': {
            let rx = opt('rx', vw), ry = opt('ry', vh);
            if (rx === undefined) rx = ry;
            if (ry === undefined) ry = rx;
            return G.ellipsePath(len('cx', vw), len('cy', vh), rx, ry);
        }
        case 'line': return G.linePath(len('x1', vw), len('y1', vh), len('x2', vw), len('y2', vh));
        case 'polyline': return G.polyPath(el.attrs.points, false);
        case 'polygon': return G.polyPath(el.attrs.points, true);
        }
        return [];
    }

    // Resolves fill/stroke to a paint, or null for none.
    resolvePaint(value, style, el, ctx) {
        value = (value || 'none').trim();
        if (value === 'none') return null;
        const ref = urlRef(value);
        if (ref) {
            const target = this.ids.get(ref[1]);
            const fallback = ref[2] && ref[2].trim();
            if (target && /^(linear|radial)Gradient$/.test(target.name)) {
                const gradient = this.gradient(target, el, ctx);
                if (gradient) return gradient;
                return null;
            }
            if (target?.name === 'pattern') this.note('pattern', ref[1]);
            else if (!target) this.note('missing-paint', ref[1]);
            return fallback && fallback !== 'none' ? this.resolvePaint(fallback, style, el, ctx) : null;
        }
        if (/^context-(fill|stroke)$/.test(value)) return null;
        const color = parseColor(value);
        if (color === 'currentColor') {
            const current = parseColor(style.color);
            return current && current !== 'currentColor' ? {type: 'solid', color: current} : {type: 'solid', color: {r: 0, g: 0, b: 0, a: 1}};
        }
        if (!color) { this.note('bad-color', value); return {type: 'solid', color: {r: 0, g: 0, b: 0, a: 1}}; }
        return {type: 'solid', color};
    }

    gradient(el, shapeEl, ctx) {
        // Attributes and stops may come from gradients this one references with href.
        const chain = [];
        for (let g = el; g && chain.length < 10 && !chain.includes(g); g = this.ids.get(idFromHref(hrefOf(g)))) chain.push(g);
        const attr = name => { for (const g of chain) if (g.attrs[name] !== undefined) return g.attrs[name]; return undefined; };
        const stopsEl = chain.find(g => elementChildren(g).some(c => c.name === 'stop'));
        const stops = [];
        let last = 0;
        for (const stop of stopsEl ? elementChildren(stopsEl).filter(c => c.name === 'stop') : []) {
            const declared = this.declared(stop);
            const raw = stop.attrs.offset ?? declared.get('offset') ?? '0';
            let offset = /%\s*$/.test(raw) ? parseFloat(raw) / 100 : parseFloat(raw);
            offset = Math.max(last, Math.min(1, Math.max(0, Number.isFinite(offset) ? offset : 0)));
            last = offset;
            let color = parseColor(declared.get('stop-color') ?? 'black');
            if (color === 'currentColor') color = parseColor(this.computeStyle(stop, ctx.style).color);
            if (!color || color === 'currentColor') color = {r: 0, g: 0, b: 0, a: 1};
            const so = parseFloat(declared.get('stop-opacity') ?? '1');
            stops.push({offset, color: {...color, a: color.a * (Number.isFinite(so) ? Math.max(0, Math.min(1, so)) : 1)}});
        }
        if (!stops.length) return null;
        if (stops.length === 1) return {type: 'solid', color: stops[0].color};
        const userSpace = attr('gradientUnits') === 'userSpaceOnUse';
        const vw = ctx.viewport.width, vh = ctx.viewport.height, diag = Math.sqrt((vw * vw + vh * vh) / 2);
        const num = (name, def, ref) => {
            const raw = attr(name);
            if (raw === undefined) return def;
            if (!userSpace) return /%\s*$/.test(raw) ? parseFloat(raw) / 100 : parseFloat(raw);
            const v = parseLength(raw, ref);
            return Number.isFinite(v) ? v : def;
        };
        let m = ctx.m;
        if (!userSpace) {
            const bb = this.userBBox(shapeEl, ctx);
            if (!bb || !bb.width || !bb.height) return {type: 'solid', color: averageStops(stops)};
            m = G.multiply(m, [bb.width, 0, 0, bb.height, bb.x, bb.y]);
        }
        m = G.multiply(m, G.parseTransform(attr('gradientTransform')));
        const spread = attr('spreadMethod') || 'pad';
        if (el.name === 'linearGradient') {
            return {type: 'linear', stops, spread, toDevice: m,
                x1: num('x1', 0, vw), y1: num('y1', 0, vh), x2: num('x2', userSpace ? vw : 1, vw), y2: num('y2', 0, vh)};
        }
        const cx = num('cx', userSpace ? vw / 2 : 0.5, vw), cy = num('cy', userSpace ? vh / 2 : 0.5, vh);
        const r = num('r', userSpace ? diag / 2 : 0.5, diag);
        const fx = num('fx', cx, vw), fy = num('fy', cy, vh);
        if (Math.hypot(fx - cx, fy - cy) > 1e-9 * Math.max(1, r)) this.note('focal');
        return {type: 'radial', stops, spread, toDevice: m, cx, cy, r};
    }

    paintShape(el, subpaths, ctx) {
        const {style, m} = ctx;
        const {q, tolerance} = this.options;
        const label = describe(el);
        const order = /^\s*stroke/.test(style['paint-order']) ? ['stroke', 'fill'] : ['fill', 'stroke'];
        const clipFill = paths => ctx.clip ? P.intersect(paths, ctx.clip) : paths;
        if (['marker-start', 'marker-mid', 'marker-end'].some(k => style[k] && style[k] !== 'none')) this.note('marker');
        for (const part of order) {
            if (part === 'fill') {
                if (el.name === 'line') continue;
                const paint = this.resolvePaint(style.fill, style, el, ctx);
                if (!paint) continue;
                const alpha = ctx.alpha * opacityValue(style['fill-opacity']);
                if (alpha <= 0) continue;
                const paths = clipFill(P.normalize(P.toPaths(G.flatten(subpaths, m, tolerance), q), style['fill-rule']));
                if (paths.length) ctx.ops.push({kind: 'fill', paths, paint, alpha, label});
            } else {
                const paint = this.resolvePaint(style.stroke, style, el, ctx);
                if (!paint) continue;
                const alpha = ctx.alpha * opacityValue(style['stroke-opacity']);
                const vw = ctx.viewport.width, vh = ctx.viewport.height, diag = Math.sqrt((vw * vw + vh * vh) / 2);
                const width = parseLength(style['stroke-width'], diag, style['font-size']);
                if (!(width > 0) || alpha <= 0) continue;
                const stretch = G.maxScale(m);
                let user = G.flatten(subpaths, G.IDENTITY, tolerance / (stretch || 1));
                const dashes = parseDashes(style['stroke-dasharray'], diag, style['font-size']);
                if (dashes) user = G.dashPolylines(user, dashes, parseLength(style['stroke-dashoffset'], diag, style['font-size']) || 0);
                const widthPx = width * G.meanScale(m) * this.options.pxPerUnit;
                if (widthPx < this.options.lineMaxPx) {
                    const open = [];
                    for (const line of user) {
                        const pts = line.closed && line.points.length > 2 ? [...line.points, line.points[0]] : line.points;
                        open.push(...P.toPaths([{points: pts}], q, {keepOpen: true, matrix: m}).filter(r => r.length > 1));
                    }
                    const paths = ctx.clip ? P.clipOpen(open, ctx.clip, true) : open;
                    const color = paint.type === 'solid' ? paint.color : averagePaintColor(paint);
                    if (paths.length) ctx.ops.push({kind: 'line', paths, color, alpha, widthPx, label});
                } else {
                    const outline = P.strokeOutline(user, m, {
                        width, join: style['stroke-linejoin'], cap: style['stroke-linecap'],
                        miterLimit: parseFloat(style['stroke-miterlimit']) || 4
                    }, q, tolerance);
                    const paths = clipFill(outline);
                    if (paths.length) ctx.ops.push({kind: 'fill', paths, paint, alpha, label: `${label} stroke`});
                }
            }
        }
    }

    // <text> as Arch canvas text boxes: one per run that starts at its own x/y (tspans on new lines).
    renderText(el, ctx) {
        const vw = ctx.viewport.width, vh = ctx.viewport.height;
        const runs = [];
        let cursor = {x: 0, y: 0};
        const visit = (node, style) => {
            if ('text' in node) {
                const content = node.text.replace(/\s+/g, ' ');
                if (!runs.length) runs.push({...cursor, style, content: ''});
                runs[runs.length - 1].content += content;
                return;
            }
            if (node.name !== 'text' && node.name !== 'tspan') return;
            const nodeStyle = node === el ? style : this.computeStyle(node, style);
            if (nodeStyle.display === 'none') return;
            const xs = G.parseNumberList(node.attrs.x), ys = G.parseNumberList(node.attrs.y);
            const fs = nodeStyle['font-size'];
            const dx = parseLength(node.attrs.dx, vw, fs) || 0, dy = parseLength(node.attrs.dy, vh, fs) || 0;
            if (xs.length || ys.length || dx || dy) {
                cursor = {x: (xs.length ? xs[0] : cursor.x) + dx, y: (ys.length ? ys[0] : cursor.y) + dy};
                runs.push({...cursor, style: nodeStyle, content: ''});
            }
            for (const child of node.children) visit(child, nodeStyle);
        };
        visit(el, ctx.style);
        const m = ctx.m;
        if (Math.abs(m[1]) > 1e-9 * Math.abs(m[0]) || Math.abs(m[2]) > 1e-9 * Math.abs(m[3])) this.note('text-rotated', describe(el));
        for (const run of runs) {
            const content = run.content.trim();
            if (!content || run.style.visibility === 'hidden') continue;
            const paint = this.resolvePaint(run.style.fill, run.style, el, {...ctx, style: run.style});
            if (!paint) continue;
            const color = paint.type === 'solid' ? paint.color : averagePaintColor(paint);
            const [x, y] = G.apply(m, run.x, run.y);
            this.note('text');
            ctx.ops.push({kind: 'text', x, y, size: run.style['font-size'] * G.meanScale(m), color,
                alpha: ctx.alpha * opacityValue(run.style['fill-opacity']), anchor: run.style['text-anchor'],
                content, clip: ctx.clip, label: describe(el)});
        }
    }
}

function opacityValue(text) {
    const t = String(text ?? '1').trim();
    const v = t.endsWith('%') ? parseFloat(t) / 100 : parseFloat(t);
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
}

function parseDashes(text, ref, fontSize) {
    if (!text || text === 'none') return null;
    const parts = text.split(/[\s,]+/).filter(Boolean).map(p => parseLength(p, ref, fontSize));
    if (!parts.length || parts.some(v => !(v >= 0)) || !parts.some(v => v > 0)) return null;
    return parts.length % 2 ? [...parts, ...parts] : parts;
}

const describe = el => `<${el.name}${el.attrs.id ? ` id="${el.attrs.id}"` : ''}${el.attrs.class ? ` class="${el.attrs.class}"` : ''}>`;

// Average colour of a gradient's stops over its 0..1 range (premultiplied by alpha).
export function averageStops(stops) {
    let r = 0, g = 0, b = 0, a = 0;
    const add = (c, w) => { r += c.r * c.a * w; g += c.g * c.a * w; b += c.b * c.a * w; a += c.a * w; };
    add(stops[0].color, stops[0].offset);
    for (let i = 1; i < stops.length; i++) {
        const w = stops[i].offset - stops[i - 1].offset;
        add(stops[i - 1].color, w / 2);
        add(stops[i].color, w / 2);
    }
    add(stops[stops.length - 1].color, 1 - stops[stops.length - 1].offset);
    return a > 0 ? {r: r / a, g: g / a, b: b / a, a} : {r: 0, g: 0, b: 0, a: 0};
}

export const averagePaintColor = paint => paint.type === 'solid' ? paint.color : averageStops(paint.stops);

// Colour of a gradient at parameter t, with its spread method.
export function gradientColorAt(paint, t) {
    if (paint.spread === 'repeat') t = t - Math.floor(t);
    else if (paint.spread === 'reflect') { t = Math.abs(t) % 2; if (t > 1) t = 2 - t; }
    const {stops} = paint;
    if (t <= stops[0].offset) return stops[0].color;
    for (let i = 1; i < stops.length; i++) {
        if (t <= stops[i].offset) {
            const a = stops[i - 1], b = stops[i];
            const k = b.offset > a.offset ? (t - a.offset) / (b.offset - a.offset) : 1;
            const mix = key => a.color[key] + (b.color[key] - a.color[key]) * k;
            return {r: mix('r'), g: mix('g'), b: mix('b'), a: mix('a')};
        }
    }
    return stops[stops.length - 1].color;
}
