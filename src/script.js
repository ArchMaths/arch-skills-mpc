// Parser for the Arch scene script (.arch) format.
//
//   # comment
//   <arch expression>            [| option option ...]
//   //free text annotation       (taken verbatim, no options)
//   @view   x=-5..5 y=-3..3 | center=0,0 unit=60 | 3d azimuth=30 elevation=20
//   @set    showAxes=false gridStyle=dots tmin=0 tmax=2*pi
//   @title  My graph
//   @style  <target|last> | option ...
//
// Parsing is purely syntactic. Name resolution (refs, auto-numbers) happens
// inside the page, where the real Arch engine knows what each line created.

export const PLAY_MODES = {pingpong: 0, bounce: 0, forward: 1, loop: 1, reverse: 2, backward: 2, once: 3, 'once-reverse': 4};
export const DASHES = ['solid', 'long', 'short', 'dotted'];
export const PERSISTED_SETTINGS = ['showAxes', 'showAxisNumbers', 'showPointLabels', 'gridStyle', 'tmin', 'tmax',
    'geometryMeasurementDisplay', 'showHiddenMath', 'showHiddenGeo'];

const NAMED_COLORS = {
    red: '#e53935', orange: '#fb8c00', yellow: '#fdd835', green: '#43a047', teal: '#00897b', cyan: '#00acc1',
    blue: '#1e88e5', indigo: '#3949ab', purple: '#8e24aa', pink: '#d81b60', brown: '#6d4c41',
    black: '#000000', gray: '#757575', grey: '#757575', white: '#ffffff'
};

const RESERVED = new Set(['x', 'y', 'z', 't', 'e', 'pi', 'o', 'xaxis', 'yaxis', 'last']);
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class ScriptError extends Error {
    constructor(line, message) { super(message); this.line = line; }
}

// Arch stores colour as HSB on 0..100 scales (hue = degrees / 3.6) plus a = transparency 0..100.
export function hexToHsb(hex) {
    const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex);
    if (!m) return null;
    let h6 = m[1];
    if (h6.length === 3) h6 = [...h6].map(c => c + c).join('');
    const [r, g, b] = [0, 2, 4].map(i => parseInt(h6.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) {
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
    }
    const round = v => Math.round(v * 10) / 10;
    return {h: round(h / 3.6), s: round(max ? (d / max) * 100 : 0), b: round(max * 100)};
}

export function parseColor(value, line) {
    const v = value.trim().toLowerCase();
    if (NAMED_COLORS[v]) return hexToHsb(NAMED_COLORS[v]);
    if (v.startsWith('#')) {
        const c = hexToHsb(v);
        if (c) return c;
    }
    const hsb = /^hsb\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/.exec(v);
    if (hsb) {
        const [h, s, b] = hsb.slice(1).map(Number);
        if ([h, s, b].every(n => Number.isFinite(n) && n >= 0 && n <= 100)) return {h, s, b};
    }
    throw new ScriptError(line, `Invalid color "${value}". Use a name (${Object.keys(NAMED_COLORS).join(', ')}), #rrggbb, or hsb(h,s,b) with each 0..100.`);
}

// Splits "a=1 b=\"two words\" flag" into [['a','1'],['b','two words'],['flag',null]].
function tokenizeOptions(text, line) {
    const out = [];
    const re = /\s*([A-Za-z0-9][\w-]*)(?:\s*=\s*(?:"([^"]*)"|(\S+)))?/y;
    let pos = 0;
    text = text.trim();
    while (pos < text.length) {
        re.lastIndex = pos;
        const m = re.exec(text);
        if (!m || m[0].length === 0) throw new ScriptError(line, `Cannot read options near "${text.slice(pos)}". Use key=value pairs separated by spaces.`);
        out.push([m[1], m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : null)]);
        pos = re.lastIndex;
        while (pos < text.length && /\s/.test(text[pos])) pos++;
    }
    return out;
}

const OBJECT_OPTIONS = ['ref', 'color', 'opacity', 'thickness', 'hidden', 'visible', 'dash', 'label',
    'min', 'max', 'step', 'mode', 'play', 'fixed'];

