# Run inside generate.py: Claude Chan's head, sculpted from separate parts.
import numpy as np

sc.blank()
sc.note('Head')

ZE = 11.73          # height of the pupils
HC = ZE - 0.77      # underside of the chin (the lower face is long and V-shaped, as on the sheet)
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
eyes, the plane of the cheeks and mouth, chin), and fws(h) the outline seen from the front: a blunt chin,
straight jaw lines up to the cheekbones, level sides. fr adds what is narrower than the whole face: the nose, lips, chin, the
round of each cheek, brow and eye sockets. fy(p,h) is the y of the skin at x=p, z=h.""")
sc.func('smn(a,b,c)', '(a+b-sqrt((a-b)^2+c^2))/2')
R = lambda dz, y: (ZE + dz, y)
spline_fn('fpl', [R(-0.77, -0.44), R(-0.749, -0.478), R(-0.701, -0.515), R(-0.633, -0.54), R(-0.545, -0.56),
                 R(-0.47, -0.585), R(-0.38, -0.607), R(-0.265, -0.618), R(-0.15, -0.6),
                 R(-0.05, -0.583), R(0.03, -0.578), R(0.12, -0.592), R(0.22, -0.607), R(0.38, -0.613),
                 R(0.52, -0.596), R(0.66, -0.555), R(0.82, -0.48)])
T_ = lambda t, w: (HC + t, w)
# Seen from the front the jaw runs nearly straight from the cheekbones to a blunt, rounded chin: the sheet's
# V-shaped jaw, a little softer so it reads well in 3D.
spline_fn('fws', [T_(0, 0.06), T_(0.03, 0.155), T_(0.07, 0.214), T_(0.12, 0.284), T_(0.17, 0.346), T_(0.22, 0.398), T_(0.27, 0.441),
                  T_(0.32, 0.479), T_(0.37, 0.513), T_(0.42, 0.541), T_(0.48, 0.585), T_(0.58, 0.624),
                  T_(0.68, 0.647), T_(0.77, 0.651), T_(0.96, 0.655), T_(1.26, 0.645), T_(1.55, 0.56), T_(1.62, 0.525)])
sc.func('fwd(h)', f"fws(h)*sqrt(max(0,h-{fmt(HC)})/(h-{fmt(HC - 0.035)}))")
sc.func('fd(h)', f"smn({fmt(Y0)}-fpl(h),1.18*fwd(h),0.08)")
sc.func('fq(h)', f"0.3-0.11*exp(-((h-{fmt(ZE)})/0.14)^2)+0.07/(1+exp((h-{fmt(ZE - 0.3)})/0.07))")
NT = ZE - 0.255     # height of the tip of the nose
sc.func('fno(h)', f"0.036*exp(-(max(0,h-{fmt(NT)})/0.07)^1.5-(max(0,{fmt(NT)}-h)/0.035)^2)")
sc.func('fr(p,h)',
        f"-fno(h)*exp(-(p/(0.034+0.024*exp(-((h-{fmt(NT - 0.01)})/0.05)^2)))^2)"
        f"-0.008*exp(-((h-{fmt(NT - 0.015)})/0.06)^2-(p/0.1)^2)"
        f"-0.008*exp(-((h-{fmt(ZE - 0.425)})/0.03)^2-(p/0.085)^2)"
        f"+0.006*exp(-((h-{fmt(ZE - 0.46)})/0.012)^2-(p/0.08)^2)"
        f"-0.008*exp(-((h-{fmt(ZE - 0.5)})/0.028)^2-(p/0.065)^2)"
        f"-0.006*exp(-((h-{fmt(ZE - 0.66)})/0.065)^2-(p/0.1)^2)"
        f"+0.02*exp(-((abs(p)-0.33)/0.17)^2-((h-{fmt(ZE + 0.02)})/0.1)^2)"
        f"-0.008*exp(-((abs(p)-0.3)/0.2)^2-((h-{fmt(ZE + 0.24)})/0.07)^2)"
        f"-0.04*exp(-((abs(p)-0.3)/0.2)^2-((h-{fmt(ZE - 0.22)})/0.17)^2)"
        f"-0.02*exp(-((abs(p)-0.26)/0.18)^2-((h-{fmt(ZE - 0.44)})/0.13)^2)")
sc.func('fy(p,h)', 'fpl(h)+fd(h)*(1-max(0,1-(p/fwd(h))^2)^fq(h))+fr(p,h)')

HN = ZE + 0.14      # the lower patches (nose, mouth, chin) end here
HT = ZE + 0.78
FS = 0.36
MASK = ('fwd(h)*sin(f)', 'fpl(h)+fd(h)*(1-abs(cos(f))^(2*fq(h)))+fr(fwd(h)*sin(f),h)', 'h')
HK = ZE - 0.07      # the cheek patches end here, just under the eyes
sc.comment("""The mask is drawn as nine patches of the same surface, three across and three up: cheek, nose and
mouth, cheek; eye, bridge of the nose, eye; and the brow. So the cheeks, nose, lips and chin each get
their own fine mesh. Patches share their edges exactly, so no seam shows.""")
for row, hr in (('', (HC, HK)), ('Eye', (HK, HN)), ('Brow', (HN, HT))):
    for col, fr_ in (('Right', ('-pi/2', -FS)), ('Mid', (-FS, FS)), ('Left', (FS, 'pi/2'))):
        nm = {'Right': 'cheekRight', 'Mid': 'noseMouth', 'Left': 'cheekLeft'}[col] if not row else f'face{row}{col}'
        sc.surface(MASK, ('h', hr[0], hr[1]), ('f', fr_[0], fr_[1]), SKIN, nm, ('point', (0, 0.2, ZE + 0.1)))

sc.comment("Underside of the jaw: chords between the two sides of the jawline, arched up a little in the middle.")
HJ = ZE - 0.12
sc.surface(('q*fwd(h)', 'fpl(h)+fd(h)', f"h+0.05*(1-q^2)*min(1,(h-{fmt(HC)})/0.2)"), ('h', HC, HJ), ('q', -1, 1), SKIN_SH, 'jawUnder', ('dir', (0, 0.6, -1)))
sc.comment("Cranium (under the hair) and neck.")
CR_C, CR_R = (0, 0.14, ZE + 0.42), (0.655, 0.745, 0.755)
ellipsoid(CR_C, CR_R, SKIN, 'cranium')
sc.surface(('fwd(h)*cos(g)', f"{fmt(Y0)}+0.3*sin(g)", 'h'), ('h', ZE - 0.3, ZE + 0.5), ('g', 0, 'pi'), SKIN, 'headSide', ('point', (0, 0.2, ZE)))
with sc.unturned():       # the neck stays with the body; the head turns on top of it
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


def nat_spline(pts):
    """Natural cubic spline through pts, as a Python function (same basis as spline_fn)."""
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
    return lambda x: c[0] + c[1] * (x - ks[0]) + sum(c[2 + i] * np.maximum(0.0, x - ks[i]) ** 3 for i in range(n))


def curve_fn(name, pts, deg=6):
    """A smooth curve through pts (s, z), written for Arch as one cheap polynomial in s over the points' range."""
    f = nat_spline(pts)
    lo, hi = pts[0][0], pts[-1][0]
    m, h = (lo + hi) / 2, (hi - lo) / 2
    xs = np.linspace(lo, hi, 300)
    c = np.polynomial.polynomial.polyfit((xs - m) / h, f(xs), deg)
    err = float(np.max(np.abs(np.polynomial.polynomial.polyval((xs - m) / h, c) - f(xs))))
    sc.func(f'{name}(s)', horner(list(c), f"({fmt(1 / h)}*(s-{fmt(m)}))"))
    print(f'  curve {name}: max error {err:.4f}', file=sys.stderr)


