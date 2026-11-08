// End-to-end tests against the real Arch page (needs Chrome/Chromium).
import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {ArchEngine} from '../src/engine.js';
import {decompile} from '../src/decompile.js';

const engine = new ArchEngine({keepWarm: true});
after(() => engine.close());
const example = name => readFileSync(new URL(`../examples/${name}`, import.meta.url), 'utf8');
const byName = (result, name) => result.objects.find(o => o.name === name);

for (const file of readdirSync(new URL('../examples/', import.meta.url)).filter(f => f.endsWith('.arch') && f !== 'bad.arch')) {
    test(`example ${file} builds, reloads identically, and has no warnings`, async () => {
        const result = await engine.run(example(file), {screenshot: true});
        assert.deepEqual(result.errors, []);
        assert.ok(result.ok);
        assert.ok(result.png && result.png.length > 10000, 'screenshot captured');
        const state = JSON.parse(result.json);
        assert.ok(Array.isArray(state.entries) && state.entries.length === result.objects.length);
        const unexpected = result.warnings.filter(w => !/Arch also created/.test(w.message));
        assert.deepEqual(unexpected, []);
    });
}

test('computed values are correct', async () => {
    const result = await engine.run(example('parabola-tangents.arch'));
    assert.equal(byName(result, 'I').details, '(1.414, 2.000)');
    assert.equal(byName(result, 'J').details, '(-1.414, 2.000)');
    assert.equal(byName(result, 't1').details, 'y = 2.00x - 1.00');
    assert.deepEqual(result.refs, {parab: 'func1', level: 'func2'});
});

test('slider, autoplay, style and view options reach the save file', async () => {
    const result = await engine.run(example('circle-motion.arch'));
    const state = JSON.parse(result.json);
    const a = state.entries.find(e => e.name === 'a');
    assert.deepEqual([a.value, a.min, a.max, a.step, a.playMode, a.playState], [0.1, 0, 1, 0.0025, 1, 1]);
    const op = state.entries.find(e => e.name === 'op');
    assert.equal(op.lineDash, 'long');
    const px = state.entries.find(e => e.name === 'Px');
    assert.deepEqual([px.labelMode, px.labelText], ['label', 'foot']);
    assert.equal(state.name, 'Circular motion');
    assert.equal(state.gridStyle, 'dots');
    assert.deepEqual(state.viewportCenter2D, {x: 0, y: 0});
});

test('mistakes are reported per line and nothing is marked ok', async () => {
    const result = await engine.run(example('bad.arch'));
    assert.equal(result.ok, false);
    const lines = result.errors.map(e => e.line);
    assert.deepEqual(lines, [3, 5, 6, 7]);
    assert.match(result.errors[0].message, /already taken.*a_1/);
    assert.match(result.errors[1].message, /unknown name\(s\) "cc"/);
    assert.match(result.errors[2].message, /"A", "B"/);
    assert.match(result.errors[3].message, /syntax error/);
    assert.ok(result.warnings.some(w => w.line === 2 && /auto-created variable a=1/.test(w.message)));
});

test('refs cannot shadow existing names or built-ins', async () => {
    const result = await engine.run('point(A,1,1)\ny=x | ref=A\ny=2x | ref=sin\ny=3x | ref=k\ny=4x | ref=k');
    assert.deepEqual(result.errors.map(e => e.line), [2, 3, 5]);
});

test('decompiled save files rebuild to the same objects', async () => {
    const first = await engine.run(example('feature-tour.arch'));
    assert.ok(first.ok);
    const {script} = decompile(first.json);
    const second = await engine.run(script);
    assert.deepEqual(second.errors, []);
    const key = o => JSON.stringify([o.expression, o.details, o.value, o.color, o.thickness, o.visible, o.min, o.max, o.step, o.playMode]);
    assert.deepEqual(second.objects.map(key), first.objects.map(key));
    const a = JSON.parse(first.json), b = JSON.parse(second.json);
    for (const field of ['name', 'scale', 'viewportCenter2D', 'gridStyle', 'tmin', 'tmax', 'showPointLabels'])
        assert.deepEqual(b[field], a[field], field);
    a.entries.forEach((entry, i) => {
        for (const field of ['lineDash', 'labelMode', 'labelText', 'dragEnabled', 'playState', 'autoNumber'])
            assert.deepEqual(b.entries[i][field], entry[field], `${entry.expr} ${field}`);
    });
});

