// Functions in this file are serialized by Playwright and executed inside the
// Arch page. They must be self-contained: no imports, no outer variables.

// Runs parsed script steps against the live Arch engine and exports the save file.
export async function runSteps({steps, title, script, messages = []}) {
    const e = window.archInstance;
    const api = new window.ArchAgentProtocol.AgentAPI(e);
    const lower = s => String(s).toLowerCase();
    const errors = [], warnings = [];
    const lineOf = new Map();         // entry -> script line
    const refs = new Map();           // lower(ref) -> actual reference (autoNumber or name)
    const playEntries = [];
    const textLines = [];             // script line of each text box, in creation order
    let last = null;

    const err = (line, message) => errors.push({line, message});
    const warn = (line, message) => warnings.push({line, message});
    // Arch 12202+ computes curves and geometry in a worker by default ("异步绘图"), out of reach
    // of the checks below (operator errors, objects without a value). Build with Arch's own
    // synchronous path instead; the file is still saved with the setting on, as Arch saves it.
    const asyncSaved = e.asyncDrawingEnabled;
    if (asyncSaved && typeof e.setAsyncDrawingEnabled === 'function') e.setAsyncDrawingEnabled(false);
    const builtinNames = new Set([
        ...(e.calcJSUtils.calc1 || []), ...(e.calcJSUtils.advancedCustomFunctionNames || []),
        ...Object.keys(e.calcJSUtils.constants || {}), ...e.geometryKeywords, 'root', 'intercept']);

    // Same as translateArchMessage in messages.js, which passes its table in as `messages`.
    const translate = message => {
        const text = String(message);
        for (const [zh, en] of messages) if (text.includes(zh)) return `${en} (${text})`;
        return text;
    };
    // Parameter names a parametric curve or surface declares for itself, e.g. u and v in
    // (cos(u),sin(u),v,u,0,1,v,0,1). They are local to that line, so refs never replace them.
    const localParameters = expr => {
        try {
            return new Set((e.parseParametricSpec?.(expr)?.parameters || []).filter(p => !p.global).map(p => lower(p.name)));
        } catch (_) {
            return new Set();
        }
    };
    const substituteRefs = (expr, keep = new Set()) => expr.replace(/(?<![\w.])[A-Za-z_][A-Za-z0-9_]*/g,
        token => refs.has(lower(token)) && !keep.has(lower(token)) ? refs.get(lower(token)) : token);
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
        // Since Arch 12201, t may name a variable or function; a curve's t is then a local parameter.
        if (d && !['x', 'y', 'z'].includes(lower(d[1]))) return d[1];
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

    const applyOptions = async (entry, line, {style = {}, slider = {}, fixed = false, frame}) => {
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
        if (frame !== undefined) {
            if (entry.type === 'text') throw new Error('frame= does not apply to // text entries (Arch shows them on every frame)');
            entry.displayFrame = frame;
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

    // Arch 12202+ computes geometry values in a worker after each change ("异步绘图").
    const idle = () => e._asyncDrawing?.waitForIdle ? e._asyncDrawing.waitForIdle() : Promise.resolve();

    const createStep = async step => {
        const {line} = step;
        const expr = step.text ? step.expr : substituteRefs(step.expr, localParameters(step.expr));
        const declared = step.text ? null : declaredName(expr);
        if (declared && refs.has(lower(declared)) && lower(refs.get(lower(declared))) !== lower(declared))
            return err(line, `"${declared}" is already used as a ref= label; pick a different object name`);
        const before = new Set(e.entries);
        // Names unknown before the line runs: Arch may auto-create variables for (parts of) them.
        const unknownBefore = step.text ? [] : unknownIdentifiers(expr);
        try {
            if (step.text) await guarded(() => api.execute({tool: 'objects.create', args: {expression: expr}}));
            // objects.create rolls back and throws with Arch's own error prompt text. It refuses
            // braces and expressions over 6000 characters, so ranges like x=cos(u),y=sin(u){u,0,pi}
            // and long generated expressions (svg2arch regions) go in the way Arch's input box adds them.
            else await refuseTextFallback(expr, () => /[{}]/.test(expr) || expr.length > 6000 ? rawCreate(expr)
                : guarded(() => api.execute({tool: 'objects.create', args: {expression: expr}})));
        } catch (error) {
            if (error.unreadable) return err(line, error.message);
            // Arch 12202+ refuses a name that is taken instead of renaming the new object.
            const holder = declared && e.entries.find(en => [en.name, en.key].some(n => n && lower(n) === lower(declared)));
            const taken = holder ? ` The name "${declared}" is already taken${holder.isAutoCreatedVariable ? ` by a variable that line ${lineOf.get(holder) ?? '?'} auto-created` : ''}; use a unique name (names are case-insensitive), or define variables before using them.` : '';
            return err(line, `Arch rejected "${expr}": ${translate(error.message)}${taken}`);
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
        else if (primary.type === 'geometry') {
            await idle();
            // Arch 12202+ reads an unknown name like "cc" as the product c*c and auto-creates c,
            // so the object gets a value; earlier builds left it without one.
            const madeVariables = new Set(created.filter(en => en.type === 'variable').map(en => lower(en.name || en.key || '')));
            const unknown = primary.isMeaningful === false ? unknownIdentifiers(expr) : unknownBefore.filter(n => !madeVariables.has(n));
            if (unknown.length)
                err(line, `unknown name(s) ${unknown.map(n => `"${n}"`).join(', ')}. Arch treated them as coordinate expressions${primary.isMeaningful === false ? ', so the object has no value' : ' (a product of single-letter variables)'}. Create the object or variable first, or fix the spelling.`);
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
            if (v.center) args.center = {x: v.center.x, y: v.center.y};
            if (v.unit) args.unit = v.unit;
            await api.execute({tool: 'view.set', args});
            if (v.center && v.center.z !== undefined) {
                // Arch's "z方向位移" (z shift, Arch 12201+): the 3D box centre's height, stored in screen units.
                if (!e.is3DMode) throw new Error('center=x,y,z is for 3d views; use center=x,y in 2d');
                if (typeof e.setZViewOffset !== 'function') throw new Error('this Arch version cannot move the 3D view along z; use center=x,y');
                const offset = v.center.z / e.scale3D;
                if (!e.setZViewOffset(offset, false) && (e.offset3D.z || 0) !== offset) {
                    e.offset3D.z = offset;
                    e.recalculate3D();
                }
            }
        }
    };

    const setStep = async step => {
        const list = step.settings.map(s => ['tmin', 'tmax', 'implicitPrecision'].includes(s.name) ? {...s, value: evalNumber(s.value, s.name)} : s);
        // Order tmin/tmax so the intermediate state always has tmin < tmax.
        const tmin = list.find(s => s.name === 'tmin'), tmax = list.find(s => s.name === 'tmax');
        if (tmin && tmax && tmin.value >= e.tmax) list.sort((a, b) => (a.name === 'tmax' ? -1 : 0) - (b.name === 'tmax' ? -1 : 0));
        for (const s of list) {
            if (s.name === 'orderedDrawing') {
                // Arch's "顺序绘图" (ordered drawing, Arch 12202+): every object is drawn in creation
                // order, inequality fills included. Saved in the file; the Agent API has no setting for it.
                if (typeof s.value !== 'boolean') throw new Error('orderedDrawing must be true or false');
                if (typeof e.setOrderedDrawingEnabled !== 'function') throw new Error('this Arch version has no ordered drawing (needs Arch 12202 or later)');
                e.setOrderedDrawingEnabled(s.value);
                continue;
            }
            await api.execute({tool: 'settings.set', args: {name: s.name, value: s.value}});
        }
    };

    // Like the Agent API's checkedMutation, for input it refuses (JS operators contain braces).
    const rawCreate = expr => guarded(async () => {
        const backup = e.saveSnapshot(), undo = e.undoStack.slice(), redo = e.redoStack.slice();
        const before = new Set(e.entries), problems = [];
        const original = e.showTopPrompt;
        e.showTopPrompt = function (message, isError, ...rest) {
            if (isError) problems.push(String(message));
            return original.call(this, message, isError, ...rest);
        };
        try { e.addEntry(expr); } catch (error) { problems.push(error.message); } finally { e.showTopPrompt = original; }
        const created = e.entries.filter(en => !before.has(en));
        problems.push(...created.map(en => en.compilationError).filter(Boolean));
        if (!created.length && !problems.length) problems.push('nothing was created');
        if (problems.length) {
            e.applySnapshot(backup);
            e.undoStack = undo; e.redoStack = redo;
            if (e.updateHistoryButtons) e.updateHistoryButtons();
            throw new Error(problems.join('; '));
        }
        return created;
    });

    // Since Arch 12201, input that Arch cannot read becomes a "//..." text note, with no error.
    // While fn runs, stop that and collect Arch's reasons, so the line fails with an explanation.
    const refuseTextFallback = async (expr, fn) => {
        const before = new Set(e.entries), reasons = [];
        let fellBack = false;
        const restores = [
            patch('addEntry', original => function (input, ...rest) {
                if (typeof input === 'string' && input.startsWith('//')) { fellBack = true; return undefined; }
                return original.call(this, input, ...rest);
            }),
            patch('parseInputInternal', original => function (...args) {
                try { return original.apply(this, args); } catch (error) { reasons.push(String(error?.message || error)); throw error; }
            }),
            patch('applySnapshot', original => function (...args) {
                for (const en of this.entries) if (!before.has(en) && en.compilationError) reasons.push(String(en.compilationError));
                return original.apply(this, args);
            })
        ];
        const unreadable = () => {
            const why = [...new Set(reasons)].map(translate).join('; ');
            return Object.assign(new Error(`Arch could not read "${expr}"${why ? `: ${why}` : '; check the syntax'}. (Arch's input box would have kept it as a // text note.)`), {unreadable: true});
        };
        let result;
        try {
            result = await fn();
        } catch (error) {
            throw fellBack ? unreadable() : error;
        } finally {
            restores.reverse().forEach(restore => restore());
        }
        // Arch has already restored its state, but the restore replaces every entry object, so
        // the Agent API may count the old objects as new and report success.
        if (fellBack) throw unreadable();
        return result;
    };
    // Replaces an ArchEngine method for a while; returns the function that puts it back.
    const patch = (name, wrap) => {
        const own = Object.prototype.hasOwnProperty.call(e, name), original = e[name];
        e[name] = wrap(original);
        return () => { if (own) e[name] = original; else delete e[name]; };
    };

    const operatorStep = async step => {
        const {line, name, params, body} = step;
        try { new Function(...params, body); } catch (error) {
            return err(line, `JavaScript syntax error in operator ${name}: ${error.message}`);
        }
        const key = lower(name);
        if (builtinNames.has(key) || ['x', 'y', 'z', 'e', 'pi'].includes(key))
            return err(line, `"${name}" is a built-in name; choose another operator name`);
        if (e.entries.some(en => [en.name, en.key].some(n => n && lower(n) === key)))
            return err(line, `name "${name}" is already taken (names are case-insensitive)`);
        let created;
        try { created = await rawCreate(`${name}(${params.join(',')})={${body}}`); } catch (error) {
            return err(line, `Arch rejected operator ${name}: ${translate(error.message)}`);
        }
        created.forEach(en => lineOf.set(en, line));
        if (!created.some(en => en.type === 'advanced_custom_function_definition'))
            return err(line, `Arch did not register ${name} as a JavaScript operator`);
        // Arch swallows exceptions thrown by operators (the value just becomes NaN), so count them
        // during the build; the engine reports them after drawing. The saved file keeps bodyJs only.
        const record = e.calcJSUtils.advancedCustomFunctions[key];
        if (record && typeof record.compiledFunc === 'function') {
            const inner = record.compiledFunc;
            const log = (window.__archOperatorErrors = window.__archOperatorErrors || {});
            record.compiledFunc = (...args) => {
                try {
                    return inner(...args);
                } catch (error) {
                    const item = log[name] || (log[name] = {line, message: String((error && error.message) || error), count: 0});
                    item.count++;
                    throw error;
                }
            };
        }
    };

    // Text boxes clip their content, so size them from the text unless width/height are given.
    const textStep = async step => {
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
        const content = (step.smart ? '<smart>' : '') + step.content;
        let shown = step.content;
        if (step.smart) {
            const now = e._processSmartTextLogic(content);
            if (/NaN/.test(now) && !/NaN/.test(step.content))
                warn(step.line, `smart text currently reads "${now}"; check the expressions inside {value(...)} / {if(...)}`);
            // Live values change length; size the box for a long number (Arch shows 6 significant digits).
            shown = e._processSmartTextLogic(content.replace(/\{value\((.*?)\)\}/g, '-0.000123456')).replace(/\/[rbi]/g, '');
        }
        const lines = shown.split('\\n');   // Arch breaks lines at a literal backslash-n
        const ctx = document.createElement('canvas').getContext('2d');
        ctx.font = "100px 'HarmonyOS_SC', Arial";
        const em = Math.max(...lines.map(l => ctx.measureText(l).width)) / 100;
        const size = step.size;
        const round = v => Math.round(v * 1000) / 1000;
        const width = step.width ?? round(em * size * (step.smart ? 1.15 : 1.08) + size * 0.4);
        const height = step.height ?? round(lines.length * size * 1.2 + size * 0.3);
        e.annotations.push({type: 'text', content, x: step.x, y: step.y, width, height, fontSize: size,
            color: {h: 0, s: 0, b: 0, a: 0, ...(step.color || {})}});
        textLines.push(step.line);
        e.annotationBatchesDirty = true;
        e.annotationLayerDirty = true;
        e.requestDraw();
    };

    const framesStep = async step => {
        const f = step.frames;
        api.extensions().settings.set('showPlaybackControls', true);
        if (f.total !== undefined) e.totalFrames = f.total;
        if (f.fps !== undefined) e.playbackFPS = f.fps;
        if (f.current !== undefined) e.currentFrame = f.current;
        if (f.bind !== undefined) {
            let v;
            try { v = e.evaluateExpressionWithCalcJS(f.bind, Object.fromEntries(e.variables || [])); } catch (error) {
                throw new Error(`bind expression "${f.bind}" could not be evaluated: ${error.message}`);
            }
            if (!Number.isFinite(v)) throw new Error(`bind expression "${f.bind}" evaluates to ${v}; define the variables it uses on earlier lines`);
            e.frameExpr = f.bind;
        }
        if (e.currentFrame > e.totalFrames) throw new Error(`current frame ${e.currentFrame} exceeds total ${e.totalFrames}`);
    };

    const runAll = async () => {
        for (const step of steps) {
            try {
                if (step.kind === 'create') await createStep(step);
                else if (step.kind === 'operator') await operatorStep(step);
                else if (step.kind === 'text') await textStep(step);
                else if (step.kind === 'frames') await framesStep(step);
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
    };

    // Drawing and the sidebar's entry list are paused while the steps run: Arch redraws every
    // inequality and re-renders every entry card after each change, which makes big svg2arch
    // pictures take minutes, and no check here depends on either. Both follow once (text boxes
    // get their size when drawn).
    e.draw = () => {};
    e.updateEntryList = () => {};
    try {
        await runAll();
    } finally {
        delete e.draw;
        delete e.updateEntryList;
    }
    try { e.updateEntryList(); } catch (error) { warn(0, `Arch failed to list the entries: ${error.message}`); }
    try { e.draw(); } catch (error) { warn(0, `Arch failed to draw the scene: ${error.message}`); }
    e.requestDraw();
    api.refresh();

    if (title) {
        e.filename = title;
        if (e.fileNameDisplay) e.fileNameDisplay.textContent = title;
    }

    // The global program is stored, not run: Arch only runs it when the user presses Run.
    if (script) {
        try {
            new Function('arch', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'addEventListener', `'use strict';\n${script.text}`);
        } catch (error) {
            err(script.line, `@script has a JavaScript syntax error: ${error.message}`);
        }
        e.globalScript = script.text;
        const input = document.getElementById('global-script-input');
        if (input) input.value = script.text;
    }

    // Final health check after every dependency exists.
    await idle();
    const describeRanges = entry => (entry.parametricParameters || []).filter(p => !p.global).map(p => {
        const value = text => {
            try { return Number(e.evaluateExpressionWithCalcJS(String(text), Object.fromEntries(e.variables || []))).toPrecision(6) * 1; } catch (_) { return NaN; }
        };
        return `${p.name} ${value(p.minExpr)}..${value(p.maxExpr)}`;
    }).join(', ');
    for (const entry of e.entries) {
        const line = lineOf.get(entry);
        const label = entry.name || entry.key || entry.autoNumber || entry.expr;
        if (entry.compilationError) warn(line, `${label}: ${entry.compilationError}`);
        if (entry.parameterRangeError)
            warn(line, `${label} is not drawn: ${translate(entry.parameterRangeError)}. Its parameter ranges currently evaluate to ${describeRanges(entry)}.`);
        if (entry.type === 'geometry' && entry.isMeaningful === false)
            warn(line, `${label} currently has no valid position/shape (no intersection, degenerate construction, parameter out of range, or outside the domain)`);
        if (entry.type === 'variable' && !Number.isFinite(entry.value))
            warn(line, `${label} evaluates to ${entry.value}`);
    }
    const framed = e.entries.filter(en => en.displayFrame > 0);
    if (framed.length && !e.showPlaybackControls)
        warn(lineOf.get(framed[0]), 'frame= has no effect until frame playback is enabled with an @frames line; until then every object is shown');
    for (const entry of framed.filter(en => e.showPlaybackControls && en.displayFrame > e.totalFrames))
        warn(lineOf.get(entry), `frame=${entry.displayFrame} is beyond @frames total=${e.totalFrames}, so it is never shown`);

    // Saved play state starts animations when the file is opened, but must not
    // advance values during the build, so it is applied only around the export.
    const previous = playEntries.map(en => en.playState);
    playEntries.forEach(en => { en.playState = 1; });
    let json;
    try {
        if (asyncSaved !== undefined) e.asyncDrawingEnabled = asyncSaved;
        json = JSON.stringify(e.exportStateObject(), (key, value) => key === 'compiledFunc' ? undefined : value);
    } finally {
        if (asyncSaved !== undefined) e.asyncDrawingEnabled = false;
        playEntries.forEach((en, i) => { en.playState = previous[i]; });
    }

    const objects = e.entries.map(entry => ({line: lineOf.get(entry), ...api.describe(entry),
        ...(entry.pointOnObject ? {min: entry.min, max: entry.max, step: entry.step} : {}),
        ...(entry.isEditableIndependent || entry.pointOnObject ? {playMode: entry.playMode, play: playEntries.includes(entry)} : {}),
        ...(entry.displayFrame > 0 ? {frame: entry.displayFrame} : {})}));
    const saved = JSON.parse(json);
    const texts = (saved.annotations || []).filter(a => a.type === 'text').map((a, i) => {
        const smart = a.content.startsWith('<smart>');
        return {line: textLines[i], content: smart ? a.content.slice(7) : a.content, smart, x: a.x, y: a.y,
            width: a.width, height: a.height, size: a.fontSize, ...(smart ? {shown: e._processSmartTextLogic(a.content)} : {})};
    });
    const frames = saved.showPlaybackControls
        ? {total: saved.totalFrames, fps: saved.playbackFPS, current: saved.currentFrame, ...(saved.frameExpr ? {bind: saved.frameExpr} : {})}
        : null;
    return {errors, warnings, objects, json, view: api.view(), refs: Object.fromEntries(refs), texts, frames,
        script: script ? {line: script.line, lines: script.text.split('\n').length} : null};
}

// Loads a save file into a fresh page and describes the result, to prove the file round-trips.
// Autoplay is paused in this copy so values (and the screenshot) show the saved starting state.
export async function loadAndDescribe(json) {
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
    try {
        e.loadState(json);
        // Arch 12202+ computes values in a worker after loading ("异步绘图"); wait until it is done.
        if (e._asyncDrawing?.waitForIdle) await e._asyncDrawing.waitForIdle();
    } finally { e.showTopPrompt = original; window.alert = originalAlert; }
    const again = JSON.stringify(e.exportStateObject(), (key, value) => key === 'compiledFunc' ? undefined : value);
    return {errors: [...prompts, ...alerts], objects: e.entries.map(entry => api.describe(entry)), json: again};
}

// Runs the saved global program (as the Run button does) in the throwaway verification page.
// Errors raised synchronously surface as error prompts; errors in timers surface as page errors.
export async function previewScript(ms) {
    const e = window.archInstance;
    const problems = [];
    const original = e.showTopPrompt;
    e.showTopPrompt = function (message, isError, ...rest) {
        if (isError) problems.push(String(message));
        return original.call(this, message, isError, ...rest);
    };
    try {
        e.executeGlobalScript();
        await new Promise(resolve => setTimeout(resolve, ms));
    } finally {
        e.showTopPrompt = original;
    }
    return {problems, objects: e.entries.length};
}

// Resolves once the page has painted a couple of frames.
export function settle(ms) {
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, ms))));
}