sc.comment("""Her eyes, drawn from the sheet's natural-smile portrait: the strokes were projected onto this face from the
portrait's angle, so each eye has its own shape, as in the drawing. Each eye has its own frame: s runs outward
from the centre of the iris (toward the ear), heights are measured from the centre of the iris.
eu{L,R}(s) is the upper lid (the lower edge of the lash line), et{L,R}(s) the top of the lash line, el{L,R}(s)
the lower lid. The opening is open at both corners: the lash line and the lower lid end apart, with white
between them, and the lash line runs on past the outer corner into a long flat wing.
Layers, back to front: eye white, the lid's shadow, iris (dark rim, warm brown, dark mauve under the lid, a
peach-gold crescent below), pupil tucked under the lash, one small highlight, the lash line, the lower lid
line, the lid's tint and its fold. Local polynomial fits of the face (qe{L,R}) keep each decal cheap.""")
# Measured on the sheet (see the comment above): iris centre (x, z), the opening's inner and outer ends, the
# end of the wing, and points on the three curves, all relative to the iris centre.
EYES = {
    'L': dict(side=1, c=(0.324, ZE - 0.030), s_in=-0.174, s_out=0.168, tip=0.27, crease=(-0.16, 0.11),
              lid=[(-0.174, -0.041), (-0.13, -0.056), (-0.094, -0.068), (-0.044, -0.083), (0.006, -0.088), (0.056, -0.083),
                   (0.106, -0.068), (0.14, -0.055), (0.168, -0.038)],
              up=[(-0.174, 0.012), (-0.144, 0.037), (-0.094, 0.047), (-0.044, 0.052), (0.006, 0.053), (0.056, 0.052),
                  (0.106, 0.047), (0.156, 0.038), (0.206, 0.037), (0.24, 0.04), (0.27, 0.044)],
              top=[(-0.174, 0.016), (-0.144, 0.064), (-0.094, 0.077), (-0.044, 0.083), (0.006, 0.087), (0.056, 0.087),
                   (0.106, 0.083), (0.156, 0.077), (0.206, 0.07), (0.24, 0.058), (0.27, 0.046)]),
    'R': dict(side=-1, c=(-0.330, ZE - 0.031), s_in=-0.12, s_out=0.195, tip=0.27, crease=(-0.06, 0.2),
              lid=[(-0.12, -0.061), (-0.08, -0.075), (-0.04, -0.085), (0.0, -0.089), (0.05, -0.09), (0.1, -0.081),
                   (0.15, -0.066), (0.195, -0.043)],
              up=[(-0.11, 0.009), (-0.08, 0.035), (-0.05, 0.049), (0.0, 0.054), (0.05, 0.055), (0.1, 0.046),
                  (0.15, 0.038), (0.195, 0.031), (0.235, 0.036), (0.27, 0.041)],
              top=[(-0.11, 0.014), (-0.08, 0.066), (-0.05, 0.08), (0.0, 0.092), (0.05, 0.094), (0.1, 0.089),
                   (0.15, 0.081), (0.195, 0.073), (0.235, 0.062), (0.27, 0.043)]),
}
IRX, IRZ = 0.091, 0.097       # iris half-width and half-height
LASH = '#2e1712'
for tag, E in EYES.items():
    curve_fn(f'eu{tag}', E['up'])
    curve_fn(f'et{tag}', E['top'], deg=8)
    curve_fn(f'el{tag}', E['lid'])
    euf, etf, elf = (nat_spline(E[k]) for k in ('up', 'top', 'lid'))
    cx, cz, sd = E['c'][0], E['c'][1], E['side']

    def keep(x, z, E=E, euf=euf, etf=etf, elf=elf, cx=cx, cz=cz, sd=sd):
        s_ = sd * (x - cx)
        if not (E['s_in'] - 0.03 < s_ < E['tip'] + 0.02):
            return False
        sl = min(max(s_, E['lid'][0][0]), E['lid'][-1][0])
        su = min(max(s_, E['up'][0][0]), E['up'][-1][0])
        return elf(sl) - 0.03 < z - cz < etf(su) + 0.07
    xa, xb = sorted((cx + sd * (E['s_in'] - 0.03), cx + sd * (E['tip'] + 0.02)))
    qfit(f'qe{tag}', xa, xb, cz - 0.13, cz + 0.17, deg=(8, 4), keep=keep)