test('operators, text boxes, frames and the global script reach the save file', async () => {
    const result = await engine.run(example('js-frames-text.arch'));
    assert.deepEqual(result.errors, []);
    assert.equal(byName(result, 'P').details, '(1.000, 1.000)');           // clamp(2 sin 1, -1, 1) = 1
    assert.ok(result.scriptPng && result.scriptPng.length > 10000, 'second screenshot after running @script');
    assert.deepEqual(result.scriptPreview, {seconds: 2, problems: []});
    assert.equal(result.texts[1].shown, 'P = (1, 1)\\nsq(a) = 1');
    const state = JSON.parse(result.json);
    assert.deepEqual([state.showPlaybackControls, state.totalFrames, state.playbackFPS, state.currentFrame], [true, 3, 1, 0]);
    assert.deepEqual(state.entries.filter(e => e.displayFrame).map(e => [e.name, e.displayFrame]), [['L', 1], ['R', 1], ['s', 2], ['c', 3]]);
    assert.deepEqual(state.entries.filter(e => e.bodyJs).map(e => e.name), ['clamp', 'sq']);
    assert.match(state.globalScript, /arch\.valuesetting\('a'/);
    assert.equal(state.annotations.length, 2);
    assert.ok(state.annotations[1].content.startsWith('<smart>'));
});

test('JavaScript problems are reported, and loops time out', async () => {
    const run = src => engine.run(src, {screenshot: false, timeoutMs: 4000});
    const cases = [
        ['y=x\n@script\nundefinedThing.go();\n@end', 2, /undefinedThing is not defined/],
        ['y=x\n@script\nsetTimeout(() => { arch.nosuchfunction(1); }, 100);\n@end', 2, /arch\.nosuchfunction is not a function/],
        ['y=x\n@script\nlet = = 3;\n@end', 2, /syntax error/],
        ['y=x\n@script\nwhile (true) {}\n@end', 2, /did not finish within 4 s/],
        ['@operator bad(u)\n  return u +* 2;\n@end', 1, /syntax error in operator bad/],
        ['@operator spin(u)\n  while (true) {}\n@end\ny=spin(x)', 1, /did not finish within 4 s.*spin \(line 1\)/],
        ['@operator sin(u)\n  return u;\n@end', 1, /built-in name/],
    ];
    for (const [src, line, pattern] of cases) {
        const result = await run(src);
        assert.equal(result.ok, false, src);
        assert.equal(result.errors[0].line, line, src);
        assert.match(result.errors[0].message, pattern, src);
    }
    const thrower = await run('@operator boom(u)\n  throw new Error("kaboom");\n@end\ny=boom(x)');
    assert.ok(thrower.ok);
    assert.ok(thrower.warnings.some(w => w.line === 1 && /boom threw "kaboom" \d+ time/.test(w.message)));
});

test('the page can reach neither local files nor the network', async () => {
    const slot = await engine.acquire();
    try {
        const probe = await slot.page.evaluate(async () => {
            const tryFetch = url => fetch(url).then(() => 'reached', () => 'blocked');
            return {secure: isSecureContext, file: await tryFetch('file:///etc/hosts'), net: await tryFetch('https://example.com/')};
        });
        assert.deepEqual(probe, {secure: true, file: 'blocked', net: 'blocked'});
    } finally {
        await slot.context.close();
    }
});

test('decompiling a file with operators, frames, text and a script rebuilds identically', async () => {
    const first = await engine.run(example('js-frames-text.arch'), {screenshot: false});
    const second = await engine.run(decompile(first.json).script, {screenshot: false});
    assert.deepEqual(second.errors, []);
    const pick = s => JSON.stringify([s.globalScript, s.showPlaybackControls, s.totalFrames, s.playbackFPS, s.currentFrame,
        s.annotations, s.entries.map(e => [e.expr, e.displayFrame, e.bodyJs, e.color, e.min, e.max, e.step])]);
    assert.equal(pick(JSON.parse(second.json)), pick(JSON.parse(first.json)));
});

test('errors inside Arch itself are reported once, as an Arch bug with a workaround', async () => {
    const result = await engine.run('y=x\npoint(A,0,0)\npoint(B,1,0)\nlength(d,A,B)', {screenshot: false});
    assert.ok(result.ok, 'file stays valid');
    const internal = result.warnings.filter(w => /Arch hit an internal error in drawMeasurements/.test(w.message));
    assert.equal(internal.length, 1);
    assert.match(internal[0].message, /create the measured points first/i);
    const fixed = await engine.run('point(A,0,0)\npoint(B,1,0)\ny=x\nlength(d,A,B)', {screenshot: false});
    assert.deepEqual(fixed.warnings, []);
});

const pngSize = png => [png.readUInt32BE(16), png.readUInt32BE(20)];

test('screenshots can be rendered at a smaller scale, including after @script', async () => {
    const result = await engine.run('a=0\ny=a*x\n@script\nsetInterval(() => arch.valuesetting(\'a\', 1), 50);\n@end', {screenshotScale: 0.5});
    assert.ok(result.ok);
    assert.deepEqual(pngSize(result.png), [640, 400]);
    assert.deepEqual(pngSize(result.scriptPng), [640, 400]);
    assert.deepEqual(pngSize((await engine.run('y=x', {screenshot: true})).png), [1280, 800]);
});
