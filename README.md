# arch-mcp

Lets AI coding agents (Claude Code, Antigravity, Cursor, and other MCP or shell-capable agents) create **Arch graphing-calculator save files**, the way GeoGebra tooling lets them create `.ggb` files.

The agent writes a short **scene script**: one Arch expression per line, plus styling options. This tool runs the script in the **real Arch engine** (your `index.html`, in headless Chrome, offline) through Arch's own Agent API, exports the save file with Arch's own exporter, reloads the file in a fresh page to prove it opens identically, and reports back:

- per-line errors in Arch's words, plus checks Arch itself doesn't do (unknown object names, silently renamed duplicates, auto-created variables);
- every object with its computed value (coordinates, equations, measurements);
- a screenshot of the file as a user will see it after opening it.

Why not have the AI write the save JSON directly? Arch's loader trusts parser-computed fields (`plotType`, `processedExpr`, `geometryType`, dependency names, ...). Getting those right means reimplementing Arch's parser, so a hand-written file breaks silently.

## Setup

Requires Node 18+ and Google Chrome (or Edge or Chromium).

```sh
git clone https://github.com/tom-j71/arch-mcp.git
cd arch-mcp
npm install
npm test          # optional: about 25 s, drives the real Arch page
```

The commands below write `/path/to/arch-mcp` for wherever you cloned it (run `pwd` inside the folder to get it).

If Chrome isn't installed: `npx playwright-core install chromium`, or set `ARCH_BROWSER_PATH` to a Chromium executable.

### Claude Code

The repo's `.mcp.json` offers the `arch` server to Claude Code sessions started anywhere inside the repo. It runs `npx --no-install arch-mcp`, which works from subfolders too and never downloads anything. To use it from any project, run this once inside the `arch-mcp` folder:

```sh
claude mcp add arch --scope user -- node "$PWD/src/mcp.js"
```

### Antigravity (and other MCP clients)

Add this to the client's MCP server config. In Antigravity, that's the raw config under *Manage MCP Servers*:

```json
{
  "mcpServers": {
    "arch": {
      "command": "node",
      "args": ["/path/to/arch-mcp/src/mcp.js"]
    }
  }
}
```

Use absolute `output_path`s in prompts when the client doesn't start servers in your project folder.

### Agents without MCP (shell only)

Put this in the project's `AGENTS.md` / `CLAUDE.md`:

```
To make Arch graphing-calculator files: run `node /path/to/arch-mcp/src/cli.js --guide`
once to learn the scene-script format, write a .arch script, check it with
`node /path/to/arch-mcp/src/cli.js --check scene.arch --png shot.png` (look at the PNG),
then build with `node /path/to/arch-mcp/src/cli.js scene.arch -o scene.txt`.
Never write Arch save JSON by hand.
```

## MCP tools

| Tool | What it does |
|---|---|
| `arch_guide` | Script format, Arch syntax, the meaning of point-on-object parameters, and common pitfalls (`docs/GUIDE.md`). `full_reference: true` adds the full Chinese syntax manual. |
| `arch_check` | Runs a script (`script` text or `script_path`) and returns the report and screenshot, plus a second screenshot after test-running any `@script` (`script_preview: false` skips that). Writes nothing. |
| `arch_build` | Same, and writes the save file to `output_path` (only if there are no errors and the reload check passes). Optional `screenshot_path`. |
| `arch_decompile` | Turns an existing save file into a script, so agents can edit files people made by hand. |

## Scene scripts

```
@title Parabola tangents
y=x^2                         | ref=parab color=blue thickness=4
y=2                           | ref=level color=gray
point(K,0,-1)                 | color=red fixed
intersect(I,parab,level,1,2)  | color=green
tangent(t1,parab,K,1)         | color=orange
tangent(t2,parab,K,-1)        | color=orange
@view x=-4..4 y=-2..5
```

`ref=` gives a math curve a name that later lines can use. The tool substitutes Arch's real auto-number (`func1`, `eq2`, ...), which an AI can't predict. Other options: `color opacity thickness hidden dash label fixed min max step mode play frame`. Directives: `@title @view @set @style`.

