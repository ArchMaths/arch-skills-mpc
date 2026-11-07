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
