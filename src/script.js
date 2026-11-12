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
    'geometryMeasurementDisplay', 'showHiddenMath', 'showHiddenGeo', 'implicitPrecision', 'autoBreakpointDetection'];

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
    'min', 'max', 'step', 'mode', 'play', 'fixed', 'frame'];

function parseObjectOptions(text, line, {allowRef = true} = {}) {
    const style = {}, slider = {};
    let ref, frame, fixed = false;
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
        case 'frame': {
            const f = Number(need());
            if (!Number.isInteger(f) || f < 0) throw new ScriptError(line, 'frame must be a whole number >= 0 (0 = shown on every frame).');
            frame = f;
            break;
        }
        default:
            throw new ScriptError(line, `Unknown option "${key}". Allowed: ${OBJECT_OPTIONS.join(', ')}.`);
        }
    }
    return {ref, style, slider, fixed, frame};
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
            if (![2, 3].includes(p.length) || !p.every(Number.isFinite))
                throw new ScriptError(line, 'center must look like center=0,0 (2d) or center=0,0,1.5 (3d)');
            view.center = {x: p[0], y: p[1], ...(p.length === 3 ? {z: p[2]} : {})};
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
    if (view.center?.z !== undefined && view.dimension !== '3d')
        throw new ScriptError(line, 'center=x,y,z needs 3d, e.g. @view 3d center=0,0,1.5');
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

const JS_IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
// name(params)={ JS body } typed on one line, as in Arch's own input box.
const ONE_LINE_OPERATOR = /^([A-Za-z_]\w*)\s*\(([^)]*)\)\s*=\s*\{([\s\S]*)\}\s*$/;

function parseOperatorHeader(name, paramText, line) {
    if (!/^[A-Za-z_]\w*$/.test(name)) throw new ScriptError(line, `Operator name "${name}" must be letters, digits or _.`);
    const params = paramText.trim() ? paramText.split(',').map(p => p.trim()) : [];
    for (const param of params)
        if (!JS_IDENT.test(param)) throw new ScriptError(line, `Operator parameter "${param}" is not a valid JavaScript name.`);
    if (new Set(params.map(p => p.toLowerCase())).size !== params.length) throw new ScriptError(line, 'Operator parameters must be distinct.');
    return params;
}