def eye_layers(tag):
    E = EYES[tag]
    cx, cz, sd = E['c'][0], E['c'][1], E['side']
    QE = f'qe{tag}'
    eu, et, el = f'eu{tag}', f'et{tag}', f'el{tag}'
    X = f"{fmt(cx)}+s" if sd > 0 else f"{fmt(cx)}-s"
    Zc = fmt(cz)
    si, so, tip = E['s_in'], E['s_out'], E['tip']
    span = ('s', si, so)
    fdec(X, f"{Zc}+{el}(s)+eta*({eu}(s)-{el}(s))", 0.003, span, ('eta', 0, 1), '#efe9ea', f'eyeWhite{tag}', q=QE)
    fdec(X, f"{Zc}+{eu}(s)-eta*0.024*min(1,(s-({fmt(si)}))/0.05)^0.5*min(1,({fmt(so)}-s)/0.05)^0.5", 0.004, span, ('eta', 0, 1),
         '#d6c7ca', f'lidShadow{tag}', q=QE)

    def band(a, b, rs, d, color, ref):
        """Part of the iris ellipse (heights a..b of its half-height, scale rs), clipped by the lids."""
        S = f"sqrt(max(0,1-(s/{fmt(IRX * rs)})^2))"
        lo = f"max({el}(s),{fmt(IRZ * rs * a)}*{S})"
        hi = f"min({eu}(s),{fmt(IRZ * rs * b)}*{S})"
        Z = f"{Zc}+{lo}+eta*(max({lo},{hi})-{lo})"
        fdec(X, Z, d, ('s', -IRX * rs, IRX * rs), ('eta', 0, 1), color, ref, q=QE)

    def polar(s0, z0, ax, az, d, color, ref):
        Xp = f"{fmt(cx + sd * s0)}+{fmt(ax)}*r*cos(w)"
        fdec(Xp, f"{fmt(cz + z0)}+{fmt(az)}*r*sin(w)", d, ('r', 0, 1), ('w', 0, '2*pi'), color, ref, q=QE)

    def shade(depth, rs, d, color, ref):
        """The iris under the lid, darker toward the lash line: a band that follows the upper lid."""
        S = f"sqrt(max(0,1-(s/{fmt(IRX * rs)})^2))"
        hi = f"min({eu}(s),{fmt(IRZ * rs)}*{S})"
        lo = f"max({el}(s),max({eu}(s)-{fmt(depth)}*(0.55+0.45*{S}),-{fmt(IRZ * rs)}*{S}))"
        fdec(X, f"{Zc}+{lo}+eta*(max({lo},{hi})-{lo})", d, ('s', -IRX * rs, IRX * rs), ('eta', 0, 1), color, ref, q=QE)

    band(-1, 1, 1.0, 0.0052, '#6a3a30', f'irisRim{tag}')
    band(-1, 1, 0.93, 0.0059, '#a5684f', f'iris{tag}')
    band(-0.96, -0.1, 0.87, 0.0066, '#df9f78', f'irisGlow{tag}')
    band(-0.9, -0.5, 0.74, 0.0073, '#f7cba2', f'irisGold{tag}')
    shade(0.07, 0.93, 0.0087, '#7a4741', f'irisShade{tag}')
    shade(0.035, 0.93, 0.0094, '#58322f', f'irisTop{tag}')
    for k in range(5):
        th = -math.pi / 2 + (k - 2) * 0.42
        c, s_ = math.cos(th), math.sin(th)
        fdec(f"{fmt(cx)}+{fmt(sd * IRX * c)}*rho-{fmt(sd * s_)}*0.004*q*(1.1-rho)", f"{Zc}+{fmt(IRZ * s_)}*rho+{fmt(c)}*0.004*q*(1.1-rho)",
             0.008, ('rho', 0.46, 0.66), ('q', -1, 1), '#f6d6b6', f'irisStreak{tag}{k + 1}', q=QE)
    # the pupil hangs from the lash line; the highlight is a small dot on the viewer's right, as on the sheet
    polar(0.0, 0.026, 0.025, 0.04, 0.0105, '#3d1f24', f'pupil{tag}')
    polar(0.013 * sd, 0.029, 0.0125, 0.0125, 0.0118, '#f5e9ea', f'shine{tag}')
    # lash line: from a thin inner end, heavy across the eye, then a long flat wing tapering to a point
    fdec(X, f"{Zc}+{eu}(s)+q*max(0,{et}(s)-{eu}(s))", 0.014, ('s', E['up'][0][0], tip), ('q', 0, 1), LASH, f'lash{tag}', q=QE)
    # lower lid: one thin line from a small hook at the inner corner, stopping short of the outer corner
    taper = f"min(1,(s-({fmt(si)}))/0.03)^0.5*min(1,({fmt(so)}-s)/0.04)^0.7"
    fdec(X, f"{Zc}+{el}(s)+0.002-q*0.0062*{taper}", 0.013, span, ('q', 0, 1), '#8f5c4e', f'lidLow{tag}', q=QE)
    Xh = f"{fmt(cx + sd * (si + 0.004))}+{fmt(sd * 0.004)}*q"
    fdec(Xh, f"{fmt(cz)}+{el}({fmt(si)})+0.001+hh*0.013", 0.013, ('q', -1, 1), ('hh', 0, 1), '#8f5c4e', f'lidHook{tag}', q=QE)
    # a soft pink-brown tint on the lid above the lash line, and the fold of the lid
    c0, c1 = E['crease']
    fdec(X, f"{Zc}+{et}(s)-0.002+q*0.016*(1-((s-{fmt((c0 + c1) / 2)})/{fmt((c1 - c0) / 2 + 0.05)})^2)", 0.0035, ('s', c0 - 0.04, c1 + 0.04), ('q', 0, 1),
         '#dcc1bc', f'lidTint{tag}', q=QE)
    fdec(X, f"{Zc}+{et}(s)+0.042+q*0.0055*(1-((s-{fmt((c0 + c1) / 2)})/{fmt((c1 - c0) / 2)})^2)^0.6", 0.004, ('s', c0, c1), ('q', 0, 1),
         '#c39a8e', f'crease{tag}', q=QE)


