# Run inside generate.py: Claude Chan's head, built from separate sculpted parts.
sc.blank()
sc.note('Face')
sc.comment("""The head is built from parts: a face shell, the back of the skull, a jaw underside, nose, ears, neck.
Face shell: for each height h, a superellipse arc from one side of the head around the front to the other.
fcw(h) is the half-width (it narrows along the jaw to a soft pointed chin), fcy(h) the depth of the
centre line (the forehead slopes back, the chin comes forward a little), fcs(h) where the arc meets the
side of the head (moving forward along the jaw), and fcf adds cheek fullness and a slight inset at the eyes.
fy(p,h) is the y of the face at x=p, so eyes, brows and mouth are painted on as thin decals just in front.""")
sc.func('fcw(h)', '(0.87-0.06*((h-11.9)/0.85)^2)*max(0,1-(max(0,11.62-h)/0.62)^1.7)^0.55')
sc.func('fcy(h)', '-0.9+0.5*max(0,h-12)^2+0.06*(max(0,11.45-h)/0.45)^1.3-0.02*exp(-((h-11.06)/0.05)^2)')
sc.func('fcs(h)', '0.2-0.3*(max(0,11.35-h)/0.35)^1.4')
sc.func('fcf(p,h)', '0.018*exp(-((abs(p)-0.37)/0.16)^2-((h-11.8)/0.12)^2)-0.015*exp(-((abs(p)-0.47)/0.18)^2-((h-11.5)/0.2)^2)')
sc.func('fy(p,h)', 'fcs(h)-(fcs(h)-fcy(h))*max(0,1-(p/fcw(h))^2)^0.375+fcf(p,h)')
sc.surface(('fcw(h)*sin(f)', 'fcs(h)-(fcs(h)-fcy(h))*abs(cos(f))^0.75+fcf(fcw(h)*sin(f),h)', 'h'),
           ('h', 11.0, 12.75), ('f', '-pi/2', 'pi/2'), SKIN, 'face', ('point', (0, 0.1, 11.8)))
sc.surface(('0.88*sin(u)*cos(v)', '0.08+0.98*sin(u)*sin(v)', '12.0+1.03*cos(u)'), ('u', 0, 'pi'), ('v', 0, 'pi'), SKIN, 'skull', ('point', (0, 0.08, 12.0)))
capsule((0, 0.1, 10.15), (0, 0.04, 11.45), 0.19, 0.185, SKIN_SH, 'neck')
ellipsoid((0, -0.3, 11.16), (0.3, 0.4, 0.08), SKIN_SH, 'jaw')


def fdec(X, Z, d, U, V, color, ref, opacity=None, q='fy'):
    """Decal on the face: (X, Z) in terms of the two parameters, d in front of the skin.
    q names the face function used: fy itself, or a cheaper local fit of it (see qfit)."""
    sc.surface((X, f"{q}({X},{Z})-{fmt(d)}", Z), U, V, color, ref, ('dir', (0, -1, 0)), opacity=opacity)


import numpy as np


def qfit(name, x0, x1, z0, z1, ellipse=False, exact_fcf=True):
    """Least-squares fit of the face surface over a small region, written as a cheap polynomial.
    Arch expands user functions textually, so painting many decals with the exact fy is slow;
    a local fit keeps each decal to a few dozen operations."""
    fyf = sc.ns['fy']
    xc, zc = (x0 + x1) / 2, (z0 + z1) / 2
    terms = [(i, j) for j in range(4) for i in range(6 - j)]     # a^i b^j, i up to 5, j up to 3
    rows, vals = [], []
    for x in np.linspace(x0, x1, 45):
        for z in np.linspace(z0, z1, 45):
            a_, b_ = x - xc, z - zc
            if ellipse and (a_ / (x1 - xc)) ** 2 + (b_ / (z1 - zc)) ** 2 > 1:
                continue
            rows.append([a_ ** i * b_ ** j for i, j in terms])
            vals.append(fyf(x, z) - (sc.ns['fcf'](x, z) if exact_fcf else 0))
    c, *_ = np.linalg.lstsq(np.array(rows), np.array(vals), rcond=None)
    err = float(np.max(np.abs(np.array(rows) @ c - np.array(vals))))
    A, B = f"(p-{fmt(xc)})", f"(h-{fmt(zc)})"
    def poly_a(j):
        cs = [c[k] for k, (i, jj) in enumerate(terms) if jj == j]
        return horner(cs, A)
    body = poly_a(3)
    for j in (2, 1, 0):
        body = f"{poly_a(j)}+{B}*({body})"
    if exact_fcf:
        body = f"{body}+fcf(p,h)"
    sc.func(f'{name}(p,h)', body)
    print(f'  fit {name}: max error {err:.4f}', file=sys.stderr)
    return name


