#!/usr/bin/env python3
"""Colour the php-geo-svg equirectangular world map using Natural Earth 110m attributes.

The SVG is Natural Earth 110m Admin-0 countries projected as x = (lon+180)*2, y = (90-lat)*2,
one <path> per polygon, with no names or colours. Each path is matched to the Natural Earth
feature whose vertices contain all of its vertices, then filled by continent or by MAPCOLOR7.

usage: colorize.py map.svg countries.geojson out.svg [--mode political|continent] [--same-as A=B ...]

--same-as A=B colours country A like country B (repeatable). Countries are named by ISO_A2_EH,
ADM0_A3 or NAME, e.g. --same-as TW=CN to colour Taiwan like mainland China.

Inputs (see README.md):
  map.svg            https://raw.githubusercontent.com/PrinsFrank/php-geo-svg/main/docs/images/world-equirectangular.svg
  countries.geojson  https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson
"""
import json
import re
import sys
from collections import Counter
from xml.sax.saxutils import escape

svg_path, geo_path, out_path = sys.argv[1:4]
mode = sys.argv[sys.argv.index('--mode') + 1] if '--mode' in sys.argv else 'political'
same_as = dict(sys.argv[i + 1].split('=', 1) for i, a in enumerate(sys.argv) if a == '--same-as')

OCEAN = '#2f6fae'
ANTARCTICA = '#b9cfdf'
CONTINENT = {
    'Africa': '#e0a23c', 'Asia': '#d9694a', 'Europe': '#9a7bd1', 'North America': '#5aa35a',
    'South America': '#d8c440', 'Oceania': '#e07fa8', 'Seven seas (open ocean)': '#e0a23c',
}
# Natural Earth's MAPCOLOR7: 1..7, chosen so that neighbouring countries differ.
POLITICAL = {1: '#e8a94a', 2: '#7fb069', 3: '#e07a5f', 4: '#a98bd6', 5: '#ecd060', 6: '#5fb3a5', 7: '#d98bb3'}

key = lambda x, y: (round(x, 3), round(y, 3))
features = json.load(open(geo_path))['features']
ids = lambda p: {p['ISO_A2_EH'], p['ADM0_A3'], p['NAME']}
by_id = {k: f['properties'] for f in features for k in ids(f['properties'])}
for a, b in same_as.items():
    if a not in by_id or b not in by_id:
        sys.exit(f'--same-as {a}={b}: unknown country {a if a not in by_id else b}')
owner = {}   # vertex -> set of feature indices
for i, f in enumerate(features):
    g = f['geometry']
    polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
    for poly in polys:
        for ring in poly:
            for lon, lat in ring:
                owner.setdefault(key((lon + 180) * 2, (90 - lat) * 2), set()).add(i)

src = open(svg_path).read()
paths = re.findall(r'<path d="([^"]*)"[^>]*/>', src)
out, unmatched, counts = [], 0, Counter()
for d in paths:
    pts = [tuple(map(float, m)) for m in re.findall(r'[ML]\s*([-\d.eE]+)\s+([-\d.eE]+)', d)]
    votes = Counter()
    for x, y in pts:
        for i in owner.get(key(x, y), ()):
            votes[i] += 1
    if not votes:
        unmatched += 1
        continue
    i, n = votes.most_common(1)[0]
    p = features[i]['properties']
    # Colour taken from another country (--same-as); the path keeps its own name.
    q = next((by_id[b] for a, b in same_as.items() if a in ids(p)), p)
    if q['CONTINENT'] == 'Antarctica':
        fill = ANTARCTICA
    elif mode == 'continent':
        fill = CONTINENT[q['CONTINENT']]
    else:
        fill = POLITICAL[q['MAPCOLOR7']]
    counts[fill] += 1
    # Short path data: 3 decimals is 0.0015 degrees, far below Arch's mesh.
    dd = re.sub(r'(\d+\.\d{3})\d+', r'\1', d)
    out.append(f'  <path data-name="{escape(p["NAME"])}" data-continent="{escape(p["CONTINENT"])}" fill="{fill}" d="{dd}"/>')

with open(out_path, 'w') as fh:
    fh.write('<?xml version="1.0" encoding="UTF-8"?>\n')
    fh.write('<!-- World map, equirectangular (x = (lon+180)*2, y = (90-lat)*2). Shapes: php-geo-svg docs/images/'
             'world-equirectangular.svg (MIT, (c) 2021 PrinsFrank), from Natural Earth 110m countries (public domain). '
             f'Coloured by {"continent" if mode == "continent" else "Natural Earth MAPCOLOR7"}'
             + ''.join(f', {a} coloured like {b}' for a, b in same_as.items()) + '; the ocean is the background. -->\n')
    fh.write(f'<svg xmlns="http://www.w3.org/2000/svg" width="720" height="360" viewBox="0 0 720 360" style="background:{OCEAN}">\n')
    fh.write('\n'.join(out) + '\n</svg>\n')
print(f'{len(out)} paths coloured, {unmatched} unmatched; colours: {dict(counts)} -> {out_path}')