Scripts can also use Arch's JavaScript and presentation features:

```
@operator clamp(v, lo, hi)        # JavaScript operator, usable in any expression
  return Math.min(hi, Math.max(lo, v));
@end
@text x=-4 y=3 size=0.4 | a = {value(a)}      # canvas text box; {value(..)} shows live values
@frames total=3 fps=1                         # frame-by-frame playback...
segment(s,L,R) | frame=2                      # ...this object only on frame 2
@script                                       # the global ArchScript program (user presses Run)
setInterval(() => arch.valuesetting('a', Math.random()), 500);
@end
```

Full details, including an `arch.*` API reference, are in [docs/GUIDE.md](docs/GUIDE.md). There are more examples in `examples/` (`js-frames-text.arch` uses all of the above).

CLI:

```sh
node src/cli.js examples/circle-motion.arch                 # writes examples/circle-motion.txt
node src/cli.js --check scene.arch --png shot.png           # validate + screenshot, no file
node src/cli.js --decompile "My graph.txt" -o mygraph.arch  # save file -> script
node src/cli.js --guide                                     # print the guide
```

Exit code 0 means OK, 1 means the script has errors, 2 means a usage or environment problem. `--json` prints the full result.

## Configuration

| Variable | Default |
|---|---|
| `ARCH_HTML` | `index.html` next to this README. Point it at a newer Arch build to use that. |
| `ARCH_BROWSER_PATH` | Not set: tries Playwright's Chromium, then Chrome, then Edge. |
| `ARCH_BROWSER_CHANNEL` | e.g. `chrome`, `msedge`. |

## How it works

`src/engine.js` serves `index.html` to Chrome from a made-up address (`https://arch.invalid`) that Playwright answers itself, and blocks every other request: no login, cloud, AI quota or notices. Because the page isn't `file://`, JavaScript in operators or `@script` can reach neither your disk nor the network. Page work has a 30 s limit, so an infinite loop fails the check instead of hanging. It waits for startup, then evaluates `src/page-runner.js` in the page. The runner uses `window.ArchAgentProtocol.AgentAPI` (the same validated API Arch's built-in Agent uses) for objects, styles, sliders, view and settings. Then it calls `archInstance.exportStateObject()` exactly as *Save* does. A second preloaded page runs `archInstance.loadState()` on the result (what *Open file* does) and compares every object, plus text boxes, frame settings, operator code and the script. If there is an `@script`, that page then runs it for 2 s, as the Run button would, to catch runtime errors. The MCP server keeps the browser and two preloaded pages warm, so a check takes about 1 s after the first call.

The tool depends on `window.archInstance`, `window.ArchAgentProtocol` and the save format in `index.html`. After updating Arch, run `npm test`: it builds every example, checks computed values, and round-trips save files.

## Limitations

- Scripts can't express hand-drawn annotations, images, PDFs, audio or statistics tables. `arch_decompile` lists anything it drops.
- JavaScript operators run in the user's Arch as soon as a file is opened; that's how Arch works, not something this tool adds. `@script` only runs when the user presses Run. Treat AI-written JavaScript like any code you ship: read it before sharing the file.
- Arch bug: `length(...)` and `angle(...)` labels are not drawn when a measured point is created after a curve, equation or point list, or is the built-in `O`. The report warns about it with the workaround: create the points first and use `point(O,0,0)`.
- Geometry commands are 2D. 3D supports surfaces, implicit 3D and space curves, plus camera angles.
- The saved view is pixels-per-unit around a center, so other screen sizes show a slightly different region.
- Checks catch syntax errors, unknown names, renames and invalid objects. They can't tell whether a valid figure is the one you *meant*, which is what the screenshot and value list are for.

## License

The arch-mcp code and documentation in this repository (`src/`, `test/`, `docs/`, `examples/`, this README) are released under the [MIT License](LICENSE).

`index.html` (the Arch graphing calculator) and `Arch图形计算器语法与对象创建说明.txt` (its syntax manual) are © Arch's authors. They are included so the tool works out of the box and are **not** covered by the MIT License.