sc.comment("""Cheap local fits of the face surface (qfit in the generator) for the eye, cheek, nose and mouth
regions; decals there use them instead of fy.""")
qfit('qeL', 0.1, 0.7, 11.64, 12.06, ellipse=True)
qfit('qeR', -0.7, -0.1, 11.64, 12.06, ellipse=True)
qfit('qbL', 0.1, 0.62, 12.0, 12.16)
qfit('qbR', -0.62, -0.1, 12.0, 12.16)
qfit('qcL', 0.32, 0.68, 11.48, 11.64, ellipse=True)
qfit('qcR', -0.68, -0.32, 11.48, 11.64, ellipse=True)
qfit('qn', -0.07, 0.07, 11.4, 11.7)
qfit('qm', -0.11, 0.11, 11.2, 11.34)


sc.comment("Shadow cast by the bangs on the forehead, with a ragged lower edge (it shows between strands).")
fdec('p', '(12.0+0.09*abs(sin(7*p+0.5))+0.06*abs(sin(13*p+1.3))+eta*(12.62-12.0-0.09*abs(sin(7*p+0.5))-0.06*abs(sin(13*p+1.3))))',
     0.002, ('p', -0.8, 0.8), ('eta', 0, 1), SKIN_SH, 'hairShadow')

sc.comment("""Nose: a narrow ridge rising out of the face to a small tip, then tucking back under it; a soft
highlight on the tip and the small side shadow anime faces use to suggest the nose.""")
sc.func('nh(t)', '0.002+0.055*min(t,1)^3*(1-max(0,t-1)/0.25)^0.7')
Xn = '(0.018+0.02*min(t,1))*sin(f)'
Zn = '(11.66-0.16*min(t,1)-0.05*max(0,t-1))'
sc.surface((Xn, f"qn({Xn},{Zn})-nh(t)*abs(cos(f))^1.3", Zn), ('t', 0, 1.25), ('f', '-pi/2', 'pi/2'), SKIN, 'nose', ('dir', (0, -1, 0)))
sc.surface((Xn, f"qn({Xn},{Zn})-nh(t)*abs(cos(f))^1.3-0.0015", Zn), ('t', 0.74, 0.95), ('f', -0.55, 0.25), '#fbe2d8', 'noseShine', ('dir', (0, -1, 0)))
fdec('(-(0.026+0.016*hh)-0.012*q*(1-hh))', '(11.6-0.1*hh)', 0.002, ('q', 0, 1), ('hh', 0, 1), '#d8957f', 'noseShadow', q='qn')

EAR_LOBES = {}
sc.comment("Ears: a dished shell with a rolled helix, an inner fold, the concha, tragus and lobe.")
for side, tag in ((1, 'L'), (-1, 'R')):
    n = unit((side, 0.18, 0))
    up0 = (0, 0.28, 1)
    b = unit(sub(up0, mul(n, dot(up0, n))))
    a = cross(b, n)
    if dot(a, (0, 1, 0)) < 0:
        a = mul(a, -1)          # a points toward the back of the head
    C = (side * 0.87, 0.16, 11.6)
    fr = (a, b, n)
    sc.surface(place(("0.115*r*cos(w)-0.01", "0.2*r*sin(w)", "0.014+0.03*r^6-0.012*(1-r^2)"), C, fr), ('r', 0, 1), ('w', 0, '2*pi'), SKIN, f'ear{tag}', ('dir', n))
    sc.surface(place(("0.115*r*cos(w)-0.01", "0.2*r*sin(w)", "-0.004-0.012*(1-r^2)"), C, fr), ('r', 0, 1), ('w', 0, '2*pi'), SKIN_SH, f'earBack{tag}', ('dir', mul(n, -1)))
    sc.surface(place(("(0.115+0.02*cos(v))*cos(w)-0.01", "(0.2+0.02*cos(v))*sin(w)", "0.042+0.02*sin(v)"), C, fr), ('w', -1.75, 2.05), ('v', 0, '2*pi'), SKIN, f'earHelix{tag}', ('tube', 'u'))
    sc.surface(place(("(0.065+0.012*cos(v))*cos(w)+0.005", "(0.12+0.012*cos(v))*sin(w)+0.01", "0.03+0.012*sin(v)"), C, fr), ('w', -1.1, 1.7), ('v', 0, '2*pi'), SKIN, f'earFold{tag}', ('tube', 'u'))
    sc.surface(place(("0.05*r*cos(w)-0.005", "0.075*r*sin(w)-0.035", "0.016"), C, fr), ('r', 0, 1), ('w', 0, '2*pi'), '#d69482', f'earConcha{tag}', ('dir', n))
    ellipsoid(add(C, add(mul(a, -0.1), mul(b, -0.03))), (0.022, 0.03, 0.022), SKIN, f'earTragus{tag}', fr=fr)
    lobe = add(C, mul(b, -0.19))
    EAR_LOBES[tag] = lobe
    ellipsoid(lobe, (0.045, 0.05, 0.03), SKIN, f'earLobe{tag}', fr=fr)

