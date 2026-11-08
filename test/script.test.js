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
    assert.match(warnings[0], /1 annotation\(s\) \(1 pen\)/);
});

test('@operator, one-line operators and @script blocks', () => {
    const {steps, script} = parseScript(`@operator clamp(v, lo, hi)
  // keep # and | inside JS
  return v > hi || v < lo ? Math.min(hi, Math.max(lo, v)) : v; # not a comment
@end
sq(u)={ return u|0 ? u*u : 0; }
@script
let t = 0;   # also kept
setInterval(() => { t++; }, 30);
@end
y=clamp(x,-1,1)`);
    assert.equal(steps[0].kind, 'operator');
    assert.deepEqual(steps[0].params, ['v', 'lo', 'hi']);
    assert.match(steps[0].body, /\/\/ keep # and \| inside JS\n {2}return v > hi \|\| v < lo/);
    assert.deepEqual([steps[1].kind, steps[1].name, steps[1].body], ['operator', 'sq', 'return u|0 ? u*u : 0;']);
    assert.equal(script.line, 6);
    assert.equal(script.text, 'let t = 0;   # also kept\nsetInterval(() => { t++; }, 30);');
    assert.equal(steps[2].expr, 'y=clamp(x,-1,1)');
    assert.equal(steps[2].line, 10);
});

test('block errors', () => {
    throwsAtLine('@script\nlet a = 1;', 1, /missing its closing @end/);
    throwsAtLine('@operator f(u)\nreturn u;', 1, /missing its closing @end/);
    throwsAtLine('y=x\n@end', 2, /without a matching/);
    throwsAtLine('@operator f(u, u)\nreturn u;\n@end', 1, /distinct/);
    throwsAtLine('@operator f(u)\n\n@end', 1, /empty body/);
    throwsAtLine('@script\nx();\n@end\n@script\ny();\n@end', 4, /Only one @script/);
});

test('@text, @frames and frame=', () => {
    const {steps} = parseScript(`@text x=-4 y=3 size=0.4 color=blue | Hello | world # not a comment
@text at=1,2 | a = {value(a)}\\nnext
@text x=0 y=0 plain | literal {value(a)}
@frames total=5 fps=2 current=1 bind="floor(a * 5)"
point(P,1,1) | frame=2`);
    assert.deepEqual(steps[0], {kind: 'text', line: 1, content: 'Hello | world # not a comment', size: 0.4, smart: false, x: -4, y: 3, color: {h: 57.8, s: 86.9, b: 89.8}});
    assert.deepEqual([steps[1].x, steps[1].y, steps[1].smart, steps[1].content], [1, 2, true, 'a = {value(a)}\\nnext']);
    assert.equal(steps[2].smart, false);
    assert.deepEqual(steps[3].frames, {total: 5, fps: 2, current: 1, bind: 'floor(a * 5)'});
    assert.equal(steps[4].frame, 2);
    throwsAtLine('@text x=1 | no y', 1, /top-left corner/);
    throwsAtLine('@text x=1 y=2', 1, /needs the text after/);
    throwsAtLine('@frames total=2 current=3', 1, /must not exceed/);
    throwsAtLine('point(P,1,1) | frame=1.5', 1, /whole number/);
});

test('decompile covers operators, frames, text boxes and the global script', () => {
    const save = {
        name: 'X', version: 12200, scale: 50, viewportCenter2D: {x: 0, y: 0},
        showPlaybackControls: true, totalFrames: 4, playbackFPS: 2, currentFrame: 1, frameExpr: 'floor(a * 4)',
        globalScript: 'let t = 0;\nsetInterval(() => t++, 30);',
        customAdvancedFunctions: [{name: 'twice', params: ['u'], bodyJsString: 'return 2*u;'}],
        annotations: [
            {type: 'text', content: '<smart>a = {value(a)}', x: 1, y: 2, width: 3, height: 0.8, fontSize: 0.4, color: {h: 0, s: 0, b: 0, a: 0}},
            {type: 'text', content: 'literal {value(a)}', x: 0, y: 0, width: 4, height: 1, fontSize: 0.5, color: {h: 60, s: 100, b: 80, a: 0}},
            {type: 'pen', path: []}],
        entries: [
            {type: 'advanced_custom_function_definition', name: 'clamp', params: ['v', 'lo', 'hi'], bodyJs: '\n  return Math.min(hi, Math.max(lo, v));\n'},
            {type: 'geometry', expr: 'point(P,1,1)', name: 'P', geometryType: 'point', displayFrame: 2, color: {h: 0, s: 0, b: 0, a: 0}}
        ]
    };
    const {script, warnings} = decompile(JSON.stringify(save));
    assert.match(script, /^@operator twice\(u\)\nreturn 2\*u;\n@end$/m);
    assert.match(script, /^@operator clamp\(v, lo, hi\)\n {2}return Math\.min\(hi, Math\.max\(lo, v\)\);\n@end$/m);
    assert.match(script, /^point\(P,1,1\) {2}\| frame=2$/m);
    assert.match(script, /^@frames total=4 fps=2 current=1 bind="floor\(a \* 4\)"$/m);
    assert.match(script, /^@text x=1 y=2 width=3 height=0\.8 size=0\.4 smart \| a = \{value\(a\)\}$/m);
    assert.match(script, /^@text x=0 y=0 width=4 height=1 size=0\.5 color=hsb\(60,100,80\) plain \| literal \{value\(a\)\}$/m);
    assert.match(script, /^@script\nlet t = 0;\nsetInterval\(\(\) => t\+\+, 30\);\n@end$/m);
    assert.deepEqual(warnings, ['Dropped 1 annotation(s) (1 pen); scripts cannot express drawings, images, PDFs or audio.']);
    // The decompiled script must itself parse.
    const parsed = parseScript(script);
    assert.equal(parsed.steps.filter(s => s.kind === 'operator').length, 2);
    assert.equal(parsed.steps.filter(s => s.kind === 'text').length, 2);
    assert.ok(parsed.script);
});
