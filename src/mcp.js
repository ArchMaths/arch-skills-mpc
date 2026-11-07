#!/usr/bin/env node
// MCP server (stdio) that lets coding agents build Arch save files.
// stdout carries the MCP protocol; anything diagnostic goes to stderr.
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
import {ArchEngine} from './engine.js';
import {formatReport} from './report.js';
import {decompile} from './decompile.js';
import {readGuide, readFullSyntax} from './guide.js';

const engine = new ArchEngine({keepWarm: true});
const abs = path => resolve(process.cwd(), path);

const INSTRUCTIONS = `Arch is a GeoGebra-like graphing calculator. These tools turn a short scene script into a real Arch save file (.txt) by running the actual Arch engine headlessly.
Workflow: call arch_guide once to learn the script format and Arch syntax; write a script; call arch_check and read the errors, warnings, object values and screenshot; fix and re-check; then arch_build to write the file. To modify an existing save file, call arch_decompile first, edit the script, then build.
Never hand-write Arch save-file JSON: it contains parser-computed fields and will not load correctly.`;

const server = new McpServer({name: 'arch', version: '0.1.0'}, {instructions: INSTRUCTIONS});

const text = value => ({type: 'text', text: value});
const image = png => ({type: 'image', data: Buffer.from(png).toString('base64'), mimeType: 'image/png'});

function scriptFrom({script, script_path}) {
    if (script && script_path) throw new Error('Pass either script or script_path, not both.');
    if (script_path) return readFileSync(abs(script_path), 'utf8');
    if (typeof script === 'string' && script.trim()) return script;
    throw new Error('Pass the scene script as script (text) or script_path (file).');
}

const scriptInput = {
    script: z.string().optional().describe('Scene script text (one Arch expression per line; see arch_guide).'),
    script_path: z.string().optional().describe('Path to a .arch scene script file, instead of script.')
};

server.registerTool('arch_guide', {
    title: 'Arch scene-script guide',
    description: 'Returns the scene-script format and the Arch expression/geometry syntax with common pitfalls. Read this before writing a script. Set full_reference to also get the complete original syntax manual (Chinese, ~40 KB).',
    inputSchema: {full_reference: z.boolean().optional().describe('Also include the complete Chinese syntax manual.')},
    annotations: {readOnlyHint: true}
}, async ({full_reference}) => {
    const parts = [text(readGuide())];
    if (full_reference) parts.push(text('# Full Arch syntax manual (Chinese)\n\n' + readFullSyntax()));
    return {content: parts};
});

server.registerTool('arch_check', {
    title: 'Check an Arch scene script',
    description: 'Runs a scene script in the real Arch engine without writing a file. Returns per-line errors and warnings, every object with its computed value (coordinates, equations, measurements), and a screenshot of the result as it will look when the saved file is opened. Use it to iterate until there are no errors and the picture is right.',
    inputSchema: {...scriptInput, screenshot: z.boolean().optional().describe('Include a screenshot (default true).')},
    annotations: {readOnlyHint: true}
}, async args => {
    const result = await engine.run(scriptFrom(args), {screenshot: args.screenshot !== false, verify: true});
    const content = [text(formatReport(result))];
    if (result.png) content.push(image(result.png));
    return {content};
});

server.registerTool('arch_build', {
    title: 'Build an Arch save file',
    description: 'Runs a scene script in the real Arch engine and writes an Arch save file (open it in Arch with the Open file button). The file is only written when the script has no errors and the saved file reloads identically. Returns the same report as arch_check.',
    inputSchema: {
        ...scriptInput,
        output_path: z.string().describe('Where to write the save file, e.g. graphs/parabola.txt (Arch saves use .txt). Relative paths resolve against the server working directory; absolute paths are safest.'),
        screenshot_path: z.string().optional().describe('Also save a PNG screenshot here.'),
        screenshot: z.boolean().optional().describe('Include the screenshot in the response (default true).')
    }
}, async args => {
    const wantPng = args.screenshot !== false || Boolean(args.screenshot_path);
    const result = await engine.run(scriptFrom(args), {screenshot: wantPng, verify: true});
    const out = abs(args.output_path);
    let shot;
    if (result.ok) {
        mkdirSync(dirname(out), {recursive: true});
        writeFileSync(out, result.json);
        if (args.screenshot_path && result.png) {
            shot = abs(args.screenshot_path);
            mkdirSync(dirname(shot), {recursive: true});
            writeFileSync(shot, result.png);
        }
    }
    const content = [text(formatReport(result, {written: result.ok ? out : null, screenshot: shot}))];
    if (result.png && args.screenshot !== false) content.push(image(result.png));
    return {content, isError: !result.ok};
});

server.registerTool('arch_decompile', {
    title: 'Convert an Arch save file to a scene script',
    description: 'Reads an existing Arch save file and returns an equivalent scene script, so you can edit it and rebuild with arch_build. Drawings, images, statistics tables and custom JavaScript operators cannot be expressed and are listed as warnings.',
    inputSchema: {save_path: z.string().describe('Path to the Arch save file (.txt).')},
    annotations: {readOnlyHint: true}
}, async ({save_path}) => {
    const {script, warnings} = decompile(readFileSync(abs(save_path), 'utf8'));
    const note = warnings.length ? `Warnings:\n${warnings.map(w => `- ${w}`).join('\n')}\n\n` : '';
    return {content: [text(`${note}${script}`)]};
});

let closing = false;
async function shutdown() {
    if (closing) return;
    closing = true;
    await engine.close().catch(() => {});
    process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.stdin.on('close', shutdown);

await server.connect(new StdioServerTransport());
console.error(`arch-mcp ready (Arch: ${engine.htmlPath})`);
