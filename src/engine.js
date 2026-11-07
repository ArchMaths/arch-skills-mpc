import {existsSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';
import {parseScript, ScriptError} from './script.js';
import {runSteps, loadAndDescribe, settle} from './page-runner.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_HTML = process.env.ARCH_HTML ? resolve(process.env.ARCH_HTML) : resolve(ROOT, 'index.html');
const VIEWPORT = {width: 1280, height: 800};
const READY_TIMEOUT = 45000;

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

export class ArchEngine {
    constructor({htmlPath = DEFAULT_HTML, keepWarm = false, log = () => {}} = {}) {
        this.htmlPath = resolve(htmlPath);
        this.keepWarm = keepWarm;
        this.log = log;
        this._browser = null;
        this._spares = [];    // preloaded pages (promises); a run uses one to build and one to verify
    }

    async browser() {
        if (!this._browser) {
            this._browser = launchBrowser();
            this._browser.catch(() => { this._browser = null; });
        }
        return this._browser;
    }

    async _loadPage() {
        if (!existsSync(this.htmlPath))
            throw new Error(`Arch index.html not found at ${this.htmlPath}. Set ARCH_HTML or pass --html.`);
        const browser = await this.browser();
        const context = await browser.newContext({viewport: VIEWPORT, colorScheme: 'light', deviceScaleFactor: 1});
        const page = await context.newPage();
        const pageErrors = [];
        // Offline: only the local file and inline data may load. No login, cloud, AI or notice requests.
        await page.route('**/*', route => {
            const url = route.request().url();
            if (/^(file|data|blob):/.test(url)) return route.continue();
            return route.abort();
        });
        page.on('pageerror', error => pageErrors.push(String(error.message || error)));
        page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
        await page.goto(pathToFileURL(this.htmlPath).href);
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

    // Runs a scene script. Returns {ok, errors, warnings, objects, view, json, png}.
    // ok is false when any line failed or the saved file does not reload identically.
    async run(source, {screenshot = true, verify = true} = {}) {
        let parsed;
        try {
            parsed = parseScript(source);
        } catch (error) {
            if (error instanceof ScriptError)
                return {ok: false, errors: [{line: error.line, message: error.message}], warnings: [], objects: []};
            throw error;
        }
        if (!parsed.steps.some(s => s.kind === 'create'))
            return {ok: false, errors: [{line: 0, message: 'The script creates no objects.'}], warnings: [], objects: []};

        // The verification page loads in parallel with the build, so verifying costs little extra time.
        const buildSlot = this.acquire();
        const verifySlot = verify ? this.acquire() : null;
        verifySlot?.catch(() => {});
        const slot = await buildSlot;
        let result, png;
        const shoot = async page => {
            await page.evaluate(settle, 500);
            return page.screenshot({type: 'png'});
        };
        try {
            result = await slot.page.evaluate(runSteps, {steps: parsed.steps, title: parsed.title});
            for (const message of slot.pageErrors)
                result.warnings.push({message: `Arch raised a JavaScript error: ${message}`});
            if (screenshot && !(verify && result.errors.length === 0)) png = await shoot(slot.page);
        } finally {
            await slot.context.close();
        }

        if (verifySlot && result.errors.length === 0) {
            // Reload the exported file exactly as a user would open it; the screenshot shows that view.
            const check = await verifySlot;
            try {
                const reloaded = await check.page.evaluate(loadAndDescribe, result.json);
                for (const message of reloaded.errors) result.errors.push({message: `Reloading the saved file failed: ${message}`});
                result.errors.push(...compareReload(result.objects, reloaded.objects));
                if (screenshot) png = await shoot(check.page);
            } finally {
                await check.context.close();
            }
        } else if (verifySlot) {
            verifySlot.then(s => s.context.close(), () => {});
        }
        result.errors.sort((a, b) => (a.line ?? 1e9) - (b.line ?? 1e9));
        result.warnings.sort((a, b) => (a.line ?? 1e9) - (b.line ?? 1e9));
        return {ok: result.errors.length === 0, ...result, png};
    }
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
