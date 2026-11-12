// Talks to the MCP server over stdio exactly like Claude Code or Antigravity would.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const server = fileURLToPath(new URL('../src/mcp.js', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'arch-mcp-test-'));
let client;

before(async () => {
    client = new Client({name: 'arch-mcp-test', version: '0.0.0'});
    await client.connect(new StdioClientTransport({command: process.execPath, args: [server], cwd: dir, stderr: 'ignore'}));
});
after(async () => {
    await client?.close();
    rmSync(dir, {recursive: true, force: true});
});

const textOf = result => result.content.filter(c => c.type === 'text').map(c => c.text).join('\n');

test('lists the five tools with instructions', async () => {
    const {tools} = await client.listTools();
    assert.deepEqual(tools.map(t => t.name).sort(), ['arch_build', 'arch_check', 'arch_decompile', 'arch_guide', 'arch_svg']);
    assert.match(client.getInstructions(), /arch_guide/);
    assert.match(client.getInstructions(), /arch_svg/);
});

test('arch_guide returns the guide', async () => {
    const result = await client.callTool({name: 'arch_guide', arguments: {}});
    assert.match(textOf(result), /What u means in `point\(P,host,u\)`/);
});

test('arch_guide can return only some sections', async () => {
    const result = await client.callTool({name: 'arch_guide', arguments: {section: 'geometry'}});
    assert.match(textOf(result), /What u means/);
    assert.ok(!textOf(result).includes('## Global program'));
    const bad = await client.callTool({name: 'arch_guide', arguments: {section: 'nope'}});
    assert.equal(bad.isError, true);
    assert.match(textOf(bad), /Unknown guide topic/);
});

test('arch_check reports errors with an image', async () => {
    const result = await client.callTool({name: 'arch_check', arguments: {script: 'y=x^2 | ref=p\nintersect(I,p,q,1,1)'}});
    assert.match(textOf(result), /line 2: refers to "q"/);
    assert.ok(result.content.some(c => c.type === 'image' && c.mimeType === 'image/png'));
});

test('arch_check renders smaller screenshots and arch_build can report briefly', async () => {
    const check = await client.callTool({name: 'arch_check', arguments: {script: 'y=x^2', screenshot_scale: 0.5}});
    const png = Buffer.from(check.content.find(c => c.type === 'image').data, 'base64');
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [640, 400]);
    const build = await client.callTool({name: 'arch_build', arguments: {script: 'y=x^2', output_path: 'out/brief.txt', brief: true, screenshot: false}});
    assert.match(textOf(build), /^OK: wrote .*brief\.txt \(1 objects\)$/);
});

test('arch_build writes a loadable save file (relative to the server cwd)', async () => {
    const result = await client.callTool({name: 'arch_build', arguments: {
        script: '@title Unit circle\ncircle(c,O,1) | color=blue\npoint(P,c,0.125)\n@view x=-2..2 y=-2..2',
        output_path: 'out/unit.txt', screenshot_path: 'out/unit.png', screenshot: false}});
    assert.equal(result.isError, false);
    assert.match(textOf(result), /OK: wrote .*unit\.txt/);
    assert.match(textOf(result), /P \[point\] point\(P,c,0\.125\) {2}=> {2}\(0\.7071, 0\.7071\)/);
    const save = JSON.parse(readFileSync(join(dir, 'out/unit.txt'), 'utf8'));
    assert.equal(save.name, 'Unit circle');
    assert.ok(existsSync(join(dir, 'out/unit.png')));
    assert.ok(!result.content.some(c => c.type === 'image'));

    const dec = await client.callTool({name: 'arch_decompile', arguments: {save_path: 'out/unit.txt'}});
    assert.match(textOf(dec), /^point\(P,c,0\.125\)/m);
});

test('arch_check returns a second screenshot after running @script', async () => {
    const result = await client.callTool({name: 'arch_check', arguments: {
        script: 'a=0\ny=a*x\n@script\nsetInterval(() => arch.valuesetting(\'a\', 1), 50);\n@end'}});
    assert.match(textOf(result), /Preview: ran 2 s with no errors/);
    assert.equal(result.content.filter(c => c.type === 'image').length, 2);
    assert.match(textOf(result), /Screenshot 2: the same file after running its @script/);
});

test('arch_build refuses to write a broken script', async () => {
    const result = await client.callTool({name: 'arch_build', arguments: {script: 'sin(', output_path: 'out/broken.txt', screenshot: false}});
    assert.equal(result.isError, true);
    assert.ok(!existsSync(join(dir, 'out/broken.txt')));
});

test('arch_svg converts an SVG and writes the scene script and save file', async () => {
    const svg = '<svg viewBox="0 0 10 10"><title>Two squares</title><rect width="6" height="6" fill="#e63946"/>' +
        '<rect x="4" y="4" width="6" height="6" fill="#457b9d" filter="url(#none)"/></svg>';
    const result = await client.callTool({name: 'arch_svg', arguments: {svg, output_path: 'out/squares.txt', screenshot: false}});
    assert.equal(result.isError, false, textOf(result));
    assert.match(textOf(result), /Converted: 2 colour region\(s\)/);
    assert.match(textOf(result), /filters are ignored/);
    assert.match(textOf(result), /OK: wrote .*squares\.txt/);
    const save = JSON.parse(readFileSync(join(dir, 'out/squares.txt'), 'utf8'));
    assert.equal(save.name, 'Two squares');
    assert.ok(save.entries.some(e => e.sign === '<'));
    assert.match(readFileSync(join(dir, 'out/squares.arch'), 'utf8'), /^cos\(pi\*/m);
    const missing = await client.callTool({name: 'arch_svg', arguments: {svg}});
    assert.equal(missing.isError, true);
});
