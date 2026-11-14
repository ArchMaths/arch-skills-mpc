"""Claude Chan's hair, for generate.py (build(G) is called with the generate module).

Two kinds of surface:

  * the cap: a shell around the skull, written as a radius along each direction from the
    head centre, like the head itself.  Its directions are taken around a pole at the
    parting, so its grooves run out from the parting like combed hair.  It turns with the
    head.
  * locks: every bang, the locks that frame the face and the long hair are tapered ribbons
    with a crescent cross-section (flat underneath, three soft ridges on top) around a centre
    line.  The centre line, the ribbon's half-width vector and its thickness vector are
    worked out in Python, posed with the head, and written for Arch as polynomials in the
    lock's parameter t (-1 at the root, 1 at the tip):
        P(t, w) = C(t) + cos(w) U(t) + lcs(w) V(t)
    so posing a lock costs nothing in Arch.  Locks that hang turn with the head only where
    they lie on it and hang straight below.

Coordinates are the head's: x forward, y her left, z up, the head centre at the origin.
"""
import math

import numpy as np

G = None                 # the generate module, set by build()

# colours sampled from the sheet's portraits (the middle, light and dark of the hair)
HAIR = '#e27d4b'
HAIR_LT = '#e98a59'
HAIR_DK = '#d27043'
HAIR_SH = '#b65b34'

# ---------------------------------------------------------------- expressions in numpy
# Every surface is also evaluated in Python (orientation, fit and clearance checks), with
# the user functions defined both for Arch and here.
NS = {'sin': np.sin, 'cos': np.cos, 'abs': np.abs, 'sqrt': np.sqrt, 'exp': np.exp,
      'max': np.maximum, 'min': np.minimum, 'sign': np.sign, 'pi': np.pi}


def ev(expr, **env):
    return eval(expr.replace('^', '**'), NS, env)


def fn(sig, body):
    """A user function, for Arch and for ev()."""
    name, args = sig[:-1].split('(')
    args = args.split(',')
    G.emit(f'{sig}={body}')
    code = compile(body.replace('^', '**'), sig, 'eval')
    NS[name] = lambda *a, c=code, n=args: eval(c, NS, dict(zip(n, a)))


def gnum(v):
    """A literal with 9 significant digits, for polynomial coefficients."""
    s = f'{v:.9g}'
    if 'e' in s:
        s = f'{v:.12f}'.rstrip('0').rstrip('.')
    return f'({s})' if s.startswith('-') else s


def horner(c, var):
    out = gnum(c[-1])
    for k in range(len(c) - 2, -1, -1):
        out = f'{gnum(c[k])}+{var}*({out})'
    return out


def smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


SURFACES = []            # (name, points 3 x n x m) of every hair surface, for the checks


def surface(xyz, pa, pb, color, name, inside=None):
    """Emit a surface; xyz are posed expressions in the parameters pa, pb = (name, lo, hi).
    inside: 'tube' (its axis is the mean over pb) or a point; the parameter order is swapped
    if the normal points toward it, so the outside is lit."""
    (a, a0, a1), (b, b0, b1) = pa, pb
    A, B = np.meshgrid(np.linspace(a0, a1, 41), np.linspace(b0, b1, 41), indexing='ij')
    P = np.array([ev(e, **{a: A, b: B}) * np.ones_like(A) for e in xyz])
    SURFACES.append((name, P))
    if inside is not None:
        ref = P.mean(axis=2, keepdims=True) if inside == 'tube' else np.reshape(inside, (3, 1, 1))
        if np.sum(normals(P) * (P - ref)) < 0:
            pa, pb = pb, pa
    rng = ','.join(f'{n},{G.num(lo)},{G.num(hi)}' for n, lo, hi in (pa, pb)).replace('6.28319', '2*pi')
    G.emit(f'surface({xyz[0]},{xyz[1]},{xyz[2]},{rng}) | color={color}')
    return P


def normals(P):
    Pa, Pb = np.gradient(P, axis=1), np.gradient(P, axis=2)
    return np.cross(Pa, Pb, axis=0)


