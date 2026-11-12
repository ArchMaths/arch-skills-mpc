#!/usr/bin/env node
// svg2arch: converts an SVG drawing into an Arch save file. Every colour is filled with
// inequalities; see src/svg/ for how.
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {ArchEngine} from './engine.js';
import {formatReport} from './report.js';
import {convertSvg, formatConversion, DEFAULTS} from './svg/index.js';

const USAGE = `Convert an SVG drawing into an Arch save file, with every colour filled by inequalities.

Usage:
  svg2arch <drawing.svg> [-o drawing.txt] [options]   write drawing.arch (scene script) and drawing.txt
  svg2arch <drawing.svg> --check [--png shot.png]     convert and run in Arch, write no save file
  svg2arch <drawing.svg> --script-only [-s out.arch]  only write the scene script (no browser)

Options:
  -o, --out <path>        save file to write (default: the SVG's name with .txt)
  -s, --script <path>     where to write the scene script (default: the save file's name with .arch)
  --png <path>            also save a screenshot of the result as Arch shows it
  --png-scale <s>         screenshot scale, 0.1 to 1 (0.5 gives 640x400)
  --tolerance <px>        how far flattened curves may stray from the true curve, in screen
                          pixels at the saved zoom (default ${DEFAULTS.tolerance}); larger = fewer edges, faster in Arch
  --precision <n>         Arch's inequality sampling precision, 0.5 to 20 (default ${DEFAULTS.precision}: a ${20 / DEFAULTS.precision} px
                          grid); higher draws finer detail but each redraw takes (n/4)^2 times longer
  --gradient-steps <n>    at most this many colour bands per gradient (default ${DEFAULTS.gradientSteps}; fewer
                          when its colours are close; 1 = the gradient's average colour)
  --max-edges <n>         edges per inequality entry (default ${DEFAULTS.maxEdges}); larger regions are split
  --title <text>          file name shown in Arch (default: the SVG's <title>)
  --axes                  keep Arch's axes and grid (hidden by default)
  --no-seams              leave out the point lists that hide seams between regions
  --timeout <s>           seconds each Arch step may take (default 30); raise for very large drawings
  --html <path>           Arch index.html to use (default: ARCH_HTML or ./index.html)
  --json                  print the full result as JSON

Filters (blur, shadows, ...) are ignored. Exit code 0: OK, 1: Arch reported errors, 2: usage or input problem.`;

function parseArgs(argv) {
    const args = {options: {}};
    const number = (name, text) => {
        const v = Number(text);
        if (!Number.isFinite(v)) throw new Error(`${name} needs a number`);
        return v;
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const value = () => {
            if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
            return argv[++i];
        };
        switch (a) {
        case '-h': case '--help': args.help = true; break;
        case '-o': case '--out': args.out = value(); break;
        case '-s': case '--script': args.script = value(); break;
        case '--check': args.check = true; break;
        case '--script-only': args.scriptOnly = true; break;
        case '--png': args.png = value(); break;
        case '--png-scale': {
            const s = number(a, value());
            if (!(s >= 0.1 && s <= 1)) throw new Error('--png-scale must be from 0.1 to 1');
            args.pngScale = s;
            break;
        }
        case '--tolerance': args.options.tolerance = number(a, value()); break;
        case '--precision': args.options.precision = number(a, value()); break;
        case '--gradient-steps': args.options.gradientSteps = Math.max(1, Math.round(number(a, value()))); break;
        case '--max-edges': args.options.maxEdges = Math.max(10, Math.round(number(a, value()))); break;
        case '--title': args.options.title = value(); break;
        case '--axes': args.options.axes = true; break;
        case '--no-seams': args.options.seams = false; break;
        case '--timeout': {
            const s = number(a, value());
            if (!(s > 0)) throw new Error('--timeout must be a positive number of seconds');
            args.timeoutMs = s * 1000;
            break;
        }
        case '--html': args.html = value(); break;
        case '--json': args.json = true; break;
        default:
            if (a.startsWith('-')) throw new Error(`Unknown option ${a}`);
            if (args.input !== undefined) throw new Error(`Unexpected argument ${a}`);
            args.input = a;
        }
    }
    if (args.pngScale && !args.png) throw new Error('--png-scale needs --png');
    if (args.scriptOnly && (args.check || args.png)) throw new Error('--script-only runs no browser, so it cannot be combined with --check or --png');
    return args;
}

const write = (path, data) => {
    mkdirSync(dirname(resolve(path)), {recursive: true});
    writeFileSync(resolve(path), data);
};

async function main() {
    let args;
    try {
        args = parseArgs(process.argv.slice(2));
    } catch (error) {
        console.error(`${error.message}\n\n${USAGE}`);
        return 2;
    }
    if (args.help) { console.log(USAGE); return 0; }
    if (!args.input) { console.error(USAGE); return 2; }

    const svg = args.input === '-' ? readFileSync(0, 'utf8') : readFileSync(resolve(args.input), 'utf8');
    const stem = args.input === '-' ? 'drawing' : args.input.replace(/\.svgz?$/i, '');
    const out = args.out || `${stem}.txt`;
    let conversion;
    try {
        conversion = convertSvg(svg, args.options);
    } catch (error) {
        console.error(`Could not convert ${args.input}: ${error.message}`);
        return 2;
    }
    const scriptPath = args.script || (args.check && !args.scriptOnly ? null : out.replace(/\.txt$/i, '') + '.arch');
    if (scriptPath) write(scriptPath, conversion.script);
    const summary = formatConversion(conversion, {scriptPath});
    if (args.scriptOnly) {
        console.log(args.json ? JSON.stringify({stats: conversion.stats, warnings: conversion.warnings, info: conversion.info, script: scriptPath}, null, 2) : summary);
        return 0;
    }

    const engine = new ArchEngine(args.html ? {htmlPath: args.html} : {});
    try {
        const result = await engine.run(conversion.script, {screenshot: Boolean(args.png), screenshotScale: args.pngScale ?? 1, timeoutMs: args.timeoutMs});
        if (args.png && result.png) write(args.png, result.png);
        if (result.ok && !args.check) write(out, result.json);
        if (args.json) {
            const {png, scriptPng, json, objects, ...rest} = result;
            console.log(JSON.stringify({conversion: {stats: conversion.stats, warnings: conversion.warnings, info: conversion.info, script: scriptPath}, build: rest}, null, 2));
        } else {
            console.log(summary);
            console.log(formatReport(result, {written: args.check ? undefined : (result.ok ? out : null), screenshot: args.png && result.png ? args.png : undefined, brief: true}));
        }
        return result.ok ? 0 : 1;
    } finally {
        await engine.close();
    }
}

main().then(code => { process.exitCode = code; }, error => {
    console.error(error.code === 'ENOENT' ? `File not found: ${error.path}` : (error.stack || error.message));
    process.exitCode = 2;
});