function parseObjectOptions(text, line, {allowRef = true} = {}) {
    const style = {}, slider = {};
    let ref, fixed = false;
    for (const [key, raw] of tokenizeOptions(text, line)) {
        const k = key.toLowerCase();
        const need = () => {
            if (raw === null || raw === '') throw new ScriptError(line, `Option "${key}" needs a value, e.g. ${key}=...`);
            return raw;
        };
        switch (k) {
        case 'ref': {
            if (!allowRef) throw new ScriptError(line, 'ref= is only allowed on object lines.');
            const r = need();
            if (!IDENT.test(r)) throw new ScriptError(line, `ref "${r}" must be letters, digits or _ and start with a letter.`);
            if (RESERVED.has(r.toLowerCase())) throw new ScriptError(line, `ref "${r}" is reserved; choose another name.`);
            ref = r;
            break;
        }
        case 'color': style.color = {...parseColor(need(), line), ...(style.color && 'a' in style.color ? {a: style.color.a} : {})}; break;
        case 'opacity': {
            const o = Number(need());
            if (!(o >= 0 && o <= 1)) throw new ScriptError(line, 'opacity must be between 0 and 1.');
            style.color = {...(style.color || {}), a: Math.round((1 - o) * 1000) / 10};
            break;
        }
        case 'thickness': {
            const t = Number(need());
            if (!(t >= 1 && t <= 20)) throw new ScriptError(line, 'thickness must be between 1 and 20.');
            style.thickness = t;
            break;
        }
        case 'hidden': style.visible = false; break;
        case 'visible': {
            const v = (raw ?? 'true').toLowerCase();
            if (!['true', 'false'].includes(v)) throw new ScriptError(line, 'visible must be true or false.');
            style.visible = v === 'true';
            break;
        }
        case 'dash': {
            const d = need().toLowerCase();
            if (!DASHES.includes(d)) throw new ScriptError(line, `dash must be one of ${DASHES.join(', ')}.`);
            style.dash = d;
            break;
        }
        case 'label': {
            const l = need();
            if (l === 'none' || l === 'name') style.label = {mode: l};
            else style.label = {mode: 'label', text: l};
            break;
        }
        case 'min': case 'max': case 'step': slider[k] = need(); break;
        case 'mode': {
            const m = need().toLowerCase();
            const n = /^[0-4]$/.test(m) ? Number(m) : PLAY_MODES[m];
            if (n === undefined) throw new ScriptError(line, `mode must be one of ${Object.keys(PLAY_MODES).join(', ')} (or 0..4).`);
            slider.mode = n;
            break;
        }
        case 'play': slider.play = true; break;
        case 'fixed': fixed = true; break;
        default:
            throw new ScriptError(line, `Unknown option "${key}". Allowed: ${OBJECT_OPTIONS.join(', ')}.`);
        }
    }
    return {ref, style, slider, fixed};
}

function parseRange(value, line, axis) {
    const m = /^(.+?)\.\.(.+)$/.exec(value);
    if (!m) throw new ScriptError(line, `${axis} must look like ${axis}=-5..5`);
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (!Number.isFinite(a) || !Number.isFinite(b) || a >= b) throw new ScriptError(line, `${axis} range must be two numbers with min < max.`);
    return [a, b];
}

function parseView(text, line) {
    const view = {};
    for (const [key, raw] of tokenizeOptions(text, line)) {
        const k = key.toLowerCase();
        if ((k === '2d' || k === '3d') && raw === null) { view.dimension = k; continue; }
        if (raw === null) throw new ScriptError(line, `@view option "${key}" needs a value.`);
        switch (k) {
        case 'x': view.xrange = parseRange(raw, line, 'x'); break;
        case 'y': view.yrange = parseRange(raw, line, 'y'); break;
        case 'center': {
            const p = raw.split(',').map(Number);
            if (p.length !== 2 || !p.every(Number.isFinite)) throw new ScriptError(line, 'center must look like center=0,0');
            view.center = {x: p[0], y: p[1]};
            break;
        }
        case 'unit': {
            const u = Number(raw);
            if (!(u > 0)) throw new ScriptError(line, 'unit (pixels per math unit) must be a positive number.');
            view.unit = u;
            break;
        }
        case 'azimuth': case 'elevation': {
            const a = Number(raw);
            if (!Number.isFinite(a)) throw new ScriptError(line, `${k} must be a number of degrees.`);
            view[k] = a;
            break;
        }
        default: throw new ScriptError(line, `Unknown @view option "${key}". Use x=a..b y=c..d, or center=x,y unit=N, or 2d/3d azimuth=deg elevation=deg.`);
        }
    }
    if ((view.xrange || view.yrange) && (view.center || view.unit)) throw new ScriptError(line, 'Use either x=/y= ranges or center=/unit=, not both.');
    if ((view.azimuth !== undefined || view.elevation !== undefined) && view.dimension !== '3d')
        throw new ScriptError(line, 'azimuth/elevation need 3d, e.g. @view 3d azimuth=30 elevation=20');
    return view;
}

