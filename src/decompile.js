// Converts an Arch save file (JSON) back into a scene script, so an AI can edit
// files that people made by hand. Pure JSON transform: no browser needed.
import {PLAY_MODES} from './script.js';

const MODE_NAMES = Object.fromEntries(Object.entries(PLAY_MODES).filter(([k]) =>
    ['pingpong', 'forward', 'reverse', 'once', 'once-reverse'].includes(k)).map(([k, v]) => [v, k]));

const num = n => String(n);  // shortest exact representation, so decompiled values round-trip

function colorOptions(color) {
    if (!color || typeof color !== 'object') return [];
    const out = [`color=hsb(${num(color.h ?? 0)},${num(color.s ?? 0)},${num(color.b ?? 0)})`];
    if (color.a) out.push(`opacity=${num((100 - color.a) / 100)}`);
    return out;
}

function sliderOptions(entry) {
    const out = [];
    if (Number.isFinite(entry.min)) out.push(`min=${num(entry.min)}`);
    if (Number.isFinite(entry.max)) out.push(`max=${num(entry.max)}`);
    if (Number.isFinite(entry.step)) out.push(`step=${num(entry.step)}`);
    if (Number.isInteger(entry.playMode) && entry.playMode !== 0) out.push(`mode=${MODE_NAMES[entry.playMode]}`);
    if (entry.playState === 1) out.push('play');
    return out;
}

