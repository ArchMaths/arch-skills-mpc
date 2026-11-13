// CSS colour parsing. Colours are {r, g, b, a}, each 0..1 (a = opacity).

const NAMED = Object.fromEntries(('aliceblue:f0f8ff antiquewhite:faebd7 aqua:00ffff aquamarine:7fffd4 azure:f0ffff ' +
    'beige:f5f5dc bisque:ffe4c4 black:000000 blanchedalmond:ffebcd blue:0000ff blueviolet:8a2be2 brown:a52a2a ' +
    'burlywood:deb887 cadetblue:5f9ea0 chartreuse:7fff00 chocolate:d2691e coral:ff7f50 cornflowerblue:6495ed ' +
    'cornsilk:fff8dc crimson:dc143c cyan:00ffff darkblue:00008b darkcyan:008b8b darkgoldenrod:b8860b darkgray:a9a9a9 ' +
    'darkgreen:006400 darkgrey:a9a9a9 darkkhaki:bdb76b darkmagenta:8b008b darkolivegreen:556b2f darkorange:ff8c00 ' +
    'darkorchid:9932cc darkred:8b0000 darksalmon:e9967a darkseagreen:8fbc8f darkslateblue:483d8b darkslategray:2f4f4f ' +
    'darkslategrey:2f4f4f darkturquoise:00ced1 darkviolet:9400d3 deeppink:ff1493 deepskyblue:00bfff dimgray:696969 ' +
    'dimgrey:696969 dodgerblue:1e90ff firebrick:b22222 floralwhite:fffaf0 forestgreen:228b22 fuchsia:ff00ff ' +
    'gainsboro:dcdcdc ghostwhite:f8f8ff gold:ffd700 goldenrod:daa520 gray:808080 green:008000 greenyellow:adff2f ' +
    'grey:808080 honeydew:f0fff0 hotpink:ff69b4 indianred:cd5c5c indigo:4b0082 ivory:fffff0 khaki:f0e68c ' +
    'lavender:e6e6fa lavenderblush:fff0f5 lawngreen:7cfc00 lemonchiffon:fffacd lightblue:add8e6 lightcoral:f08080 ' +
    'lightcyan:e0ffff lightgoldenrodyellow:fafad2 lightgray:d3d3d3 lightgreen:90ee90 lightgrey:d3d3d3 lightpink:ffb6c1 ' +
    'lightsalmon:ffa07a lightseagreen:20b2aa lightskyblue:87cefa lightslategray:778899 lightslategrey:778899 ' +
    'lightsteelblue:b0c4de lightyellow:ffffe0 lime:00ff00 limegreen:32cd32 linen:faf0e6 magenta:ff00ff maroon:800000 ' +
    'mediumaquamarine:66cdaa mediumblue:0000cd mediumorchid:ba55d3 mediumpurple:9370db mediumseagreen:3cb371 ' +
    'mediumslateblue:7b68ee mediumspringgreen:00fa9a mediumturquoise:48d1cc mediumvioletred:c71585 midnightblue:191970 ' +
    'mintcream:f5fffa mistyrose:ffe4e1 moccasin:ffe4b5 navajowhite:ffdead navy:000080 oldlace:fdf5e6 olive:808000 ' +
    'olivedrab:6b8e23 orange:ffa500 orangered:ff4500 orchid:da70d6 palegoldenrod:eee8aa palegreen:98fb98 ' +
    'paleturquoise:afeeee palevioletred:db7093 papayawhip:ffefd5 peachpuff:ffdab9 peru:cd853f pink:ffc0cb plum:dda0dd ' +
    'powderblue:b0e0e6 purple:800080 rebeccapurple:663399 red:ff0000 rosybrown:bc8f8f royalblue:4169e1 ' +
    'saddlebrown:8b4513 salmon:fa8072 sandybrown:f4a460 seagreen:2e8b57 seashell:fff5ee sienna:a0522d silver:c0c0c0 ' +
    'skyblue:87ceeb slateblue:6a5acd slategray:708090 slategrey:708090 snow:fffafa springgreen:00ff7f steelblue:4682b4 ' +
    'tan:d2b48c teal:008080 thistle:d8bfd8 tomato:ff6347 turquoise:40e0d0 violet:ee82ee wheat:f5deb3 white:ffffff ' +
    'whitesmoke:f5f5f5 yellow:ffff00 yellowgreen:9acd32').split(' ').map(pair => pair.split(':')));

