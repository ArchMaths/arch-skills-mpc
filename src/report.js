const MODE_NAMES = ['pingpong', 'forward', 'reverse', 'once', 'once-reverse'];

const fmt = n => (typeof n === 'number' && Number.isFinite(n)) ? String(Math.round(n * 1e6) / 1e6) : String(n);

function describeObject(o) {
    const kind = o.type === 'advanced_custom_function_definition' ? 'JS operator' : (o.geometryType || o.plotType || o.type);
    const label = o.reference ? `${o.reference}` : (o.name || '');
    let value = '';
    if (o.details) value = o.details;
    else if (o.value !== undefined && o.value !== null && o.type !== 'function') value = fmt(o.value);
    const extras = [];
    if (o.min !== undefined && o.max !== undefined && Number.isFinite(o.min))
        extras.push(`slider ${fmt(o.min)}..${fmt(o.max)} step ${fmt(o.step)}${o.playMode !== undefined ? ' ' + MODE_NAMES[o.playMode] : ''}${o.play ? ' play' : ''}`);
    if (o.frame) extras.push(`frame ${o.frame}`);
    if (o.visible === false) extras.push('hidden');
    if (o.meaningful === false) extras.push('NO VALID VALUE');
    if (o.error) extras.push(`error: ${o.error}`);
    const where = o.line ? `L${o.line}` : 'auto';
    return `  ${where.padEnd(5)} ${label ? label + ' ' : ''}[${kind}] ${o.expression}${value ? '  =>  ' + value : ''}${extras.length ? '  (' + extras.join(', ') + ')' : ''}`;
}

// brief: only the status, errors, warnings and @script preview, for a build after a check already listed the objects.
export function formatReport(result, {written, screenshot, scriptScreenshot, brief = false} = {}) {
    const out = [];
    const objects = result.objects || [];
    if (result.ok) {
        out.push(written ? `OK: wrote ${written} (${objects.length} objects)` : `OK: script is valid (${objects.length} objects)`);
    } else {
        out.push(`FAILED: ${result.errors.length} error(s)${written === undefined ? '' : ', no file written'}`);
    }
    if (screenshot) out.push(`Screenshot: ${screenshot}`);
    if (scriptScreenshot) out.push(`Screenshot after running @script: ${scriptScreenshot}`);
    const where = item => item.line ? `line ${item.line}` : 'file';
    if (result.errors.length) {
        out.push('', 'Errors:');
        for (const e of result.errors) out.push(`  ${where(e)}: ${e.message}`);
    }
    if (result.warnings?.length) {
        out.push('', 'Warnings:');
        for (const w of result.warnings) out.push(`  ${where(w)}: ${w.message}`);
    }
    if (objects.length && !brief) {
        out.push('', 'Objects (line, reference, type, definition => current value):');
        for (const o of objects) out.push(describeObject(o));
    }
    if (result.texts?.length && !brief) {
        out.push('', 'Text boxes (line, top-left corner, width x height, font size, content => as shown now):');
        for (const t of result.texts)
            out.push(`  ${(t.line ? `L${t.line}` : '').padEnd(5)} (${fmt(t.x)}, ${fmt(t.y)}) ${fmt(t.width)}x${fmt(t.height)} size ${fmt(t.size)}${t.smart ? ' smart' : ''}: "${t.content}"${t.shown !== undefined ? `  =>  "${t.shown}"` : ''}`);
    }
    if (result.frames && !brief) {
        const f = result.frames;
        out.push('', `Frames: playback controls on, ${f.total} frames at ${fmt(f.fps)} fps, opens on frame ${f.current}${f.bind ? `, frame bound to ${f.bind}` : ''} (frame 0 shows every object)`);
    }
    if (result.script) {
        const preview = result.scriptPreview;
        const status = !preview ? 'not run (preview skipped)'
            : preview.problems.length ? `ran ${preview.seconds} s and failed (see errors)` : `ran ${preview.seconds} s with no errors`;
        out.push('', `Global script: ${result.script.lines} line(s) from line ${result.script.line}; stored in the file, runs when the user presses Run. Preview: ${status}.`);
    }
    if (brief) return out.join('\n');
    if (result.refs && Object.keys(result.refs).length)
        out.push('', 'Refs: ' + Object.entries(result.refs).map(([k, v]) => `${k} -> ${v}`).join(', '));
    if (result.view) {
        const v = result.view;
        if (v.dimension === '3d') out.push('', `View: 3d, azimuth ${fmt(v.camera?.azimuth)}, elevation ${fmt(v.camera?.elevation)}`);
        else if (v.center) out.push('', `View: 2d, center (${fmt(v.center.x)}, ${fmt(v.center.y)}), ${fmt(v.unit)} px per unit`);
    }
    return out.join('\n');
}