for tag in ('L', 'R'):
    eye_layers(tag)

for side, tag in ((1, 'L'), (-1, 'R')):
    for k, (sx, sz, col) in enumerate(((0.12, 0.05, '#e5c7c2'), (0.085, 0.035, '#e6bfba'), (0.05, 0.021, '#e7b8b3'))):
        fdec(f"{fmt(0.355 * side)}+{fmt(sx)}*r*cos(w)", f"{fmt(ZE - 0.23)}+{fmt(sz)}*r*sin(w)", 0.0015 + 0.0008 * k, ('r', 0, 1), ('w', 0, '2*pi'), col, f'blush{tag}{k + 1}')


# ---------------- brows ----------------
sc.comment("""Brows: thin, long and nearly straight, high above the eyes, as on the sheet, where they are drawn over the
hair. Each is a decal on the skin along bw{L,R}(s) (s outward from the middle of the face); where a lock of the
bangs crosses it, a short strip carries the brow on over the front of that lock (drawn after the hair).""")
BROWS = {
    'L': dict(side=1, pts=[(0.124, 0.276), (0.174, 0.285), (0.224, 0.286), (0.274, 0.288), (0.324, 0.283), (0.375, 0.273),
                           (0.425, 0.262), (0.475, 0.25)]),
    'R': dict(side=-1, pts=[(0.281, 0.263), (0.324, 0.265), (0.366, 0.271), (0.408, 0.273), (0.45, 0.273), (0.492, 0.272),
                            (0.534, 0.268), (0.576, 0.268)]),
}
BROW_C = '#93503a'
for tag, B in BROWS.items():
    curve_fn(f'bw{tag}', B['pts'], deg=4)
    B['f'] = nat_spline(B['pts'])
    s0, s1 = B['pts'][0][0], B['pts'][-1][0]
    xa, xb = sorted((B['side'] * (s0 - 0.03), B['side'] * (s1 + 0.03)))
    qfit(f'qb{tag}', xa, xb, ZE + 0.2, ZE + 0.35, deg=(7, 3))


