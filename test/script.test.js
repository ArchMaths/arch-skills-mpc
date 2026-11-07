// Parser and decompiler tests: pure Node, no browser.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseScript, hexToHsb, ScriptError} from '../src/script.js';
import {decompile} from '../src/decompile.js';

const throwsAtLine = (source, line, pattern) => assert.throws(() => parseScript(source), error =>
    error instanceof ScriptError && error.line === line && pattern.test(error.message));

test('object lines, options and directives', () => {
    const {steps, title} = parseScript(`@title Demo
# comment
a=0 | min=0 max=1 step=0.0025 mode=forward play
y=x^2 | ref=parab color=#ff0000 opacity=0.5 thickness=4 hidden
point(P,1,2) | label="Point P" dash=short fixed
//note with | bar and @at
@view x=-5..5 y=-3..3
@view 3d azimuth=30 elevation=20
@set showAxes=false gridStyle=dots tmin=0
@style last | color=blue`);
    assert.equal(title, 'Demo');
    assert.equal(steps.length, 8);
    assert.deepEqual(steps[0].slider, {min: '0', max: '1', step: '0.0025', mode: 1, play: true});
    assert.equal(steps[1].ref, 'parab');
    assert.deepEqual(steps[1].style, {color: {h: 0, s: 100, b: 100, a: 50}, thickness: 4, visible: false});
    assert.deepEqual(steps[2].style.label, {mode: 'label', text: 'Point P'});
    assert.equal(steps[2].fixed, true);
    assert.equal(steps[3].expr, '//note with | bar and @at');
    assert.deepEqual(steps[4].view, {xrange: [-5, 5], yrange: [-3, 3]});
    assert.deepEqual(steps[5].view, {dimension: '3d', azimuth: 30, elevation: 20});
    assert.deepEqual(steps[6].settings, [{name: 'showAxes', value: false}, {name: 'gridStyle', value: 'dots'}, {name: 'tmin', value: '0'}]);
    assert.equal(steps[7].target, 'last');
});

test('trailing # comments are ignored except in text lines and quotes', () => {
    const {steps} = parseScript('y=x^2   # parabola\npoint(P,1,1) | label="#1" # first\n//keep # this\n@view x=-1..1 # zoom');
    assert.equal(steps[0].expr, 'y=x^2');
    assert.deepEqual(steps[1].style.label, {mode: 'label', text: '#1'});
    assert.equal(steps[2].expr, '//keep # this');
    assert.deepEqual(steps[3].view, {xrange: [-1, 1]});
    const colors = parseScript('y=x | color=#ff0000 # red\ny=2x | color= #00ff00').steps;
    assert.deepEqual(colors[0].style.color, {h: 0, s: 100, b: 100});
    assert.deepEqual(colors[1].style.color, {h: 33.3, s: 100, b: 100});
});

test('parser errors carry line numbers', () => {
    throwsAtLine('y=x\ny=x | colour=red', 2, /Unknown option "colour"/);
    throwsAtLine('y=x | color=chartreuse', 1, /Invalid color/);
    throwsAtLine('y=x | ref=pi', 1, /reserved/);
    throwsAtLine('@view x=5..1', 1, /min < max/);
    throwsAtLine('@set darkMode=true', 1, /not saved/);
    throwsAtLine('@zoom 2', 1, /Unknown directive/);
    throwsAtLine('$multi2$y=x$(0,100,85,100)$', 1, /one expression per line/);
    throwsAtLine('@view x=-1..1 unit=40', 1, /either/);
});

test('hex to Arch HSB', () => {
    assert.deepEqual(hexToHsb('#000000'), {h: 0, s: 0, b: 0});
    assert.deepEqual(hexToHsb('#00ff00'), {h: 33.3, s: 100, b: 100});
    assert.deepEqual(hexToHsb('#fff'), {h: 0, s: 0, b: 100});
});

test('decompile maps save fields back to script options', () => {
    const save = {
        name: 'T', version: 12200, scale: 80, viewportCenter2D: {x: 1, y: 2}, gridStyle: 'dots', showAxes: true,
        statistics: {rows: [['', '']], regressions: []}, annotations: [{type: 'pen'}],
        entries: [
            {type: 'variable', expr: 'a=0.5', isEditableIndependent: true, min: 0, max: 1, step: 0.01, playMode: 1, playState: 1},
            {type: 'function', expr: 'y=x^2', autoNumber: 'func1', color: {h: 10, s: 100, b: 85, a: 0}, thickness: 3, visible: true},
            {type: 'geometry', expr: 'point(A,1,2)', name: 'A', geometryType: 'point', color: {h: 0, s: 0, b: 0, a: 0}, dragEnabled: 0, labelMode: 'label', labelText: 'start'},
            {type: 'geometry', expr: 'polyeq(sq,A,B,4)', name: 'sq', geometryType: 'polyeq', color: {h: 0, s: 0, b: 0, a: 0}},
            {type: 'geometry', expr: 'point(C,sq,3)', name: 'C', geometryType: 'point', pointOnObject: true, autoPolyeqVertex: true, color: {h: 50, s: 100, b: 85, a: 0}},
            {type: 'text', expr: '//hello', content: 'hello', color: {h: 0, s: 0, b: 60, a: 0}}
        ]
    };
    const {script, warnings} = decompile(JSON.stringify(save));
    assert.match(script, /^@title T$/m);
    assert.match(script, /^a=0\.5 {2}\| min=0 max=1 step=0\.01 mode=forward play$/m);
    assert.match(script, /^y=x\^2 {2}\| ref=func1 color=hsb\(10,100,85\)$/m);
    assert.match(script, /^point\(A,1,2\) {2}\| label="start" fixed$/m);
    assert.match(script, /^polyeq\(sq,A,B,4\)$/m);
    assert.match(script, /^@style C \| color=hsb\(50,100,85\)$/m);
    assert.doesNotMatch(script, /^point\(C,sq,3\)/m);
    assert.match(script, /^\/\/hello$/m);
    assert.match(script, /^@view center=1,2 unit=80$/m);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /1 drawing annotation/);
});