export function decompile(saveText) {
    let state;
    try {
        state = typeof saveText === 'string' ? JSON.parse(saveText) : saveText;
    } catch (error) {
        throw new Error(`Not an Arch save file (invalid JSON): ${error.message}`);
    }
    if (!state || !Array.isArray(state.entries)) throw new Error('Not an Arch save file: missing "entries".');

    const lines = [];
    const warnings = [];
    if (state.name) lines.push(`@title ${state.name}`);
    lines.push(`# Decompiled from an Arch save file (version ${state.version ?? 'unknown'}).`, '');

    const operator = (name, params, body) => {
        const text = String(body ?? '').replace(/\r\n?/g, '\n');
        if (text.split('\n').some(l => l.trim().toLowerCase() === '@end'))
            warnings.push(`Operator "${name}" contains a line reading "@end", which would end the block early; edit it before rebuilding.`);
        lines.push(`@operator ${name}(${(params || []).join(', ')})`, ...text.replace(/^\n+|\s+$/g, '').split('\n'), '@end');
    };
    // Operators loaded from a JS file live in a global list rather than as entries.
    const entryNames = new Set(state.entries.filter(e => e && e.type === 'advanced_custom_function_definition').map(e => String(e.name).toLowerCase()));
    for (const def of Array.isArray(state.customAdvancedFunctions) ? state.customAdvancedFunctions : [])
        if (def && def.name && !entryNames.has(String(def.name).toLowerCase())) operator(def.name, def.params, def.bodyJsString);

    for (const entry of state.entries) {
        if (!entry || typeof entry !== 'object') continue;
        if (entry.type === 'advanced_custom_function_definition') {
            operator(entry.name, entry.params, entry.bodyJs);
            continue;
        }
        if (entry.type === 'text') {
            const content = entry.content ?? String(entry.expr || '').replace(/^\/\//, '');
            if (/^data:image/i.test(content)) {
                warnings.push('Skipped an image text entry (embedded image data).');
                continue;
            }
            lines.push(`//${content.replace(/\r?\n/g, ' ')}`);
            const c = entry.color;
            if (c && !(c.h === 0 && c.s === 0 && c.b === 60 && !c.a)) lines.push(`@style last | ${colorOptions(c).join(' ')}`);
            continue;
        }
        const expr = String(entry.originalExprWithPoints || entry.expr || '').trim();
        if (!expr) continue;
        const options = [];
        if (entry.autoNumber) options.push(`ref=${entry.autoNumber}`);
        const c = entry.color;
        const defaultGeometryColor = entry.type === 'geometry' && c && !c.h && !c.s && !c.b && !c.a;
        if (entry.type !== 'variable' && entry.type !== 'constant' && entry.type !== 'custom_function_definition') {
            if (!defaultGeometryColor) options.push(...colorOptions(entry.color));
            if (Number.isFinite(entry.thickness) && entry.thickness !== 3) options.push(`thickness=${num(entry.thickness)}`);
            if (entry.visible === false) options.push('hidden');
        }
        if (entry.type === 'geometry') {
            if (entry.lineDash && entry.lineDash !== 'solid') options.push(`dash=${entry.lineDash}`);
            if (entry.labelMode === 'none') options.push('label=none');
            if (entry.labelMode === 'label' && entry.labelText) options.push(`label="${String(entry.labelText).replace(/"/g, "'")}"`);
            if (entry.geometryType === 'point' && entry.dragEnabled === 0) options.push('fixed');
            if (entry.pointOnObject && !entry.autoPolyeqVertex) options.push(...sliderOptions(entry));
        }
        if (entry.autoPolyeqVertex && entry.name) {
            // polyeq(...) recreates its vertex points; only re-apply their styling.
            if (entry.playState === 1) options.push('play');
            if (options.length) lines.push(`@style ${entry.name} | ${options.join(' ')}`);
            continue;
        }
        if (entry.type === 'variable' && entry.isEditableIndependent) options.push(...sliderOptions(entry));
        if (Number.isInteger(entry.displayFrame) && entry.displayFrame > 0) options.push(`frame=${entry.displayFrame}`);
        if (entry.statisticsRegressionId) warnings.push(`"${expr}" is a regression curve tied to a statistics table; it is kept as a plain curve.`);
        lines.push(options.length ? `${expr}  | ${options.join(' ')}` : expr);
    }

    lines.push('');
    if (state.is3DMode) {
        const view = ['@view 3d'];
        if (Number.isFinite(state.camera3DTheta)) view.push(`azimuth=${num(state.camera3DTheta * 180 / Math.PI)}`);
        if (Number.isFinite(state.camera3DPhi)) view.push(`elevation=${num(90 - state.camera3DPhi * 180 / Math.PI)}`);
        // The 3D box centre is stored in screen units (offset3D); scale3D converts it to graph units.
        const centre = ['offset3DX', 'offset3DY', 'offset3DZ'].map(k => (Number(state[k]) || 0) * (Number(state.scale3D) || 1));
        if (centre[2] === 0) centre.pop();
        if (centre.some(v => v !== 0)) view.push(`center=${centre.map(v => num(Math.round(v * 1e9) / 1e9)).join(',')}`);
        lines.push(view.join(' '));
    } else if (Number.isFinite(state.scale)) {
        const c = state.viewportCenter2D && Number.isFinite(state.viewportCenter2D.x) ? state.viewportCenter2D : {x: 0, y: 0};
        lines.push(`@view center=${num(c.x)},${num(c.y)} unit=${num(state.scale)}`);
    }
    const settings = [];
    const add = (name, value) => { if (value !== undefined && value !== null) settings.push(`${name}=${typeof value === 'number' ? num(value) : value}`); };
    add('showAxes', state.showAxes);
    add('showAxisNumbers', state.showAxisNumbers);
    add('showPointLabels', state.showPointLabels);
    add('gridStyle', state.gridStyle);
    add('tmin', state.tmin);
    add('tmax', state.tmax);
    add('geometryMeasurementDisplay', state.geometryMeasurementDisplayEnabled);
    add('showHiddenMath', state.showHiddenMath);
    add('showHiddenGeo', state.showHiddenGeo);
    if (settings.length) lines.push(`@set ${settings.join(' ')}`);

    if (state.showPlaybackControls) {
        const frames = [`total=${num(state.totalFrames ?? 100)}`, `fps=${num(state.playbackFPS ?? 10)}`];
        if (state.currentFrame) frames.push(`current=${num(state.currentFrame)}`);
        if (state.frameExpr && String(state.frameExpr).trim()) {
            const bind = String(state.frameExpr).trim();
            frames.push(/\s/.test(bind) ? `bind="${bind}"` : `bind=${bind}`);
        }
        lines.push(`@frames ${frames.join(' ')}`);
    }

    const annotations = Array.isArray(state.annotations) ? state.annotations : [];
    for (const a of annotations.filter(a => a && a.type === 'text')) {
        const raw = String(a.content ?? '').replace(/\r?\n/g, '\\n');
        const smart = raw.startsWith('<smart>');
        const content = smart ? raw.slice(7) : raw;
        const opts = [`x=${num(a.x)}`, `y=${num(a.y)}`, `width=${num(a.width)}`, `height=${num(a.height)}`, `size=${num(a.fontSize ?? 0.5)}`];
        const c = a.color;
        if (c && (c.h || c.s || c.b || c.a)) opts.push(...colorOptions(c));
        if (smart) opts.push('smart');
        else if (/\{value\(|\{if\(/.test(content)) opts.push('plain');
        lines.push(`@text ${opts.join(' ')} | ${content}`);
    }
    const others = annotations.filter(a => a && a.type !== 'text');
    if (others.length) {
        const counts = {};
        others.forEach(a => { counts[a.type] = (counts[a.type] || 0) + 1; });
        warnings.push(`Dropped ${others.length} annotation(s) (${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}); scripts cannot express drawings, images, PDFs or audio.`);
    }
    const stats = state.statistics || {};
    const hasData = (Array.isArray(stats.rows) && stats.rows.some(row => Array.isArray(row) && row.some(cell => String(cell ?? '').trim() !== '')))
        || (Array.isArray(stats.regressions) && stats.regressions.length > 0);
    if (hasData) warnings.push('Dropped the statistics table data and regressions.');
    if (state.globalScript && String(state.globalScript).trim()) {
        const program = String(state.globalScript).replace(/\r\n?/g, '\n').replace(/^\n+|\s+$/g, '');
        if (program.split('\n').some(l => l.trim().toLowerCase() === '@end'))
            warnings.push('The global script contains a line reading "@end", which would end the @script block early; edit it before rebuilding.');
        lines.push('', '@script', ...program.split('\n'), '@end');
    }

    return {script: lines.join('\n') + '\n', warnings};
}
