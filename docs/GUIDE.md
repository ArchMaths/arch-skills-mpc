# Arch scene scripts: guide for AI agents

Arch is a GeoGebra-like graphing calculator. You describe a figure as a **scene script**. The tool runs it in the real Arch engine and writes an Arch save file (`.txt`, JSON) that users open with Arch's *Open file* button.

**Never write save-file JSON by hand.** It contains parser-computed fields. Always go through the tool.

## Workflow

1. Write a script (one Arch expression per line).
2. Check it (`arch_check` / `arch-build --check`). Read every error and warning, verify the computed values in the object list, and look at the screenshot.
3. Fix and re-check until clean, then build (`arch_build` / `arch-build scene.arch -o out.txt`).
4. To change an existing save file: decompile it (`arch_decompile` / `arch-build --decompile`), edit the script, rebuild.

The build stops with errors (and writes nothing) for syntax errors, unknown object names, renamed duplicates, and invalid options. Warnings mean the file is valid but something may be unintended. Take them seriously, especially "no valid position" and "auto-created variable".

## Script format

```
@title Circular motion                       # file name shown in Arch
# comment lines start with #
a=0.1                | min=0 max=1 step=0.0025 mode=forward play
circle(c,O,2)        | color=blue thickness=4
point(P,c,a)         | color=red
segment(op,O,P)      | dash=long
y=x^2                | ref=parab color=#8e24aa
intersect(I,parab,c,1,1)
//A free-text note (verbatim, no options)
@style last | color=gray
@view x=-4..4 y=-3..3
@set gridStyle=dots showAxisNumbers=false
```

- **Object line**: `<Arch expression>` optionally followed by `|` and options. Order matters: create things before referring to them.
- **Text line**: starts with `//`; the rest is shown as a note. Options are not parsed on text lines; use `@style last | ...`.
- `#` starts a comment, on its own line or after an object line or directive (not inside `//` text lines).

### Object options (after `|`, space separated)

| Option | Meaning |
|---|---|
| `ref=name` | Label for this object, usable in later lines. Essential for math curves: `y=x^2 \| ref=parab` then `intersect(I,parab,...)`. The tool substitutes the real auto-number (`func1`, `eq2`, ...), which you cannot predict. Do not reuse an object name as a ref. |
| `color=` | `red orange yellow green teal cyan blue indigo purple pink brown black gray white`, `#rrggbb`, or `hsb(h,s,b)` with each 0..100. |
| `opacity=0..1` | Opacity (useful for inequality regions and 3D surfaces). |
| `thickness=1..20` | Line width / point size (default 3). |
| `hidden` | Create invisible (still usable as a dependency). |
| `dash=solid\|long\|short\|dotted` | Geometry objects only. |
| `label=none\|name\|"Custom text"` | Geometry objects only: hide the label, show the name, or show custom text. |
| `fixed` | Points only: user cannot drag it. |
| `min= max= step=` | Slider range for an **independent variable** (`a=1`) or a **point on an object** (`point(P,c,0)`). Accepts constants like `2*pi`. |
| `mode=` | Slider animation: `pingpong` (default), `forward`, `reverse`, `once`, `once-reverse`. |
| `play` | Start animating when the file is opened. |
| `frame=N` | Frame-by-frame mode: show this object only on frame N (0 = every frame). Needs an `@frames` line. |

Animation speed: Arch advances about `100*step` per second. For a span L in T seconds, use `step=L/(100*T)`. Example: `min=0 max=1 step=0.0025 mode=forward` is one lap of a circle every 4 s.

### Directives

- `@title Name`: file name shown in Arch.
- `@view x=a..b y=c..d`: fit this region (2D). Or `@view center=x,y unit=N` (N = pixels per unit). For 3D: `@view 3d azimuth=35 elevation=25` (degrees). `@view 2d` switches back.
- `@set name=value ...`: saved document settings only: `showAxes`, `showAxisNumbers`, `showPointLabels` (true/false), `gridStyle` (`grid|dots|polar|hidden`), `tmin`, `tmax` (parametric t range, default -2*pi..2*pi), `geometryMeasurementDisplay`, `showHiddenMath`, `showHiddenGeo`.
- `@style target | options`: restyle an existing object by name, ref, auto-number, or `last`.
- `@text x=.. y=.. [size=] [color=] [width=] [height=] [smart|plain] | content`: canvas text box (see below).
- `@frames total=N fps=F [current=K] [bind=expr]`: turn on frame-by-frame playback (see below).
- `@operator name(params)` … `@end`: JavaScript operator (see below).
- `@script` … `@end`: the global ArchScript program (see below). Only one per file.

