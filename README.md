# arch-mcp

Lets AI coding agents (Claude Code, Antigravity, Cursor, and other MCP or shell-capable agents) create **Arch graphing-calculator save files**, the way GeoGebra tooling lets them create `.ggb` files.

The agent writes a short **scene script**: one Arch expression per line, plus styling options. This tool runs the script in the **real Arch engine** (your `index.html`, in headless Chrome, offline) through Arch's own Agent API, exports the save file with Arch's own exporter, reloads the file in a fresh page to prove it opens identically, and reports back:

- per-line errors in Arch's words (with English translations), plus checks Arch itself doesn't do (unknown object names, silently renamed duplicates, auto-created variables, and lines Arch would quietly keep as text notes);
- every object with its computed value (coordinates, equations, measurements);
- a screenshot of the file as a user will see it after opening it.

It can also **convert SVG drawings into Arch files** (`svg2arch`, or the `arch_svg` MCP tool): every shape of the picture becomes an inequality, stacked in the SVG's painting order. See [SVG drawings](#svg-drawings-svg2arch).

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

### Claude Code: the `arch-graph` skill (recommended)

Run this once inside the `arch-mcp` folder:

```sh
npm run install-skill
```

It installs the skill at `~/.claude/skills/arch-graph/SKILL.md` (or `$CLAUDE_CONFIG_DIR/skills`), with this folder's absolute path filled in, so it works in every project. New sessions use it whenever you ask for an Arch graph; you can also type `/arch-graph`. Run it again after moving or updating this folder. `npm run install-skill -- --dir <project>/.claude/skills` installs it for one project instead.

The skill drives the CLI (below) instead of the MCP server, and uses far fewer tokens:

- It loads a ~2k-token summary instead of the ~5k-token guide, and reads the rest one topic at a time (`--guide geometry`).
- The script lives in a `.arch` file that Claude fixes with small edits, instead of resending the whole script on every check.
- Checks return text only. Claude looks at a screenshot when appearance matters, usually once, at half size (`--png-scale 0.5`, a quarter of the image tokens).
- The final build prints one line (`--brief`).

In a test session (build a triangle with its circumcircle and a moving point, fixing one mistake along the way), that came to about 3.5k tokens, against about 10.5k for the same steps through the MCP tools. Each CLI run starts Chrome, so a check takes about 3 s instead of about 1 s from the always-running MCP server.

### Claude Code: MCP server

