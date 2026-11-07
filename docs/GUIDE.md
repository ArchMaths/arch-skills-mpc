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

Animation speed: Arch advances about `100*step` per second. For a span L in T seconds, use `step=L/(100*T)`. Example: `min=0 max=1 step=0.0025 mode=forward` is one lap of a circle every 4 s.

### Directives

- `@title Name`: file name shown in Arch.
- `@view x=a..b y=c..d`: fit this region (2D). Or `@view center=x,y unit=N` (N = pixels per unit). For 3D: `@view 3d azimuth=35 elevation=25` (degrees). `@view 2d` switches back.
- `@set name=value ...`: saved document settings only: `showAxes`, `showAxisNumbers`, `showPointLabels` (true/false), `gridStyle` (`grid|dots|polar|hidden`), `tmin`, `tmax` (parametric t range, default -2*pi..2*pi), `geometryMeasurementDisplay`, `showHiddenMath`, `showHiddenGeo`.
- `@style target | options`: restyle an existing object by name, ref, auto-number, or `last`.

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

### Common mistakes
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