def brow_th(s0, s1, u):
    """Brow thickness at u (an Arch expression in the brow's s): fuller at the inner end, thin at the outer."""
    t = f"(({u})-({fmt(s0)}))/{fmt(s1 - s0)}"
    return f"(0.014-0.008*{t})*min(1,{t}/0.07)^0.5*min(1,(1-{t})/0.15)^0.7"


def draw_brows(blades):
    """Draw both brows; blades are (ref, xyz) of the locks in front of the face (unturned), for the strips over them."""
    H = []
    for ref, xyz in blades:
        g = sc._f(*xyz, 't', 'w')
        for t in np.linspace(0, 1, 170):
            for w in np.linspace(0, 2 * math.pi, 36, endpoint=False):
                P = g(t, w)
                if P and abs(P[2] - (ZE + 0.27)) < 0.06:
                    H.append(P)
    H = np.array(H) if H else np.zeros((0, 3))
    for tag, B in BROWS.items():
        sd = B['side']
        s0, s1 = B['pts'][0][0], B['pts'][-1][0]
        X = 's' if sd > 0 else '-s'
        fdec(X, f"{fmt(ZE)}+bw{tag}(s)+(q-0.5)*{brow_th(s0, s1, 's')}", 0.004, ('s', s0, s1), ('q', 0, 1), BROW_C, f'brow{tag}', q=f'qb{tag}')
        ss = np.linspace(s0, s1, 100)
        xs, zs = sd * ss, ZE + B['f'](ss)
        yh = np.full(len(ss), np.nan)
        for i in range(len(ss)):
            m = (np.abs(H[:, 0] - xs[i]) < 0.009) & (np.abs(H[:, 2] - zs[i]) < 0.009) if len(H) else np.zeros(0, bool)
            if m.any():
                yh[i] = H[m, 1].min()
        skin = np.array([sc.ns['fy'](x, z) for x, z in zip(xs, zs)])
        over = np.isfinite(yh) & (yh < skin - 0.012)
        runs, i = [], 0
        while i < len(ss):
            if over[i]:
                j = i
                while j + 1 < len(ss) and over[j + 1]:
                    j += 1
                runs.append((max(0, i - 1), min(len(ss) - 1, j + 1)))
                i = j + 1
            else:
                i += 1
        for k, (i0, i1) in enumerate(runs):
            if i1 - i0 < 2:
                continue
            yr = np.where(np.isfinite(yh[i0:i1 + 1]), yh[i0:i1 + 1], skin[i0:i1 + 1])
            yr = np.array([yr[max(0, j - 2):j + 3].min() for j in range(len(yr))]) - 0.008
            u = np.linspace(0, 1, len(yr))
            c = np.polynomial.polynomial.polyfit(u, yr, min(3, len(yr) - 1))
            c[0] -= max(0.0, float(np.max(np.polynomial.polynomial.polyval(u, c) - yr)))
            sa, sb = ss[i0], ss[i1]
            S = f"({fmt(sa)}+{fmt(sb - sa)}*u)"
            sc.surface((f"{fmt(sd)}*{S}", horner(list(c), 'u'), f"{fmt(ZE)}+bw{tag}({S})+(q-0.5)*{brow_th(s0, s1, S)}"),
                       ('u', 0, 1), ('q', 0, 1), BROW_C, f'brow{tag}Hair{k + 1}', ('dir', (0, -1, 0)))

