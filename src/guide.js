import {readFileSync, existsSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const GUIDE_PATH = resolve(ROOT, 'docs', 'GUIDE.md');
export const FULL_SYNTAX_PATH = resolve(ROOT, 'Arch图形计算器语法与对象创建说明.txt');

export function readGuide() {
    return readFileSync(GUIDE_PATH, 'utf8');
}

export function readFullSyntax() {
    if (!existsSync(FULL_SYNTAX_PATH)) return 'The full Chinese syntax reference file is not available next to this tool.';
    return readFileSync(FULL_SYNTAX_PATH, 'utf8');
}
