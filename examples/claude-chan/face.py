# Run inside generate.py: Claude Chan's head, sculpted from separate parts.
import numpy as np

sc.blank()
sc.note('Head')

ZE = 11.73          # height of the pupils
HC = ZE - 0.71      # underside of the chin
Y0 = 0.10           # the plane just in front of the ears, where the face meets the side of the head


def spline_fn(name, pts, var='h'):
    """Natural cubic spline through pts as an Arch function: a0 + a1 d + sum c_i max(0, var - k_i)^3."""
    ks = [p[0] for p in pts]
    n = len(pts) - 1
    A = np.zeros((n + 2, n + 2))
    b = np.zeros(n + 2)
    for r, (k, v) in enumerate(pts):
        A[r, 0], A[r, 1] = 1, k - ks[0]
        for i in range(n):
            A[r, 2 + i] = max(0.0, k - ks[i]) ** 3
        b[r] = v
    for i in range(n):
        A[n + 1, 2 + i] = 6 * (ks[n] - ks[i])
    c = np.linalg.solve(A, b)
    body = f"{fmt(c[0])}+{fmt(c[1])}*({var}-{fmt(ks[0])})" + ''.join(
        f"+{fmt(c[2 + i])}*max(0,{var}-{fmt(ks[i])})^3" for i in range(n))
    sc.func(f'{name}({var})', body)


sc.comment("""The head is sculpted from parts: a face mask, the cranium under the hair, the underside of the jaw,
the neck and the ears. The face mask is a stack of horizontal arcs, one per height h. Each arc runs from the
side of the head around the front to the other side: half-width fwd(h), depth fd(h), and a superellipse
exponent fq(h) that makes it boxy across the eyes (a flat front that turns quickly at the cheekbones) and
rounder along the jaw. fpl(h) is the profile of the face seen from the side (forehead, the dip between the
eyes, the plane of the cheeks and mouth, chin). fr adds what is narrower than the whole face: the nose,
lips, chin, cheeks, brow and eye sockets. fy(p,h) is the y of the skin at x=p, z=h.""")
sc.func('smn(a,b,c)', '(a+b-sqrt((a-b)^2+c^2))/2')
R = lambda dz, y: (ZE + dz, y)
spline_fn('fpl', [R(-0.71, -0.44), R(-0.693, -0.478), R(-0.655, -0.515), R(-0.6, -0.54), R(-0.53, -0.56),
                 R(-0.47, -0.585), R(-0.38, -0.607), R(-0.265, -0.618), R(-0.15, -0.6),
                 R(-0.05, -0.583), R(0.03, -0.578), R(0.12, -0.592), R(0.22, -0.607), R(0.38, -0.613),
                 R(0.52, -0.596), R(0.66, -0.555), R(0.82, -0.48)])
sc.func('fwd(h)', f"smn(smn(0.645,0.69*sqrt(max(0,1-(max(0,h-{fmt(ZE + 0.3)})/0.86)^2)),0.04),1.05*sqrt(max(0,(h-{fmt(HC)})*(h-{fmt(HC - 0.1)}))),0.1)")
sc.func('fd(h)', f"smn({fmt(Y0)}-fpl(h),1.25*fwd(h),0.08)")
sc.func('fq(h)', f"0.3-0.115*exp(-((h-{fmt(ZE - 0.03)})/0.2)^2)+0.1/(1+exp((h-{fmt(ZE - 0.5)})/0.06))")
NT = ZE - 0.235     # height of the tip of the nose
sc.func('fno(h)', f"0.07*exp(-(max(0,h-{fmt(NT)})/0.075)^1.4-(max(0,{fmt(NT)}-h)/0.03)^2)")
sc.func('fr(p,h)',
        f"-fno(h)*exp(-(p/(0.024+0.022*exp(-((h-{fmt(NT - 0.01)})/0.05)^2)))^2)"
        f"-0.008*exp(-((h-{fmt(NT - 0.015)})/0.06)^2-(p/0.1)^2)"
        f"-0.008*exp(-((h-{fmt(ZE - 0.39)})/0.03)^2-(p/0.085)^2)"
        f"+0.006*exp(-((h-{fmt(ZE - 0.425)})/0.012)^2-(p/0.08)^2)"
        f"-0.008*exp(-((h-{fmt(ZE - 0.465)})/0.028)^2-(p/0.065)^2)"
        f"-0.006*exp(-((h-{fmt(ZE - 0.61)})/0.06)^2-(p/0.1)^2)"
        f"+0.02*exp(-((abs(p)-0.33)/0.17)^2-((h-{fmt(ZE + 0.02)})/0.1)^2)"
        f"-0.008*exp(-((abs(p)-0.3)/0.2)^2-((h-{fmt(ZE + 0.24)})/0.07)^2)"
        f"-0.02*exp(-((abs(p)-0.3)/0.17)^2-((h-{fmt(ZE - 0.24)})/0.15)^2)")