# ---------------- eyes ----------------
sc.blank()
sc.note('Eyes')
sc.comment("""Almond eyes with gently lowered lids for her calm smile. For an eye, xi runs from the inner corner
(-1) to the outer corner (+1); eu and el are the upper and lower lid heights above the eye line.
ecl clips a height between the lids, so the upper lid hides the top of the iris. Layers, back to front:
eye white and the lid's shadow on it, iris (amber, darkening toward the top, golden below), the radial
pattern around the pupil and light streaks, rim, pupil, highlights, then lashes, crease and brow.""")
sc.func('eu(xi)', '0.012+0.16*(1-min(1,xi^2))^0.55-0.025*min(xi,1)+0.02*xi*(1-min(1,xi^2))')
sc.func('el(xi)', '-0.085*(1-min(1,xi^2))^0.7-0.015*min(xi,1)')
sc.func('ecl(xi,hh)', 'max(el(xi),min(eu(xi),hh))')
sc.func('lt(xi)', '(0.016+0.03*min(1,max(0,(xi+0.2)/1.0)))*min(1,(xi+1)/0.3)^0.5*min(1,max(0,1.3-xi)/0.3)^0.8')
sc.func('ltop(xi)', 'eu(min(xi,1))-0.06*max(0,xi-1)+lt(xi)')
EZ = 11.79
AW = 0.215
LASH = '#28130e'


