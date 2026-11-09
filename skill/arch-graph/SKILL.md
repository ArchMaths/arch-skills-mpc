---
name: arch-graph
description: Create or edit Arch graphing-calculator save files (.txt): function graphs, geometry constructions, sliders and animations, 3D surfaces, canvas text, JavaScript operators. Builds them from a short scene script with the real Arch engine. Use whenever the user wants an Arch file, figure or graph, or wants to change an existing Arch save file. Arch is a GeoGebra-like calculator, not Arch Linux.
---

# Arch save files

Arch save files (`.txt`, JSON) contain parser-computed fields, so **never write or edit save JSON by hand**. Write a scene script (`.arch`) and build it with the CLI, which runs the real Arch engine headlessly (about 3 s per run).

## Workflow

1. Write the script with the Write tool, next to where the save file should go (`name.arch` beside `name.txt`), so it can be edited and rebuilt later.
2. Check it: `{{CLI}} --check name.arch`. The text report lists errors and warnings per line, and every object with its computed value. Exit code 1 means errors.
3. Fix with Edit (small edits, not a rewrite) and check again. Verify the computed values (coordinates, equations, intersections) against what you meant.
4. When appearance matters (layout, view, colors, labels), look once: `{{CLI}} --check name.arch --png shot.png --png-scale 0.5`, then Read `shot.png` (640x400). Drop `--png-scale` only to inspect small details. Put screenshots in a scratch folder, not beside the user's files. With `@script` there is also `shot-script.png`, taken after the program has run for 2 s.
5. Build: `{{CLI}} name.arch -o name.txt --brief`. It writes the file only when there are no errors and the saved file reloads identically.

To change an existing save file: `{{CLI}} --decompile file.txt -o file.arch`, edit, rebuild. It warns about anything a script can't express (drawings, images, tables).

## More reference: read only what the task needs

`{{CLI}} --guide <topic>[,<topic>]` prints one part of the full guide:

| Topic | Contents |
|---|---|
| `format` | every option and directive in detail |
| `syntax` | expression rules, all functions, math objects, parametric curves and surfaces, root, point lists, 3D |
| `geometry` | every geometry command, what `u` means in `point(P,host,u)`, units |
| `animation` | sliders that move things, `@frames` frame-by-frame playback |
| `text` | `@text` canvas text with live values |
| `operators` | `@operator` JavaScript operators |
| `script` | `@script` global program and the `arch.*` API |
| `mistakes` | the full list of common mistakes |

Examples: `{{REPO}}/examples/*.arch`. The original Chinese manual, `{{REPO}}/Arch图形计算器语法与对象创建说明.txt` (~40 KB), is for grepping a specific command, never for reading whole.

## Script format

```
@title Circular motion                 # name shown in Arch
a=0.1           | min=0 max=1 step=0.0025 mode=forward play
circle(c,O,2)   | color=blue thickness=4
point(P,c,a)    | color=red
segment(op,O,P) | dash=long
y=x^2           | ref=parab color=#8e24aa
intersect(I,parab,c,1,1)
//A note shown in the object list
@view x=-4..4 y=-3..3
```

- One Arch expression per line, then optional `| options`. Create things before referring to them. `#` starts a comment. A `//` line is a note and takes no options.
- **`ref=name`**: Arch auto-numbers curves (`func1`, `eq2`, `para3`) and you can't predict the number, so give curves a ref and use it in later lines. Don't reuse an object name as a ref.
- Other options: `color=` (`red orange yellow green teal cyan blue indigo purple pink brown black gray white`, `#rrggbb`, `hsb(h,s,b)`), `opacity=0..1`, `thickness=1..20`, `hidden`, `dash=solid|long|short|dotted`, `label=none|name|"text"`, `fixed`, `min= max= step=`, `mode=pingpong|forward|reverse|once|once-reverse`, `play`, `frame=N`.
- Sliders: only a plain number literal gets one (`a=2`, not `a=2*pi`). Arch advances `100*step` per second, so `step = span/(100*seconds)`.
- Directives: `@title`; `@view x=a..b y=c..d` (always add one) or `@view 3d azimuth=35 elevation=25 [unit=N] [center=x,y,z]`; `@set gridStyle=grid|dots|polar|hidden showAxes=false showAxisNumbers=false tmin= tmax=`; `@style <name|ref|last> | options`; `@text x= y= size= | content {value(a)}`; `@frames total=N fps=F`; `@operator f(a,b)` … `@end`; `@script` … `@end`.