sc.func('fy(p,h)', 'fpl(h)+fd(h)*(1-max(0,1-(p/fwd(h))^2)^fq(h))+fr(p,h)')

HN = ZE + 0.14      # the lower patches (nose, mouth, chin) end here
HT = ZE + 0.78
FS = 0.36
MASK = ('fwd(h)*sin(f)', 'fpl(h)+fd(h)*(1-abs(cos(f))^(2*fq(h)))+fr(fwd(h)*sin(f),h)', 'h')
sc.comment("""The mask is drawn as six patches of the same surface, so the nose, lips and chin get a finer
mesh than the cheeks and forehead. Patches share their edges exactly, so no seam shows.""")
for nm, hr, fr_ in (('faceMid', (HC, HN), (-FS, FS)), ('faceLeft', (HC, HN), (FS, 'pi/2')), ('faceRight', (HC, HN), ('-pi/2', -FS)),
                    ('browMid', (HN, HT), (-FS, FS)), ('browLeft', (HN, HT), (FS, 'pi/2')), ('browRight', (HN, HT), ('-pi/2', -FS))):
    sc.surface(MASK, ('h', hr[0], hr[1]), ('f', fr_[0], fr_[1]), SKIN, nm, ('point', (0, 0.2, ZE + 0.1)))

sc.comment("Underside of the jaw: chords between the two sides of the jawline, arched up a little in the middle.")
HJ = ZE - 0.12
sc.surface(('q*fwd(h)', 'fpl(h)+fd(h)', f"h+0.05*(1-q^2)*min(1,(h-{fmt(HC)})/0.2)"), ('h', HC, HJ), ('q', -1, 1), SKIN_SH, 'jawUnder', ('dir', (0, 0.6, -1)))
sc.comment("Cranium (under the hair) and neck.")
CR_C, CR_R = (0, 0.14, ZE + 0.42), (0.655, 0.745, 0.755)
ellipsoid(CR_C, CR_R, SKIN, 'cranium')
sc.surface(('fwd(h)*cos(g)', f"{fmt(Y0)}+0.3*sin(g)", 'h'), ('h', ZE - 0.3, ZE + 0.5), ('g', 0, 'pi'), SKIN, 'headSide', ('point', (0, 0.2, ZE)))
capsule((0, 0.04, 10.2), (0, -0.05, 11.52), 0.2, 0.205, SKIN_SH, 'neck')


EAR_LOBES = {}
sc.comment("Ears: a dished shell with a rolled helix, an inner fold, the concha, tragus and lobe.")
EK = 0.8
for side, tag in ((1, 'L'), (-1, 'R')):
    n = unit((side, 0.42, 0))
    up0 = (0, 0.33, 1)
    b = unit(sub(up0, mul(n, dot(up0, n))))
    a = cross(b, n)
    if dot(a, (0, 1, 0)) < 0:
        a = mul(a, -1)          # a points toward the back of the head
    C = (side * 0.612, 0.23, ZE - 0.045)
    fr = (a, b, n)
    k = lambda v: fmt(v * EK)
    sc.surface(place((f"{k(0.105)}*r*cos(w)*(1+0.25*sin(w))-{k(0.01)}", f"{k(0.2)}*r*sin(w)", f"{k(0.014)}+{k(0.03)}*r^6-{k(0.012)}*(1-r^2)"), C, fr), ('r', 0, 1), ('w', 0, '2*pi'), SKIN, f'ear{tag}', ('dir', n))
    sc.surface(place((f"{k(0.105)}*r*cos(w)*(1+0.25*sin(w))-{k(0.01)}", f"{k(0.2)}*r*sin(w)", f"-{k(0.004)}-{k(0.012)}*(1-r^2)"), C, fr), ('r', 0, 1), ('w', 0, '2*pi'), SKIN_SH, f'earBack{tag}', ('dir', mul(n, -1)))
    sc.surface(place((f"({k(0.105)}+{k(0.02)}*cos(v))*cos(w)*(1+0.25*sin(w))-{k(0.01)}", f"({k(0.2)}+{k(0.02)}*cos(v))*sin(w)", f"{k(0.042)}+{k(0.02)}*sin(v)"), C, fr), ('w', -1.75, 2.05), ('v', 0, '2*pi'), SKIN, f'earHelix{tag}', ('tube', 'u'))
    sc.surface(place((f"({k(0.06)}+{k(0.012)}*cos(v))*cos(w)*(1+0.25*sin(w))+{k(0.005)}", f"({k(0.12)}+{k(0.012)}*cos(v))*sin(w)+{k(0.01)}", f"{k(0.03)}+{k(0.012)}*sin(v)"), C, fr), ('w', -1.1, 1.7), ('v', 0, '2*pi'), SKIN, f'earFold{tag}', ('tube', 'u'))
    sc.surface(place((f"{k(0.05)}*r*cos(w)-{k(0.005)}", f"{k(0.075)}*r*sin(w)-{k(0.035)}", k(0.016)), C, fr), ('r', 0, 1), ('w', 0, '2*pi'), '#c9958a', f'earConcha{tag}', ('dir', n))
    ellipsoid(add(C, add(mul(a, -0.1 * EK), mul(b, -0.03 * EK))), (0.022 * EK, 0.03 * EK, 0.022 * EK), SKIN, f'earTragus{tag}', fr=fr)
    lobe = add(C, mul(b, -0.19 * EK))
    EAR_LOBES[tag] = lobe
    ellipsoid(lobe, (0.045 * EK, 0.05 * EK, 0.03 * EK), SKIN, f'earLobe{tag}', fr=fr)