To use the MCP tools instead (or as well), run this once inside the `arch-mcp` folder:

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
once to learn the scene-script format (or `--guide <topic>` for one part), write a .arch script, check it with
`node /path/to/arch-mcp/src/cli.js --check scene.arch --png shot.png` (look at the PNG),
then build with `node /path/to/arch-mcp/src/cli.js scene.arch -o scene.txt`.
Never write Arch save JSON by hand.
```

## MCP tools

| Tool | What it does |
|---|---|
| `arch_guide` | Script format, Arch syntax, the meaning of point-on-object parameters, and common pitfalls (`docs/GUIDE.md`). `section: "geometry"` (or a comma-separated list) returns only those topics; `full_reference: true` adds the full Chinese syntax manual. |
| `arch_check` | Runs a script (`script` text or `script_path`) and returns the report and screenshot, plus a second screenshot after test-running any `@script` (`script_preview: false` skips that). `screenshot_scale: 0.5` renders 640x400 screenshots. Writes nothing. |
| `arch_build` | Same, and writes the save file to `output_path` (only if there are no errors and the reload check passes). Optional `screenshot_path`; `brief: true` leaves out the object list. |
| `arch_decompile` | Turns an existing save file into a script, so agents can edit files people made by hand. |
| `arch_svg` | Converts an SVG drawing (`svg_path` or `svg` text) into a save file at `output_path`, filling every shape with inequalities, and also writes the scene script beside it. Returns the conversion summary, the build report and a screenshot. Options: `tolerance`, `precision`, `gradient_steps`, `title`, `axes`, `flatten` (for Arch before 12202), `check`. |

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

Parametric curves and surfaces can declare their own parameters and ranges (Arch build 12201 and later):

```
(cos(q),sin(q),q,0,2*pi*a)                                # curve; x=cos(q),y=sin(q){q,0,2*pi*a} is the same
surface(sin(u)*cos(v),sin(u)*sin(v),cos(u),u,0,pi,v,0,2*pi)   # sphere; (X,Y,Z,u,..,v,..) and x=..,y=..,z=..{u,..,v,..} too
@view 3d azimuth=35 elevation=20 center=0,0,1                 # center=x,y,z also moves the 3D box along z
```

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

Full details, including an `arch.*` API reference, are in [docs/GUIDE.md](docs/GUIDE.md). There are more examples in `examples/` (`js-frames-text.arch` uses all of the above, `parametric-surfaces.arch` the parametric forms), and `examples/claude-chan/` is a detailed 3D figure built from parametric surfaces by a small generator script.

CLI:

```sh
node src/cli.js examples/circle-motion.arch                 # writes examples/circle-motion.txt
node src/cli.js --check scene.arch --png shot.png           # validate + screenshot, no file
node src/cli.js --check scene.arch --png s.png --png-scale 0.5  # 640x400 screenshot
node src/cli.js scene.arch -o out.txt --brief               # report only status, errors, warnings
node src/cli.js big-3d-scene.arch --timeout 300              # allow each step up to 300 s (default 30)
node src/cli.js --decompile "My graph.txt" -o mygraph.arch  # save file -> script
node src/cli.js --guide                                     # print the guide
node src/cli.js --guide geometry,animation                  # print only these topics
```

Guide topics: `workflow format syntax geometry animation text operators script mistakes` (a unique prefix such as `geo` also works).

Exit code 0 means OK, 1 means the script has errors, 2 means a usage or environment problem. `--json` prints the full result.

## SVG drawings (svg2arch)

```sh
node src/svg2arch.js drawing.svg                        # writes drawing.arch (scene script) and drawing.txt (save file)
node src/svg2arch.js drawing.svg -o out/pic.txt --png shot.png --png-scale 0.5
node src/svg2arch.js drawing.svg --check --png shot.png # convert and run in Arch, write no save file
node src/svg2arch.js drawing.svg --script-only          # only the scene script, no browser
node src/svg2arch.js drawing.svg --precision 8          # finer detail, slower redraws in Arch
```

Every filled shape of the picture becomes an **inequality**, filled by Arch itself and stacked in the SVG's painting order; filters (blur, shadows, ...) are ignored. This needs Arch 12202 or later (the bundled build), whose *ordered drawing* (顺序绘图) draws objects in creation order; the file switches it on. `--flatten` makes files for older builds instead. `examples/svg/lighthouse.svg` is converted to `lighthouse.arch` and `lighthouse.txt` beside it: 58 entries and 609 edges, against 166 entries and 1087 edges with `--flatten`. Options: `--tolerance <px>` (how far flattened curves may stray, default 0.5 px at the saved zoom; larger means fewer edges), `--precision <n>` (Arch's inequality sampling, default 4 = a 5 px grid), `--gradient-steps <n>` (at most this many colour bands per gradient, default 24), `--max-edges <n>`, `--title`, `--axes`, `--flatten`, `--no-seams`, `--timeout`, `--json`. Run `--help` for the full list.

Supported: paths (all commands, arcs), basic shapes, `<g>`, `<use>`/`<symbol>`, nested `<svg>`, transforms, `<style>` sheets (type, class, id, attribute selectors, descendant and child combinators, `!important`), presentation attributes and `style`, inheritance, `currentColor`, every CSS colour syntax, `fill-rule`, fill/stroke/group opacity, strokes with joins, caps, miter limits and dashes, `paint-order`, `clip-path`, linear and radial gradients (as bands of solid colour), masks (approximated as clips), and `<text>` (as Arch text boxes). Not drawn: filters (on purpose), images, patterns, markers.

How a picture becomes inequalities:

- **Layers in painting order.** Each shape is written whole, bottom to top, as the SVG paints it. Nothing is cut out of what lies beneath, so a shape's outline is drawn once, by the shape itself: no seams and no notches where pieces meet. A lower shape that borders a later one reaches about a sampling cell beneath it, and each gradient band reaches under the next, so Arch's interpolation leaves no gap along a shared edge either. Shapes that later opaque ones hide completely are dropped, partly hidden ones are trimmed when that saves edges, and shapes of the same colour are merged into one entry when nothing drawn in between overlaps them.
- **One signed distance per entry.** Each entry is `cos(pi*(W))/sqrt(D)<0`. `W` counts the edges a ray from (x, y) crosses (odd inside), one `heaviside` term per edge; `1/sqrt(D)` is about the distance to the nearest edge, from one term per edge. So the left side is a signed distance, and Arch, which samples the inequality on a pixel grid and interpolates between samples, draws each edge where it really is. Both parts of each edge's terms are written from the same exact vertex coordinates, so they vanish on exactly the same line. Products instead of powers keep Arch's compiled evaluation fast (about 0.6 ms per edge for a full redraw at the default precision). Coordinates are the SVG's user units with y flipped.
- **Thin strokes.** A stroke narrower than about 1.5 grid cells would break up as a region, so it becomes an equation `...=0` instead, which Arch draws as a line of that pixel width, in its place in the painting order. For an open line the sign also jumps along a "cut" from each end; Arch's automatic breakpoint detection (switched on in the file) drops those jumps, and each line counts crossings in one of eight directions chosen so the cuts miss the lines.
- **Near-white.** Arch's light theme draws near-white colours (saturation < 15, brightness > 85) as light grey, and pure white as black. So an opaque near-white shape is cut out of everything beneath it, letting Arch's white canvas show, with a faint darker ink on top that makes it the right shade; pure white areas are left empty.
- **Translucency.** Arch 12202's ordered drawing blends a fill of colour c and opacity a as a·c + (1−a)·below + a·(1−a)·white, lighter than ordinary blending: its WebGL canvas blends the alpha channel with SRC_ALPHA too, then goes over the white background. So each translucent shape gets the colour and opacity that make Arch show what the SVG shows over what actually lies beneath it, within 8/255, keeping the SVG's own opacity where that works. Where no single layer can do it (black 50% over both a colour and the bare canvas), the shape is blended with what lies beneath it here and drawn as opaque pieces, which Arch shows exactly. `npm test` checks this against Arch's real pixels.

`--flatten` is the method for Arch builds before 12202, which fill overlapping inequalities in grid-scan order rather than entry order: the converter computes what is visible (Clipper boolean operations), every opaque shape cutting its area out of everything beneath it, and writes regions that never overlap, one per colour, with point lists along shared boundaries (drawn beneath all fills) to hide the seams between them. That takes more edges, and leaves small notches where a seam meets a corner.

The conversion reports parts thinner than the sampling grid (they may show gaps; use a higher `--precision` or zoom in), unsupported features, and the approximate redraw time. Arch redraws on every pan and zoom, so drawings with thousands of edges feel slow; `--tolerance 1` or fewer gradient steps help.

## Configuration

| Variable | Default |
|---|---|
| `ARCH_HTML` | `index.html` next to this README. Point it at a newer Arch build to use that. |
| `ARCH_BROWSER_PATH` | Not set: tries Playwright's Chromium, then Chrome, then Edge. |
| `ARCH_BROWSER_CHANNEL` | e.g. `chrome`, `msedge`. |

## How it works

`src/engine.js` serves `index.html` to Chrome from a made-up address (`https://arch.invalid`) that Playwright answers itself, and blocks every other request: no login, cloud, AI quota or notices. Because the page isn't `file://`, JavaScript in operators or `@script` can reach neither your disk nor the network (Arch 12201+ also runs that code in its own QuickJS sandbox). Page work has a 30 s limit, so an infinite loop fails the check instead of hanging. It waits for startup, then evaluates `src/page-runner.js` in the page. The runner uses `window.ArchAgentProtocol.AgentAPI` (the same validated API Arch's built-in Agent uses) for objects, styles, sliders, view and settings. Then it calls `archInstance.exportStateObject()` exactly as *Save* does. A second preloaded page runs `archInstance.loadState()` on the result (what *Open file* does) and compares every object, plus text boxes, frame settings, operator code and the script. If there is an `@script`, that page then runs it for 2 s, as the Run button would, to catch runtime errors. The MCP server keeps the browser and two preloaded pages warm, so a check takes about 1 s after the first call.