Always add an `@view` that frames the interesting part; Arch's default is centered at the origin at about 100 px per unit. The saved scale is in pixels per unit, so the visible region is somewhat larger or smaller on other screens.

## Arch expression syntax

### General rules
- One object per line. ASCII only: `( ) , . + - * / ^`. Function calls need parentheses: `sin(x)`.
- **Names are case-insensitive**: `A` and `a` clash, and `F` clashes with a function `f`. Use distinct names (`P1`, `Q2`, `rot`, ...).
- Do not name things `x y z t e pi`, built-in function names, geometry keywords, `O`, `Xaxis`, `Yaxis`, or auto-number patterns like `func1`.
- Constants: `pi` (or `π`) and `e`. Write `0.001` or `10^(-3)` rather than `1e-3`.
- Implicit multiplication works (`2x`, `2(x+1)`, `2sin(x)`), but write `*` between multi-letter names (`a*b`).
- Not supported: `%`, `!` (use `gamma(n+1)`), `|x|` (use `abs(x)`), `&&`, `||`, `==`, `!=`, `?:`, chained inequalities `-1<x<1`, degree symbols.
- `[A,x]` and `[A,y]` read the coordinates of an existing point A. Lowercase x/y, square brackets.

### Functions
- `ln log lg logbase(b,x) logb(b,x) exp sqrt cbrt abs floor ceil round`. Note that `log` is base 10.
- `sin cos tan asin acos atan sinh cosh tanh asinh acosh atanh` (radians only; sin of 30° is `sin(30*pi/180)`).
- `sum(expr,k,1,5)`, `prod(expr,k,1,5)`, `int(expr,u,a,b)` (numeric), `diff(expr,x)`, `diffat(expr,x,value)` (numeric, central difference).
- `pow gamma erf erfc elliptice elliptick sign sgn heaviside fresnels fresnelc psi lambertw li zeta sinintegral cosintegral expintegral`.
- **Domain limits are added, not multiplied**: `y=x^2+range(x,-2,2)`, `y=sin(x)+llim(x,0)` (x≥0), `y=sqrt(x)+ulim(x,4)` (x≤4). These return 0 inside and NaN outside, so `*range(...)` collapses the curve to 0.

### Math objects

| Write | Creates |
|---|---|
| `a=2` | **Independent variable** with slider. Only a plain number literal makes a slider: `a=1+1` does not. |
| `b=2*a+1` | Dependent variable (no slider). |
| `f(u)=u^2+1` | Callable function (not drawn). Draw it with `y=f(x)`. |
| `y=x^2+1`, `x=y^2-1` | Explicit curve (auto-number `funcN`). |
| `x^2+y^2=4`, `x*y=1` | Implicit curve (`eqN`). |
| `x^2+y^2<=4`, `y>x^2` | Inequality region (`eqN`). One relation per line. |
| `x=cos(t),y=sin(t)` | Parametric curve in t (`paraN`), x first then y. The t range is global (`@set tmin= tmax=`). |
| `r=root[x^2-2,x,1]` | Numeric root of expr=0 from start value 1 (square brackets, expression not equation). |
| `/-/(0,0)(1,1)(2,0)/(3,1)(4,0)` | Point list / polyline (`plistN`); a top-level `/` starts a new piece. |
| `2+3` | Computed value entry. |
| 3D (after `@view 3d`): `z=x^2+y^2`, `x^2+y^2+z^2=9`, `x=cos(t),y=sin(t),z=t` | Surfaces and space curves. Geometry commands are 2D only. |

Single-letter names used before being defined are **auto-created** as variables (value 1, range -2..2), and the report warns. Define variables first.

### Geometry commands (2D). The new object's name is always the first argument.