function parseSettings(text, line) {
    const out = [];
    for (const [key, raw] of tokenizeOptions(text, line)) {
        const name = PERSISTED_SETTINGS.find(s => s.toLowerCase() === key.toLowerCase());
        if (!name) throw new ScriptError(line, `Setting "${key}" is not saved in Arch files. Allowed: ${PERSISTED_SETTINGS.join(', ')}.`);
        if (raw === null) throw new ScriptError(line, `Setting "${key}" needs a value.`);
        let value = raw;
        if (/^(true|false)$/i.test(raw)) value = raw.toLowerCase() === 'true';
        out.push({name, value});
    }
    if (!out.length) throw new ScriptError(line, '@set needs at least one name=value.');
    return out;
}

// Drops a trailing " # comment" (Arch syntax never uses #). A comment # must follow whitespace,
// so colors like color=#ff0000 (or color= #ff0000) and "quoted" values are kept.
function stripComment(text) {
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '"') quoted = !quoted;
        else if (text[i] === '#' && !quoted && /\s/.test(text[i - 1] || '') && !/=\s*$/.test(text.slice(0, i)))
            return text.slice(0, i).trim();
    }
    return text;
}

// Returns {steps, title}. Throws ScriptError with a 1-based line number.
export function parseScript(source) {
    if (typeof source !== 'string') throw new ScriptError(0, 'Script must be text.');
    const steps = [];
    let title;
    source.replace(/\r\n?/g, '\n').split('\n').forEach((rawLine, i) => {
        const line = i + 1;
        let text = rawLine.trim();
        if (!text || text.startsWith('#')) return;
        if (text.startsWith('//')) {
            steps.push({kind: 'create', line, expr: text, style: {}, slider: {}, text: true});
            return;
        }
        text = stripComment(text);
        if (!text) return;
        if (text.startsWith('@')) {
            const m = /^@(\w+)\s*(.*)$/.exec(text);
            const directive = m ? m[1].toLowerCase() : '';
            const rest = m ? m[2] : '';
            switch (directive) {
            case 'title':
                if (!rest.trim()) throw new ScriptError(line, '@title needs a name.');
                title = rest.trim();
                return;
            case 'view':
                steps.push({kind: 'view', line, view: parseView(rest, line)});
                return;
            case 'set':
                steps.push({kind: 'set', line, settings: parseSettings(rest, line)});
                return;
            case 'style': {
                const bar = rest.indexOf('|');
                const target = (bar < 0 ? rest : rest.slice(0, bar)).trim();
                if (!target) throw new ScriptError(line, '@style needs a target: @style <name|ref|last> | color=red');
                if (bar < 0) throw new ScriptError(line, '@style needs options after "|", e.g. @style P | color=red');
                const opts = parseObjectOptions(rest.slice(bar + 1), line, {allowRef: false});
                steps.push({kind: 'style', line, target, ...opts});
                return;
            }
            default:
                throw new ScriptError(line, `Unknown directive "${text.split(/\s/)[0]}". Use @title, @view, @set or @style.`);
            }
        }
        const bar = text.indexOf('|');
        const expr = (bar < 0 ? text : text.slice(0, bar)).trim();
        if (!expr) throw new ScriptError(line, 'Missing expression before "|".');
        if (/^\$multi/i.test(expr)) throw new ScriptError(line, 'Write one expression per line instead of a $multi string.');
        const opts = bar < 0 ? {style: {}, slider: {}, fixed: false} : parseObjectOptions(text.slice(bar + 1), line);
        steps.push({kind: 'create', line, expr, ...opts});
    });
    return {steps, title};
}
