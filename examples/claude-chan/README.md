# Claude Chan, a 3D Arch figure

Claude Chan (Claude娘: orange hair and a chrysanthemum motif) as a static 3D figure, built from her
design sheet with nothing but parametric surfaces and a few curves.

| File | |
|---|---|
| `claude-chan-3d.txt` | The Arch save file. Open it with Arch's *Open file*. |
| `claude-chan-3d.arch` | The scene script it was built from (439 objects). |
| `generate.py` | Writes the scene script. `face.py`, `outfit.py`, `hair.py` and `scene.py` are its parts. |

Opening the file takes several minutes (it is about 11 MB): it is saved with `implicitPrecision=10`, so
each surface is meshed on a 125 x 125 grid instead of Arch's default 50 x 50, and the turned head's
surfaces are about three times as long to evaluate. Lower the *equation, inequality and parametric
surface precision* slider in Arch's settings for faster redraws while rotating.

## What is modelled

- **Proportions**: measured on the sheet's full-body front view (正面). Her head, crown to chin, is 1/7.9
  of her height; the elbows are at the waist, the cuffs at the hips and the fingertips at mid-thigh, with
  the arms held a little away from the skirt. The skirt flares from the corset in a straight A-line, as
  wide as the sheet's at every height, and ends high enough to show the lace-up boots.
- **Head**: sculpted from parts, tilted toward her right shoulder and turned a little to her right, which
  gives her a lively pose. The tilt is 7 degrees at the eyes, between the sheet's calm portraits (7 to 9
  degrees) and its full-body front view (about 3). The face is a
  stack of horizontal arcs whose width, depth and roundness change with height, so it has a real profile:
  forehead, the dip between the eyes, a small pointed nose, lips, a receding chin, and a jawline that
  runs up to the ear. Seen from the front the jaw runs nearly straight from the cheekbones to a blunt,
  rounded chin: the portrait's V-shaped jaw, a little softer so it reads well in 3D. The round of each
  cheek, the brow and the eye sockets are shallow bumps and hollows on top. Under the jaw, the neck,
  and ears with helix, fold, concha, tragus and lobe.
- **Face**: the expression of the natural-smile portrait. Long, heavy-lidded almond eyes, each with its own
  shape as in the drawing: a bold lash line that starts thin at the inner corner, covers the top quarter of
  the iris and runs on past the outer corner into a long flat wing; a shallow lower lid drawn as one thin
  line from a small hook at the inner corner; both corners left open, with white showing between the lash
  line and the lower lid. A round iris resting on the lower lid, dark mauve-brown under the lid, warm
  brown in the middle and a peach-gold crescent below, a pupil tucked under the lash line and one small
  highlight on the viewer's right. Above each eye a pink-brown tint and the fold of the lid. Thin, long,
  nearly straight brows high above the eyes, carried over the bangs where a lock crosses them, as the
  sheet draws them. A thin L-shaped line down the side of the nose and under its tip, a highlight above
  the tip, a calm closed smile and a faint blush. Skin, iris and hair colours are sampled from the sheet.
- **Hair**: every lock starts at the crown, lies on the head, and falls from there, so the top of the
  hair and the long hair are the same surfaces. Down the back the locks fall straight in three layers;
  at the sides they fan out over the shoulders and arms; in front of the ears thinner locks fall over
  the chest. Locks wave more toward their ends and finish in a curled tip. The bangs follow the
  portrait: one wide lock sweeps down to the bridge of the nose, the forehead shows in a tall triangle
  above her left eye, a lock sweeps over her left temple, and a smaller gap above her right eye is
  framed by the locks at the side. The wide lock and the temple lock are made of narrow, rounded strands
  laid along the strand lines drawn on the sheet, stacked on each other, with staggered pointed tips and
  a lighter streak down the main ones. Locks fall from the temples to below the jaw: beside the face on
  her right, so the whole jaw line shows, and over the outer cheek on her left, where thin strands
  flick inward.
  A three-strand braid crown around the back of the head.
- **Accessories**: a chrysanthemum on a black bow with cream ribbons and a gold tassel above her left
  ear; gold tassel earrings.
- **Outfit**: high ruffled collar and jabot, black ascot with a chrysanthemum brooch, cream capelet with
  gold trim and chrysanthemum emblems, bishop sleeves with lacing and two-tone ruffled cuffs, black
  corset with gold buttons, piping, chain, ring and tassel, a pleated cream skirt with orange
  embroidery, a frilled petticoat, a black overskirt lined in orange with gold-trimmed lapels, hip bows
  with chrysanthemums, chains and tassels, an orange back panel with a black bow, cream lace-up boots.
- **Hands**: palm, two-jointed fingers and thumb, half as long as her head and about as wide as the
  cuffs they come out of, as on the sheet. Her right hand hangs relaxed and turned out; her left holds the
  book at her side.
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
  `generate.py` fits the face over the eye and brow regions with small polynomials (within 0.002) and
  the decals use those.
- **Matching the portrait.** The eye, brow, nose and mouth outlines were traced over the natural-smile
  portrait, placed on the model by its pupils and projected onto this face from the portrait's angle, so
  they land where the drawing puts them with the head's tilt and turn accounted for. Each eye keeps the
  points measured that way (`EYES` in `face.py`): its upper lid, the top of its lash line and its lower
  lid, relative to its own iris, written for Arch as one short polynomial each. The bangs were placed the
  same way, against the portrait's border between hair and skin.
- **Bangs as strands.** A strand is a blade from the crown over the dome to the hairline, then through a
  middle point to a pointed tip just in front of the face; its section is narrow and round, so the light
  falls off across it like hair. Strands that overlap are lifted off the dome by different amounts so they
  lie on each other instead of cutting through, and a thin dark layer under the wide lock shows between
  its strands like the drawing's strand lines. The lighter streak is a thin ribbon on the front of a strand
  that tapers away at both ends.
- **Brows over the hair.** Each brow is a decal on the skin; where a lock of the bangs crosses it, the
  generator samples the front of that lock along the brow and adds a short strip just in front of it,
  so the brow shows over the hair from the front and three-quarter views.
- **Hair.** A lock is a tube around a flow line on one guiding surface: a dome around the head for the
  first part of its length `t`, then an ellipse whose half-axes `hrx(t)`, `hry(t)` are fitted so the
  hair clears the shoulders, capelet, arms, book and skirt everywhere (the generator prints the
  margin). Each lock has its own angle, drift, wave, layer, width and length. Its tip turns through
  three quarters of a circle with the cross-section turning along, either sideways (a hook) or outward
  (a scroll), and is a separate surface so the curl gets a fine mesh.
- **Head turn.** The generator draws the head's parts inside a turned block: each coordinate is
  replaced by a fixed combination of all three (a rotation about the top of the neck). The long locks
  use the same rotation with an angle that eases from the head's to zero down the lock, hb(t), so they
  turn with the head where they lie on it and hang straight below. The head is modelled large for its
  detail and scaled down (0.82) about the same point, by the same block; the long locks ease from that
  scale to none as they leave the head. Earrings and tassels hang straight from their turned attachment
  points and are scaled with the head.
- **Skirt.** The skirt is drawn from z 8.4 to 1.35 and raised as a whole (a raised block adds to every
  z), so its many parts keep their own measurements.
- **Braid.** Three strands follow an oval ring on the dome and weave as `sin(tau)` across the ring and
  `sin(2 tau)` in height, a third of a turn apart.
- Arch lights a surface at half strength where its normal faces away from the camera, so the generator
  evaluates every surface in Python and swaps its two parameter ranges when the normals point inward.