sc.blank()
sc.note('Nose and mouth')
sc.comment("""As on the sheet: a thin shadow line down her right side of the nose that turns under its tip (an L), a
highlight above the tip, and a calm closed smile, slightly lower on her left.""")
fdec('-0.024-0.012*t^1.5+0.0028*q', f"{fmt(NT + 0.075)}-0.083*t", 0.0016, ('t', 0, 1), ('q', -1, 1), '#cfaaa2', 'noseLine')
fdec('-0.034+0.044*t', f"{fmt(NT - 0.012)}-0.008*t+0.006*t^2+0.0028*q*(1-0.6*t)", 0.0016, ('t', 0, 1), ('q', -1, 1), '#c39b93', 'noseUnder')
fdec('0.004+0.009*r*cos(w)', f"{fmt(NT + 0.035)}+0.03*r*sin(w)", 0.0015, ('r', 0, 1), ('w', 0, '2*pi'), '#f7ecea', 'noseShine')
MZ = ZE - 0.46
fdec('p', f"{fmt(MZ)}-0.12*(p+0.03)*0.085+0.011*((p+0.03)/0.1)^2+q*0.0068*(1-((p+0.03)/0.102)^2)^0.6", 0.003, ('p', -0.13, 0.07), ('q', -0.45, 0.45), '#b27770', 'smile')