## Syntax essentials

- **Names are case-insensitive**: `A` clashes with `a`, and `F` with a function `f`. Don't use `x y z e pi O Xaxis Yaxis`, built-in names, or `func1`-style names (`t` is allowed). An undefined single letter becomes an auto-created variable (warning), so define variables first.
- Not supported: `%`, `!`, `|x|`, `&&`, `||`, `==`, `?:`, `**`, `1e-3`, chained or several relations per line. Use `abs()`, `gamma(n+1)`, `10^(-3)`.
- `log` is base 10, `ln` is natural. `sin`/`cos` use radians. `rotate` and `angle` use degrees.
- Domain limits are **added**: `y=x^2+range(x,-2,2)`, `+llim(x,0)` (x≥0), `+ulim(x,4)` (x≤4).
- Math objects: `y=…`/`x=…` explicit, `x^2+y^2=4` implicit, `y>x^2` region (one relation per line), `x=cos(t),y=sin(t)` parametric in the global t, `f(u)=u^2` callable but not drawn (draw it with `y=f(x)`), `b=2*a` dependent value. 3D, after `@view 3d`: `z=x^2+y^2`, `x^2+y^2+z^2=9`, `x=cos(t),y=sin(t),z=t`.
- Parametric objects with their own parameters and ranges (ranges may use sliders, need min < max, and not their own parameter): curve `(cos(q),sin(q),q,0,2*pi)` or `x=cos(q),y=sin(q){q,0,2*pi}` or `curve(cos(q),sin(q),q,0,2*pi)`; surface `(X,Y,Z,u,0,pi,v,0,2*pi)` or `x=X,y=Y,z=Z{u,0,pi,v,0,2*pi}` or `surface(X,Y,Z,u,0,pi,v,0,2*pi)`. Inside surfaces write `p*p`, not `p^2` (much faster). Details: `--guide syntax`.
- `[A,x]` and `[A,y]` read a point's coordinates. Built-ins: `O`, `Xaxis`, `Yaxis`.
- Geometry (2D only, new object's name first): `point(P,x,y)`, `point(P,host,u)`, `midpoint(M,A,B)`, `segment/ray/line/vector(s,A,B)`, `circle(c,C,r)` or `circle(c,C,P)`, `circulararc(arc,C,A,B)`, `ellipse(e,F1,F2,P)`, `parabola(p,F,l)`, `polygon(poly,n,P1,…,Pn)`, `polyeq(sq,A,B,n)` (creates the remaining vertices with the next free capital letters), `parallelline(l2,l1,P)`, `perpendicularline(l2,l1,P)`, `intersect(I,o1,o2,x0,y0)` (always give curves a starting guess near the wanted point; for line/conic pairs use `1`/`-1`), `tangent(l,obj,P,…)`, `rotate(Q,C,P,deg)`, `reflect(Q,m,P)`, `translate(Q,v,P)`, `length(d,A,B)`, `angle(ang,A,V,C)`. For anything else, run `--guide geometry`.
- What `u` means in `point(P,host,u)`: on a geometry circle, ellipse or arc it is a **fraction of a turn** (0 is the rightmost point, 0.25 the top); on a segment it runs 0..1; on `y=f(x)` it is x; on a parametric curve it is t. Other hosts: `--guide geometry`.

## Reading the report

- Errors block the build. Warnings mean the file is valid but something may be unintended; fix "no valid position" and "auto-created variable".
- "Arch also created …" lists objects Arch added itself (e.g. polyeq vertices). Avoid their names.
- Arch bug: `length`/`angle` labels are not drawn when a measured point is created after a curve, or is the built-in `O`. Create the points first and use `point(O,0,0)`.
- "Arch could not read …": Arch would have kept the line as a `//` note; fix the syntax.
- `@operator` code runs when the user opens the file, and `@script` runs when they press Run, both in Arch's sandbox (no network). Keep it plain math and timers. Operators are slow inside 3D surfaces; use them for values, not in surface equations.