# ---------------------------------------------------------------- pose
def pose_points(P, ease=None):
    """Head-frame points (3 x N) to the scene.  ease = None: they turn with the head.
    ease = (z1, z0): the turn eases off from whole at height z1 to none at z0 (heights in the
    head frame), so hair that hangs below the head falls straight down."""
    pitch, tilt = G.X['pitch'], G.X['tilt']
    piv = G.NECK_TOP
    c = np.ones(P.shape[1]) if ease is None else smooth((P[2] - ease[1]) / (ease[0] - ease[1]))
    out = np.empty_like(P)
    for i in range(P.shape[1]):
        R = G.rot_x(tilt * c[i]) @ G.rot_up(pitch * c[i])
        out[:, i] = piv + R @ (P[:, i] - piv)
    return out


def unpose(Q):
    """Scene points back to the head frame (rigid inverse of the head's pose)."""
    R, t = G.POSE['R'], G.POSE['t']
    return R.T @ (Q - t[:, None])


def outside(P):
    """How far outside the skin head-frame points are, as a fraction of the radius (< 0:
    inside).  hr is homogeneous of degree -1, so hr(P) * P is the skin along P."""
    return 1 / G.ev_hr(P) - 1


# ---------------------------------------------------------------- the cap
# The hair's outer shape: a superquadric around the head centre with its own semi-axis in
# each direction (front, back, her left, her right, top, bottom).  On the sheet the hair
# rises about 1.85 eye-to-chin lengths above the eye corners (the skull is 1.3) and is about
# 1.2 wide on each side of the face, a little fuller on her right.
CAP = dict(xf=0.99, xb=1.08, yl=1.05, yr=1.12, zt=1.68, zb=0.8, n=2.3, m=3.0)
PART = (16.0, -4.0)      # the parting: tilted this far forward and toward her right (degrees)
# the hairline, as heights (head frame) at azimuths around the head (degrees, 0 = front,
# + toward her left): high on the forehead, above the ears, down to the nape at the back.
HAIRLINE = [(0, 0.80), (25, 0.74), (45, 0.55), (70, 0.30), (88, 0.12), (102, 0.08),
            (118, -0.1), (140, -0.25), (180, -0.3)]
GROOVES = 18             # grooves around the parting
GROOVE_DEPTH = 0.015


def cap_frame():
    fwd, side = (math.radians(a) for a in PART)
    d0 = G.unit([math.sin(fwd), math.sin(side), math.cos(fwd) * math.cos(side)])
    e1 = G.unit(np.array([1.0, 0, 0]) - d0[0] * d0)
    e2 = np.cross(d0, e1)
    return np.column_stack([e1, e2, d0])          # local (x toward the front, y her left, z pole)


def cap_inv(D):
    """1 / (the cap's radius) along head-frame directions D (3 x N)."""
    c = CAP
    x, y, z = D
    h = ((np.maximum(x, 0) / c['xf']) ** c['n'] + (np.maximum(-x, 0) / c['xb']) ** c['n']
         + (np.maximum(y, 0) / c['yl']) ** c['n'] + (np.maximum(-y, 0) / c['yr']) ** c['n'])
    return (h ** (c['m'] / c['n']) + (np.maximum(z, 0) / c['zt']) ** c['m']
            + (np.maximum(-z, 0) / c['zb']) ** c['m']) ** (1 / c['m'])


def cap_inv_expr(x, y, z):
    c = CAP
    num = G.num
    n, m = num(c['n']), num(c['m'])
    h = (f'(max({x},0)*{num(1 / c["xf"])})^{n}+(max(-({x}),0)*{num(1 / c["xb"])})^{n}+'
         f'(max({y},0)*{num(1 / c["yl"])})^{n}+(max(-({y}),0)*{num(1 / c["yr"])})^{n}')
    return (f'(({h})^{num(c["m"] / c["n"])}+(max({z},0)*{num(1 / c["zt"])})^{m}+'
            f'(max(-({z}),0)*{num(1 / c["zb"])})^{m})^{num(1 / c["m"])}')


def local_dir(a, f):
    return np.array([np.sin(a) * np.cos(f), np.sin(a) * np.sin(f), np.cos(a)])