| Command | Notes |
|---|---|
| `point(P,x,y)` | Free point; x, y may be expressions (`point(P,cos(a),sin(a))`, `point(Q,[A,x]+1,[A,y])`). |
| `point(P,obj,u)` / `point(P,obj,u,r0)` | Point on an object; meaning of `u` depends on obj (table below). |
| `midpoint(M,A,B)` | |
| `intersect(P,o1,o2)` (+ `,1` / `,-1` or `,x0` / `,x0,y0`) | Line/circle/conic pairs: 4th arg `1`/`-1` picks the algebraic branch. Curves (`funcN`/`eqN`/`paraN`): 4th/5th args are a **starting guess** (x0,y0). For curves, always give a guess near the wanted intersection. |
| `segment(s,A,B)` `ray(r,A,B)` `line(l,A,B)` `vector(v,A,B)` | A ≠ B. |
| `parallelline(l2,l1,P)` `perpendicularline(l2,l1,P)` | Order: new name, reference line, through point. `Xaxis`/`Yaxis` work as l1. |
| `anglebisector(b,A,V,C)` | V is the vertex; result is a full line. |
| `circle(c,C,r)` / `circle(c,C,P)` | Center + radius expression, or center + point on circle (P must already exist). |
| `circulararc(arc,C,A,B)` | Center C, radius CA, counter-clockwise from direction CA to direction CB. |
| `ellipse(e1,F1,F2,P)` / `ellipse(e2,a,b)` | Foci + point on it, or axis-aligned at origin with semi-axes a, b. |
| `hyperbola(h,F1,F2,P)` | Foci + point. For a standard hyperbola write `x^2/a^2-y^2/b^2=1`. |
| `parabola(p,F,l)` | Focus + directrix line. For coefficients write `y=a*x^2+b*x+c`. |
| `polygon(poly,n,P1,...,Pn)` | n literal integer ≥ 3, exactly n points, in order. |
| `polyeq(sq,A,B,n)` | Regular n-gon on edge AB (counter-clockwise from A to B). **Arch auto-creates the remaining vertex points with the next free capital letters**, so check the report and avoid those names. |
| `length(d,A,B)` `angle(ang,A,V,C)` `area(s,n,P1,...,Pn)` | Measurements. angle is in degrees (0..180) with V the vertex. Do not rely on their names inside other expressions; compute with `sqrt(([A,x]-[B,x])^2+([A,y]-[B,y])^2)` instead. |
| `isparallel(l1,l2)` `isperpendicular(l1,l2)` `isconcyclic(A,B,C,D)` | Checks; an optional name can come first. |
| `rotate(Q,C,P,deg)` | Rotate point P about C by **degrees** (counter-clockwise). |
| `reflect(Q,m,P)` | Reflect point P in line m, or through point m (central symmetry). |
| `translate(Q,v,P)` / `translate(Q,P,dx,dy)` | By vector v (note argument order!) or by dx, dy. Only points are transformed; rebuild shapes from transformed vertices. |
| `fitline(l,n,P1,...,Pn)` | Least-squares line. |
| `tangent(l,conic,P[,1\|-1])` | Tangent from P to a geometry circle/ellipse/hyperbola/parabola; the 4th arg picks the branch. |
| `tangent(l,curve,P[,slope0])` / `tangent(l,curve,P,x0,y0)` | Tangent from P to a math curve; slope0 is a direction hint, and x0,y0 is a hint for the touching point. |

Built-ins: `O` (origin, unless you create your own O), `Xaxis`, `Yaxis`. Example: `point(A,Xaxis,2)` is (2,0).

### What u means in `point(P,host,u)`

| Host | u |
|---|---|
| segment / vector | 0..1 from start to end (0.5 is the midpoint). |
| ray | u ≥ 0; line: any real (base point + u·direction). |
| geometry circle, ellipse, arc | **Fraction of a full turn**: 0 is the rightmost point, 0.25 the top. Not degrees, not radians. Arc: 0 is start, 1 is end. |
| hyperbola | u in cosh/sinh form on one branch; the other branch is u near -100000. |
| geometry parabola | Local coordinate u (not 0..1). |
| `funcN` (y=f(x)) | x-coordinate: `point(P,parab,2)` is (2, f(2)). |
| `paraN` | Parameter t. |
| `eqN` (implicit or inequality), polygon | **Angle in radians of a ray from the origin**; the point is where that ray meets the boundary. The optional 4th arg prefers the hit nearest that radius. |
| `polyeq` | Integer u (no 4th arg) is **vertex number** 1..n. For a boundary point use the 4th arg: `point(P,hex,0.5,1)`. |
| `plistN` | Point index 1, 2, 3, ... |

