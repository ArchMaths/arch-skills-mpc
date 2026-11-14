#!/usr/bin/env python3
"""Draw latitude and longitude lines (a graticule) onto an equirectangular world map SVG.

usage: graticule.py map.svg out.svg [--step 15] [--width 0.6] [--major-width 1.2] [--color #f6edd0]

The map must be plate carree over the whole viewBox: x from longitude -180 to 180, y from
latitude 90 (top) to -90. The grid is appended as one <path> on top of the map, so svgsurf
wraps it onto the globe with the map: it lies on the surface (no line floats beside the globe
at its edge) and its lines keep their width as the globe is zoomed, like a printed globe.

Widths are in degrees of arc on the globe. Parallels are bands of constant height; meridians
widen towards the poles as 1/cos(latitude), so they too look the same width everywhere on the
sphere. Meridians stop at the last parallel short of the poles, except every 90 degrees, which
run on to within step/3 of the pole. The equator and the prime meridian get --major-width.

The grid is two paths, parallels and then meridians, with fill-opacity 0.99. svgsurf treats
translucent shapes differently from opaque ones: they are not cut out of the map beneath (that would
add thousands of patches), but go on levels of their own above it, the meridians one level above
the parallels where they cross. Kept apart, each set breaks into a few long strips; one shape with
every crossing would take about four times as many patches. At 0.99 the grid looks opaque.
"""
import math
import re
import sys

args = sys.argv[1:]
opt = lambda name, default: args[args.index(name) + 1] if name in args else default
src, dst = args[0], args[1]
step = float(opt('--step', '15'))
width, major = float(opt('--width', '0.6')), float(opt('--major-width', '1.2'))
color, opacity = opt('--color', '#f6edd0'), opt('--opacity', '0.99')

svg = open(src).read()
vb = re.search(r'viewBox="([^"]+)"', svg)
x0, y0, W, H = map(float, vb.group(1).split())
X = lambda lon: x0 + (lon + 180) / 360 * W
Y = lambda lat: y0 + (90 - lat) / 180 * H
kx, ky = W / 360, H / 180          # picture units per degree
f = lambda v: f'{v:.3f}'.rstrip('0').rstrip('.')

last = step * math.floor((90 - 1e-9) / step)             # highest parallel short of the pole
if last >= 90 - step / 3:
    last -= step
pole = 90 - step / 3

parallels, meridians = [], []
n = int(round(last / step))
for k in range(-n, n + 1):
    lat = k * step
    h = (major if k == 0 else width) / 2 * ky
    parallels.append([(X(-180), Y(lat) + h), (X(180), Y(lat) + h), (X(180), Y(lat) - h), (X(-180), Y(lat) - h)])


def meridian(lon, w, top):
    """Band around longitude lon, half-width w/2 degrees of arc, i.e. w/2/cos(lat) of longitude."""
    lats, t = [], 0.0
    while t < top - 1e-9:
        lats.append(t)
        t += step / 2
    lats.append(top)
    half = [w / 2 / math.cos(math.radians(a)) * kx for a in lats]
    right = [(X(lon) + d, Y(a)) for a, d in zip(lats, half)]          # equator to north end
    right = [(X(lon) + d, Y(-a)) for a, d in reversed(list(zip(lats, half)))][:-1] + right
    left = [(2 * X(lon) - x, y) for x, y in reversed(right)]
    return right + left


m = int(round(180 / step))
for k in range(-m, m):
    lon = k * step
    top = pole if lon % 90 == 0 else last
    ring = meridian(lon, major if lon == 0 else width, top)
    if lon == -180:
        # The antimeridian straddles the picture's left and right edges: half on each side.
        meridians.append([(max(x, X(-180)), y) for x, y in ring])
        meridians.append([(min(x + W, X(180)), y) for x, y in ring])
    else:
        meridians.append(ring)

d = lambda rings: ' '.join('M' + ' L'.join(f'{f(x)} {f(y)}' for x, y in ring) + ' Z' for ring in rings)
path = (f'  <!-- Graticule: latitude and longitude every {step:g} degrees (graticule.py) -->\n'
        f'  <path data-name="parallels" fill="{color}" fill-opacity="{opacity}" d="{d(parallels)}"/>\n'
        f'  <path data-name="meridians" fill="{color}" fill-opacity="{opacity}" d="{d(meridians)}"/>\n')
open(dst, 'w').write(svg.replace('</svg>', path + '</svg>'))
print(f'{n * 2 + 1} parallels, {2 * m} meridians -> {dst}')
