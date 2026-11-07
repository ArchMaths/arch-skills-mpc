// Functions in this file are serialized by Playwright and executed inside the
// Arch page. They must be self-contained: no imports, no outer variables.

// Runs parsed script steps against the live Arch engine and exports the save file.
export async function runSteps({steps, title}) {
    const e = window.archInstance;
    const api = new window.ArchAgentProtocol.AgentAPI(e);
    const lower = s => String(s).toLowerCase();
    const errors = [], warnings = [];
    const lineOf = new Map();         // entry -> script line
    const refs = new Map();           // lower(ref) -> actual reference (autoNumber or name)
    const playEntries = [];
    let last = null;

    const err = (line, message) => errors.push({line, message});
    const warn = (line, message) => warnings.push({line, message});
    const builtinNames = new Set([
        ...(e.calcJSUtils.calc1 || []), ...(e.calcJSUtils.advancedCustomFunctionNames || []),
        ...Object.keys(e.calcJSUtils.constants || {}), ...e.geometryKeywords, 'root', 'intercept']);

    const translate = message => {
        const known = {
            '输入的表达式有误，请检查语法': 'syntax error in expression',
            '未创建新对象，请检查语法与重名情况': 'nothing was created; check syntax and duplicate names'
        };
        for (const [zh, en] of Object.entries(known)) if (message.includes(zh)) return `${en} (${message})`;
        return message;
    };
    const substituteRefs = expr => expr.replace(/(?<![\w.])[A-Za-z_][A-Za-z0-9_]*/g,
        token => refs.has(lower(token)) ? refs.get(lower(token)) : token);
    const topLevelArgs = inner => {
        const out = [];
        let depth = 0, cur = '';
        for (const ch of inner) {
            if ('([{'.includes(ch)) depth++;
            if (')]}'.includes(ch)) depth--;
            if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
        }
        out.push(cur.trim());
        return out;
    };
    const declaredName = expr => {
        const g = /^([A-Za-z]+)\s*\((.*)\)\s*$/s.exec(expr);
        if (g && e.geometryKeywords.has(lower(g[1]))) {
            const kw = lower(g[1]), args = topLevelArgs(g[2]);
            if ((kw === 'isparallel' || kw === 'isperpendicular') && args.length === 2) return null;
            if (kw === 'isconcyclic' && args.length === 4) return null;
            return /^[A-Za-z_]\w*$/.test(args[0]) ? args[0] : null;
        }
        const d = /^([A-Za-z_]\w*)\s*(\([^)]*\))?\s*=(?![=<>])/.exec(expr);
        if (d && !['x', 'y', 'z', 't'].includes(lower(d[1]))) return d[1];
        return null;
    };
    const evalNumber = (value, what) => {
        const n = Number(value);
        if (Number.isFinite(n)) return n;
        let v;
        try { v = e.evaluateExpressionWithCalcJS(String(value), Object.fromEntries(e.variables || [])); } catch (_) {}
        if (!Number.isFinite(v)) throw new Error(`${what} "${value}" is not a number or constant expression`);
        return v;
    };
    const refName = entry => entry.autoNumber || entry.name || entry.key;
    const resolveTarget = target => {
        if (lower(target) === 'last') {
            if (!last) throw new Error('"last" used before any object was created');
            return last;
        }
        const actual = refs.get(lower(target)) || target;
        const entry = e.entries.find(en => [en.autoNumber, en.name, en.key].some(n => n && lower(n) === lower(actual)));
        if (!entry) throw new Error(`no object named "${target}"`);
        return entry;
    };

    // Agent mutations that fail restore an undo snapshot, which replaces every entry
    // object (same order). Carry our per-entry bookkeeping over to the new objects.
    const guarded = async fn => {
        const order = e.entries.slice();
        try {
            return await fn();
        } finally {
            if (e.entries.length === order.length && e.entries.some((en, i) => en !== order[i])) {
                e.entries.forEach((en, i) => {
                    const old = order[i];
                    if (old === en) return;
                    if (lineOf.has(old)) lineOf.set(en, lineOf.get(old));
                    const p = playEntries.indexOf(old);
                    if (p >= 0) playEntries[p] = en;
                    if (last === old) last = en;
                });
            }
        }
    };
    const GEOMETRY_REF_FIELDS = ['onObjectName', 'p1Name', 'p2Name', 'p3Name', 'p4Name', 'vertexName', 'lineName', 'l1Name',
        'l2Name', 'pointName', 'obj1Name', 'obj2Name', 'centerName', 'pointOnCircleName', 'f1Name', 'f2Name', 'pName',
        'focusName', 'directrixName', 'rotatedPointName', 'axisName', 'reflectedPointName', 'vectorName',
        'translatedPointName', 'startPointName', 'endPointName', 'conicName'];
    const unknownReferences = entry => {
        if (entry.type !== 'geometry') return [];
        const names = GEOMETRY_REF_FIELDS.map(f => entry[f]).concat(Array.isArray(entry.pointNames) ? entry.pointNames : [])
            .filter(n => typeof n === 'string' && n);
        // These fields name geometry objects or plotted curves, never variables (names are case-insensitive).
        const known = n => ['o', 'xaxis', 'yaxis'].includes(lower(n)) || e.entries.some(en => en !== entry &&
            ((en.type === 'geometry' && en.name && lower(en.name) === lower(n)) || (en.autoNumber && lower(en.autoNumber) === lower(n))));
        return [...new Set(names.filter(n => !known(n)))];
    };
    // Names in an expression that match nothing Arch knows; used to explain invalid geometry.
    const unknownIdentifiers = expr => {
        const body = expr.replace(/^[A-Za-z]+\s*\(\s*[A-Za-z_]\w*\s*,?/, '');
        const known = n => ['x', 'y', 'z', 't', 'o', 'xaxis', 'yaxis'].includes(n) || builtinNames.has(n) ||
            Object.prototype.hasOwnProperty.call(e.calcJSUtils.customFunctions || {}, n) ||
            e.entries.some(en => [en.name, en.key, en.autoNumber].some(k => k && lower(k) === n));
        const ids = (body.match(/(?<![\w.])[A-Za-z_][A-Za-z0-9_]*/g) || []).map(lower);
        return [...new Set(ids.filter(n => !known(n)))];
    };

    const applyOptions = async (entry, line, {style = {}, slider = {}, fixed = false}) => {
        const {color, visible, thickness, dash, label} = style;
        if (color || visible !== undefined || thickness !== undefined) {
            if (color && !entry.color) throw new Error('this object has no color');
            const args = {target: api.id(entry)};
            if (color) args.color = color;
            if (visible !== undefined) args.visible = visible;
            if (thickness !== undefined) args.thickness = thickness;
            api.style(entry, args);
        }
        if (dash || label) {
            if (entry.type !== 'geometry') throw new Error('dash= and label= only apply to geometry objects (point, segment, circle, ...)');
            if (dash) entry.lineDash = dash;
            if (label) { entry.labelMode = label.mode; entry.labelText = label.text || ''; }
            entry.webglVertices = null;
        }
        if (fixed) {
            if (entry.type !== 'geometry' || entry.geometryType !== 'point') throw new Error('fixed only applies to point(...) objects');
            entry.dragEnabled = 0;
        }
        const hasSlider = ['min', 'max', 'step', 'mode', 'play'].some(k => slider[k] !== undefined);
        if (!hasSlider) return;
        const isVariable = entry.type === 'variable' && entry.isEditableIndependent;
        const isObjectPoint = entry.type === 'geometry' && entry.pointOnObject;
        if (!isVariable && !isObjectPoint)
            throw new Error('min/max/step/mode/play only apply to independent variables written as name=<number> (e.g. a=1) and to points on objects (point(P,c,0.25))');
        if (isObjectPoint) e.ensureObjectPointPlaybackDefaults(entry);
        const next = {min: entry.min, max: entry.max, step: entry.step};
        for (const k of ['min', 'max', 'step']) if (slider[k] !== undefined) next[k] = evalNumber(slider[k], k);
        if (!(next.min < next.max)) throw new Error(`slider needs min < max (got ${next.min}..${next.max})`);
        if (!(next.step > 0)) throw new Error('slider step must be > 0');
        const current = isVariable ? entry.value : entry.pointParamValue;
        if (Number.isFinite(current) && (current < next.min || current > next.max))
            warn(line, isVariable
                ? `value ${current} is outside ${next.min}..${next.max}; Arch clamps it to the range`
                : `point parameter ${current} is outside the slider range ${next.min}..${next.max}`);
        if (isVariable) {
            const args = {target: api.id(entry), ...next};
            if (slider.mode !== undefined) args.playMode = slider.mode;
            await guarded(() => api.execute({tool: 'variables.set', args}));
            if (slider.play) playEntries.push(entry);
            return;
        }
        Object.assign(entry, next);
        if (slider.mode !== undefined) entry.playMode = slider.mode;
        if (slider.play) playEntries.push(entry);
    };

    const createStep = async step => {
        const {line} = step;
        const expr = step.text ? step.expr : substituteRefs(step.expr);
        const declared = step.text ? null : declaredName(expr);
        if (declared && refs.has(lower(declared)) && lower(refs.get(lower(declared))) !== lower(declared))
            return err(line, `"${declared}" is already used as a ref= label; pick a different object name`);
        const before = new Set(e.entries);
        try {
            // objects.create rolls back and throws with Arch's own error prompt text.
            await guarded(() => api.execute({tool: 'objects.create', args: {expression: expr}}));
        } catch (error) {
            return err(line, `Arch rejected "${expr}": ${translate(error.message)}`);
        }
        const created = e.entries.filter(en => !before.has(en));
        const norm = s => String(s || '').replace(/\s+/g, '').toLowerCase();
        let primary = (declared && created.find(en => lower(en.name || en.key || '') === lower(declared)))
            || created.find(en => norm(en.expr) === norm(expr)) || created[created.length - 1];
        created.forEach(en => lineOf.set(en, line));
        last = primary;
        const missing = unknownReferences(primary);
        if (missing.length)
            err(line, `refers to ${missing.map(n => `"${n}"`).join(', ')}, which is not an existing geometry object or curve. Create referenced objects on earlier lines (check spelling; names are case-insensitive; curves are referenced by their ref= label or auto-number like func1).`);
        else if (primary.type === 'geometry' && primary.isMeaningful === false) {
            const unknown = unknownIdentifiers(expr);
            if (unknown.length)
                err(line, `unknown name(s) ${unknown.map(n => `"${n}"`).join(', ')}. Arch treated them as coordinate expressions, so the object has no value. Create the object or variable first, or fix the spelling.`);
        }
        if (declared && (primary.name || primary.key) && ['variable', 'custom_function_definition', 'geometry'].includes(primary.type)) {
            const actual = primary.name || primary.key;
            if (lower(actual) !== lower(declared))
                err(line, `name "${declared}" is already taken, so Arch renamed this object to "${actual}". Use a unique name (names are case-insensitive; a variable may have been auto-created by an earlier line, so define variables before using them).`);
        }
        for (const extra of created.filter(en => en !== primary)) {
            if (extra.type === 'variable')
                warn(line, `also auto-created variable ${extra.name || extra.key}=${extra.value} (range ${extra.min}..${extra.max}). If unintended, check for a typo; otherwise define it explicitly on an earlier line.`);
            else warn(line, `Arch also created ${extra.name ? `"${extra.name}" ` : ''}(${extra.expr})${extra.name ? '; that name is now taken' : ''}`);
        }
        if (step.ref) {
            const actual = refName(primary);
            const key = lower(step.ref);
            if (!actual) err(line, 'ref= used on an object that has no referable name');
            else if (builtinNames.has(key)) err(line, `ref "${step.ref}" clashes with a built-in function or command`);
            else if (refs.has(key)) err(line, `ref "${step.ref}" is already defined`);
            else if (lower(actual) !== key && e.entries.some(en => en !== primary && [en.name, en.key, en.autoNumber].some(n => n && lower(n) === key) && !/^(func|eq|para|plist)\d+$/.test(key)))
                err(line, `ref "${step.ref}" clashes with an existing object name`);
            else refs.set(key, actual);
        }
        try { await applyOptions(primary, line, step); } catch (error) { err(line, error.message); }
    };

    const viewStep = async step => {
        const v = step.view;
        if (v.dimension) await api.execute({tool: 'view.set', args: {dimension: v.dimension}});
        if (v.azimuth !== undefined || v.elevation !== undefined) {
            const args = {};
            if (v.azimuth !== undefined) args.azimuth = v.azimuth;
            if (v.elevation !== undefined) args.elevation = v.elevation;
            await api.execute({tool: 'view.camera', args});
        }
        if (v.xrange || v.yrange) {
            if (e.is3DMode) throw new Error('x=/y= ranges are only for 2d views');
            const rect = e.canvasContainer.getBoundingClientRect();
            const c = e.getViewportCenter2D();
            const visW = 2 * Math.min(c.x, rect.width - c.x), visH = 2 * Math.min(c.y, rect.height - c.y);
            const cur = e.getViewportCenterMath2D();
            const units = [];
            const center = {...cur};
            if (v.xrange) { units.push(visW / (v.xrange[1] - v.xrange[0])); center.x = (v.xrange[0] + v.xrange[1]) / 2; }
            if (v.yrange) { units.push(visH / (v.yrange[1] - v.yrange[0])); center.y = (v.yrange[0] + v.yrange[1]) / 2; }
            await api.execute({tool: 'view.set', args: {center, unit: Math.min(...units)}});
        } else if (v.center || v.unit) {
            const args = {};
            if (v.center) args.center = v.center;
            if (v.unit) args.unit = v.unit;
            await api.execute({tool: 'view.set', args});
        }
    };

    const setStep = async step => {
        const list = step.settings.map(s => ['tmin', 'tmax'].includes(s.name) ? {...s, value: evalNumber(s.value, s.name)} : s);
        // Order tmin/tmax so the intermediate state always has tmin < tmax.
        const tmin = list.find(s => s.name === 'tmin'), tmax = list.find(s => s.name === 'tmax');
        if (tmin && tmax && tmin.value >= e.tmax) list.sort((a, b) => (a.name === 'tmax' ? -1 : 0) - (b.name === 'tmax' ? -1 : 0));
        for (const s of list) await api.execute({tool: 'settings.set', args: {name: s.name, value: s.value}});
    };

    for (const step of steps) {
        try {
            if (step.kind === 'create') await createStep(step);
            else if (step.kind === 'view') await viewStep(step);
            else if (step.kind === 'set') await setStep(step);
            else if (step.kind === 'style') {
                const entry = resolveTarget(step.target);
                await applyOptions(entry, step.line, step);
            }
        } catch (error) {
            err(step.line, translate(error.message));
        }
    }
    api.refresh();

    if (title) {
        e.filename = title;
        if (e.fileNameDisplay) e.fileNameDisplay.textContent = title;
    }

    // Final health check after every dependency exists.
    for (const entry of e.entries) {
        const line = lineOf.get(entry);
        const label = entry.name || entry.key || entry.autoNumber || entry.expr;
        if (entry.compilationError) warn(line, `${label}: ${entry.compilationError}`);
        if (entry.type === 'geometry' && entry.isMeaningful === false)
            warn(line, `${label} currently has no valid position/shape (no intersection, degenerate construction, parameter out of range, or outside the domain)`);
        if (entry.type === 'variable' && !Number.isFinite(entry.value))
            warn(line, `${label} evaluates to ${entry.value}`);
    }

    // Saved play state starts animations when the file is opened, but must not
    // advance values during the build, so it is applied only around the export.
    const previous = playEntries.map(en => en.playState);
    playEntries.forEach(en => { en.playState = 1; });
    let json;
    try {
        json = JSON.stringify(e.exportStateObject(), (key, value) => key === 'compiledFunc' ? undefined : value);
    } finally {
        playEntries.forEach((en, i) => { en.playState = previous[i]; });
    }

    const objects = e.entries.map(entry => ({line: lineOf.get(entry), ...api.describe(entry),
        ...(entry.pointOnObject ? {min: entry.min, max: entry.max, step: entry.step} : {}),
        ...(entry.isEditableIndependent || entry.pointOnObject ? {playMode: entry.playMode, play: playEntries.includes(entry)} : {})}));
    return {errors, warnings, objects, json, view: api.view(), refs: Object.fromEntries(refs)};
}

// Loads a save file into a fresh page and describes the result, to prove the file round-trips.
// Autoplay is paused in this copy so values (and the screenshot) show the saved starting state.
export function loadAndDescribe(json) {
    const state = JSON.parse(json);
    for (const entry of state.entries || []) if (entry && entry.playState === 1) entry.playState = 0;
    json = JSON.stringify(state);
    const e = window.archInstance;
    const api = new window.ArchAgentProtocol.AgentAPI(e);
    const original = e.showTopPrompt, prompts = [];
    e.showTopPrompt = function (message, isError, ...rest) {
        if (isError) prompts.push(String(message));
        return original.call(this, message, isError, ...rest);
    };
    const alerts = [];
    const originalAlert = window.alert;
    window.alert = message => alerts.push(String(message));
    try { e.loadState(json); } finally { e.showTopPrompt = original; window.alert = originalAlert; }
    return {errors: [...prompts, ...alerts], objects: e.entries.map(entry => api.describe(entry))};
}

// Resolves once the page has painted a couple of frames.
export function settle(ms) {
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, ms))));
}
