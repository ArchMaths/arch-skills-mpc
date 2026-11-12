// A small, forgiving XML parser for SVG files: elements, attributes, text, CDATA,
// comments, processing instructions, and DOCTYPE internal entities (Illustrator
// declares namespaces as entities, e.g. <!ENTITY ns_svg "http://www.w3.org/2000/svg">).
//
// Elements are {name, attrs, children, parent}; text nodes are {text, parent}.
// Namespace prefixes on element names are dropped (svg:path -> path); attribute
// names keep theirs (xlink:href).

const PREDEFINED = {lt: '<', gt: '>', amp: '&', quot: '"', apos: "'"};

export class XmlError extends Error {}

function decodeEntities(text, entities) {
    if (!text.includes('&')) return text;
    return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[A-Za-z_][\w.-]*);/gi, (whole, ref) => {
        if (ref[0] === '#') {
            const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
            return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
        }
        if (ref in PREDEFINED) return PREDEFINED[ref];
        if (entities.has(ref)) return entities.get(ref);
        return whole;
    });
}

function readDoctype(xml, start, entities) {
    // <!DOCTYPE svg PUBLIC "..." "..." [ <!ENTITY name "value"> ... ]>
    let i = start + 9;
    let depth = 0;
    for (; i < xml.length; i++) {
        const ch = xml[i];
        if (ch === '"' || ch === "'") {
            const end = xml.indexOf(ch, i + 1);
            if (end < 0) break;
            i = end;
        } else if (ch === '[') depth++;
        else if (ch === ']') depth--;
        else if (ch === '>' && depth <= 0) break;
    }
    const body = xml.slice(start, i);
    for (const m of body.matchAll(/<!ENTITY\s+([A-Za-z_][\w.-]*)\s+(?:"([^"]*)"|'([^']*)')\s*>/g))
        entities.set(m[1], m[2] ?? m[3]);
    return i + 1;
}

export function parseXml(xml) {
    if (typeof xml !== 'string') throw new XmlError('SVG input must be text.');
    xml = xml.replace(/^﻿/, '');
    const entities = new Map();
    const document = {name: '#document', attrs: {}, children: [], parent: null};
    let current = document;
    let i = 0;
    const addText = text => {
        if (!text) return;
        const last = current.children[current.children.length - 1];
        if (last && 'text' in last) last.text += text;
        else current.children.push({text, parent: current});
    };
    while (i < xml.length) {
        const lt = xml.indexOf('<', i);
        if (lt < 0) {
            addText(decodeEntities(xml.slice(i), entities));
            break;
        }
        if (lt > i) addText(decodeEntities(xml.slice(i, lt), entities));
        if (xml.startsWith('<!--', lt)) {
            const end = xml.indexOf('-->', lt + 4);
            i = end < 0 ? xml.length : end + 3;
        } else if (xml.startsWith('<![CDATA[', lt)) {
            const end = xml.indexOf(']]>', lt + 9);
            addText(xml.slice(lt + 9, end < 0 ? xml.length : end));
            i = end < 0 ? xml.length : end + 3;
        } else if (xml.startsWith('<?', lt)) {
            const end = xml.indexOf('?>', lt + 2);
            i = end < 0 ? xml.length : end + 2;
        } else if (/^<!DOCTYPE/i.test(xml.slice(lt, lt + 9))) {
            i = readDoctype(xml, lt, entities);
        } else if (xml[lt + 1] === '!') {
            const end = xml.indexOf('>', lt);
            i = end < 0 ? xml.length : end + 1;
        } else if (xml[lt + 1] === '/') {
            const end = xml.indexOf('>', lt);
            const name = xml.slice(lt + 2, end < 0 ? xml.length : end).trim().replace(/^[\w.-]+:/, '');
            // Close the nearest open element with this name; tolerate stray closing tags.
            let node = current;
            while (node !== document && node.name !== name) node = node.parent;
            if (node !== document) current = node.parent;
            i = end < 0 ? xml.length : end + 1;
        } else {
            const tag = /^<([A-Za-z_][\w:.-]*)/.exec(xml.slice(lt, lt + 200));
            if (!tag) {
                addText('<');
                i = lt + 1;
                continue;
            }
            const element = {name: tag[1].replace(/^[\w.-]+:/, ''), qname: tag[1], attrs: {}, children: [], parent: current};
            let j = lt + tag[0].length;
            const attrRe = /\s*([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/y;
            let selfClosing = false;
            for (;;) {
                while (j < xml.length && /\s/.test(xml[j])) j++;
                if (j >= xml.length) throw new XmlError(`Unclosed <${element.qname}> tag.`);
                if (xml[j] === '>') { j++; break; }
                if (xml.startsWith('/>', j)) { selfClosing = true; j += 2; break; }
                attrRe.lastIndex = j;
                const m = attrRe.exec(xml);
                if (!m || m[0].length === 0) { j++; continue; }
                const value = m[2] ?? m[3] ?? m[4] ?? '';
                element.attrs[m[1]] = decodeEntities(value, entities);
                j = attrRe.lastIndex;
            }
            current.children.push(element);
            if (!selfClosing) current = element;
            i = j;
        }
    }
    const root = document.children.find(n => n.name === 'svg');
    if (!root) throw new XmlError('No <svg> element found.');
    return root;
}

export const elementChildren = node => node.children.filter(c => c.name);

export function textContent(node) {
    if ('text' in node) return node.text;
    return node.children.map(textContent).join('');
}

// Every element in document order.
export function* walk(node) {
    yield node;
    for (const child of node.children) if (child.name) yield* walk(child);
}