def hairline_alpha():
    """For each angle f around the parting, how far (a, from the pole) the cap reaches."""
    Q = cap_frame()
    az, zz = zip(*HAIRLINE)
    az = np.array(az + tuple(-a for a in az[1:-1]), float)
    zz = np.array(zz + zz[1:-1], float)
    order = np.argsort(az)
    az, zz = az[order], zz[order]
    fs = np.linspace(-np.pi, np.pi, 361)
    al = np.linspace(0.01, 2.9, 600)
    out = []
    for f in fs:
        D = Q @ local_dir(al, np.full_like(al, f))
        P = D / cap_inv(D)
        psi = np.degrees(np.arctan2(P[1], P[0]))
        target = np.interp(psi, az, zz)
        k = np.nonzero(P[2] < target)[0]
        out.append(al[k[0]] if len(k) else al[-1])
    # smooth it (circularly) so a few harmonics describe it
    out = np.array(out)
    ker = np.exp(-0.5 * (np.arange(-30, 31) / 8) ** 2)
    ker /= ker.sum()
    ext = np.r_[out[-31:-1], out, out[1:31]]
    return fs, np.convolve(ext, ker, mode='same')[30:-30]


def fourier_fit(fs, y, K):
    M = np.column_stack([np.ones_like(fs)] + [g(k * fs) for k in range(1, K + 1)
                                              for g in (np.cos, np.sin)])
    c, *_ = np.linalg.lstsq(M, y, rcond=None)
    err = np.max(np.abs(M @ c - y))
    terms = [G.num(c[0], 4)]
    for k in range(1, K + 1):
        for g, v in zip(('cos', 'sin'), c[2 * k - 1:2 * k + 1]):
            if abs(v) > 5e-5:
                terms.append(f'{G.num(v, 4)}*{g}({k}*f)' if k > 1 else f'{G.num(v, 4)}*{g}(f)')
    return '+'.join(terms), err


def cap():
    G.emit('# The hair cap: a shell around the skull, taken around a pole at the parting')
    G.emit('# (a: angle from the pole, f: around it, 0 toward the face).  ca(f) is how far it')
    G.emit('# reaches from the pole: down to the hairline, above the ears and to the nape.')
    G.emit('# Its radius is a superquadric with a semi-axis in each direction, grooved like')
    G.emit('# combed hair, the grooves fading toward the pole.')
    fs, al = hairline_alpha()
    expr, err = fourier_fit(fs, al, 8)
    assert err < 0.03, err
    fn('ca(f)', expr)
    Q = cap_frame()
    num = G.num
    a = '(s*ca(f))'
    dl = (f'sin{a}*cos(f)', f'sin{a}*sin(f)', f'cos{a}')
    D = [G.lin(Q[i], [f'({d})' for d in dl]) for i in range(3)]
    fn('cdx(s,f)', D[0])
    fn('cdy(s,f)', D[1])
    fn('cdz(s,f)', D[2])
    groove = (f'(1-{num(GROOVE_DEPTH)}*s^0.7*(1-abs(sin({GROOVES / 2:g}*f))^0.4))')
    fn('cq(s,f)', f'1/{cap_inv_expr("cdx(s,f)", "cdy(s,f)", "cdz(s,f)")}')
    fn('cr(s,f)', f'{groove}*cq(s,f)')
    R, t = G.POSE['R'], G.POSE['t']
    M = R @ Q
    xyz = [f'{num(t[i])}+cr(s,f)*({G.lin(M[i], [f"({d})" for d in dl])})' for i in range(3)]
    # six sectors around the parting, so each gets a fine mesh
    cuts = np.linspace(-np.pi, np.pi, 7)
    for i in range(6):
        P = surface(xyz, ('s', 0, 1), ('f', cuts[i], cuts[i + 1]), HAIR_DK, f'cap{i}')
        out = np.sum(normals(P) * (P - (t + R @ np.array([0, 0, 0.2]))[:, None, None]))
        assert out > 0, 'the cap faces inward'
    # the cap must cover the skull: check it is outside the skin where it is drawn
    s, f = np.meshgrid(np.linspace(0.02, 1, 60), np.linspace(-np.pi, np.pi, 240), indexing='ij')
    A = s * ev('ca(f)', f=f)
    D = Q @ local_dir(A.ravel(), f.ravel())
    P = D / cap_inv(D)
    gap = outside(P)
    print(f'  cap: hairline fit within {err:.3f} rad; clears the skin by >= {gap.min():.3f}')


def cap_point(a, f, lift=0.0):
    """A point on the cap (head frame) at angle a from the pole and f around it, lifted."""
    Q = cap_frame()
    D = Q @ local_dir(np.atleast_1d(a), np.atleast_1d(f))
    r = 1 / cap_inv(D)
    return (D * (r + lift)).T


