# Claude Chan, a 3D Arch figure

Claude Chan (Claude娘: orange hair and a chrysanthemum motif) as a static 3D figure, built from her
design sheet with nothing but parametric surfaces and a few curves.

| File | |
|---|---|
| `claude-chan-3d.txt` | The Arch save file. Open it with Arch's *Open file*. |
| `claude-chan-3d.arch` | The scene script it was built from (474 objects). |
| `generate.py` | Writes the scene script. `face.py`, `outfit.py`, `hair.py` and `scene.py` are its parts. |

Opening the file takes about a minute: it is saved with `implicitPrecision=10`, so each surface is
meshed on a 125 x 125 grid instead of Arch's default 50 x 50. Lower the *equation, inequality and
parametric surface precision* slider in Arch's settings for faster redraws while rotating.

## What is modelled

- **Head**: a face shell (superellipse arcs that narrow along the jaw to a soft chin), the back of the
  skull, a nose that rises to a small tip, ears with helix, fold, concha, tragus and lobe.
- **Face**: almond eyes with lowered lids for her calm smile. Each eye is layered: eye white with the
  lid's shadow, an amber iris that darkens toward the top and glows gold below, a radial pattern and
  light streaks around the pupil, rim, pupil, three highlights and a sparkle, the lash line with five
  lash clumps, lower lashes, lid crease, tear duct, and a tapering brow. Soft blush with hatch lines, a
  nose highlight and side shadow, a closed smile with lifted corners, and the bangs' shadow on the forehead.
- **Hair**: side-swept pointed bangs with a halo of shine, two small ahoge, leaf-like sidelocks with
  three ridges, side hair, and three layered sheets of long hair. Their outline keeps clear of the
  capelet, arms, book and skirt and flares below the waist into wavy clumps with pointed tips. A braid
  runs down the back of the head to a small bow.
- **Accessories**: a chrysanthemum on a black bow with cream ribbons and a gold tassel; gold tassel earrings.
- **Outfit**: high ruffled collar and jabot, black ascot with a chrysanthemum brooch, cream capelet with
  gold trim and chrysanthemum emblems, bishop sleeves with lacing and two-tone ruffled cuffs, black
  corset with gold buttons, piping, chain, ring and tassel, a pleated cream skirt with orange
  embroidery, a frilled petticoat, a black overskirt lined in orange with gold-trimmed lapels, hip bows
  with chrysanthemums, chains and tassels, an orange back panel with a black bow, cream lace-up boots.
- **Props**: a leather book with gold corners, a chrysanthemum emblem and a ribbon bookmark; a display base.

## Rebuilding

```sh
python3 examples/claude-chan/generate.py         # writes claude-chan-3d.arch (needs numpy)
node src/cli.js examples/claude-chan/claude-chan-3d.arch -o examples/claude-chan/claude-chan-3d.txt --timeout 1800
```

`generate.py --view face --prec 4` writes a quicker version framed on the face; `--parts head,hair`
limits it to some parts. The views and parts are listed in `generate.py`.

## How it is built

- Every part is a parametric surface `(X,Y,Z,u,u0,u1,v,v0,v1)`. Shared shapes are Arch user functions:
  `fw` places a local shape in a frame, `cr`/`cpf` are capsule and puffy-sleeve profiles, `fa`/`fb`/`fc`
  are chrysanthemum petal layers, `bla`/`blh`/`blt` bow loops, `sqc`/`sqs` rounded boxes.
- Face details are thin decals that follow the face. Arch expands user functions textually, so a
  decal that called the exact face function `fy` with a long argument grew to thousands of terms.
  `generate.py` fits `fy` over each feature's region with a small polynomial (keeping the eye-inset and
  cheek terms exact; the fit is within 0.0007) and the decals use those fits instead.
- Arch lights a surface at half strength where its normal faces away from the camera, so the generator
  evaluates every surface in Python and swaps its two parameter ranges when the normals point inward.
- The long hair's outline is a quadratic spline fitted so that it clears the body everywhere; the
  generator raises it until the margin is positive and prints the margin.
