# World globe, an SVG map wrapped onto a sphere

A world map, coloured by continent, wrapped onto a sphere with `svgsurf`. The ocean is the
sphere itself; every land region is a decal of exact parametric patches lying on it.

| File | |
|---|---|
| `world-globe.txt` | The Arch save file. Open it with Arch's *Open file* (it takes about 15 s to load). |
| `world-globe.arch` | The scene script it was built from (1 sphere, 1159 patches on 3 levels). |
| `world-map.svg` | The coloured map: equirectangular, 720 x 360, 2 px per degree. |
| `colorize.py` | Colours the downloaded map (Python 3, no dependencies). |
| `preview.png` | The file as Arch shows it after opening. |

## Source

- Shapes: `docs/images/world-equirectangular.svg` from
  [PrinsFrank/php-geo-svg](https://github.com/PrinsFrank/php-geo-svg) (MIT, © 2021 PrinsFrank). It is
  Natural Earth's 110m Admin-0 countries in plate carrée, x = (lon + 180) x 2, y = (90 - lat) x 2,
  one black `<path>` per polygon with no names.
- Attributes: [Natural Earth](https://www.naturalearthdata.com/) 110m Admin-0 countries (public
  domain), `ne_110m_admin_0_countries.geojson` from
  [nvkelso/natural-earth-vector](https://github.com/nvkelso/natural-earth-vector).

The SVG has the same 10,654 vertices as the GeoJSON, so `colorize.py` matches each path to the
country whose vertices contain all of its own. It then fills the path by the country's continent
(Natural Earth places Russia in Europe). Antarctica is pale ice blue. The ocean colour (#2f6fae) is
the SVG's CSS background, so it is not drawn as a shape; `svgsurf --base` paints the sphere in that
colour instead.

## Rebuild

```sh
curl -sSLO https://raw.githubusercontent.com/PrinsFrank/php-geo-svg/main/docs/images/world-equirectangular.svg
curl -sSLO https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson
python3 examples/world-globe/colorize.py world-equirectangular.svg ne_110m_admin_0_countries.geojson \
    examples/world-globe/world-map.svg --mode continent
node src/svgsurf.js examples/world-globe/world-map.svg --base '#2f6fae' \
    --view "azimuth=20 elevation=20 unit=100" -o examples/world-globe/world-globe.arch
sed -i '1s/.*/@title World globe/' examples/world-globe/world-globe.arch
node src/cli.js examples/world-globe/world-globe.arch -o examples/world-globe/world-globe.txt --timeout 600
```

The build takes about 3 minutes. The sphere preset maps the picture's left and right edges to
longitude -180° and 180°, its top to the north pole and its bottom to the south pole, so an
equirectangular map lands on the globe unchanged.

`--mode political` colours each country by Natural Earth's `MAPCOLOR7` instead (seven colours,
neighbours always different). Country borders cut the land into many more strips: 2549 patches on
7 levels and a 4.4 MB script, more than twice the continent version, and slower to open and rotate.