### Units cheat sheet
- Degrees: `rotate`, `angle`, `@view` azimuth/elevation.
- Radians: `sin`/`cos`/..., and the ray angle for `eqN`/polygon hosts.
- Fraction of a turn (0..1): points on a geometry circle, ellipse or arc.

### Making things move
- Drive several objects together: `a=0 | min=0 max=1 step=0.0025 mode=forward play`, then use `a` in them (`point(P,c,a)`, `point(Q,cos(2*pi*a),sin(2*pi*a))`).
- Animate one point on its own: put the slider options on the point on an object, e.g. `point(P,c,0) | min=0 max=1 step=0.005 mode=forward play`. Playing a point replaces an expression parameter like `a` with a number, so do not combine both approaches on one point.

## Canvas text: `@text`

```
@text x=-4.5 y=3.6 size=0.45 color=indigo | Construction steps
@text at=0.5,-1.2 size=0.35 | P = ({value(a)}, {value(f(a))})\nslope {if(f(a)-1),then(≥ 1),else(< 1)}
```

- A text box placed on the graph. `x,y` is its **top-left corner** in graph coordinates. `size` is the font height in graph units (default 0.5), so text zooms with the graph.
- The box clips its text. The tool sizes it to fit, with room for live values, unless you give `width=`/`height=` (graph units).
- `\n` (backslash n, typed literally) starts a new line.
- **Smart text** (switched on automatically when the content has `{value(` or `{if(`; force with `smart`, switch off with `plain`):
  - `{value(expr)}`: live value of any Arch expression (variables, functions, operators), 6 significant digits.
  - `{if(cond),then(text),else(text)}`: cond counts as true when its value is ≥ 0, e.g. `{if(a-2),then(a ≥ 2),else(a < 2)}`.
  - `/b` bold, `/i` italic, `/r` regular, from that point on.
- The report shows each box as it currently reads, so you can check the values.
- `//text` lines are different: they are notes in the object list, not on the graph.

## Frame-by-frame animation: `@frames` and `frame=`

```
@frames total=3 fps=1
point(L,-3,-2)   | frame=1
point(R,-1,-2)   | frame=1
segment(s,L,R)   | frame=2
circle(c,L,R)    | frame=3
```

- Works like slides. Arch's play button steps the current frame from its value to `total` at `fps` frames per second, then stops.
- An object with `frame=N` is drawn only on frame N; `frame=0` (the default) means every frame. **Frame 0 shows everything**, so the file opens showing the whole construction unless you set `current=`.
- To show cumulative steps (step 2 keeps step 1), give later frames their own copies or use a slider instead; Arch shows exactly one frame number at a time.
- `bind=expr` ties the current frame to an expression, e.g. `a=0 | min=0 max=3 step=0.01` then `@frames total=3 bind=floor(a)`. Define the variables first.
- `//` text lines and `@text` boxes are shown on every frame.

## JavaScript operators: `@operator`

```
@operator clamp(v, lo, hi)
  return Math.min(hi, Math.max(lo, v));
@end
sq(u)={ return u*u; }          # one-line form, as typed in Arch
y=clamp(2*sin(x),-1,1)
```

- The body is a JavaScript function body that **returns a number**. Parameters are plain numbers. Use `Math.*`.
- After definition the operator works in every expression, slider, geometry argument and `{value(...)}`.
- Arch calls it thousands of times while drawing, so keep it fast and pure: no timers, no DOM, no `arch` calls.
- If it throws, Arch silently turns that value into NaN. The tool reports how often it threw. An infinite loop makes the build time out.
- Names follow the usual rules: unique, case-insensitive, not a built-in.
- **Operators run in the user's Arch when they open the file**, so only write ordinary math code.

## Global program: `@script`

```
@script
let t = 0;
setInterval(() => {
  t += 0.03;
  arch.valuesetting('a', 1.5 + 1.5 * Math.sin(t));
}, 30);
@end
```

- Stored in the file. **Arch never runs it on open; the user presses Run** in the code panel. Use it for things a slider cannot do: scripted motion, several values moving together, timed sequences, reactions to clicks.
- Create the objects with normal script lines. Use the program to change them: running `arch.create` adds new objects every time the user presses Run.
- The tool syntax-checks it, and also **runs it for 2 seconds in an isolated copy** (no network, no file access) and reports runtime errors, plus a second screenshot. The saved file is never modified by that test run.
- It is JavaScript in strict mode with `arch`, `setInterval`, `clearInterval`, `setTimeout`, `clearTimeout`, `addEventListener` provided. Stopping the script clears its timers, listeners and pen drawings.

