#!/usr/bin/env node
// Installs the arch-graph skill for Claude Code: copies skill/arch-graph/SKILL.md into the user's
// skills folder with this checkout's absolute paths filled in, so the skill works from any project.
import {readFileSync, writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {homedir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {ROOT} from './guide.js';

export const SKILL_NAME = 'arch-graph';
export const SKILL_SOURCE = resolve(ROOT, 'skill', SKILL_NAME, 'SKILL.md');
const MARKER = '<!-- Installed by arch-mcp (npm run install-skill). Reinstall after moving the arch-mcp folder. -->';

const USAGE = `Install the ${SKILL_NAME} skill for Claude Code.

Usage: npm run install-skill [-- --dir <skills folder>] [-- --force]

  --dir <path>  skills folder to install into (default: ~/.claude/skills, or
                $CLAUDE_CONFIG_DIR/skills); use <project>/.claude/skills for one project
  --force       overwrite an existing ${SKILL_NAME}/SKILL.md that arch-mcp did not install`;

// Forward slashes work in Git Bash on Windows and avoid backslash escapes.
const slashes = path => path.replace(/\\/g, '/');

export function renderSkill(root = ROOT) {
    const repo = slashes(root);
    return readFileSync(SKILL_SOURCE, 'utf8')
        .replaceAll('{{CLI}}', `node "${repo}/src/cli.js"`)
        .replaceAll('{{SVG2ARCH}}', `node "${repo}/src/svg2arch.js"`)
        .replaceAll('{{REPO}}', repo)
        .trimEnd() + `\n\n${MARKER}\n`;
}

export const defaultSkillsDir = () => join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'skills');

export function installSkill({dir = defaultSkillsDir(), force = false} = {}) {
    const target = join(resolve(dir), SKILL_NAME, 'SKILL.md');
    const existed = existsSync(target);
    if (existed && !force && !readFileSync(target, 'utf8').includes(MARKER))
        throw new Error(`${target} exists and was not installed by arch-mcp. Pass --force to overwrite it.`);
    mkdirSync(join(resolve(dir), SKILL_NAME), {recursive: true});
    writeFileSync(target, renderSkill());
    return {target, updated: existed};
}

function main(argv) {
    const options = {};
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--dir' && i + 1 < argv.length) options.dir = argv[++i];
        else if (argv[i] === '--force') options.force = true;
        else if (argv[i] === '-h' || argv[i] === '--help') { console.log(USAGE); return 0; }
        else { console.error(`Unknown argument ${argv[i]}\n\n${USAGE}`); return 2; }
    }
    try {
        const {target, updated} = installSkill(options);
        console.log(`${updated ? 'Updated' : 'Installed'} ${target}\nClaude Code picks it up in new sessions; ask for an Arch graph or run /${SKILL_NAME}.`);
        return 0;
    } catch (error) {
        console.error(error.message);
        return 1;
    }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exitCode = main(process.argv.slice(2));