def fdec(X, Z, d, U, V, color, ref, opacity=None, q='fy'):
    """Decal on the face: (X, Z) in terms of the two parameters, d in front of the skin.
    q names the face function used: fy itself, or a cheaper local fit of it (see qfit)."""
    sc.surface((X, f"{q}({X},{Z})-{fmt(d)}", Z), U, V, color, ref, ('dir', (0, -1, 0)), opacity=opacity)


def qfit(name, x0, x1, z0, z1, deg=(6, 3), keep=None):
    """Least-squares fit of the face surface over a small region, written as a cheap polynomial.
    Arch expands user functions textually, so painting many decals with the exact fy is slow;
    a local fit keeps each decal to a few dozen operations. keep(x, z) limits the region."""
    fyf = sc.ns['fy']
    xc, zc = (x0 + x1) / 2, (z0 + z1) / 2
    terms = [(i, j) for j in range(deg[1] + 1) for i in range(deg[0] + 1 - j)]
    rows, vals = [], []
    for x in np.linspace(x0, x1, 61):
        for z in np.linspace(z0, z1, 41):
            if keep and not keep(x, z):
                continue
            a_, b_ = x - xc, z - zc
            rows.append([a_ ** i * b_ ** j for i, j in terms])
            vals.append(fyf(x, z))
    c, *_ = np.linalg.lstsq(np.array(rows), np.array(vals), rcond=None)
    err = float(np.max(np.abs(np.array(rows) @ c - np.array(vals))))
    A, B = f"(p-{fmt(xc)})", f"(h-{fmt(zc)})"
    def poly_a(j):
        cs = [c[k] for k, (i, jj) in enumerate(terms) if jj == j]
        return horner(cs, A)
    body = poly_a(deg[1])
    for j in range(deg[1] - 1, -1, -1):
        body = f"{poly_a(j)}+{B}*({body})"
    sc.func(f'{name}(p,h)', body)
    print(f'  fit {name}: max error {err:.4f}', file=sys.stderr)
    return name


# ---------------- eyes ----------------
sc.blank()
sc.note('Eyes')
sc.comment("""Local polynomial fits of the face surface (qfit in the generator) for the eye and brow regions.
Arch expands functions as text, so decals use these instead of the full fy.""")
EX, EA = 0.355, 0.175         # centre of an eye and its half-width
EZ = ZE + 0.045               # height of the line through the corners of the eye
def near_eye(x, z):
    """Where eye decals can be: between the lids (with room for the lash line and the fold above it)."""
    xi = (abs(x) - EX) / EA
    return -1.15 < xi < 1.4 and EZ - 0.15 - 0.02 * xi < z < EZ + 0.1 and (xi < 1.0 or z > EZ - 0.05)


qfit('qeL', 0.15, 0.6, EZ - 0.16, EZ + 0.1, deg=(8, 4), keep=near_eye)
qfit('qeR', -0.6, -0.15, EZ - 0.16, EZ + 0.1, deg=(8, 4), keep=near_eye)
qfit('qbL', 0.12, 0.59, EZ + 0.1, EZ + 0.26, deg=(7, 3))
qfit('qbR', -0.59, -0.12, EZ + 0.1, EZ + 0.26, deg=(7, 3))