### The `arch` API (most useful parts)

Calls marked *(async)* take effect on the next tick, so do not read their result on the same line.

| Call | Does |
|---|---|
| `arch.valuesetting(name, value, max, min, step, playState, playMode)` | Set an independent variable; trailing args optional. **Note the order: max before min.** |
| `arch.calc(expr)` | Evaluate an Arch expression to a number, e.g. `arch.calc('a^2')`. |
| `arch.coordinate(pointName, 'x'\|'y')` | Coordinate of a point (exact name, case-sensitive). `arch.coordinate(0,'x')` gives the x of the canvas center. |
| `arch.create(expr)` *(async)* | Add an object, same syntax as script lines. |
| `arch.createfunc(expr, h, s, b, a, visible, thickness)` / `arch.creategeo(...)` *(async)* | Add a curve / geometry object with color (HSB 0..100, `a` = transparency). **Pass `visible` as 1**; anything else hides it. |
| `arch.geosetting(name, h, s, b, a, visible, thickness)` *(async)* | Restyle a geometry object (`visible` 1/0). |
| `arch.setcolor(reference, h, s, b, a)` | Recolor any object by name or auto-number. |
| `arch.objects.list()` / `.get(ref)` / `.style(ref, {color, visible, thickness})` / `.remove(ref)` | Inspect and style objects (`thickness` 1..10 here). |
| `arch.deletefunc(id)` / `arch.deletegeo(name)` / `arch.clearall()` *(async)* | Delete objects. |
| `arch.txt(content, h, s, b, a, fontSize, x1, y1, x2, y2)` *(async)* | Add a text box from (x1,y1) top-left to (x2,y2). |
| `arch.edittxt(oldContent, newContent, h, s, b, a, fontSize, x1, y1, x2, y2)` *(async)* | Change a text box found by its current content; pass `undefined` to keep a field. |
| `arch.deletetxt(content)` *(async)* | Remove text boxes with that content. |
| `arch.setcanvas(x, y, zoom)` | Center the 2D view on (x,y) at `zoom` pixels per unit. |
| `arch.setview({center:{x,y}, unit})` / `arch.getview()` | View control (also `dimension: '2d'\|'3d'`). |
| `arch.setcamera({azimuth, elevation})` / `arch.rotatecamera(right, up)` | 3D camera, degrees. |
| `arch.setsetting(name, value)` / `arch.getsetting(name)` | Settings such as `showAxes`, `gridStyle`. |
| `arch.message(text, seconds)` | Show a short message. |
| `arch.pencolor(h,s,b,a)`, `arch.penthickness(t)`, `arch.pendown()`, `arch.penposition(x,y)`, `arch.penup()`, `arch.clearpen()` | Turtle-style drawing in graph coordinates (not saved with the file). |
| `arch.fill(n, x1,y1, …, xn,yn, h,s,b,a)` | Filled polygon with the pen layer. |

## Common mistakes
1. Referring to `func1`/`eq1` by guessing: use `ref=`.
2. Name clashes from case-insensitivity (`A` vs `a`, `F` vs `f`), or with polyeq's auto-created vertices.
3. Using an object before creating it (`circle(c,C,P)` needs P first).
4. Radians in `rotate` (use 90, not pi/2); degrees in `sin`.
5. `point(P,c,90)` on a circle: u is a fraction, so 90 means 90 full turns. Use 0.25 for the top.
6. `*range(...)` instead of `+range(...)`.
7. Integer angles on a `polyeq` without the 4th arg switch to vertex mode.
8. Expecting a slider from `a=2*pi`: write `a=6.283` or set min/max on a literal.
9. JavaScript syntax (`&&`, `%`, `!`, `|x|`, `**`).
10. Chained inequalities or several relations on one line.
11. `frame=` without an `@frames` line (it has no effect), or expecting frame 0 to hide framed objects.
12. `arch.createfunc(...)` without `visible` = 1, or `valuesetting` with min and max swapped.
13. Creating objects inside `@script` that the scene script already creates (duplicates on every Run).
14. Arch bug: `length(...)` and `angle(...)` labels are not drawn if a measured point is created after any curve, equation or point list, or is the built-in `O`. Create the measured points first and use `point(O,0,0)` rather than the built-in origin.