# ---------------------------------------------------------------- locks
NLOCK = [0]


def lcs_define():
    G.emit('# A lock is a ribbon around its centre line; lcs(w) is its cross-section across the')
    G.emit('# thickness: flat underneath, three faint ridges on top.')
    fn('lcs(w)', '(0.65*sin(w)+0.35*abs(sin(w)))*(0.86+0.14*cos(2*pi*cos(w)))')


def spline_path(pts, n=400):
    pts = np.asarray(pts, float)
    d = np.r_[0, np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))]
    d /= d[-1]
    ts = np.linspace(0, 1, n)
    return ts, np.array([G.spline(d, pts[:, i])(ts) for i in range(3)])


def axis_point(C):
    """The point the hair's outward direction is taken from: the head centre (a little
    up) for hair on the head, the vertical axis below it for hair that hangs."""
    return np.array([np.full(C.shape[1], -0.05), np.zeros(C.shape[1]), np.minimum(C[2], 0.15)])


def frames(C, ts, twist=None):
    T = np.gradient(C, ts, axis=1)
    T /= np.linalg.norm(T, axis=0)
    N = C - axis_point(C)
    N -= np.sum(N * T, 0) * T
    N /= np.linalg.norm(N, axis=0)
    S = np.cross(T, N, axis=0)
    if twist is not None:
        th = twist(ts)
        S, N = np.cos(th) * S + np.sin(th) * N, -np.sin(th) * S + np.cos(th) * N
    return T, N, S


def taper(ts, root=0.08, tip=0.3):
    """Grows from 0 at the root and comes to a point at the tip, smoothly (x (2 - x) at both
    ends), so the polynomials fit it closely."""
    a, b = np.minimum(1, ts / root), np.minimum(1, (1 - ts) / tip)
    return a * (2 - a) * b * (2 - b)


def lock(name, pts, width, thick, color, ease=None, twist=None, margin=0.012,
         root=0.08, tip=0.3):
    """A lock along the spline through pts (head frame).  width and thick: half-width and
    thickness, numbers or functions of t (0 at the root, 1 at the tip), times the taper.
    The centre line is pushed out wherever the lock would dip under the skin."""
    ts, C = spline_path(pts)
    wf = width if callable(width) else (lambda t, w=width: w + 0 * t)
    hf = thick if callable(thick) else (lambda t, h=thick: h + 0 * t)
    tp = taper(ts, root, tip)
    wd, th = wf(ts) * tp, hf(ts) * tp
    ws = np.linspace(0, 2 * np.pi, 13)[:-1]
    sec = (0.65 * np.sin(ws) + 0.35 * np.abs(np.sin(ws))) * (0.86 + 0.14 * np.cos(2 * np.pi * np.cos(ws)))
    for _ in range(40):
        T, N, S = frames(C, ts, twist)
        worst = np.full(len(ts), np.inf)
        for w, sc in zip(ws, sec):
            P = C + np.cos(w) * wd * S + sc * th * N
            worst = np.minimum(worst, outside(P))
        need = np.maximum(0, margin - worst)
        # ignore the root, which starts under the cap on purpose
        need[ts < root] = 0
        if need.max() < 1e-4:
            break
        push = np.convolve(need, np.ones(15) / 15, mode='same') * 1.5 + need
        R = C - axis_point(C)
        C = C + push * R / np.linalg.norm(R, axis=0)
    T, N, S = frames(C, ts, twist)
    Pc = pose_points(C, ease)
    Pu = pose_points(C + wd * S, ease) - Pc
    Pv = pose_points(C + th * N, ease) - Pc
    x = 2 * ts - 1
    exprs, errs = [], []
    for F in (Pc, Pu, Pv):
        for i in range(3):
            for deg in range(8, 23, 2):
                ch = np.polynomial.chebyshev.chebfit(x, F[i], deg)
                c = np.polynomial.chebyshev.cheb2poly(ch)
                e = np.max(np.abs(np.polynomial.polynomial.polyval(x, c) - F[i]))
                if e < 6e-4:
                    break
            errs.append(e)
            exprs.append(horner(c, 't'))
    xyz = [f'{exprs[i]}+cos(w)*({exprs[3 + i]})+lcs(w)*({exprs[6 + i]})' for i in range(3)]
    P = surface(xyz, ('t', -1, 1), ('w', 0, 2 * math.pi), color, name)
    # outward: away from the centre line
    ctr = P.mean(axis=2, keepdims=True)
    assert np.sum(normals(P) * (P - ctr)) > 0, f'{name} faces inward'
    return dict(C=C, worst=float(np.min(worst)), fit=max(errs))