function parseText(rest, line) {
    const bar = rest.indexOf('|');
    if (bar < 0) throw new ScriptError(line, '@text needs the text after "|", e.g. @text x=-4 y=3 | Hello');
    const content = rest.slice(bar + 1).trim();
    if (!content) throw new ScriptError(line, '@text has no content after "|".');
    const text = {content, size: 0.5, smart: /\{value\(|\{if\(/.test(content)};
    const number = (raw, key, positive) => {
        const n = Number(raw);
        if (!Number.isFinite(n) || (positive && n <= 0)) throw new ScriptError(line, `@text ${key} must be a ${positive ? 'positive ' : ''}number.`);
        return n;
    };
    for (const [key, raw] of tokenizeOptions(rest.slice(0, bar), line)) {
        const k = key.toLowerCase();
        if (k === 'smart' && raw === null) { text.smart = true; continue; }
        if (k === 'plain' && raw === null) { text.smart = false; continue; }
        if (raw === null) throw new ScriptError(line, `@text option "${key}" needs a value.`);
        switch (k) {
        case 'x': text.x = number(raw, 'x'); break;
        case 'y': text.y = number(raw, 'y'); break;
        case 'at': {
            const p = raw.split(',').map(Number);
            if (p.length !== 2 || !p.every(Number.isFinite)) throw new ScriptError(line, 'at must look like at=-4,3');
            [text.x, text.y] = p;
            break;
        }
        case 'width': text.width = number(raw, 'width', true); break;
        case 'height': text.height = number(raw, 'height', true); break;
        case 'size': text.size = number(raw, 'size', true); break;
        case 'color': text.color = {...parseColor(raw, line), ...(text.color && 'a' in text.color ? {a: text.color.a} : {})}; break;
        case 'opacity': {
            const o = Number(raw);
            if (!(o >= 0 && o <= 1)) throw new ScriptError(line, 'opacity must be between 0 and 1.');
            text.color = {...(text.color || {}), a: Math.round((1 - o) * 1000) / 10};
            break;
        }
        default:
            throw new ScriptError(line, `Unknown @text option "${key}". Allowed: x, y (or at=x,y), width, height, size, color, opacity, smart, plain.`);
        }
    }
    if (text.x === undefined || text.y === undefined) throw new ScriptError(line, '@text needs the top-left corner: x= and y= (or at=x,y), in graph coordinates.');
    return text;
}

function parseFrames(rest, line) {
    const frames = {};
    for (const [key, raw] of tokenizeOptions(rest, line)) {
        const k = key.toLowerCase();
        if (raw === null) throw new ScriptError(line, `@frames option "${key}" needs a value.`);
        const whole = (min) => {
            const n = Number(raw);
            if (!Number.isInteger(n) || n < min) throw new ScriptError(line, `@frames ${k} must be a whole number >= ${min}.`);
            return n;
        };
        switch (k) {
        case 'total': frames.total = whole(1); break;
        case 'current': frames.current = whole(0); break;
        case 'fps': {
            const n = Number(raw);
            if (!(n > 0)) throw new ScriptError(line, '@frames fps must be a positive number.');
            frames.fps = n;
            break;
        }
        case 'bind': frames.bind = raw.trim(); break;
        default:
            throw new ScriptError(line, `Unknown @frames option "${key}". Allowed: total, fps, current, bind.`);
        }
    }
    if (frames.total !== undefined && frames.current !== undefined && frames.current > frames.total)
        throw new ScriptError(line, '@frames current must not exceed total.');
    return frames;
}

// Returns {steps, title, script}. Throws ScriptError with a 1-based line number.
export function parseScript(source) {
    if (typeof source !== 'string') throw new ScriptError(0, 'Script must be text.');
    const steps = [];
    let title, script;
    const lines = source.replace(/\r\n?/g, '\n').split('\n');

    // Collects raw lines up to a line that is exactly "@end".
    const readBlock = (start, what) => {
        const body = [];
        for (let j = start + 1; j < lines.length; j++) {
            if (lines[j].trim().toLowerCase() === '@end') return {body: body.join('\n').replace(/^\n+|\s+$/g, ''), next: j};
            body.push(lines[j].replace(/\s+$/, ''));
        }
        throw new ScriptError(start + 1, `${what} block is missing its closing @end line.`);
    };

    for (let i = 0; i < lines.length; i++) {
        const line = i + 1;
        let text = lines[i].trim();
        if (!text || text.startsWith('#')) continue;
        if (text.startsWith('//')) {
            steps.push({kind: 'create', line, expr: text, style: {}, slider: {}, text: true});
            continue;
        }
        const oneLine = ONE_LINE_OPERATOR.exec(text);
        if (oneLine) {
            steps.push({kind: 'operator', line, name: oneLine[1], params: parseOperatorHeader(oneLine[1], oneLine[2], line), body: oneLine[3].trim()});
            continue;
        }
        if (text.startsWith('@')) {
            const m = /^@(\w+)\s*(.*)$/.exec(text);
            const directive = m ? m[1].toLowerCase() : '';
            const rest = m ? m[2] : '';
            switch (directive) {
            case 'title':
                if (!rest.trim()) throw new ScriptError(line, '@title needs a name.');
                title = rest.trim();
                continue;
            case 'operator': {
                const h = /^([A-Za-z_]\w*)\s*\(([^)]*)\)\s*$/.exec(rest.trim());
                if (!h) throw new ScriptError(line, '@operator needs a header like: @operator clamp(v, lo, hi)');
                const params = parseOperatorHeader(h[1], h[2], line);
                const {body, next} = readBlock(i, '@operator');
                if (!body.trim()) throw new ScriptError(line, `@operator ${h[1]} has an empty body; write JavaScript that returns a number.`);
                steps.push({kind: 'operator', line, name: h[1], params, body});
                i = next;
                continue;
            }
            case 'script': {
                if (rest.trim()) throw new ScriptError(line, '@script takes no options; put the program on the following lines and close with @end.');
                if (script) throw new ScriptError(line, `Only one @script block is allowed (the first is on line ${script.line}).`);
                const {body, next} = readBlock(i, '@script');
                if (!body.trim()) throw new ScriptError(line, '@script block is empty.');
                script = {line, text: body};
                i = next;
                continue;
            }
            case 'end':
                throw new ScriptError(line, '@end without a matching @operator or @script.');
            case 'text':
                // Content is verbatim: no comment stripping, so "#" and "|" may appear in it.
                steps.push({kind: 'text', line, ...parseText(rest, line)});
                continue;
            }
            text = stripComment(text);
            const m2 = /^@(\w+)\s*(.*)$/.exec(text);
            const rest2 = m2 ? m2[2] : '';
            switch (directive) {
            case 'view':
                steps.push({kind: 'view', line, view: parseView(rest2, line)});
                continue;
            case 'set':
                steps.push({kind: 'set', line, settings: parseSettings(rest2, line)});
                continue;
            case 'frames':
                steps.push({kind: 'frames', line, frames: parseFrames(rest2, line)});
                continue;
            case 'style': {
                const bar = rest2.indexOf('|');
                const target = (bar < 0 ? rest2 : rest2.slice(0, bar)).trim();
                if (!target) throw new ScriptError(line, '@style needs a target: @style <name|ref|last> | color=red');
                if (bar < 0) throw new ScriptError(line, '@style needs options after "|", e.g. @style P | color=red');
                const opts = parseObjectOptions(rest2.slice(bar + 1), line, {allowRef: false});
                steps.push({kind: 'style', line, target, ...opts});
                continue;
            }
            default:
                throw new ScriptError(line, `Unknown directive "${text.split(/\s/)[0]}". Use @title, @view, @set, @style, @text, @frames, @operator or @script.`);
            }
        }
        text = stripComment(text);
        if (!text) continue;
        const bar = text.indexOf('|');
        const expr = (bar < 0 ? text : text.slice(0, bar)).trim();
        if (!expr) throw new ScriptError(line, 'Missing expression before "|".');
        if (/^\$multi/i.test(expr)) throw new ScriptError(line, 'Write one expression per line instead of a $multi string.');
        const opts = bar < 0 ? {style: {}, slider: {}, fixed: false} : parseObjectOptions(text.slice(bar + 1), line);
        steps.push({kind: 'create', line, expr, ...opts});
    }
    return {steps, title, script};
}
