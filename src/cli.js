#!/usr/bin/env node
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {ArchEngine} from './engine.js';
import {formatReport} from './report.js';
import {decompile} from './decompile.js';
import {readGuide} from './guide.js';

const USAGE = `Build Arch graphing-calculator save files from a scene script.

Usage:
  arch-build <scene.arch> [-o out.txt] [--png shot.png] [--no-verify]
  arch-build --check <scene.arch> [--png shot.png]
  arch-build --decompile <save.txt> [-o scene.arch]
  arch-build --guide              print the scene-script and Arch syntax guide

Options:
  -o, --out <path>   output file (default: scene.arch -> scene.txt)
  --png <path>       also save a screenshot of the result
  --no-verify        skip reloading the saved file to confirm it round-trips
  --html <path>      Arch index.html to use (default: ARCH_HTML or ./index.html)
  --json             print the full result as JSON

Use "-" as the script path to read from stdin. Exit code 1 means the script has errors.`;

function parseArgs(argv) {
    const args = {verify: true};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const value = () => {
            if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
            return argv[++i];
        };
        if (a === '-h' || a === '--help') args.help = true;
        else if (a === '--check') args.mode = 'check';
        else if (a === '--decompile') args.mode = 'decompile';
        else if (a === '--guide') args.mode = 'guide';
        else if (a === '-o' || a === '--out') args.out = value();
        else if (a === '--png') args.png = value();
        else if (a === '--html') args.html = value();
        else if (a === '--no-verify') args.verify = false;
        else if (a === '--json') args.json = true;
        else if (a.startsWith('-') && a !== '-') throw new Error(`Unknown option ${a}`);
        else if (args.input === undefined) args.input = a;
        else throw new Error(`Unexpected argument ${a}`);
    }
    return args;
}

const readInput = path => path === '-' ? readFileSync(0, 'utf8') : readFileSync(resolve(path), 'utf8');

async function main() {
    let args;
    try {
        args = parseArgs(process.argv.slice(2));
    } catch (error) {
        console.error(`${error.message}\n\n${USAGE}`);
        return 2;
    }
    if (args.help) { console.log(USAGE); return 0; }
    if (args.mode === 'guide') { process.stdout.write(readGuide()); return 0; }
    if (!args.input) { console.error(USAGE); return 2; }

    if (args.mode === 'decompile') {
        const {script, warnings} = decompile(readInput(args.input));
        for (const w of warnings) console.error(`warning: ${w}`);
        if (args.out) { writeFileSync(resolve(args.out), script); console.error(`wrote ${args.out}`); }
        else process.stdout.write(script);
        return 0;
    }

    const check = args.mode === 'check';
    let out;
    if (!check) {
        out = args.out || (args.input.endsWith('.arch') ? args.input.replace(/\.arch$/, '.txt') : null);
        if (!out) { console.error('Please give an output path with -o (scripts not ending in .arch have no default).'); return 2; }
    }

    const engine = new ArchEngine(args.html ? {htmlPath: args.html} : {});
    try {
        const result = await engine.run(readInput(args.input), {screenshot: Boolean(args.png), verify: args.verify});
        if (args.png && result.png) writeFileSync(resolve(args.png), result.png);
        if (result.ok && !check) writeFileSync(resolve(out), result.json);
        if (args.json) {
            const {png, json, ...rest} = result;
            console.log(JSON.stringify(rest, null, 2));
        } else {
            console.log(formatReport(result, {written: check ? undefined : (result.ok ? out : null), screenshot: args.png && result.png ? args.png : undefined}));
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