# ---------------------------------------------------------------- the hairstyle
def bang(name, f0, f1, tip, color, width=0.13, thick=0.045, a1=0.9, mid_gap=0.07,
         tip_gap=0.035, sweep=0.0):
    """A bang: from near the parting (angle f0 around it) over the cap to its edge (angle f1,
    a1 of the way to the hairline), then down over the forehead to the tip, given as front-face
    coordinates (u, v) of the skin under it.  sweep bows the hanging part sideways (u)."""
    ca = ev('ca(f)', f=np.array([f0, f1]))
    pts = [cap_point(0.12, f0, 0.0)[0], cap_point(0.5 * ca[0], 0.55 * f0 + 0.45 * f1, 0.025)[0],
           cap_point(a1 * ca[1], f1, 0.04)[0]]
    u, v = tip
    D = np.array([[1.0], [u], [v]])
    skin_tip = G.ev_hr(D)[0] * D[:, 0]
    p2 = pts[-1]
    # a point in front of the forehead, halfway down, standing off the skin by mid_gap
    um, vm = 0.5 * (p2[1] / p2[0] + u) + sweep, 0.45 * (p2[2] / p2[0]) + 0.55 * v
    Dm = np.array([[1.0], [um], [vm]])
    mid = G.ev_hr(Dm)[0] * Dm[:, 0] * (1 + mid_gap)
    pts += [mid, skin_tip * (1 + tip_gap)]
    return lock(name, pts, width, thick, color, root=0.1, tip=0.4)


# ---------------------------------------------------------------- the braid
# A three-strand braid on the cap, around the upper back of the head from above her left ear
# (where the sheet puts the flower ornament) to the back of her right side.  Its ring is given
# by heights on the cap (head frame) at angles f around the parting; a polynomial ba(f) gives
# the angle from the pole that reaches them.  Strand j weaves across the ring as sin(tau)
# and in and out as sin(2 tau), tau a third of a turn apart (the classic braid); the strands
# taper to points at both ends.
BRAID_RING = [(95, 0.98), (120, 1.06), (150, 1.13), (180, 1.17), (215, 1.17), (250, 1.1)]
BRAID_TURNS = 11         # crossings of each strand
BRAID = dict(lift=0.09, across=0.06, out=0.028, r=0.04)


def braid():
    G.emit('# The braid: three strands around a ring on the cap, a = ba(f) from the pole')
    fs_d, zs = zip(*BRAID_RING)
    f0, f1 = math.radians(fs_d[0]), math.radians(fs_d[-1])
    fs = np.linspace(f0, f1, 60)
    zt = np.interp(fs, np.radians(fs_d), zs)
    Q = cap_frame()
    al = np.linspace(0.05, 2.5, 800)
    ring, rads = [], []
    for f, z in zip(fs, zt):
        P = cap_point(al, np.full_like(al, f))
        i = np.nonzero(P[:, 2] < z)[0][0]
        ring.append(al[i])
        rads.append(np.linalg.norm(P[i]))
    x = (fs - f0) / (f1 - f0)
    c = np.polynomial.polynomial.polyfit(x, ring, 5)
    fn('ba(f)', G.poly(c, f'((f-{G.num(f0)})*{G.num(1 / (f1 - f0))})'))
    rm = float(np.mean(rads))
    k = 2 * math.pi * BRAID_TURNS / (f1 - f0)
    b = BRAID
    R, t = G.POSE['R'], G.POSE['t']
    M = R @ Q
    num = G.num
    # taper toward both ends of the ring
    tp = f'min(1,max(0,min(f-{num(f0)},{num(f1)}-f))*{num(1 / 0.18)})^0.6'
    segs = 3
    cuts = np.linspace(f0, f1, segs + 1)
    for j in range(3):
        tau = f'({num(k)}*(f-{num(f0)})+{num(2 * math.pi * j / 3)})'
        A = f'(ba(f)+{tp}*({num(b["across"] / rm)}*sin{tau}+{num(b["r"] / rm)}*cos(w)))'
        K = (f'(1+{num(b["lift"] / rm)}+{tp}*({num(b["out"] / rm)}*sin(2*{tau})+'
             f'{num(b["r"] / rm)}*sin(w)))')
        dl = (f'sin{A}*cos(f)', f'sin{A}*sin(f)', f'cos{A}')
        D = [G.lin(Q[i], [f'({d})' for d in dl]) for i in range(3)]
        rad = f'{K}/{cap_inv_expr(*[f"({d})" for d in D])}'
        fn(f'bq{"abc"[j]}(f,w)', rad)
        xyz = [f'{num(t[i])}+bq{"abc"[j]}(f,w)*({G.lin(M[i], [f"({d})" for d in dl])})' for i in range(3)]
        col = (HAIR, HAIR_LT, HAIR_DK)[j]
        for q in range(segs):
            surface(xyz, ('f', cuts[q], cuts[q + 1]), ('w', 0, 2 * math.pi), col, f'braid{j}{q}',
                    inside='tube')


