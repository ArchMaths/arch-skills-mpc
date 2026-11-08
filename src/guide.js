import {readFileSync, existsSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const GUIDE_PATH = resolve(ROOT, 'docs', 'GUIDE.md');
export const FULL_SYNTAX_PATH = resolve(ROOT, 'Arch图形计算器语法与对象创建说明.txt');

// Guide topics, so agents can read only the part they need. Each topic lists the start of the
// headings it covers; a ## heading runs to the next ##, a ### heading to the next ## or ###.
export const GUIDE_TOPICS = {
    workflow: {about: 'check/build/decompile loop and what errors vs warnings mean', headings: ['## Workflow']},
    format: {about: 'script lines, every object option, every directive', headings: ['## Script format']},
    syntax: {about: 'expression rules, functions, math objects (curves, regions, parametric, root, point lists, 3D)', headings: ['### General rules', '### Functions', '### Math objects']},
    geometry: {about: 'every geometry command, what u means in point(P,host,u), units', headings: ['### Geometry commands', '### What u means', '### Units cheat sheet']},
    animation: {about: 'sliders that move things, @frames frame-by-frame playback', headings: ['### Making things move', '## Frame-by-frame animation']},
    text: {about: '@text canvas text boxes with live values', headings: ['## Canvas text']},
    operators: {about: '@operator JavaScript operators', headings: ['## JavaScript operators']},
    script: {about: '@script global program and the arch.* API', headings: ['## Global program']},
    mistakes: {about: 'the full list of common mistakes', headings: ['## Common mistakes']}
};

export function readGuide() {
    return readFileSync(GUIDE_PATH, 'utf8');
}

// Splits the guide into {heading, level, text} blocks (code fences are not headings).
export function guideBlocks(guide = readGuide()) {
    const blocks = [];
    let fenced = false;
    for (const line of guide.split('\n')) {
        if (line.startsWith('```')) fenced = !fenced;
        const level = !fenced && /^(#{2,3}) /.exec(line)?.[1].length;
        if (level) blocks.push({heading: line, level, lines: [line]});
        else if (blocks.length) blocks.at(-1).lines.push(line);
    }
    return blocks.map(({heading, level, lines}) => ({heading, level, text: lines.join('\n').trim()}));
}

function topicText(blocks, headings) {
    const parts = [];
    for (const start of headings) {
        const at = blocks.findIndex(b => b.heading.startsWith(start));
        if (at < 0) throw new Error(`docs/GUIDE.md has no heading starting with "${start}"`);
        const level = blocks[at].level;
        let end = at + 1;
        while (end < blocks.length && blocks[end].level > level) end++;
        parts.push(blocks.slice(at, end).map(b => b.text).join('\n\n'));
    }
    return parts.join('\n\n');
}

export const topicList = () => Object.entries(GUIDE_TOPICS).map(([name, t]) => `  ${name.padEnd(10)} ${t.about}`).join('\n');

// "geometry", "geo" (unique prefix) or "syntax,geometry". Unknown names throw with the topic list.
export function readGuideTopics(spec) {
    const names = String(spec).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (!names.length) throw new Error(`Name a guide topic:\n${topicList()}`);
    const blocks = guideBlocks();
    return names.map(name => {
        const matches = GUIDE_TOPICS[name] ? [name] : Object.keys(GUIDE_TOPICS).filter(t => t.startsWith(name));
        if (matches.length !== 1) throw new Error(`Unknown guide topic "${name}". Topics:\n${topicList()}`);
        return topicText(blocks, GUIDE_TOPICS[matches[0]].headings);
    }).join('\n\n') + '\n';
}

export function readFullSyntax() {
    if (!existsSync(FULL_SYNTAX_PATH)) return 'The full Chinese syntax reference file is not available next to this tool.';
    return readFileSync(FULL_SYNTAX_PATH, 'utf8');
}