sc.comment("""Her eyes are long and half-lidded: a heavy, nearly level upper lash line that ends in a wing, and a
bowl-shaped lower lid. xi runs across an eye from the inner corner (-1) to the outer corner (+1);
eu and el are the heights of the upper and lower lid above the corner line, lw and lv the lower and
upper edge of the lash line (which continues past the corner into the wing).
Layers, back to front: eye white, the lid's shadow, iris (dark rim, amber, shaded under the lid, golden
below), pupil, highlights, then the lash line, lashes, lower lid line, the fold of the lid and the brow.""")
sc.func('eu(xi)', '0.024*(1-min(1,abs(xi))^2.5)^0.6+0.006*xi')
sc.func('el(xi)', '-0.126*(1-min(1,xi^2))^0.62*(1+0.12*xi)+0.006*xi')
sc.func('lw(xi)', 'eu(min(xi,1))+0.04*(max(0,xi-1)/0.32)^1.5')
sc.func('lv(xi)', 'eu(min(xi,1))+(0.012+0.022*min(1,max(0,xi+0.9)/0.9)+0.014*min(1,max(0,xi-0.5)/0.5))*min(1,(xi+1)/0.12)^0.5-0.004*max(0,xi-1)/0.32')
LASH = '#2b1811'


def eye_layers(side, tag):
    ex, sg = EX * side, side
    QE = 'qeL' if side > 0 else 'qeR'
    XI = f"{fmt(ex)}+{fmt(sg * EA)}*xi"
    fdec(XI, f"{fmt(EZ)}+el(xi)+eta*(eu(xi)-el(xi))", 0.003, ('xi', -1, 1), ('eta', 0, 1), '#ece7e9', f'eyeWhite{tag}', q=QE)
    fdec(XI, f"{fmt(EZ)}+eu(xi)-eta*(0.03+0.022*xi^2)*(1-xi^2)^0.3", 0.004, ('xi', -1, 1), ('eta', 0, 1), '#c7bec8', f'lidShadow{tag}', q=QE)
    idx = -0.006                                  # the iris sits slightly toward the nose
    icx, icz, rx, rz = ex + sg * idx, EZ - 0.045, 0.094, 0.106
    xa, xb = (idx - rx) / EA, (idx + rx) / EA

    def band(a, b, rs, d, color, ref, lift=0.0):
        """Part of the iris ellipse (heights a..b of its half-height, scale rs), clipped by the lids."""
        S = f"sqrt(max(0,1-(({fmt(EA)}*xi-{fmt(idx)})/{fmt(rx * rs)})^2))"
        lo = f"max(el(xi)+{fmt(lift)},{fmt(icz - EZ)}+{fmt(rz * rs * a)}*{S})"
        hi = f"min(eu(xi),{fmt(icz - EZ)}+{fmt(rz * rs * b)}*{S})"
        Z = f"{fmt(EZ)}+{lo}+eta*(max({lo},{hi})-{lo})"
        fdec(XI, Z, d, ('xi', idx / EA - rx * rs / EA, idx / EA + rx * rs / EA), ('eta', 0, 1), color, ref, q=QE)

    def polar(cx, cz, ax, az, d, color, ref, rad='r', ww=(0, '2*pi')):
        fdec(f"{fmt(cx)}+{fmt(ax)}*{rad}*cos(w)", f"{fmt(cz)}+{fmt(az)}*{rad}*sin(w)", d, ('r', 0, 1), ('w', ww[0], ww[1]), color, ref, q=QE)

    band(-1, 1, 1.0, 0.0055, '#4a2212', f'irisRim{tag}')
    band(-1, 1, 0.91, 0.0065, '#c9772c', f'iris{tag}')
    band(-0.9, -0.25, 0.84, 0.0072, '#dc9238', f'irisGlow{tag}')
    band(-0.86, -0.48, 0.72, 0.0079, '#f0b858', f'irisGold{tag}')
    band(0.2, 1, 0.91, 0.0072, '#955020', f'irisShade{tag}')
    band(0.48, 1, 0.91, 0.0079, '#6f3618', f'irisTop{tag}')
    for k in range(5):
        th = -math.pi / 2 + (k - 2) * 0.4
        c, s_ = math.cos(th), math.sin(th)
        fdec(f"{fmt(icx)}+{fmt(rx * c)}*rho-{fmt(s_)}*0.0045*q*(1.1-rho)", f"{fmt(icz)}+{fmt(rz * s_)}*rho+{fmt(c)}*0.0045*q*(1.1-rho)",
             0.0086, ('rho', 0.44, 0.62), ('q', -1, 1), '#f8d48a', f'irisStreak{tag}{k + 1}', q=QE)
    polar(icx, icz + 0.006, 0.04, 0.05, 0.0095, '#5a2a12', f'pupilHalo{tag}')
    polar(icx, icz + 0.006, 0.031, 0.04, 0.0105, '#2e140a', f'pupil{tag}')
    polar(icx - 0.034, icz + 0.042, 0.021, 0.024, 0.0125, 'white', f'shine{tag}')
    polar(icx + 0.04, icz - 0.05, 0.011, 0.011, 0.0125, '#fff4de', f'shineDot{tag}')
    # upper lash line with its wing, small lashes at the outer corner
    fdec(XI, f"{fmt(EZ)}+lw(xi)-0.004*min(1,max(0,1-xi)/0.1)+q*(lv(xi)-lw(xi)+0.004*min(1,max(0,1-xi)/0.1))", 0.014, ('xi', -1, 1.32), ('q', 0, 1), LASH, f'lash{tag}', q=QE)
    for k, (x0, x1, tipx, tipz) in enumerate(((0.8, 0.95, 1.12, -0.034), (0.98, 1.1, 1.3, -0.008))):
        xb_ = f"({fmt(x0)}+{fmt(x1 - x0)}*q)"
        Xs = f"{fmt(ex)}+{fmt(sg * EA)}*({xb_}*(1-hh)+{fmt(tipx)}*hh)"
        Zs = f"{fmt(EZ)}+(lw({xb_})+0.004)*(1-hh)+{fmt(tipz)}*hh"
        fdec(Xs, Zs, 0.013, ('q', 0, 1), ('hh', 0, 1), LASH, f'lashTip{tag}{k + 1}', q=QE)
    fdec(XI, f"{fmt(EZ)}+el(min(xi,1))+0.002-q*(0.004+0.008*min(1,max(0,xi-0.2)/0.6))", 0.013, ('xi', 0.2, 1), ('q', 0, 1), '#5b3020', f'lashLow{tag}', q=QE)
    fdec(XI, f"{fmt(EZ)}+el(xi)+0.001-q*0.004", 0.012, ('xi', -0.45, 0.2), ('q', 0, 1), '#a56f5e', f'lidLow{tag}', q=QE)
    fdec(XI, f"{fmt(EZ)}+lv(xi)+0.017+0.005*(1-xi^2)+q*0.005*(1-((xi-0.05)/0.85)^2)^0.5", 0.004, ('xi', -0.8, 0.9), ('q', 0, 1), '#bd8876', f'crease{tag}', q=QE)
    fdec(f"{fmt(ex)}+{fmt(sg * EA)}*xb", f"{fmt(EZ + 0.19)}+0.014*(1-xb^2)-0.024*(xb+1)/2.3+q*0.016*(1-0.7*(xb+1)/2.3)*min(1,(xb+1.1)/0.15)^0.5*min(1,(1.25-xb)/0.3)^0.8",
         0.004, ('xb', -1.1, 1.25), ('q', 0, 1), '#a45f38', f'brow{tag}', q='qbL' if side > 0 else 'qbR')
    for k, (sx, sz, col) in enumerate(((0.13, 0.055, '#e4b8ae'), (0.095, 0.04, '#e4b1a8'), (0.06, 0.025, '#e5aaa2'))):
        fdec(f"{fmt(0.37 * side)}+{fmt(sx)}*r*cos(w)", f"{fmt(ZE - 0.21)}+{fmt(sz)}*r*sin(w)", 0.0015 + 0.0008 * k, ('r', 0, 1), ('w', 0, '2*pi'), col, f'blush{tag}{k + 1}')


for side, tag in ((1, 'L'), (-1, 'R')):
    eye_layers(side, tag)

sc.blank()
sc.note('Nose and mouth')
sc.comment("The small shadow under the tip of the nose, and a calm closed smile.")
fdec('-0.012+0.03*q', f"{fmt(NT - 0.035)}-0.008*(1-(2*q-1)^2)+hh*0.006*(1-(2*q-1)^2)^0.5", 0.002, ('q', 0, 1), ('hh', 0, 1), '#c48e83', 'noseShadow')
MZ = ZE - 0.425
fdec('p', f"{fmt(MZ)}+0.014*(p/0.072)^2-0.002*exp(-(p/0.015)^2)+q*0.0075*(1-(p/0.074)^2)^0.6", 0.003, ('p', -0.074, 0.074), ('q', -0.5, 0.5), '#a9615a', 'smile')