Lines longer than 6000 characters (svg2arch regions often are) also go in through `addEntry`, because the Agent API refuses them.

Arch 12202 computes curves and geometry in a worker by default (异步绘图, asynchronous drawing). The build page switches that off while it runs the script, so the checks see every value and operator error as Arch computes them, and saves the file with it on, as Arch does. The verification page keeps it on and waits until Arch has finished before it compares and takes the screenshot. `@set orderedDrawing=true` switches on ordered drawing, which the Agent API has no setting for; the reload check then also compares the drawing order.

The tool depends on `window.archInstance`, `window.ArchAgentProtocol` and the save format in `index.html`. The bundled `index.html` is Arch build 12202 (from the arch-core repository; it reports version 19999). After updating Arch, run `npm test`: it builds every example, checks computed values, and round-trips save files.

Arch's input box keeps any line it cannot read as a `//` text note, without a message. The runner temporarily wraps `addEntry` while it creates each line, so such a line fails with Arch's reason instead. Arch's Agent API refuses `{` `}`, so lines with a parameter range in braces go in through `addEntry`, as Arch's own input box does.

## Limitations

- Scripts can't express hand-drawn annotations, images, PDFs, audio or statistics tables. `arch_decompile` lists anything it drops.
- svg2arch: Arch samples inequalities on a pixel grid, so corners are slightly rounded and details thinner than the grid can break up; very detailed drawings redraw slowly. Text uses Arch's font at an approximate position and is not clipped. Gradients are drawn as bands. Opened in Arch's dark mode, the colours of a converted picture change (Arch adapts them to the theme).
- JavaScript operators run in the user's Arch as soon as a file is opened (in Arch's sandbox since build 12201); that's how Arch works, not something this tool adds. In that sandbox they are much slower than plain math, so keep them out of 3D surface equations. `@script` only runs when the user presses Run. Treat AI-written JavaScript like any code you ship: read it before sharing the file.
- svg2arch's translucent colours are fitted to how Arch 12202 blends in ordered drawing (see above). If a later Arch build blends normally, convert again: translucent parts would otherwise look darker than they should.
- Geometry commands are 2D. 3D supports surfaces, implicit 3D, parametric surfaces and space curves, plus camera angles, zoom and the box centre.
- The saved view is pixels-per-unit around a center, so other screen sizes show a slightly different region.
- Checks catch syntax errors, unknown names, renames and invalid objects. They can't tell whether a valid figure is the one you *meant*, which is what the screenshot and value list are for.

## License

The arch-mcp code and documentation in this repository (`src/`, `test/`, `docs/`, `examples/`, `skill/`, this README) are released under the [MIT License](LICENSE). svg2arch uses [clipper-lib](https://www.npmjs.com/package/clipper-lib) (Angus Johnson's Clipper, Boost Software License), installed by `npm install`.

`index.html` (the Arch graphing calculator) and `Arch图形计算器语法与对象创建说明.txt` (its syntax manual) are © Arch's authors. They are included so the tool works out of the box and are **not** covered by the MIT License.
