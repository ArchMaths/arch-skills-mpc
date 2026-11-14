# World globes, an SVG map wrapped onto a sphere

A world map wrapped onto a sphere with `svgsurf`, in two versions. The ocean is the sphere itself;
every land region is a decal of exact parametric patches lying on it.

| File | |
|---|---|
| `world-globe.txt` | Continents: the Arch save file. Open it with Arch's *Open file* (about 15 s to load). |
| `world-globe.arch` | Its scene script (1 sphere, 1159 patches on 3 levels). |
| `world-map.svg` | Its map: equirectangular, 720 x 360, 2 px per degree. |
| `preview.png` | The continent globe as Arch shows it after opening. |
| `world-globe-political.txt` | Countries, with latitude and longitude lines: the Arch save file (about 35 s to load). |
| `world-globe-political.arch` | Its scene script (1 sphere, 2715 patches on 9 levels). |
| `world-map-political-grid.svg` | Its map, with the grid drawn in. |
| `preview-political.png` | The political globe as Arch shows it after opening. |
| `colorize.py` | Colours the downloaded map (Python 3, no dependencies). |
| `graticule.py` | Draws latitude and longitude lines onto the map (Python 3, no dependencies). |

## Source

- Shapes: `docs/images/world-equirectangular.svg` from
  [PrinsFrank/php-geo-svg](https://github.com/PrinsFrank/php-geo-svg) (MIT, © 2021 PrinsFrank). It is
  Natural Earth's 110m Admin-0 countries in plate carrée, x = (lon + 180) x 2, y = (90 - lat) x 2,
  one black `<path>` per polygon with no names.
- Attributes: [Natural Earth](https://www.naturalearthdata.com/) 110m Admin-0 countries (public
  domain), `ne_110m_admin_0_countries.geojson` from
  [nvkelso/natural-earth-vector](https://github.com/nvkelso/natural-earth-vector).

The SVG has the same 10,654 vertices as the GeoJSON, so `colorize.py` matches each path to the
country whose vertices contain all of its own, then fills it:

- `--mode continent` (`world-map.svg`): by continent. Natural Earth places Russia in Europe.
- `--mode political` (`world-map-political-grid.svg`): by Natural Earth's `MAPCOLOR7`, seven colours
  chosen so that neighbouring countries differ. This map colours Taiwan like mainland China
  (`--same-as TW=CN`; `--same-as` takes `ISO_A2_EH`, `ADM0_A3` or `NAME`).

Antarctica is pale ice blue in both. The ocean colour (#2f6fae) is the SVG's CSS background, so it is
not drawn as a shape; `svgsurf --base` paints the sphere in that colour instead.

## Latitude and longitude

`graticule.py` draws parallels and meridians every 15° into the map before it is wrapped, so the
grid is made of decals like the countries: it lies on the globe and keeps its width as you zoom,
like a printed globe. Lines are 0.6° of arc wide; the equator and the prime meridian are 1.2°.
Meridians widen towards the poles in the flat map as 1/cos(latitude), which makes them the same
width everywhere on the sphere. They stop at 75°, except every 90°, which run on to 85°.

The grid is two paths, parallels and meridians, at `fill-opacity` 0.99. svgsurf does not cut
translucent shapes out of the map beneath them (that would add thousands of patches); it puts them
on levels of their own above it. Drawn as one shape with all its crossings, the grid would take 730
patches; as two, it takes 166. At 0.99 it looks opaque.

Space curves, Arch's other way to draw lines in 3D, were tried first. They keep a constant pixel
width and have to float above the highest decal, so their far halves stick out past the globe's
outline as a ring. The decal grid shows only a faint hairline there. Arch has no text in 3D, so the
lines carry no degree labels.

## Rebuild

```sh
curl -sSLO https://raw.githubusercontent.com/PrinsFrank/php-geo-svg/main/docs/images/world-equirectangular.svg
curl -sSLO https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson
G=examples/world-globe

# Continents
python3 $G/colorize.py world-equirectangular.svg ne_110m_admin_0_countries.geojson $G/world-map.svg --mode continent
node src/svgsurf.js $G/world-map.svg --base '#2f6fae' --view "azimuth=20 elevation=20 unit=100" -o $G/world-globe.arch
sed -i '1s/.*/@title World globe/' $G/world-globe.arch
node src/cli.js $G/world-globe.arch -o $G/world-globe.txt --timeout 600

# Countries, with latitude and longitude
python3 $G/colorize.py world-equirectangular.svg ne_110m_admin_0_countries.geojson political.svg \
    --mode political --same-as TW=CN
python3 $G/graticule.py political.svg $G/world-map-political-grid.svg --step 15
node src/svgsurf.js $G/world-map-political-grid.svg --base '#2f6fae' --view "azimuth=20 elevation=20 unit=100" \
    -o $G/world-globe-political.arch
sed -i '1s/.*/@title Political world globe with latitude and longitude/' $G/world-globe-political.arch
node src/cli.js $G/world-globe-political.arch -o $G/world-globe-political.txt --timeout 1500
```

The continent build takes about 3 minutes, the political one about 14. The sphere preset
maps the picture's left and right edges to longitude -180° and 180°, its top to the north pole and
its bottom to the south pole, so an equirectangular map lands on the globe unchanged.

The political globe has more than twice the patches of the continent one, because country borders
cut the land into many more strips. Its save file is 19 MB against 9 MB, and takes about 35 s to open against about 15 s.
