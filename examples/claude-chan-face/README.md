# Claude Chan's face, a 3D Arch figure

Claude Chan's face and head, from the orange-haired character sheet, built only from parametric surfaces. This model is a fresh start and shares nothing with `examples/claude-chan/`. It covers the face only: no hair and no outfit.

![Front, three-quarter and side views](preview.png)

| File | |
|---|---|
| `claude-chan-face.txt` | The Arch save file of the base face. Open it with Arch's *Open file*. |
| `claude-chan-face.arch` | The scene script it was built from: 141 parametric surfaces and 11 functions. |
| `claude-chan-face-natural-smile.txt`, `.arch` | Expression 1 from the sheet, 自然微笑 (natural smile). See [Expressions](#expressions). |
| `generate.py` | Writes the scene scripts (needs numpy). |
| `construction.png`, `natural-smile.png` | The figures below. |

The file is saved with `implicitPrecision=20`, so every surface gets Arch's finest mesh (60 x 60 cells). Lower the *equation, inequality and parametric surface precision* setting in Arch for faster redraws while you rotate the head.

## How the face is modelled

![The primitives, the tiled head, the finished face](construction.png)

*Left: the three primitives drawn separately. Middle: their soft union with the small forms added, drawn as a cube-sphere of tiles (front face blue). Right: the finished face.*

### One surface, seen from one centre

The skin of the head, face and neck is a single closed surface. It is star-shaped around the head centre, so it can be written as a radius along each direction:

```
P(D) = hr(D) * D          D = (p, q, w), any length; x forward, y her left, z up
```

`hr(p,q,w)` is one Arch function, defined once in the file. All 96 skin tiles call it, and so do the face's decals, with region-specific copies (see below).

### Primitives as reciprocal radii

Each primitive gives `1/s`, where `s*D` is the point where the ray along `D` leaves the primitive. Each one is written so that `1/s` is homogeneous of degree 1 in `D`, so `D` never needs normalising:

| Primitive | `1/s` along D | Used for |
|---|---|---|
| Superquadric centred on the head centre, with its own semi-axis in each direction (front, back, side, top, bottom), exponent `n` across and `m` up and down | `( ((p⁺/xf)ⁿ + (p⁻/xb)ⁿ + (\|q\|/y)ⁿ)^(m/n) + (w⁺/zt)ᵐ + (w⁻/zb)ᵐ )^(1/m)` | skull, lower face |
| Off-centre quadric (here a slanted cylinder) | `(sqrt(B² − A·C) − B) / (−C)`, with `A = DᵀMD`, `B = DᵀMc`, `C = cᵀMc − 1` | neck |
| Half-space `n·X ≤ h` | `max(n·D, 0) / h` | sides of the jaw, under the jaw, ends of the neck |

The superquadrics are what make the head read as anime rather than as a ball. The skull's horizontal sections are slightly square (`n = 2.15`), so the face is broad and flat across the eyes. The lower face is deep in front and long below (`zb = 0.91`, `m = 3.2`), so the front stays nearly vertical from the nose to the mouth before it turns into the chin.

### Soft union and intersection without repeating anything

Arch expands user functions as text macros. A smooth-min written the usual way, `min(a,b) − h(a,b)`, repeats its arguments, so nesting a few of them multiplies the formula size exponentially. A first test with three nested ones did not finish meshing 24 tiles within 30 seconds. Here every blend is instead a p-norm, in which each part appears once:

```
soft intersection   1/s^k = Σ 1/s_i^k        (k = 16: jaw;  k = 40: neck)
soft union            s^k = Σ s_i^k          (k = 14: skull + lower face;  k = 14: + neck)
```

Both stay homogeneous, so a blend is a fixed fraction of the head's size. A smaller `k` gives a wider, softer blend. The whole head is:

```
head = union₁₄( union₁₄( skull, inter₁₆(lower face, jaw left, jaw right, under the jaw) ),
                inter₄₀(neck cylinder, below z = 0.2, above z = −1.55) )
```

The soft intersection with the two jaw half-spaces gives the V of the jaw with a rounded chin. The half-space under the jaw makes the line from the chin back to the neck.

### Small forms as bumps

Eye sockets, nose, cheeks, lips, chin and the hollow under the lower lip multiply the radius by `exp(Σ amp·exp(−Q))`. Each `Q` is a Gaussian in the front-face coordinates `(u, v) = (q/p, w/p)`, the same plane the face is drawn in. Symmetric pairs (eye sockets, cheeks) use `|q|`, so one term makes both. The nose has a different falloff above (the bridge) and below (the underside), and a sharpened top (`Q^0.8`) for the small pointed anime nose.

Behind the head, `q/p` would map a tiny copy of every bump onto the point straight behind the face. It is invisible, but it disturbs Arch's finite-difference normals, which showed up as a dark speck. So `u` is pushed far away for `p < 0` with a `1000*max(-p,0)` term.

### Cube-sphere tiles

Arch meshes a parametric surface on at most 60 x 60 cells, so one surface for the whole head would be far too coarse. Instead the directions are those of a cube: `D = (1, u, v)` on the front face, `(−u, 1, v)` on her left face, and so on, with `u, v ∈ [−1, 1]`. Each of the six faces is cut into the same 4 x 4 grid of tiles, and each tile is one Arch surface. Because all six faces are cut the same way, tiles that meet across a cube edge sample their shared edge at the same points. An earlier mix of 5 x 5 and 3 x 3 grids left hairline cracks. The cube-sphere has no poles, and each face's `(u, v)` order gives an outward normal, which Arch lights at full strength.

### The face as decals in the front-face plane

On the front face, `(u, v)` is the front view divided by the depth, and the depth hardly changes across the face. That makes it a natural drawing plane, matching the character sheet's front view. Eyes, brows, blush and mouth are patches over regions of that plane, lying on the skin:

```
P = dX(U, V, L) * (1, U, V),   dX(a,b,c) = hX(a,b) * (1 + c)
```

- **Layers.** Each layer is lifted by its own multiple of 0.16 % of the radius (sclera 1, lid shadow 2, iris rim 3, … highlights 9, lash line 10). The layers therefore stack in a fixed order in Arch's single depth buffer, without flicker.
- **Strips.** The white of the eye, the lash line, the lower lash, the lid crease, the brows and the mouth are strips: `U = u₀ + width·s`, and `V` runs from a lower curve to an upper curve in `s`. The lid curves `lidu(s)` and `lidl(s)` are smooth polynomials fitted to a few control points, held exactly at their ends so that the two lids meet at both corners. Every layer of the eye uses the same two functions, so the layers line up exactly.
- **Clamped ellipses.** The iris layers (dark rim, amber body, two bright lower bands, the lid's shadow), the pupil and the highlights are ellipses in polar form. Their `V` is clamped between the two lids, `min(max(V, lidl), lidu)`. Points outside the eye collapse onto the lid line, so the iris is cut by the lids exactly, as in the drawing.
- **A raised lash line.** The upper lash band's lift grows across its width, `L = 0.016 + 0.01·sin(πw)`. The lash line is therefore a small ridge, not paint, and catches the light like the edge of an eyelid. A wing past the outer corner and a smaller flick below it are drawn the same way.
- **Shorter radius functions per region.** The decals of the eyes and brows (`he`), the cheeks (`hc`) and the mouth (`hm`) each get their own copy of `hr`, specialised to `p = 1`. Each copy leaves out every primitive and bump that changes the radius by less than 10⁻⁶ in that region; the generator checks that each copy still matches `hr` to within 2·10⁻⁵. This cut the meshing time of the decals several times over.

### Ears

The ears are separate shells. Each is a pear-shaped outline in its own frame on the side of the head, with a flare that lifts the back edge off the head, a rolled rim, and a hollow bowl with a slightly pinker inner surface. A second surface closes it from behind and sinks into the head.

## What is on the face

- Amber eyes, measured on the sheet (her left eye in the calm portrait, in eye widths):
  - The upper lid arches gently, about 0.055 above the corners.
  - The lower lid is flat under the iris, 0.3 below the corners from t = 0.2 to past the middle, so it does not cut across the iris. It drops steeply from the inner corner, and rises in a round curve to the outer corner: 0.24 deep at t = 0.7, 0.17 at 0.85, 0.08 at 0.95.
  - The iris is 0.57 across and sits a little toward the nose (t = 0.44), its centre just under the lid, so its top is hidden. It has a dark brown rim, an amber-brown body, a dark top and lighter bands near the lower lid.
  - The pupil is large, 0.58 of the iris across, just under the lid, with a highlight on its left and a smaller one on its right.
- A fine, dark upper lash line that follows the lid in one smooth arc.
  - It is a hairline at the inner corner, with a slim tail down into the corner. It grows steadily to its thickest at 0.8 of the way out: 0.033 in all, about a fourteenth of the eye width. Its top edge arches with the lid.
  - It ends in a thin flick that reaches 0.18 eye widths past the outer corner, pointing out and a little down, and tapers to a point.
  - On the sheet, which is shrunk about five times, the line's short lashes blur into a band about 0.15 eye widths thick. At full size it reads as a fine line with lashes, and the model draws that line.
  - The lower lash line thickens toward the outer corner, where it meets the flick. A soft lid crease runs above the lash line.
- Thin brown eyebrows, measured on the sheet. Each is a fine line about 0.63 eye widths above the eye corners, nearly level over the inner half of the eye, where the sheet shows it between the strands of hair. It is rounded at the inner end, thickest a third of the way out (0.011, about a fortieth of the eye width) and tapers to a point at the outer end. Its control points are solved so that from the front it is a smooth parabolic arch. They rise toward the outer end, because there the forehead curves back and would otherwise pull the line down on screen.
- Soft three-step blush on the cheeks, a small pointed nose made by shape alone, and a small closed smile.
- A tall, domed skull, a narrow V-shaped jaw with a rounded chin, ears, and a slender neck.
- She looks up by 10°, measured from the sheet. In its portraits the nose sits 0.31 of the way from the eye line to the chin, and the mouth 0.59–0.63. With the head level, the model measured 0.40 and 0.64, which reads as looking down. Looking up 10° and a slightly higher nose give 0.335 and 0.60. The saved views are near eye level (2°).
- The proportions are measured on the sheet's two front portraits (calm and smiling), from the eye corners along the face's own up direction, in units of the distance from the eye corners to the chin. The model is measured the same way in its front view.

  | Measure | Sheet | Model |
  |---|---|---|
  | Gap between the inner eye corners, in eye widths | 1.16–1.32 | 1.3 (was 0.96) |
  | Nose, as a fraction of the way from the corners to the chin | 0.34–0.39 | 0.35 |
  | Mouth, as a fraction of the way from the corners to the chin | 0.59–0.63 | 0.60 |
  | Top of the skull above the corners | about 1.3 (under the hair) | 1.34 (was 0.90) |
  | Head width / height | about 0.8 | 0.79 (was 0.99) |
  | Half-width of the face at 0.5 / 0.69 / 0.75 / 0.82 / 0.89 of the way down | ≈0.65 / 0.46 / 0.39 / 0.29 / 0.19 | 0.66 / 0.44 / 0.37 / 0.29 / 0.20 |

  The head had been about as wide as it was tall, with the eyes above its middle; on the sheet they sit well below it, and the face narrows from the ears to a pointed chin. So the skull is taller (`zt`) with a rounder dome (`m` = 2.5), its underside is shallow (`zb`), so that below the ears the face narrows instead of keeping the skull's width, and the jaw is a steeper V. The width at the ears is unchanged; it matched the sheet. With the eyes closer together the nose had looked too far below them, at 0.95 of the inner-corner gap; it is now 0.69. The eye sockets, brows and blush move with the eyes; the lip bumps move with the mouth.

## Expressions

![Expression 1, natural smile: at the sheet's angle, from the front, from the side](natural-smile.png)

Each expression on the character sheet is a set of changes to a few numbers of the face, kept in `EXPRESSIONS` in `generate.py`. The base face is `base`; `--expression NAME` writes `claude-chan-face-NAME.arch`. The surfaces stay the same; only their formulas change:

| Setting | What it changes |
|---|---|
| `lid_up`, `lid_lo` | Move the middle of the upper and lower lid curves (by `amount·sin(πt)^0.8`, so the corners stay). The white of the eye, the lash line, the crease and the clamps of the iris all follow, because they are all written with `lidu(s)` and `lidl(s)`. |
| `under_eye` | Adds the soft fold under the lower lid that a smile pushes up. |
| `gaze`, `converge`, `glow_dv` | Move both irises (where she looks), move each one toward the nose, and move the bright bands inside them. |
| `brow_dv` | Raises or lowers the eyebrows. |
| `mouth` | The mouth line: corner lift, an upturn at the very ends (`hook`), asymmetry, thickness and taper. |
| `cheek` | Height and size of the cheek bumps in `hr`, so the skin itself changes shape. |
| `blush_v`, `blush` | Height of the blush and how many of its three steps are drawn. |
| `tilt`, `pitch` | Head tilt toward her right and how far she looks up, in degrees (`pitch` is 10 for every expression). |
| `view` | The saved camera angle. |

**1. 自然微笑, natural smile** (`--expression natural-smile`). The upper lids come down a little and the lower lids rise (the sheet's smile is 0.26 eye widths deep against 0.29 when calm), so the eyes are calm and gentle. A light fold shows under each eye. She looks straight ahead, with the irises where they are in the base face. The mouth is a nearly straight, slightly longer closed line whose ends turn up a little, her left end more. The cheeks are fuller and higher, with only a trace of blush. The head is tilted 12° toward her right as well as looking up, and the camera is a little to her left, as in the sheet's portrait.

The pose is cheap for the head. A rotation `R` (look up, then tilt) about a point at the top of the neck turns `t + R·(hr(D)·D)` into `t + hr(D)·(R·D)`, so only the direction factor changes. The look-up turns the neck with the head. For the tilt, the neck can't turn rigidly, or it would lean. So the tiles that reach into the neck use a tilt angle that grows smoothly with height, `θ(z) = θ·smoothstep(z)`, from still at z = −1.5 to fully turned at z = −0.85. The neck bends, and those tiles still meet the head's tiles exactly.

## Rebuilding

```sh
cd examples/claude-chan-face
python3 generate.py                                   # writes claude-chan-face.arch
python3 generate.py --expression natural-smile        # writes claude-chan-face-natural-smile.arch
node ../../src/cli.js claude-chan-face.arch -o claude-chan-face.txt --timeout 600
node ../../src/cli.js claude-chan-face-natural-smile.arch -o claude-chan-face-natural-smile.txt --timeout 600
```

The build takes a minute or two. Options of `generate.py`:

- `--expression`: which expression to write (default `base`).
- `--azimuth`, `--elevation`, `--unit`, `--center`: the saved view (the azimuth and elevation default to the expression's).
- `--prec`: the mesh fineness (`10` is four times faster for trying changes).
- `--tiles`: tiles per cube face.
- `--stage tiles` or `--stage primitives`: the two left panels of the construction figure.

All the shape numbers are in one place in `generate.py`: the primitives (`cranium`, `lowerface`, `neck`, `HEAD`), the bumps (`BUMPS`), the eye curves (`LID_UP_PTS`, `LID_LO_PTS`, `LASH_TH`, `BROW_PTS`, `IRIS`), and the expressions (`BASE`, `EXPRESSIONS`).
