const MODE_NAMES = ['pingpong', 'forward', 'reverse', 'once', 'once-reverse'];

const fmt = n => (typeof n === 'number' && Number.isFinite(n)) ? String(Math.round(n * 1e6) / 1e6) : String(n);

function describeObject(o) {
    const kind = o.geometryType || o.plotType || o.type;
    const label = o.reference ? `${o.reference}` : (o.name || '');
    let value = '';
    if (o.details) value = o.details;
    else if (o.value !== undefined && o.value !== null && o.type !== 'function') value = fmt(o.value);
    const extras = [];
    if (o.min !== undefined && o.max !== undefined && Number.isFinite(o.min))
        extras.push(`slider ${fmt(o.min)}..${fmt(o.max)} step ${fmt(o.step)}${o.playMode !== undefined ? ' ' + MODE_NAMES[o.playMode] : ''}${o.play ? ' play' : ''}`);
    if (o.visible === false) extras.push('hidden');
    if (o.meaningful === false) extras.push('NO VALID VALUE');
    if (o.error) extras.push(`error: ${o.error}`);
    const where = o.line ? `L${o.line}` : 'auto';
    return `  ${where.padEnd(5)} ${label ? label + ' ' : ''}[${kind}] ${o.expression}${value ? '  =>  ' + value : ''}${extras.length ? '  (' + extras.join(', ') + ')' : ''}`;
}

export function formatReport(result, {written, screenshot} = {}) {
    const out = [];
    const objects = result.objects || [];
    if (result.ok) {
        out.push(written ? `OK: wrote ${written} (${objects.length} objects)` : `OK: script is valid (${objects.length} objects)`);
    } else {
        out.push(`FAILED: ${result.errors.length} error(s)${written === undefined ? '' : ', no file written'}`);
    }
    if (screenshot) out.push(`Screenshot: ${screenshot}`);
    const where = item => item.line ? `line ${item.line}` : 'file';
    if (result.errors.length) {
        out.push('', 'Errors:');
        for (const e of result.errors) out.push(`  ${where(e)}: ${e.message}`);
    }
    if (result.warnings?.length) {
        out.push('', 'Warnings:');
        for (const w of result.warnings) out.push(`  ${where(w)}: ${w.message}`);
    }
    if (objects.length) {
        out.push('', 'Objects (line, reference, type, definition => current value):');
        for (const o of objects) out.push(describeObject(o));
    }
    if (result.refs && Object.keys(result.refs).length)
        out.push('', 'Refs: ' + Object.entries(result.refs).map(([k, v]) => `${k} -> ${v}`).join(', '));
    if (result.view) {
        const v = result.view;
        if (v.dimension === '3d') out.push('', `View: 3d, azimuth ${fmt(v.camera?.azimuth)}, elevation ${fmt(v.camera?.elevation)}`);
        else if (v.center) out.push('', `View: 2d, center (${fmt(v.center.x)}, ${fmt(v.center.y)}), ${fmt(v.unit)} px per unit`);
    }
    return out.join('\n');
}
