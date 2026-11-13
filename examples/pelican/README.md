# Pelican, a 3D Arch figure

An American white pelican standing on a wooden post, built from parametric surfaces only.

| File | |
|---|---|
| `pelican.txt` | The Arch save file. Open it with Arch's *Open file*. |
| `pelican.arch` | The scene script it was built from (216 surfaces, 4 curves). |
| `generate.py` | Writes the scene script (needs numpy). |

The file is saved with `implicitPrecision=20`, so each surface gets Arch's finest mesh (60 x 60).
Lower the *equation, inequality and parametric surface precision* setting in Arch for faster redraws
while rotating.

## What is modelled

- **Body, neck and head** are one smooth surface: an ellipse swept from the tail along an S-shaped
  neck to the face, with a deeper belly than back and a round head.
- **Bill**: a long, flat upper mandible with a ridge along the top and a hooked orange-red nail; the
  two thin rami of the lower mandible; the orange gular pouch hanging between them.
- **Eyes**: bare orange-yellow facial skin, a pale iris, a dark pupil and a highlight. A small pale
  crest at the nape.
- **Wings**, folded along the body and fitted to its shape: white coverts with rounded feather tips,
  dark secondaries showing as a scalloped band below them, three long white tertials, and five dark
  primaries that reach back over the tail. A short fan of tail feathers.
- **Legs and feet**: stout orange legs; four toes per foot, all joined by webs as in every pelican,
  with scalloped web edges and grey claws.
- **Post**: a worn top with growth rings, a grained side and a soft contact shadow under the bird.

## Light and dark mode

Arch keeps 3D colours as they are in both themes; only the background changes, to white or black.
The pelican's colours are chosen to read on both: the plumage is an off-white that Arch's lighting
brightens to white on the side facing you and shades to grey at the edges, so the outline still shows
on a white background. The dark feathers are a charcoal grey rather than black, so they stay visible
on a black background. Nothing is pure black or pure white; Arch's 2D contrast rules swap those.

Two more Arch details matter here:

- **No translucent surfaces.** A surface with opacity below 1 lets the page show through Arch's
  3D canvas, so a "shadow" drawn that way looks lighter in light mode and darker in dark mode.
  The contact shadow is three opaque, slightly darker discs instead.
- **Arch's colour inversion setting** (颜色反转) inverts every colour in dark mode, 3D surfaces included,
  which turns this white pelican nearly black. Leave it off.

## Rebuilding

```sh
python3 examples/pelican/generate.py -o examples/pelican/pelican.arch
node src/cli.js examples/pelican/pelican.arch -o examples/pelican/pelican.txt --timeout 120
```

`--azimuth` and `--elevation` set the starting view (relative to the bird), `--prec` the mesh fineness.

## How it is built

- Most parts are lofts: a cross-section swept along a spine that lies in a plane. The spine and the
  cross-section sizes are natural cubic splines through a few knots. Each spline segment is its own
  surface, written as polynomials in its local parameter, so every segment gets a full mesh and
  neighbouring segments share their edges exactly. Rounded ends use a quarter-circle parameter, so
  mesh rows bunch up toward the tip.
- Each surface's two parameters are put in the order that makes its normal face outward, since
  Arch lights the back side of a surface at less than full strength.
- The wing feathers are thin curved leaves. Their sideways position follows the body's measured
  width at each feather's upper edge, centre and lower edge, so they lie on the body.
- Arch clips every 3D scene to a box about 246/unit wide on each side of the view centre. The whole
  model is turned 45° about z so the long bird lies along the box's diagonal. The generator then picks
  the largest zoom that keeps everything except the bottom of the post inside the box.