const clamp01 = v => Math.min(1, Math.max(0, v));

function hexColor(hex) {
    if (![3, 4, 6, 8].includes(hex.length) || !/^[0-9a-f]+$/i.test(hex)) return null;
    const full = hex.length <= 4 ? [...hex].map(c => c + c).join('') : hex;
    const n = i => parseInt(full.slice(i, i + 2), 16) / 255;
    return {r: n(0), g: n(2), b: n(4), a: full.length === 8 ? n(6) : 1};
}

// "50%" -> 0.5 of scale, "128" -> 128/scale
function channel(text, scale) {
    const t = text.trim();
    if (t.endsWith('%')) return clamp01(parseFloat(t) / 100);
    const v = parseFloat(t);
    return Number.isFinite(v) ? clamp01(v / scale) : NaN;
}

function alphaValue(text) {
    if (text === undefined) return 1;
    const t = text.trim();
    const v = t.endsWith('%') ? parseFloat(t) / 100 : parseFloat(t);
    return Number.isFinite(v) ? clamp01(v) : NaN;
}

function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    const f = n => {
        const k = (n + h * 12) % 12;
        return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return {r: f(0), g: f(8), b: f(4)};
}

function hue(text) {
    const m = /^(-?[\d.]+(?:e-?\d+)?)(deg|rad|grad|turn)?$/i.exec(text.trim());
    if (!m) return NaN;
    const v = parseFloat(m[1]);
    switch ((m[2] || 'deg').toLowerCase()) {
    case 'rad': return v * 180 / Math.PI;
    case 'grad': return v * 0.9;
    case 'turn': return v * 360;
    default: return v;
    }
}

// Returns {r,g,b,a}, 'currentColor', or null when the text is not a colour.
export function parseColor(text) {
    if (typeof text !== 'string') return null;
    const t = text.trim().toLowerCase();
    if (!t) return null;
    if (t === 'transparent') return {r: 0, g: 0, b: 0, a: 0};
    if (t === 'currentcolor') return 'currentColor';
    if (NAMED[t]) return hexColor(NAMED[t]);
    if (t[0] === '#') return hexColor(t.slice(1));
    const fn = /^(rgba?|hsla?)\((.*)\)$/.exec(t);
    if (!fn) return null;
    // Both "r, g, b, a" and "r g b / a" syntaxes.
    let parts = fn[2].includes(',') ? fn[2].split(',') : fn[2].replace('/', ' / ').split(/\s+/).filter(Boolean);
    let alpha;
    const slash = parts.indexOf('/');
    if (slash >= 0) { alpha = parts[slash + 1]; parts = parts.slice(0, slash); } else if (parts.length === 4) alpha = parts.pop();
    if (parts.length !== 3) return null;
    let color;
    if (fn[1].startsWith('rgb')) color = {r: channel(parts[0], 255), g: channel(parts[1], 255), b: channel(parts[2], 255)};
    else {
        const s = channel(parts[1], 100), l = channel(parts[2], 100);
        color = hslToRgb(hue(parts[0]), s, l);
    }
    color.a = alphaValue(alpha);
    return [color.r, color.g, color.b, color.a].every(Number.isFinite) ? color : null;
}

export const toHex = ({r, g, b}) => '#' + [r, g, b].map(v => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0')).join('');

export const luminance = ({r, g, b}) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// Source-over compositing of colour `top` onto `bottom` (both non-premultiplied).
export function over(top, bottom) {
    const a = top.a + bottom.a * (1 - top.a);
    if (a <= 0) return {r: 0, g: 0, b: 0, a: 0};
    const mix = k => (top[k] * top.a + bottom[k] * bottom.a * (1 - top.a)) / a;
    return {r: mix('r'), g: mix('g'), b: mix('b'), a};
}

// Arch colour as saved: hue/saturation/brightness 0..100 (one decimal), as script.js's hexToHsb computes it.
export function archHsb({r, g, b}) {
    [r, g, b] = [r, g, b].map(v => Math.round(clamp01(v) * 255) / 255);
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

// Arch's 2D light theme draws a colour with saturation < 15 and brightness > 85 at brightness 85
// (and pure white as black), so near-white fills would show as light grey on its white canvas.
export function archDimsColor(color) {
    const {s, b} = archHsb(color);
    return s < 15 && b > 85;
}
