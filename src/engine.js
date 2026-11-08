import {existsSync, readFileSync, statSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {parseScript, ScriptError} from './script.js';
import {runSteps, loadAndDescribe, previewScript, settle} from './page-runner.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_HTML = process.env.ARCH_HTML ? resolve(process.env.ARCH_HTML) : resolve(ROOT, 'index.html');
const VIEWPORT = {width: 1280, height: 800};
const READY_TIMEOUT = 45000;
export const RUN_TIMEOUT = 30000;
export const PREVIEW_MS = 2000;
// Arch is served from a made-up HTTPS origin answered by Playwright itself. Unlike file://,
// the page cannot read local files, and every other request is aborted, so JavaScript in
// operators or @script runs isolated from both the disk and the network.
const PAGE_URL = 'https://arch.invalid/index.html';
// Arch's own server calls fail because the network is blocked on purpose; that is not a script problem.
const BLOCKED_NETWORK = /Failed to fetch|NetworkError|net::ERR_/;
// Code Arch compiles from operators and @script (createSandboxedFunction = new Function) shows up
// in stack traces with this frame; everything else is Arch's own code.
const USER_CODE_FRAME = /eval at createSandboxedFunction/;

// Uncaught errors on the build page, deduplicated (drawing errors repeat every frame).
function pageErrorWarnings(pageErrors) {
    const seen = new Set();
    const out = [];
    for (const {message, stack} of pageErrors) {
        if (BLOCKED_NETWORK.test(message)) continue;
        if (USER_CODE_FRAME.test(stack)) {
            if (!seen.has('op:' + message)) out.push({message: `JavaScript operator code raised an uncaught error: ${message}`});
            seen.add('op:' + message);
            continue;
        }
        const where = /\n\s+at (?:ArchEngine\.)?([A-Za-z_$][\w$]*) \(https:\/\/arch\.invalid/.exec(stack)?.[1];
        const key = `${where}:${message}`;
        if (seen.has(key)) continue;
        seen.add(key);
        let hint = '';
        if (where === 'drawMeasurements' && /toLowerCase/.test(message))
            hint = ' Known Arch bug: length(...) and angle(...) labels are not drawn when a measured point is created after any curve, equation or point list, or is the built-in O. Create the measured points first, and use point(O,0,0) instead of the built-in origin.';
        out.push({message: `Arch hit an internal error${where ? ` in ${where}` : ''}: ${message}. This is a bug inside Arch, not in the script; the file is still valid but part of the display may be missing.${hint}`});
    }
    return out;
}

// Browser choice: ARCH_BROWSER_PATH, then ARCH_BROWSER_CHANNEL, then Playwright's
// own Chromium, then installed Chrome / Edge.
async function launchBrowser() {
    const attempts = [];
    if (process.env.ARCH_BROWSER_PATH) attempts.push({executablePath: process.env.ARCH_BROWSER_PATH});
    if (process.env.ARCH_BROWSER_CHANNEL) attempts.push({channel: process.env.ARCH_BROWSER_CHANNEL});
    attempts.push({}, {channel: 'chrome'}, {channel: 'msedge'});
    const failures = [];
    for (const options of attempts) {
        try {
            return await chromium.launch({headless: true, ...options});
        } catch (error) {
            failures.push(`${JSON.stringify(options)}: ${String(error.message).split('\n')[0]}`);
        }
    }
    throw new Error('Could not start a Chromium browser. Install Google Chrome, or run "npx playwright-core install chromium", ' +
        'or set ARCH_BROWSER_PATH to a Chrome/Chromium executable.\n' + failures.join('\n'));
}

class RunTimeout extends Error {}

// Page code can loop forever (a bad operator or script); give up and let the caller close the page.
function guard(promise, ms, what) {
    promise.catch(() => {});
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new RunTimeout(
            `${what} did not finish within ${ms / 1000} s; a JavaScript operator or @script may loop forever.`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export class ArchEngine {
    constructor({htmlPath = DEFAULT_HTML, keepWarm = false, log = () => {}} = {}) {
        this.htmlPath = resolve(htmlPath);
        this.keepWarm = keepWarm;
        this.log = log;
        this._browser = null;
        this._html = null;
        this._spares = [];    // preloaded pages (promises); a run uses one to build and one to verify
    }

    async browser() {
        if (!this._browser) {
            this._browser = launchBrowser();
            this._browser.catch(() => { this._browser = null; });
        }
        return this._browser;
    }

    _htmlBody() {
        if (!existsSync(this.htmlPath))
            throw new Error(`Arch index.html not found at ${this.htmlPath}. Set ARCH_HTML or pass --html.`);
        const mtime = statSync(this.htmlPath).mtimeMs;
        if (!this._html || this._html.mtime !== mtime) this._html = {mtime, body: readFileSync(this.htmlPath)};
        return this._html.body;
    }

    async _loadPage() {
        const body = this._htmlBody();
        const browser = await this.browser();
        const context = await browser.newContext({viewport: VIEWPORT, colorScheme: 'light', deviceScaleFactor: 1});
        // Offline: Arch itself is the only response. No login, cloud, AI or notice requests.
        await context.route('**/*', route => {
            if (route.request().url() === PAGE_URL)
                return route.fulfill({status: 200, contentType: 'text/html; charset=utf-8', body});
            return route.abort();
        });
        const page = await context.newPage();
        const pageErrors = [];
        page.on('pageerror', error => pageErrors.push({message: String(error.message || error), stack: String(error.stack || '')}));
        page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
        await page.goto(PAGE_URL);
        await page.waitForFunction(() => window.archInstance && window.ArchAgentProtocol &&
            (window.archStartupFinished || !document.getElementById('arch-startup-splash')), null, {timeout: READY_TIMEOUT});
        // A first launch (empty storage) opens the About page over the canvas; use the normal plot layout.
        await page.evaluate(() => window.archInstance.createArchScriptExtensions().ui.sidebar('plot'));
        return {page, context, pageErrors};
    }

    // Each run gets pristine pages so builds never leak state into each other.
    // Returns a promise; with keepWarm the next pages start loading immediately.
    acquire() {
        const spare = this._spares.shift();
        if (this.keepWarm) this._topUp();
        if (!spare) return this._loadPage();
        return spare.catch(() => this._loadPage());
    }

    _topUp() {
        while (this._spares.length < 2) {
            const slot = this._loadPage();
            slot.catch(() => {});
            this._spares.push(slot);
        }
    }

    async close() {
        const spares = this._spares;
        this._spares = [];
        await Promise.all(spares.map(spare => spare.then(s => s.context.close(), () => {})));
        if (this._browser) {
            const browser = await this._browser.catch(() => null);
            this._browser = null;
            if (browser) await browser.close();
        }
    }

    // Runs a scene script. Returns {ok, errors, warnings, objects, view, json, png, scriptPng, ...}.
    // ok is false when any line failed, the saved file does not reload identically, or the
    // @script preview raised an error.
    async run(source, {screenshot = true, verify = true, scriptPreview = true, timeoutMs = RUN_TIMEOUT} = {}) {
        let parsed;
        try {
            parsed = parseScript(source);
        } catch (error) {
            if (error instanceof ScriptError)
                return {ok: false, errors: [{line: error.line, message: error.message}], warnings: [], objects: []};
            throw error;
        }
        if (!parsed.steps.some(s => ['create', 'operator', 'text'].includes(s.kind)) && !parsed.script)
            return {ok: false, errors: [{line: 0, message: 'The script creates nothing.'}], warnings: [], objects: []};

        // The verification page loads in parallel with the build, so verifying costs little extra time.
        const buildSlot = this.acquire();
        const verifySlot = verify ? this.acquire() : null;
        verifySlot?.catch(() => {});
        const dropVerify = () => verifySlot?.then(s => s.context.close(), () => {});
        const slot = await buildSlot;
        let result, png, scriptPng;
        // Drawing happens after the build call returns, so waiting for painted frames doubles as a
        // check that no operator hangs the page.
        const shoot = async (page, what) => {
            await guard(page.evaluate(settle, 500), timeoutMs, what);
            return page.screenshot({type: 'png'});
        };
        try {
            result = await guard(slot.page.evaluate(runSteps, {steps: parsed.steps, title: parsed.title, script: parsed.script}),
                timeoutMs, 'Building the scene');
            if (screenshot && !(verifySlot && result.errors.length === 0)) png = await shoot(slot.page, 'Drawing the scene');
            else await guard(slot.page.evaluate(settle, 100), timeoutMs, 'Drawing the scene');
            const thrown = await slot.page.evaluate(() => window.__archOperatorErrors || {});
            for (const [name, item] of Object.entries(thrown))
                result.warnings.push({line: item.line, message: `operator ${name} threw "${item.message}" ${item.count} time(s) while Arch computed values; those values become NaN (gaps in curves)`});
            result.warnings.push(...pageErrorWarnings(slot.pageErrors));
        } catch (error) {
            dropVerify();
            if (error instanceof RunTimeout) return {ok: false, errors: [blameOperators(error, parsed)], warnings: [], objects: []};
            throw error;
        } finally {
            await slot.context.close().catch(() => {});
        }

        if (verifySlot && result.errors.length === 0) {
            // Reload the exported file exactly as a user would open it; the screenshot shows that view.
            const check = await verifySlot;
            try {
                const reloaded = await guard(check.page.evaluate(loadAndDescribe, result.json), timeoutMs, 'Reloading the saved file');
                for (const message of reloaded.errors) result.errors.push({message: `Reloading the saved file failed: ${message}`});
                result.errors.push(...compareReload(result.objects, reloaded.objects));
                result.errors.push(...compareSaved(JSON.parse(result.json), JSON.parse(reloaded.json)));
                if (screenshot) png = await shoot(check.page, 'Drawing the reloaded file');
                else await guard(check.page.evaluate(settle, 100), timeoutMs, 'Drawing the reloaded file');
                if (parsed.script && scriptPreview && result.errors.length === 0) {
                    // Run the global program the way the Run button does, in this throwaway page.
                    const before = check.pageErrors.length;
                    const preview = await guard(check.page.evaluate(previewScript, PREVIEW_MS), timeoutMs, 'The @script preview');
                    if (screenshot) scriptPng = await guard(check.page.screenshot({type: 'png'}), timeoutMs, 'The @script preview');
                    // Count page errors only when the stack passes through the script, which Arch compiles
                    // with new Function (shown as <anonymous>/eval). Arch's own blocked network calls are ignored.
                    const fromScript = check.pageErrors.slice(before).filter(e => USER_CODE_FRAME.test(e.stack));
                    const problems = [...preview.problems, ...fromScript.map(e => e.message)];
                    result.scriptPreview = {seconds: PREVIEW_MS / 1000, problems};
                    for (const problem of problems)
                        result.errors.push({line: parsed.script.line, message: `@script failed when run: ${problem}`});
                }
            } catch (error) {
                if (!(error instanceof RunTimeout)) throw error;
                result.errors.push(/preview/.test(error.message) ? {line: parsed.script.line, message: error.message} : blameOperators(error, parsed));
            } finally {
                await check.context.close().catch(() => {});
            }
        } else {
            dropVerify();
        }
        result.errors.sort((a, b) => (a.line ?? 1e9) - (b.line ?? 1e9));
        result.warnings.sort((a, b) => (a.line ?? 1e9) - (b.line ?? 1e9));
        return {ok: result.errors.length === 0, ...result, png, scriptPng};
    }
}

// A hang while drawing can only come from operator code; point at it.
function blameOperators(error, parsed) {
    const ops = parsed.steps.filter(s => s.kind === 'operator');
    if (!ops.length) return {line: 0, message: error.message};
    return {line: ops.length === 1 ? ops[0].line : 0,
        message: `${error.message} Operators in this script: ${ops.map(o => `${o.name} (line ${o.line})`).join(', ')}.`};
}

function compareReload(built, reloaded) {
    const problems = [];
    if (built.length !== reloaded.length) {
        problems.push({message: `Saved file reloads with ${reloaded.length} objects instead of ${built.length}.`});
        return problems;
    }
    const close = (a, b) => (a === b) || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a)))
        || (Number.isNaN(a) && Number.isNaN(b)) || (a == null && b == null);
    built.forEach((b, i) => {
        const r = reloaded[i];
        const diffs = [];
        if (b.expression !== r.expression) diffs.push(`expression "${b.expression}" → "${r.expression}"`);
        if ((b.details || '') !== (r.details || '')) diffs.push(`value "${b.details}" → "${r.details}"`);
        if (!close(b.value, r.value)) diffs.push(`value ${b.value} → ${r.value}`);
        if (b.meaningful !== r.meaningful) diffs.push(`valid ${b.meaningful} → ${r.meaningful}`);
        if (diffs.length) problems.push({line: b.line, message: `Saved file reloads differently: ${diffs.join('; ')}`});
    });
    return problems;
}

// Document-level parts the object list does not cover: frames, text boxes, operators, the script.
function compareSaved(a, b) {
    // A fresh page leaves some fields undefined that a reload restores as "" (e.g. frameExpr).
    const norm = v => (v === undefined || v === null || v === '') ? null : v;
    const same = (x, y) => JSON.stringify(norm(x)) === JSON.stringify(norm(y));
    const diffs = [];
    if ((a.globalScript || '') !== (b.globalScript || '')) diffs.push('the global script');
    for (const key of ['showPlaybackControls', 'totalFrames', 'playbackFPS', 'currentFrame', 'frameExpr'])
        if (!same(a[key], b[key])) diffs.push(`${key} ${JSON.stringify(a[key])} → ${JSON.stringify(b[key])}`);
    const texts = state => (state.annotations || []).filter(t => t.type === 'text')
        .map(t => [t.content, t.x, t.y, t.width, t.height, t.fontSize, t.color]);
    if (!same(texts(a), texts(b))) diffs.push('text boxes');
    (a.entries || []).forEach((entry, i) => {
        const other = (b.entries || [])[i] || {};
        for (const key of ['displayFrame', 'bodyJs', 'params'])
            if (!same(entry[key], other[key])) diffs.push(`${entry.expr}: ${key}`);
    });
    return diffs.map(d => ({message: `Saved file reloads differently: ${d}`}));
}
