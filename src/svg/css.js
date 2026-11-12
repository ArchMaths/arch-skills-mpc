// Just enough CSS for SVG files from editors and icon sets: <style> rules with type, class,
// id, universal and attribute selectors, descendant and child combinators, selector lists,
// specificity and !important; @media blocks are read as if they apply, other at-rules are skipped.

// "fill:red; stroke-width: 2 !important" -> [{name, value, important}]
export function parseDeclarations(text) {
    const out = [];
    for (const part of splitOutside(text, ';')) {
        const colon = part.indexOf(':');
        if (colon < 0) continue;
        const name = part.slice(0, colon).trim().toLowerCase();
        let value = part.slice(colon + 1).trim();
        if (!name || !value) continue;
        const important = /!\s*important\s*$/i.test(value);
        if (important) value = value.replace(/!\s*important\s*$/i, '').trim();
        out.push({name, value, important});
    }
    return out;
}

// Splits on a separator that is not inside parentheses or quotes (url(data:...;base64,...)).
function splitOutside(text, separator) {
    const out = [];
    let depth = 0, quote = null, start = 0;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quote) { if (ch === quote) quote = null; continue; }
        if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '(') depth++;
        else if (ch === ')') depth = Math.max(0, depth - 1);
        else if (ch === separator && depth === 0) { out.push(text.slice(start, i)); start = i + 1; }
    }
    out.push(text.slice(start));
    return out;
}

// Compound selector "path.cls#id[fill=red]" -> {tag, ids, classes, attrs} or null if unsupported.
function parseCompound(text) {
    const sel = {tag: null, ids: [], classes: [], attrs: []};
    const re = /([A-Za-z_][\w-]*|\*)|#([\w-]+)|\.([\w-]+)|\[\s*([\w:-]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]|(:{1,2}[\w-]+(?:\([^)]*\))?)/y;
    let pos = 0;
    while (pos < text.length) {
        re.lastIndex = pos;
        const m = re.exec(text);
        if (!m) return null;
        if (m[1]) { if (pos !== 0) return null; sel.tag = m[1] === '*' ? null : m[1].replace(/^[\w-]+\|/, ''); }
        else if (m[2]) sel.ids.push(m[2]);
        else if (m[3]) sel.classes.push(m[3]);
        else if (m[4]) sel.attrs.push({name: m[4], op: m[5] || null, value: m[6] ?? m[7] ?? m[8] ?? ''});
        else if (m[9]) {
            const pseudo = m[9].toLowerCase();
            if (pseudo === ':root') sel.root = true;
            else if (pseudo === ':first-child') sel.firstChild = true;
            else if (pseudo === ':last-child') sel.lastChild = true;
            else return null;   // :hover etc. never match a static picture
        }
        pos = re.lastIndex;
    }
    return sel;
}

// "g.a > path.b" -> [{compound, combinator}] from left to right, or null.
function parseSelector(text) {
    const tokens = text.trim().replace(/\s*>\s*/g, ' > ').split(/\s+/).filter(Boolean);
    const parts = [];
    let combinator = ' ';
    for (const token of tokens) {
        if (token === '>') { combinator = '>'; continue; }
        if (token === '+' || token === '~') return null;
        const compound = parseCompound(token);
        if (!compound) return null;
        parts.push({compound, combinator});
        combinator = ' ';
    }
    if (!parts.length) return null;
    let a = 0, b = 0, c = 0;
    for (const {compound} of parts) {
        a += compound.ids.length;
        b += compound.classes.length + compound.attrs.length + (compound.root || compound.firstChild || compound.lastChild ? 1 : 0);
        if (compound.tag) c++;
    }
    return {parts, specificity: a * 1e6 + b * 1e3 + c};
}

const classList = el => (el.attrs.class || '').split(/\s+/).filter(Boolean);
const siblings = el => (el.parent?.children || []).filter(n => n.name);

function matchCompound(el, sel) {
    if (!el || !el.name || el.name === '#document') return false;
    if (sel.tag && sel.tag !== el.name) return false;
    if (sel.ids.length && !sel.ids.every(id => el.attrs.id === id)) return false;
    if (sel.classes.length) {
        const list = classList(el);
        if (!sel.classes.every(c => list.includes(c))) return false;
    }
    for (const {name, op, value} of sel.attrs) {
        const actual = el.attrs[name];
        if (actual === undefined) return false;
        if (!op) continue;
        if (op === '=' && actual !== value) return false;
        if (op === '~=' && !actual.split(/\s+/).includes(value)) return false;
        if (op === '^=' && !actual.startsWith(value)) return false;
        if (op === '$=' && !actual.endsWith(value)) return false;
        if (op === '*=' && !actual.includes(value)) return false;
        if (op === '|=' && actual !== value && !actual.startsWith(value + '-')) return false;
    }
    if (sel.root && el.parent?.name !== '#document') return false;
    if (sel.firstChild && siblings(el)[0] !== el) return false;
    if (sel.lastChild && siblings(el).at(-1) !== el) return false;
    return true;
}

export function matches(el, selector) {
    const {parts} = selector;
    const step = (node, index) => {
        if (!matchCompound(node, parts[index].compound)) return false;
        if (index === 0) return true;
        if (parts[index].combinator === '>') return step(node.parent, index - 1);
        for (let up = node.parent; up && up.name !== '#document'; up = up.parent)
            if (step(up, index - 1)) return true;
        return false;
    };
    return step(el, parts.length - 1);
}

// Returns [{selector, declarations, order}].
export function parseStylesheet(text, startOrder = 0) {
    const rules = [];
    let order = startOrder;
    text = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--|-->/g, '');
    const readBlock = (src, from) => {
        // Returns the index of the matching closing brace for the block opened before `from`.
        let depth = 1;
        for (let i = from; i < src.length; i++) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}' && --depth === 0) return i;
        }
        return src.length;
    };
    const parse = src => {
        let i = 0;
        while (i < src.length) {
            const open = src.indexOf('{', i);
            const semi = src.indexOf(';', i);
            if (open < 0) break;
            const head = src.slice(i, open).trim();
            if (head.startsWith('@') && semi >= 0 && semi < open) { i = semi + 1; continue; }   // @import ...;
            const close = readBlock(src, open + 1);
            const body = src.slice(open + 1, close);
            if (head.startsWith('@')) {
                if (/^@media\b/i.test(head) || /^@supports\b/i.test(head)) parse(body);
            } else {
                const declarations = parseDeclarations(body);
                for (const selText of splitOutside(head, ',')) {
                    const selector = parseSelector(selText);
                    if (selector && declarations.length) rules.push({selector, declarations, order: order++});
                }
            }
            i = close + 1;
        }
    };
    parse(text);
    return rules;
}