EASE = (-0.2, -1.5)       # hanging hair: turns with the head above z = -0.2, hangs straight below -1.5


def long_lock(name, f, a_rel, z_end, width, color, lift=0.03, thick=0.07, via=(), flare=0.22,
              fwd=0.0, wave=0.05, phase=0.0, a0=0.14, drift=0.0):
    """A long lock: from near the parting along the cap (angle f around it, turning by drift on
    the way) to a_rel, through the via points (head frame), then hanging, flaring out a little,
    to the height z_end."""
    al = np.linspace(a0, a_rel, 7)
    pts = list(cap_point(al, f + drift * np.linspace(0, 1, 7) ** 2, lift))
    pts += [np.asarray(v, float) for v in via]
    P = pts[-1]
    h = G.unit([P[0] + 0.05, P[1], 0])
    side = np.cross([0, 0, 1.0], h)
    drop = P[2] - z_end
    for k in range(1, 6):
        q = k / 5
        pts.append(P + h * flare * q ** 1.4 + np.array([fwd * q, 0, 0])
                   + side * wave * np.sin(2.6 * math.pi * q + phase) * q
                   - np.array([0, 0, drop * q]))
    return lock(name, pts, width, thick, color, ease=EASE, root=0.05, tip=0.18)


def build(gen):
    global G
    G = gen
    SURFACES.clear()
    G.emit('# ---- hair ----')
    lcs_define()
    cap()
    deg = math.radians
    info = []

    def rep(nm, r):
        info.append(f'{nm} {r["worst"]:.3f}/{r["fit"]:.4f}')

    G.emit('# Long hair: locks from the parting over the cap that hang below the head; an under')
    G.emit('# layer of wide dark locks, the main layer, and thin light strands on top.  On her left')
    G.emit('# the hair is tucked behind the ear; on her right it falls over it.')
    for nm, f, a, z, w, col, lift, th, kw in (
            # under layer
            ('hairU1', 180, 1.85, -1.45, 0.3, HAIR_SH, 0.0, 0.06, {}),
            ('hairU2', 150, 1.8, -1.35, 0.3, HAIR_SH, 0.0, 0.06, {}),
            ('hairU3', -150, 1.8, -1.4, 0.3, HAIR_SH, 0.0, 0.06, {}),
            ('hairU4', 115, 1.6, -1.3, 0.28, HAIR_SH, 0.0, 0.06, dict(drift=0.25)),
            ('hairU5', -120, 1.6, -1.35, 0.3, HAIR_SH, 0.0, 0.06, {}),
            ('hairU6', -95, 1.55, -1.3, 0.28, HAIR_SH, 0.0, 0.06, dict(fwd=0.15)),
            # main layer
            ('hair1', 168, 1.8, -1.75, 0.24, HAIR, 0.035, 0.07, dict(phase=1.0)),
            ('hair2', -168, 1.8, -1.85, 0.24, HAIR_DK, 0.035, 0.07, dict(phase=2.5)),
            ('hair3', 140, 1.75, -1.7, 0.24, HAIR_DK, 0.035, 0.07, dict(phase=4.0)),
            ('hair4', -140, 1.75, -1.8, 0.24, HAIR, 0.035, 0.07, dict(phase=0.3)),
            ('hair5', 108, 1.55, -1.65, 0.22, HAIR, 0.035, 0.07, dict(drift=0.35, phase=2.0)),
            ('hair6', -112, 1.6, -1.75, 0.24, HAIR_DK, 0.035, 0.07, dict(phase=5.0)),
            ('hair7', 84, 1.45, -1.6, 0.2, HAIR_DK, 0.035, 0.065, dict(drift=0.6, phase=3.0)),
            ('hair8', -88, 1.5, -1.8, 0.22, HAIR, 0.035, 0.07, dict(fwd=0.2, phase=1.5)),
            ('hair9', -68, 1.45, -1.7, 0.18, HAIR_LT, 0.04, 0.065, dict(fwd=0.25, phase=4.5)),
            # strands on top
            ('hairT1', 175, 1.8, -1.6, 0.09, HAIR_LT, 0.075, 0.05, dict(phase=3.3)),
            ('hairT2', -152, 1.75, -1.5, 0.09, HAIR_LT, 0.075, 0.05, dict(phase=0.8)),
            ('hairT3', 150, 1.75, -1.55, 0.08, HAIR_LT, 0.075, 0.05, dict(phase=5.5)),
            ('hairT4', -100, 1.55, -1.65, 0.08, HAIR_LT, 0.075, 0.05, dict(fwd=0.18, phase=2.2)),
    ):
        rep(nm, long_lock(nm, deg(f), a, z, w, col, lift=lift, thick=th, **kw))

    G.emit('# Locks that frame the face: on her right over the edge of the cheek, on her left a thin')
    G.emit('# one in front of the ear.')
    for nm, f, via, z, w, col in (
            ('frameR1', -48, [(0.66, -0.74, 0.2), (0.52, -0.72, -0.3), (0.36, -0.66, -0.8)], -1.75, 0.17, HAIR),
            ('frameR2', -62, [(0.56, -0.84, 0.1), (0.38, -0.84, -0.45)], -1.5, 0.14, HAIR_LT),
            ('frameL1', 52, [(0.3, 0.87, 0.15), (0.18, 0.86, -0.35)], -1.7, 0.1, HAIR),
    ):
        ca = float(ev('ca(f)', f=np.array(deg(f))))
        rep(nm, long_lock(nm, deg(f), 0.85 * ca, z, w, col, lift=0.045, thick=0.05, via=via,
                          flare=0.1, wave=0.03))

    G.emit('# Bangs: from the parting over the cap and down over the forehead.  They sweep a')
    G.emit('# little toward her left; the longest falls between the eyes, others end at the brows')
    G.emit('# or reach over the eyes, and thin wisps cross them.')
    for nm, f0, f1, tip, col, w, kw in (
            ('bang0', -2, 6, (0.06, 0.1), HAIR_DK, 0.2, dict(mid_gap=0.045, tip_gap=0.02)),
            ('bang1', -10, 18, (0.34, -0.05), HAIR, 0.2, dict(sweep=0.04, thick=0.055)),
            ('bang2', 6, 46, (0.64, 0.02), HAIR_LT, 0.16, dict(a1=0.85, sweep=0.03)),
            ('bang3', -12, -5, (-0.06, -0.19), HAIR_LT, 0.15, {}),
            ('bang4', -22, -28, (-0.32, -0.03), HAIR, 0.17, dict(thick=0.055)),
            ('bang5', -38, -52, (-0.56, -0.13), HAIR_LT, 0.15, dict(a1=0.85)),
            ('wisp1', -4, 10, (0.15, -0.22), HAIR_LT, 0.03, dict(thick=0.02, tip_gap=0.045)),
            ('wisp2', 10, 34, (0.5, -0.16), HAIR, 0.03, dict(thick=0.02, tip_gap=0.045)),
            ('wisp3', -44, -50, (-0.62, -0.26), HAIR, 0.035, dict(thick=0.02, tip_gap=0.045)),
    ):
        rep(nm, bang(nm, deg(f0), deg(f1), tip, col, width=w, **kw))
    braid()
    print('  locks (clearance/fit):', ', '.join(info))
    allp = np.concatenate([P.reshape(3, -1) for _, P in SURFACES], axis=1)
    return allp.min(axis=1), allp.max(axis=1)