def eye_layers(side, tag):
    ex = 0.37 * side
    sg = side
    QE = 'qeL' if side > 0 else 'qeR'
    QC = 'qcL' if side > 0 else 'qcR'
    XI = f"{fmt(ex)}+{fmt(sg * AW)}*xi"
    fdec(XI, f"{EZ}+el(xi)+eta*(eu(xi)-el(xi))", 0.004, ('xi', -1, 1), ('eta', 0, 1), '#f6f3f8', f'eyeWhite{tag}', q=QE)
    fdec(XI, f"{EZ}+eu(xi)-eta*0.05*(1-min(1,xi^2))^0.4", 0.005, ('xi', -1, 1), ('eta', 0, 1), '#d9cdda', f'lidShadow{tag}', q=QE)
    fdec(f"{fmt(ex - sg * AW * 1.0)}+{fmt(0.014 * sg)}*r*cos(w)", f"{EZ + 0.026}+0.011*r*sin(w)", 0.006, ('r', 0, 1), ('w', 0, '2*pi'), '#e7a09d', f'tearDuct{tag}', q=QE)
    icx, icz, rx, rz = ex + sg * 0.005, EZ - 0.002, 0.136, 0.168
    xa, xb = (-0.005 - rx) / AW, (-0.005 + rx) / AW   # xi range covered by the iris (same for both eyes)

    def band(a, b, rs, d, color, ref, lift=0.0):
        """Part of the iris ellipse (heights a..b of its half-height, scale rs), clipped by the lids."""
        S = f"sqrt(max(0,1-(({fmt(AW)}*xi+0.005)/{fmt(rx * rs)})^2))"
        lo = f"max(el(xi)+{fmt(lift)},{fmt(icz - EZ)}+{fmt(rz * rs * a)}*{S})"
        hi = f"min(eu(xi),{fmt(icz - EZ)}+{fmt(rz * rs * b)}*{S})"
        Z = f"{EZ}+{lo}+eta*(max({lo},{hi})-{lo})"
        fdec(XI, Z, d, ('xi', xa * rs, xb * rs), ('eta', 0, 1), color, ref, q=QE)

    def polar(cx, cz, ax, az, rr, ww, d, color, ref, rad='r'):
        fdec(f"{fmt(cx)}+{fmt(ax)}*{rad}*cos(w)", f"{fmt(cz)}+{fmt(az)}*{rad}*sin(w)", d, ('r', rr[0], rr[1]), ('w', ww[0], ww[1]), color, ref, q=QE)

    band(-1, 1, 1.0, 0.0075, '#3a1606', f'irisRim{tag}')
    band(-1, 1, 0.9, 0.0085, '#d9822a', f'iris{tag}')
    band(-0.7, -0.1, 0.75, 0.0105, '#ffcf5c', f'irisGlow{tag}')
    band(0.05, 0.42, 0.9, 0.0105, '#a34a16', f'irisMid{tag}')
    band(0.34, 1, 0.9, 0.011, '#5e2410', f'irisTop{tag}')
    polar(icx, icz + 0.01, 1, 1.12, (0, 1), (0, '2*pi'), 0.0125, '#b0561b', f'irisFlower{tag}', rad='r*(0.05+0.028*abs(cos(5*w))^1.5)')
    for k in range(5):
        th = -math.pi / 2 + (k - 2) * 0.36
        c, s_ = math.cos(th), math.sin(th)
        fdec(f"{fmt(icx)}+{fmt(rx * c)}*rho-{fmt(s_)}*0.007*q*(1.1-rho)", f"{fmt(icz)}+{fmt(rz * s_)}*rho+{fmt(c)}*0.007*q*(1.1-rho)",
             0.0135, ('rho', 0.3, 0.5), ('q', -1, 1), '#ffe39a', f'irisStreak{tag}{k + 1}', q=QE)
    polar(icx, icz + 0.012, 0.054, 0.09, (0, 1), (0, '2*pi'), 0.015, '#5a2008', f'pupilHalo{tag}')
    polar(icx, icz + 0.012, 0.038, 0.068, (0, 1), (0, '2*pi'), 0.016, '#260a03', f'pupil{tag}')
    # a soft reflection along the lower lid inside the iris
    fdec(XI, f"{EZ}+el(xi)+0.008+eta*0.014*sqrt(max(0,1-((xi-{fmt((xa + xb) / 2)})/{fmt((xb - xa) * 0.42)})^2))", 0.017,
         ('xi', (xa + xb) / 2 - (xb - xa) * 0.42, (xa + xb) / 2 + (xb - xa) * 0.42), ('eta', 0, 1), '#ffefbd', f'irisReflect{tag}', q=QE)
    polar(icx - 0.045, icz + 0.06, 0.043, 0.051, (0, 1), (0, '2*pi'), 0.019, 'white', f'shine{tag}')
    polar(icx + 0.052, icz - 0.04, 0.019, 0.019, (0, 1), (0, '2*pi'), 0.019, 'white', f'shineDot{tag}')
    polar(icx + 0.058, icz + 0.075, 0.03, 0.03, (0, 1), (0, '2*pi'), 0.02, '#fff6d8', f'sparkle{tag}',
          rad='r*(0.2+0.8*abs(cos(w))^8+0.8*abs(sin(w))^8)')
    # upper lash line, its lash clumps and corner flicks
    fdec(XI, f"{EZ}+eu(min(xi,1))-0.06*max(0,xi-1)-0.008+q*(lt(xi)+0.008)", 0.022, ('xi', -1, 1.3), ('q', 0, 1), LASH, f'lash{tag}', q=QE)
    clumps = [(0.28, 0.42, 0.44, 0.05), (0.48, 0.62, 0.68, 0.055), (0.68, 0.82, 0.9, 0.055), (0.86, 1.0, 1.12, 0.045), (1.02, 1.16, 1.34, 0.025)]
    for k, (x0, x1, tipx, rise) in enumerate(clumps):
        xb_ = f"({fmt(x0)}+{fmt(x1 - x0)}*q)"
        Xs = f"{fmt(ex)}+{fmt(sg * AW)}*({xb_}*(1-hh)+{fmt(tipx)}*hh)"
        Zs = f"{EZ}+(ltop({xb_})-0.004)*(1-hh)+{fmt(sc.ns['ltop'](tipx) + rise)}*hh+0.01*hh*(1-hh)"
        fdec(Xs, Zs, 0.021, ('q', 0, 1), ('hh', 0, 1), LASH, f'lashClump{tag}{k + 1}', q=QE)
    fdec(XI, f"{EZ}+el(min(xi,1))-0.004-q*0.011*min(1,(xi-0.05)/0.3)^0.5*min(1,max(0,1.1-xi)/0.15)^0.7", 0.02, ('xi', 0.05, 1.1), ('q', 0, 1), '#6a3828', f'lashLow{tag}', q=QE)
    for k, (x0, x1, tipx, drop) in enumerate(((0.62, 0.7, 0.74, 0.03), (0.85, 0.93, 1.0, 0.026))):
        xb_ = f"({fmt(x0)}+{fmt(x1 - x0)}*q)"
        Xs = f"{fmt(ex)}+{fmt(sg * AW)}*({xb_}*(1-hh)+{fmt(tipx)}*hh)"
        Zs = f"{EZ}+(el({xb_})-0.01)*(1-hh)+{fmt(sc.ns['el'](tipx) - 0.01 - drop)}*hh"
        fdec(Xs, Zs, 0.02, ('q', 0, 1), ('hh', 0, 1), '#6a3828', f'lashLowTip{tag}{k + 1}', q=QE)
    fdec(XI, f"{EZ}+eu(xi)+0.05+0.012*(1-xi^2)+q*0.007*(1-xi^2)^0.5", 0.006, ('xi', -0.55, 0.85), ('q', 0, 1), '#c88a76', f'crease{tag}', q=QE)
    fdec(f"{fmt(ex)}+{fmt(sg)}*(0.225*xb)", "12.07+0.04*(1-xb^2)-0.012*xb+q*0.024*(1-0.75*(xb+1)/2)*min(1,(xb+1)/0.12)^0.5*min(1,(1-xb)/0.25)^0.8",
         0.006, ('xb', -1, 1), ('q', 0, 1), '#b8592a', f'brow{tag}', q='qbL' if side > 0 else 'qbR')
    for k, (sx, sz, col) in enumerate(((0.15, 0.06, '#efb09f'), (0.11, 0.043, '#f0a493'), (0.07, 0.027, '#f19887'))):
        fdec(f"{fmt(0.5 * side)}+{fmt(sx)}*r*cos(w)", f"11.56+{fmt(sz)}*r*sin(w)", 0.002 + 0.0015 * k, ('r', 0, 1), ('w', 0, '2*pi'), col, f'blush{tag}{k + 1}', q=QC)
    for k in range(3):
        x0 = 0.5 * side + (k - 1) * 0.045
        fdec(f"{fmt(x0)}+0.012*hh+0.004*q", "11.535+0.05*hh", 0.007, ('hh', 0, 1), ('q', -1, 1), '#e3707a', f'blushLine{tag}{k + 1}', q=QC)


for side, tag in ((1, 'L'), (-1, 'R')):
    eye_layers(side, tag)

sc.blank()
sc.note('Mouth')
sc.comment("A calm closed smile: the line lifts at the corners, which curl up a little; a soft lower-lip tint.")
fdec('p', '11.28+0.02*(p/0.075)^2-0.003*exp(-(p/0.02)^2)+q*0.012*sqrt(1-(p/0.075)^4)', 0.004, ('p', -0.075, 0.075), ('q', -0.5, 0.5), '#9a4440', 'smile', q='qm')
for side, tag in ((1, 'L'), (-1, 'R')):
    fdec(f"{fmt(side)}*(0.072+0.014*t)", '11.3+0.012*t^1.3+q*0.004*(1-t)', 0.004, ('t', 0, 1), ('q', -0.5, 0.5), '#ad5a50', f'smileCorner{tag}', q='qm')
fdec('0.036*r*cos(w)', '11.25+0.01*r*sin(w)', 0.003, ('r', 0, 1), ('w', 0, '2*pi'), '#f2b0a6', 'lowerLip', q='qm')
