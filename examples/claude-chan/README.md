# Claude Chan, a 3D Arch figure

Claude Chan (Claude娘: orange hair and a chrysanthemum motif) as a static 3D figure, built from her
design sheet with nothing but parametric surfaces and a few curves.

| File | |
|---|---|
| `claude-chan-3d.txt` | The Arch save file. Open it with Arch's *Open file*. |
| `claude-chan-3d.arch` | The scene script it was built from (416 objects). |
| `generate.py` | Writes the scene script. `face.py`, `outfit.py`, `hair.py` and `scene.py` are its parts. |

Opening the file takes a few minutes: it is saved with `implicitPrecision=10`, so each surface is
meshed on a 125 x 125 grid instead of Arch's default 50 x 50. Lower the *equation, inequality and
parametric surface precision* slider in Arch's settings for faster redraws while rotating.

## What is modelled

- **Head**: sculpted from parts. The face is a stack of horizontal arcs whose width, depth and
  roundness change with height, so it has a real profile: forehead, the dip between the eyes, a small
  pointed nose, lips, a receding chin, and a jawline that runs up to the ear. Seen from the front the
  outline is a small chin under full, round cheeks; the round of each cheek, the brow and the eye
  sockets are shallow bumps and hollows on top. Under the jaw, the neck, and ears with helix, fold,
  concha, tragus and lobe.
- **Face**: long, half-lidded eyes as on the sheet: a heavy, nearly level lash line that ends in a wing,
  a bowl-shaped lower lid, an amber iris that is shaded under the lid and golden below, pupil, two
  highlights, the fold of the lid, lower lash line, and thin brows that slope gently outward. A small
  shadow under the tip of the nose, a calm closed smile, a faint blush.
- **Hair**: every lock starts at the crown, lies on the head, and falls from there, so the top of the
  hair and the long hair are the same surfaces. Down the back the locks fall straight in three layers;
  at the sides they fan out over the shoulders and arms; in front of the ears thinner locks fall over
  the chest. Locks wave more toward their ends and finish in a curled tip. Side-swept bangs with a tuft
  between the eyes, locks framing the face, and a three-strand braid crown around the back of the head.
- **Accessories**: a chrysanthemum on a black bow with cream ribbons and a gold tassel above her left
  ear; gold tassel earrings.
- **Outfit**: high ruffled collar and jabot, black ascot with a chrysanthemum brooch, cream capelet with
  gold trim and chrysanthemum emblems, bishop sleeves with lacing and two-tone ruffled cuffs, black
  corset with gold buttons, piping, chain, ring and tassel, a pleated cream skirt with orange
  embroidery, a frilled petticoat, a black overskirt lined in orange with gold-trimmed lapels, hip bows
  with chrysanthemums, chains and tassels, an orange back panel with a black bow, cream lace-up boots.
- **Props**: a leather book with gold corners, a chrysanthemum emblem and a ribbon bookmark; a display base.

## Rebuilding

```sh
python3 examples/claude-chan/generate.py         # writes claude-chan-3d.arch (needs numpy)
node src/cli.js examples/claude-chan/claude-chan-3d.arch -o examples/claude-chan/claude-chan-3d.txt --timeout 3600
```

`generate.py --prec 4` writes a quicker version; `--parts head,hair` limits it to some parts and
`--view face` frames the face. The views and parts are listed in `generate.py`.

## How it is built

- Every part is a parametric surface `(X,Y,Z,u,u0,u1,v,v0,v1)`. Shared shapes are Arch user functions.
- **Face.** For each height `h` the face is a superellipse arc from one side of the head around the
  front to the other: half-width `fwd(h)`, depth `fd(h)`, exponent `fq(h)` (boxy across the eyes,
  rounder over the cheeks and jaw). The side profile `fpl(h)` and the front outline `fws(h)` are
  natural cubic splines through points read off the sheet, written for Arch as
  `a + b d + sum c_i max(0, h - k_i)^3`. `fr(p,h)` adds the nose, lips, chin, cheeks, brow and eye
  sockets as Gaussian bumps. The same surface is drawn as nine patches (each cheek, the nose and mouth,
  each eye, the bridge of the nose, the brow) that share their edges exactly, so every part gets its
  own fine mesh and no seam shows.
- **Eyes, brows, mouth** are thin decals that follow the face. Arch expands user functions as text, so
  a decal that called the full face function with a long argument would grow to thousands of terms;
  `generate.py` fits the face over the eye and brow regions with small polynomials (within 0.001) and
  the decals use those.
- **Hair.** A lock is a tube around a flow line on one guiding surface: a dome around the head for the
  first part of its length `t`, then an ellipse whose half-axes `hrx(t)`, `hry(t)` are fitted so the
  hair clears the shoulders, capelet, arms, book and skirt everywhere (the generator prints the
  margin). Each lock has its own angle, drift, wave, layer, width and length. Its tip turns through
  three quarters of a circle with the cross-section turning along, either sideways (a hook) or outward
  (a scroll), and is a separate surface so the curl gets a fine mesh.
- **Braid.** Three strands follow an oval ring on the dome and weave as `sin(tau)` across the ring and
  `sin(2 tau)` in height, a third of a turn apart.
- Arch lights a surface at half strength where its normal faces away from the camera, so the generator
  evaluates every surface in Python and swaps its two parameter ranges when the normals point inward.
