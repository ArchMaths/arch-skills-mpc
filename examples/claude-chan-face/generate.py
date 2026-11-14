#!/usr/bin/env python3
"""Write claude-chan-face.arch: Claude Chan's face for the Arch calculator, built from
parametric surfaces only.

The head is ONE closed surface, written as a radius function seen from a single centre:

    P(D) = hr(D) * D

D = (p, q, w) is a direction (not normalised) and hr(D) how far to go along it.  Arch expands
user functions as text macros, so hr is written so that every primitive appears ONCE:

  * each primitive gives its reciprocal radius 1/s along D, a function of degree 1 in D:
    superquadrics centred on the head centre (skull, lower face), an off-centre slanted
    cylinder (neck: (sqrt(B^2-AC)-B)/(-C)), half-spaces (jaw sides, under the jaw: max(n.D,0)/h);
  * soft intersection is the p-norm of reciprocal radii, 1/s^k = sum 1/s_i^k, and soft union
    the p-norm of radii, s^k = sum s_i^k.  No term is repeated, and the result stays of
    degree -1 in D, so a blend is a fixed fraction of the size whatever the length of D;
  * small forms (eye sockets, nose, cheeks, lips, chin) multiply the radius by
    exp(sum of Gaussian bumps), placed in front-face coordinates (u, v) = (q/p, w/p).

The surface is drawn as a cube-sphere: D = (1, u, v) on the front face of a cube, and likewise
on the other five.  Each face is cut into the same grid of tiles; every tile is one Arch surface
(Arch meshes a surface on at most 60 x 60 cells), all with the same hr, so tiles meet exactly.
On the front face (u, v) is the front view divided by the depth, which is nearly constant, so
the eyes, brows, blush and mouth are drawn there as decals: patches P = hr(1,U,V)*(1+L)*(1,U,V)
over regions of the (u, v) plane, lifted by a small fraction L per layer.  Each region of the
face gets its own copy of hr without the parts that are negligible there.  The ears are
separate shells.

x is forward (she looks along +x), y is her left, z is up.  Needs numpy.
    python3 generate.py [--expression natural-smile] [-o FILE.arch] [--prec 20]
Each expression of the character sheet is a set of changes to the face (EXPRESSIONS below).
"""
import argparse
import math

import numpy as np

# ---------------------------------------------------------------- formatting


def num(v, digits=5):
    """Short literal; negatives in parentheses so they are safe after any operator."""
    if abs(v) < 0.5 * 10 ** -digits:
        return '0'
    s = f'{v:.{digits}f}'.rstrip('0').rstrip('.')
    return f'({s})' if s.startswith('-') else s


def expo(a, b=1):
    """Exponent a/b as an Arch literal."""
    v = a / b
    if abs(v - round(v)) < 1e-12:
        return num(round(v))
    return f'({a}/{b})' if a > 0 else f'(-{-a}/{b})'


def unit(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


HR = ('p', 'q', 'w')     # the parameters of hr(p,q,w)
FRONT = ('1', 'a', 'b')  # the front face: D = (1, a, b)


def term(c, names):
    """c times a product of names, where the name '1' drops out."""
    names = [n for n in names if n != '1']
    if not names:
        return num(c)
    v = '*'.join(names) if len(set(names)) > 1 or len(names) == 1 else f'{names[0]}^{len(names)}'
    if abs(c - 1) < 1e-7:
        return v
    if abs(c + 1) < 1e-7:
        return '-' + v
    return f'{num(c)}*{v}'


def total(terms):
    """Sum of term strings, merging the constant ones."""
    const, rest = 0.0, []
    for t in terms:
        try:
            const += float(t.strip('()'))
        except ValueError:
            rest.append(t)
    if abs(const) > 1e-9:
        rest.insert(0, num(const))
    return '+'.join(rest).replace('+-', '-') or '0'


def lin(coefs, names):
    return total(term(c, [n]) for c, n in zip(coefs, names) if abs(c) > 1e-7)


def quad(M, names):
    return total(term(M[i, j] * (1 if i == j else 2), [names[i], names[j]])
                 for i in range(3) for j in range(i, 3) if abs(M[i, j]) > 1e-9)

# ---------------------------------------------------------------- shape algebra
# Every node knows its radius s along D through the reciprocal 1/s.  inv(m, names) is the
# string for s^(-m), with D written as the three names, and ev_inv(D, m) its value
# (D is a 3 x N array).


class Ellipsoid:
    """Solid ellipsoid with centre c, semi-axes a (np.inf for a cylinder), axes rotated by R."""

    def __init__(self, c, a, R=None):
        self.c = np.asarray(c, float)
        a = np.asarray(a, float)
        R = np.eye(3) if R is None else np.asarray(R, float)
        self.M = R @ np.diag(1 / a ** 2) @ R.T
        self.C = self.c @ self.M @ self.c - 1
        assert self.C < 0, 'the centre of the head must lie inside every primitive'

    def inv(self, m, nm):
        A = quad(self.M, nm)
        if np.allclose(self.c, 0):
            return f'({A})^{expo(m, 2)}'
        B = lin(self.M @ self.c, nm)
        return f'((sqrt(({B})^2-({A})*{num(self.C, 6)})-({B}))*{num(-1 / self.C, 6)})^{expo(m)}'

    def ev_inv(self, D, m):
        A = np.einsum('in,ij,jn->n', D, self.M, D)
        B = (self.M @ self.c) @ D
        return ((np.sqrt(B * B - A * self.C) - B) / (-self.C)) ** m


class HalfSpace:
    """n.X <= h (h > 0: the centre is inside)."""

    def __init__(self, n, through=None, h=None):
        self.n = unit(n)
        self.h = float(h if h is not None else self.n @ np.asarray(through, float))
        assert self.h > 0

    def inv(self, m, nm):
        assert m > 0, 'a half-space cannot be part of a union'
        return f'max({lin(self.n / self.h, nm)},0)^{expo(m)}'

    def ev_inv(self, D, m):
        return np.maximum(self.n @ D / self.h, 0) ** m


class Superquadric:
    """A superquadric centred on the head centre, with its own semi-axis in each of the six
    directions (front xf, back xb, side y, top zt, bottom zb).  Its horizontal sections are
    superellipses of exponent n, its vertical ones of exponent m:
        1/s = ( ((p+/xf)^n + (p-/xb)^n + (|q|/y)^n)^(m/n) + (w+/zt)^m + (w-/zb)^m )^(1/m)
    with p+ = max(p,0), p- = max(-p,0).  It is homogeneous of degree 1 in D, as it must be."""

    def __init__(self, xf, xb, y, zt, zb, n=2.0, m=2.0):
        self.a = (xf, xb, y, zt, zb)
        self.n, self.m = n, m

    def inv(self, k, nm):
        xf, xb, y, zt, zb = self.a
        n, m = self.n, self.m
        p, q, w = nm
        if p == '1':                      # on the front face p = 1: no back term
            h = [num((1 / xf) ** n)]
        else:
            h = [f'(max({p},0)*{num(1 / xf)})^{num(n)}', f'(max(-{p},0)*{num(1 / xb)})^{num(n)}']
        h.append(f'(abs({q})*{num(1 / y)})^{num(n)}')
        body = (f'({total(h)})^{num(m / n)}+(max({w},0)*{num(1 / zt)})^{num(m)}'
                f'+(max(-{w},0)*{num(1 / zb)})^{num(m)}')
        return f'({body})^{num(k / m)}'

    def ev_inv(self, D, k):
        xf, xb, y, zt, zb = self.a
        n, m = self.n, self.m
        p, q, w = D
        h = (np.maximum(p, 0) / xf) ** n + (np.maximum(-p, 0) / xb) ** n + (np.abs(q) / y) ** n
        return (h ** (m / n) + (np.maximum(w, 0) / zt) ** m + (np.maximum(-w, 0) / zb) ** m) ** (k / m)


class Inter:
    """Soft intersection: 1/s^k = sum 1/s_i^k."""

    def __init__(self, parts, k):
        self.parts, self.k = parts, k

    def inv(self, m, nm):
        body = '+'.join(p.inv(self.k, nm) for p in self.parts)
        return f'({body})' if m == self.k else f'({body})^{expo(m, self.k)}'

    def ev_inv(self, D, m):
        return sum(p.ev_inv(D, self.k) for p in self.parts) ** (m / self.k)


class Union:
    """Soft union: s^k = sum s_i^k."""

    def __init__(self, parts, k):
        self.parts, self.k = parts, k

    def inv(self, m, nm):
        body = '+'.join(p.inv(-self.k, nm) for p in self.parts)
        return f'({body})^{expo(-m, self.k)}'

    def ev_inv(self, D, m):
        return sum(p.ev_inv(D, -self.k) for p in self.parts) ** (-m / self.k)


def prune(node, D, tol):
    """The node without the parts that change its radius by less than tol over the directions D.
    Used for the decals: each region of the face gets a shorter radius function."""
    if not isinstance(node, (Inter, Union)):
        return node
    sgn = 1 if isinstance(node, Inter) else -1
    vals = [p.ev_inv(D, sgn * node.k) for p in node.parts]
    tot = sum(vals)
    keep = [prune(p, D, tol) for p, v in zip(node.parts, vals) if np.max(v / tot) > tol]
    return keep[0] if len(keep) == 1 else type(node)(keep, node.k)


class Bump:
    """A bump on the front of the head, multiplying the radius by exp(amp * exp(-Q)).
    It is written in the front-face coordinates (u, v) = (q/p, w/p), the plane the face is
    drawn in:  Q = ((u-u0)/su)^2 + ((v-v0)/sv)^2, with sv above the centre and svb below.
    g < 1 sharpens the top (Q -> Q^g).  sym=True mirrors it to both sides (|u|)."""

    def __init__(self, u0, v0, su, sv, amp, svb=None, g=1.0, sym=False):
        self.u0, self.v0, self.su, self.sv = u0, v0, su, sv
        self.svb = sv if svb is None else svb
        self.amp, self.g, self.sym = amp, g, sym

    def term(self, nm):
        p, q, w = nm
        q = f'abs({q})' if self.sym else q
        if p == '1':
            U, V = q, w
        else:
            # q/p and w/p, kept finite at p = 0; behind the head (p < 0) u is pushed far
            # away, or the bumps would leave a tiny copy of themselves around D = (-1, 0, 0).
            P = f'max({p},0.0001)'
            U, V = f'({q}/{P}+1000*max(-{p},0))', f'{w}/{P}'
        du = f'({U}-{num(self.u0)})' if self.u0 else U
        dv = f'({V}-{num(self.v0)})' if self.v0 else V
        Q = f'({du}*{num(1 / self.su)})^2+'
        if abs(self.sv - self.svb) < 1e-9:
            Q += f'({dv}*{num(1 / self.sv)})^2'
        else:
            kp, kn = 1 / self.sv, 1 / self.svb
            Q += f'({dv}*({num((kp + kn) / 2)}+{num((kp - kn) / 2)}*sign({dv})))^2'
        if self.g != 1:
            Q = f'({Q}+0.01)^{num(self.g)}-{num(0.01 ** self.g)}'
        return f'{num(self.amp)}*exp(-({Q}))'

    def ev(self, D):
        p, q, w = np.asarray(D, float)
        P = np.maximum(p, 0.0001)
        u = (np.abs(q) if self.sym else q) / P + 1000 * np.maximum(-p, 0) - self.u0
        v = w / P - self.v0
        Q = (u / self.su) ** 2 + (v / np.where(v >= 0, self.sv, self.svb)) ** 2
        if self.g != 1:
            Q = (Q + 0.01) ** self.g - 0.01 ** self.g
        return self.amp * np.exp(-Q)

# ---------------------------------------------------------------- the head

SKIN = '#fbe4d6'


def rot_y(deg):
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


# The skull: a superquadric, squarish from above so the face is broad and flat.
cranium = Superquadric(xf=0.92, xb=0.9, y=0.83, zt=0.92, zb=0.66, n=2.15, m=2.0)
# The lower face: a superquadric that is deep in front and long below (cheeks, mouth, chin),
# trimmed by the two sides of the jaw and the plane under the jaw.
lowerface = Inter([Superquadric(xf=0.90, xb=0.25, y=0.74, zt=0.30, zb=0.91, n=2.3, m=3.2),
                   HalfSpace([0, 0.595, -0.804], through=[0.3, 0.6, -0.5]),
                   HalfSpace([0, -0.595, -0.804], through=[0.3, -0.6, -0.5]),
                   HalfSpace([-0.488, 0, -0.873], through=[0.56, 0, -0.875])], 12)
# The neck: a slanted cylinder between two planes (its top is buried in the skull).
neck = Inter([Ellipsoid([-0.25, 0, -0.8], [0.30, 0.30, np.inf], rot_y(7)),
              HalfSpace([0, 0, -1], h=1.55), HalfSpace([0, 0, 1], h=0.2)], 40)
HEAD = Union([Union([cranium, lowerface], 24), neck], 14)

CHEEKS = Bump(0.50, -0.40, 0.23, 0.18, 0.02, sym=True)   # set by the expression
BUMPS = [
    Bump(0.39, -0.16, 0.14, 0.10, -0.025, sym=True),             # eye sockets
    Bump(0.0, -0.42, 0.04, 0.09, 0.05, svb=0.035, g=0.8),        # nose
    CHEEKS,                                                      # cheeks
    Bump(0.0, -0.68, 0.17, 0.10, 0.015),                         # lips
    Bump(0.0, -1.45, 0.22, 0.32, 0.05),                          # chin
    Bump(0.0, -0.80, 0.105, 0.05, -0.01),                        # below the lower lip
]


def hr_expr(nm=HR, node=HEAD, bumps=BUMPS):
    if not bumps:
        return f'1/({node.inv(1, nm)})'
    b = '+'.join(x.term(nm) for x in bumps).replace('+-', '-')
    return f'exp({b})/({node.inv(1, nm)})'


def ev_hr(D, node=HEAD, bumps=BUMPS):
    D = np.asarray(D, float)
    return np.exp(sum((b.ev(D) for b in bumps), 0.0)) / node.ev_inv(D, 1)


def front_region(u0, u1, v0, v1, sym=True, n=60):
    uu, vv = np.meshgrid(np.linspace(u0, u1, n), np.linspace(v0, v1, n), indexing='ij')
    u, v = uu.ravel(), vv.ravel()
    if sym:
        u, v = np.concatenate([u, -u]), np.concatenate([v, v])
    return np.array([np.ones_like(u), u, v])


def region_hr(D, tol=1e-6):
    """A shorter head radius for the directions D: the full one without the negligible parts."""
    node = prune(HEAD, D, tol)
    bumps = [b for b in BUMPS if np.max(np.abs(b.ev(D))) > tol]
    err = np.max(np.abs(ev_hr(D, node, bumps) / ev_hr(D) - 1))
    return node, bumps, err

# ---------------------------------------------------------------- scene

LINES = []


def emit(s):
    LINES.append(s)


# cube faces: D as strings in u, v and as numbers; (u, v) order gives an outward normal
FACES = {
    'front': (('1', 'u', 'v'), lambda u, v: (np.ones_like(u), u, v)),
    'back': (('(-1)', '(-u)', 'v'), lambda u, v: (-np.ones_like(u), -u, v)),
    'left': (('(-u)', '1', 'v'), lambda u, v: (-u, np.ones_like(u), v)),
    'right': (('u', '(-1)', 'v'), lambda u, v: (u, -np.ones_like(u), v)),
    'top': (('u', 'v', '1'), lambda u, v: (u, v, np.ones_like(u))),
    'bottom': (('v', 'u', '(-1)'), lambda u, v: (v, u, -np.ones_like(u))),
}


def mul(a, b):
    if a == '1':
        return b
    if b == '1':
        return a
    return f'{a}*{b}'


def tile(face, u0, u1, v0, v1, color=SKIN, fn='hr', ev=None):
    """One tile of a cube face: P = fn(D) * D with D on the face, (u, v) in [u0,u1] x [v0,v1]."""
    ev = ev or ev_hr
    (P, Q, W), f = FACES[face]
    h = f'{fn}({P},{Q},{W})'
    # orientation check: the normal should point away from the centre
    uu, vv = np.meshgrid(np.linspace(u0, u1, 9), np.linspace(v0, v1, 9), indexing='ij')
    eps = 1e-5

    def pt(a, b):
        D = np.array(f(a.ravel(), b.ravel()), float)
        return D * ev(D)
    Pm = pt(uu, vv)
    N = np.cross(pt(uu + eps, vv) - pt(uu - eps, vv), pt(uu, vv + eps) - pt(uu, vv - eps), axis=0)
    if np.sum(N * Pm) < 0:
        print(f'warning: tile {face} {u0},{u1},{v0},{v1} faces inward')
    # tiles that reach down into the neck bend with it; the others turn rigidly with the head
    xyz = (bent if POSE['angle'] and Pm[2].min() < NECK_BEND[1] + 0.02 else posed)(h, (P, Q, W))
    emit(f'surface({xyz[0]},{xyz[1]},{xyz[2]},u,{num(u0)},{num(u1)},v,{num(v0)},{num(v1)}) | color={color}')


def tiles(face, ucuts, vcuts, colors=(SKIN,), fn='hr', ev=None):
    """All tiles of a cube face; with two colours they alternate like a chessboard."""
    for i in range(len(ucuts) - 1):
        for j in range(len(vcuts) - 1):
            tile(face, ucuts[i], ucuts[i + 1], vcuts[j], vcuts[j + 1], colors[(i + j) % len(colors)],
                 fn, ev)


# ---------------------------------------------------------------- curves for the decals


def poly(c, var):
    """Horner form of c[0] + c[1] var + c[2] var^2 + ..."""
    c = list(c)
    while len(c) > 1 and abs(c[-1]) < 5e-7:
        c.pop()
    out = num(c[-1])
    for k in range(len(c) - 2, -1, -1):
        out = f'{num(c[k])}+{var}*({out})' if abs(c[k]) >= 5e-7 else f'{var}*({out})'
    return out


def spline(t, y):
    """Natural cubic spline through (t_i, y_i), as a numpy function."""
    t, y = np.asarray(t, float), np.asarray(y, float)
    n, h = len(t), np.diff(t)
    A, r = np.zeros((n, n)), np.zeros(n)
    A[0, 0] = A[-1, -1] = 1
    for i in range(1, n - 1):
        A[i, i - 1:i + 2] = h[i - 1], 2 * (h[i - 1] + h[i]), h[i]
        r[i] = 3 * ((y[i + 1] - y[i]) / h[i] - (y[i] - y[i - 1]) / h[i - 1])
    c = np.linalg.solve(A, r)
    b = (y[1:] - y[:-1]) / h - h * (2 * c[:-1] + c[1:]) / 3
    d = (c[1:] - c[:-1]) / (3 * h)

    def f(x):
        x = np.asarray(x, float)
        i = np.clip(np.searchsorted(t, x) - 1, 0, n - 2)
        dx = x - t[i]
        return y[i] + b[i] * dx + c[i] * dx ** 2 + d[i] * dx ** 3
    return f


class Curve:
    """A smooth curve through control points (s, value), written for Arch as one polynomial."""

    def __init__(self, pts, deg=6, name=None):
        t, y = zip(*pts)
        f = spline(t, y)
        xs = np.linspace(t[0], t[-1], 400)
        # the ends are held (almost) exactly, so curves that share a corner meet there
        wts = np.ones_like(xs)
        wts[[0, -1]] = 1000
        self.c = np.polynomial.polynomial.polyfit(xs, f(xs), deg, w=wts)
        err = np.max(np.abs(np.polynomial.polynomial.polyval(xs, self.c) - f(xs)))
        if err > 0.005:
            print(f'warning: curve {name} fits its control points to within {err:.4f} only')
        self.name = name

    def __call__(self, var):
        """Arch expression: a call of the curve's own function if it has a name."""
        return f'{self.name}({var})' if self.name else poly(self.c, f'({var})')

    def define(self):
        emit(f'{self.name}(s)={poly(self.c, "s")}')

# ---------------------------------------------------------------- the face, as decals
# A decal is a patch over a region of the front face's (u, v) plane, drawn at
# dp(U,V,L) * (1, U, V) = hr(1,U,V) * (1+L) * (1, U, V): the skin, lifted by the fraction L.
# Every layer gets its own lift, so the layers stack in a fixed order in Arch's depth buffer.


LIFT = 0.0016            # lift between two stacked layers, as a fraction of the radius


def lv(k):
    return num(k * LIFT, 6)


def decal(U, V, L, pa, pb, color, mirror=False, fn='de'):
    """U, V, L: expressions in the patch parameters pa, pb = (name, lo, hi).  (pa, pb) must
    give an outward normal on her left side; mirror=True draws the patch on her right."""
    if mirror:
        U = f'-({U})'
        pa, pb = pb, pa
    h = f'{fn}({U},{V},{L})'
    xyz = posed(h, ('1', f'({U})', f'({V})'))
    rng = ','.join(f'{n},{num(a)},{num(b)}' for n, a, b in (pa, pb))
    emit(f'surface({xyz[0]},{xyz[1]},{xyz[2]},{rng}) | color={color}')


def clamp(v, lo, hi):
    return f'min(max({v},{lo}),{hi})'


# The left eye, in front-face coordinates.  t = 0 at the inner corner, 1 at the outer corner;
# the lid curves give v relative to EYE_V.
EYE_U0, EYE_UW, EYE_V = 0.155, 0.46, -0.16
# As on the sheet, the upper lid is nearly straight, with both corners up near it, and the eye
# hangs below it like a bowl.
LID_UP_PTS = [(0, 0.06), (0.1, 0.085), (0.3, 0.098), (0.5, 0.103), (0.7, 0.1), (0.9, 0.09),
              (1.0, 0.075)]
LID_LO_PTS = [(0, 0.06), (0.06, 0.0), (0.2, -0.05), (0.4, -0.075), (0.6, -0.08), (0.8, -0.06),
              (0.93, -0.01), (1.0, 0.075)]
BROW_PTS = [(-0.05, 0.255), (0.25, 0.275), (0.55, 0.283), (0.85, 0.275), (1.05, 0.262)]
LASH_TH = Curve([(0, 0.012), (0.08, 0.022), (0.3, 0.028), (0.6, 0.034), (0.85, 0.04),
                 (1.0, 0.04)], deg=4, name='lasht')
IRIS = dict(t=0.47, dv=0.03, a=0.105, b=0.13)
MOUTH_V = -0.68

# ---------------------------------------------------------------- pose
# The head turns rigidly about a point at the top of the neck, P -> t + R P, which for the skin
# is t + hr(D) * (R D): only the direction changes, so it costs nothing.  R looks up by `pitch`
# and then tilts toward her right by `tilt`.  For the tilt the neck bends smoothly instead,
# from still at z = NECK_BEND[0] to fully turned at NECK_BEND[1]; the look-up turns it whole.
NECK_BEND = (-1.5, -0.85)
NECK_TOP = np.array([-0.25, 0, NECK_BEND[1]])      # the point the head turns about
POSE = dict(R=np.eye(3), t=np.zeros(3), P=np.eye(3), tp=np.zeros(3), angle=0.0)


def rot_x(deg):
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def rot_up(deg):
    """Look up by deg degrees: the face (+x) turns toward +z."""
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return np.array([[c, 0, -s], [0, 1, 0], [s, 0, c]])


def set_pose(tilt, pitch=0.0):
    """Look up by pitch degrees, then tilt toward her right by tilt degrees."""
    P = rot_up(pitch)
    R = rot_x(tilt) @ P
    POSE.update(R=R, t=NECK_TOP - R @ NECK_TOP, P=P, tp=NECK_TOP - P @ NECK_TOP,
                angle=math.radians(tilt))


def affine(h, D, M, t):
    """The strings of t + M (h * D)."""
    if np.allclose(M, np.eye(3)) and np.allclose(t, 0):
        return [mul(h, c) for c in D]
    out = []
    for i in range(3):
        rd = lin(M[i], D)
        p = h if rd == '1' else f'{h}*({rd})'
        out.append(f'{num(t[i])}+{p}' if abs(t[i]) > 1e-9 else p)
    return out


def posed(h, D):
    """The coordinates of h * D in the pose; h is a radius and D three direction strings."""
    return affine(h, D, POSE['R'], POSE['t'])


def bent(h, D):
    """Like posed, for the neck: the look-up is applied whole, and then the tilt, whose angle
    grows smoothly with the height z the point had before the pose."""
    z0, z1 = NECK_BEND
    Z = mul(h, D[2])
    X1, Y1, Z1 = affine(h, D, POSE['P'], POSE['tp'])
    c = f'min(max(({Z}-({num(z0)}))*{num(1 / (z1 - z0))},0),1)'
    th = f'{num(POSE["angle"], 6)}*{c}^2*(3-2*{c})'
    return [X1, f'({Y1})*cos({th})-({Z1}-({num(z1)}))*sin({th})',
            f'{num(z1)}+({Y1})*sin({th})+({Z1}-({num(z1)}))*cos({th})']

# ---------------------------------------------------------------- expressions
# Each expression on the sheet changes a few numbers of the face.  'base' is the face as first
# built; every other expression overrides some of its values.
BASE = dict(
    title='Claude Chan - face',
    lid_up=0.0,            # the middle of the upper lid moves by this (v; negative = down)
    lid_lo=0.0,            # the middle of the lower lid moves by this (positive = up)
    under_eye=False,       # the soft fold under the lower lid that a smile pushes up
    gaze=(0.0, 0.0),       # (u, v) shift of both irises: where she looks
    converge=0.0,          # extra shift of each iris toward the nose
    glow_dv=(-0.045, -0.065),  # how far below the iris centre its two bright bands sit
    brow_dv=0.0,           # eyebrows up (+) or down (-)
    mouth=dict(w=0.1, lift=0.024, hook=0.0, asym=0.0, th=0.011, taper=0.7),
    cheek=(-0.40, 0.02),   # height and amplitude of the cheek bumps
    blush_v=-0.42,
    blush=3,               # how many of the three blush steps are drawn (0 = none)
    tilt=0.0,              # head tilt toward her right, degrees
    pitch=10.0,            # how far she looks up, degrees (measured from the sheet)
    view=(22, 2),          # azimuth and elevation of the saved view
)
EXPRESSIONS = {
    'base': {},
    # 自然微笑, the first expression on the sheet: relaxed upper lids, lower lids pushed up by
    # the cheeks, eyes on the viewer, a closed smile, the head tilted toward her right.
    'natural-smile': dict(
        title='Claude Chan - natural smile', lid_up=-0.012, lid_lo=0.022, under_eye=True,
        gaze=(-0.014, 0.0), converge=0.009, brow_dv=0.005,
        mouth=dict(w=0.12, lift=0.006, hook=0.005, asym=0.004, th=0.008, taper=0.35),
        cheek=(-0.37, 0.03), blush_v=-0.40, blush=1, tilt=12, view=(8, 2)),
}
X = dict(BASE)


def lid_curve(pts, dv, name):
    """A lid curve through pts, its middle moved by dv (the corners stay)."""
    if not dv:
        return Curve(pts, deg=9, name=name)
    t, y = zip(*pts)
    ts = np.linspace(0, 1, 17)
    return Curve(list(zip(ts, spline(t, y)(ts) + dv * np.sin(np.pi * ts) ** 0.8)), deg=9,
                 name=name)


def set_expression(name):
    global X, LID_UP, LID_LO, BROW
    X = {**BASE, **EXPRESSIONS[name]}
    LID_UP = lid_curve(LID_UP_PTS, X['lid_up'], 'lidu')
    LID_LO = lid_curve(LID_LO_PTS, X['lid_lo'], 'lidl')
    BROW = Curve([(t, v + X['brow_dv']) for t, v in BROW_PTS], deg=4, name='brow')
    CHEEKS.v0, CHEEKS.amp = X['cheek']
    set_pose(X['tilt'], X['pitch'])


set_expression('base')


def eye_u(t):
    return f'{num(EYE_U0)}+{num(EYE_UW)}*{t}'


def t_of(U):
    return f'(({U})-{num(EYE_U0)})*{num(1 / EYE_UW)}'


def lid_hi(U, d=0.0):
    return f'{num(EYE_V + d)}+{LID_UP(t_of(U))}'


def lid_lo(U, d=0.0):
    return f'{num(EYE_V + d)}+{LID_LO(t_of(U))}'


def ellipse(cu, cv, a, b, L, color, mirror, lo=None, hi=None, fn='de'):
    """Elliptic patch centred at (cu, cv), squeezed between the curves lo(U) and hi(U)."""
    U = f'{num(cu)}+{num(a)}*r*cos(g)'
    V = f'{num(cv)}+{num(b)}*r*sin(g)'
    if lo or hi:
        V = clamp(V, lo(U) if lo else '-9', hi(U) if hi else '9')
    decal(U, V, L, ('r', 0, 1), ('g', 0, 2 * math.pi), color, mirror, fn)


def quad_patch(A, B, C, D, L, color, mirror, fn='de'):
    """Bilinear patch with corners A (s=0,w=0), B (s=0,w=1), C (s=1,w=0), D (s=1,w=1), each a
    point (u, v) of the front face; C = D makes a triangle."""
    A, B, C, D = (np.asarray(P, float) for P in (A, B, C, D))
    k = [f'(1-s)*(1-w)*{num(A[i])}+(1-s)*w*{num(B[i])}+s*(1-w)*{num(C[i])}+s*w*{num(D[i])}'
         for i in (0, 1)]
    du = (C + D - A - B) / 2
    dw = (B + D - A - C) / 2
    pa, pb = ('s', 0, 1), ('w', 0, 1)
    if du[0] * dw[1] - du[1] * dw[0] < 0:
        pa, pb = pb, pa
    decal(k[0], k[1], L, pa, pb, color, mirror, fn)


def lid_point(t, dv=0.0, curve=None):
    curve = curve or LID_UP
    v = EYE_V + np.polynomial.polynomial.polyval(t, curve.c) + dv
    return (EYE_U0 + EYE_UW * t, v)


def eye(mirror):
    s, w = ('s', 0, 1), ('w', 0, 1)
    U = eye_u('s')
    top = f'{num(EYE_V)}+lidu(s)'
    bot = f'{num(EYE_V)}+lidl(s)'
    # white of the eye, and the soft shadow the upper lid casts on it
    decal(U, f'{bot}+w*(lidu(s)-lidl(s))', lv(1), s, w, '#f8f2ef', mirror)
    decal(U, f'max({top}-0.04*(1-w),{bot})', lv(2), s, w, '#e4d5dc', mirror)
    # iris: dark rim, amber body, bright lower half, the lid's shadow, pupil, highlights
    gu, gv = X['gaze']
    gu = (-gu if mirror else gu) - X['converge']     # mirror flips u; the nose is at u = 0
    cu = EYE_U0 + EYE_UW * IRIS['t'] + gu
    cv = EYE_V + IRIS['dv'] + gv
    a, b = IRIS['a'], IRIS['b']
    ellipse(cu, cv, a, b, lv(3), '#5e2c14', mirror, lid_lo, lid_hi)
    ellipse(cu, cv, 0.86 * a, 0.89 * b, lv(4), '#b4612a', mirror, lid_lo, lid_hi)
    g1, g2 = X['glow_dv']
    ellipse(cu, cv + g1, 0.66 * a, 0.5 * b, lv(5), '#d08a46', mirror, lid_lo, lid_hi)
    ellipse(cu, cv + g2, 0.48 * a, 0.3 * b, lv(6), '#e8b06a', mirror, lid_lo, lid_hi)
    ellipse(cu, cv, 0.86 * a, 0.89 * b, lv(7), '#4a2412', mirror,
            lambda U: lid_hi(U, -0.05), lid_hi)
    # the pupil sits high, just under the lid, with a small highlight beside it
    ellipse(cu, cv + 0.03, 0.34 * a, 0.36 * b, lv(8), '#2e140a', mirror, lid_lo, lid_hi)
    hx = -0.022 if not mirror else 0.022      # both highlights on the viewer's left
    ellipse(cu + hx, cv + 0.04, 0.02, 0.025, lv(9), '#fffdf8', mirror, lid_lo, lid_hi)
    ellipse(cu - 1.6 * hx, cv - 0.055, 0.012, 0.009, lv(9), '#fff4e6', mirror, lid_lo, lid_hi)
    # upper lash line: a raised band along the upper lid, thickest at the outer corner
    ridge = f'{lv(10)}+0.01*sin(pi*w)'
    decal(U, f'{top}-0.009+w*(lasht(s)+0.009)', ridge, s, w, '#2e1c18', mirror)
    # a short hook down into the inner corner
    corner = lid_point(0.0)[1]
    quad_patch(lid_point(0.0, 0.012), lid_point(0.07, -0.009), (EYE_U0 - 0.006, corner - 0.03),
               (EYE_U0 - 0.006, corner - 0.03), lv(10), '#2e1c18', mirror)
    # its wing past the outer corner, pointing out and a little down
    v1 = lid_point(1.0)[1]
    lo0, hi0, tip, ln = v1 - 0.009, v1 + LASH_TH.c @ np.ones(len(LASH_TH.c)), v1 - 0.004, 0.14
    f = f'(s-1)*{num(1 / ln)}'
    lo = f'{num(lo0)}+{f}*{num(tip - lo0)}'
    hi = f'{num(hi0)}+{f}^0.75*{num(tip - hi0)}'
    decal(U, f'{lo}+w*({hi}-({lo}))', ridge, ('s', 1, 1 + ln), w, '#2e1c18', mirror)
    # lower lash line on the outer half, thickening toward the outer corner where it meets the
    # wing; and the crease of the upper lid
    f = '(s-0.4)*1.6667'
    decal(U, f'{bot}+0.004-w*0.03*{f}^1.5*(1-{f})^0.3', lv(10), ('s', 0.4, 1), w, '#6e3a2a',
          mirror)
    f = '(s-0.22)*1.3699'
    decal(U, f'{top}+lasht(s)+0.026+w*0.008*4*{f}*(1-{f})', lv(2), ('s', 0.22, 0.95), w,
          '#d9a896', mirror)
    if X['under_eye']:
        # the soft fold under the lower lid that a smile pushes up
        f = '(s-0.35)*1.8182'
        decal(U, f'{bot}-0.032+w*0.006*4*{f}*(1-{f})', lv(2), ('s', 0.35, 0.9), w, '#ebc2b4',
              mirror)
    # eyebrow: thick at the inner end, tapering outward
    th = '(0.018-0.012*(s+0.05)*0.9091)'
    decal(U, f'{num(EYE_V)}+brow(s)-{th}/2+w*{th}', lv(2), ('s', -0.05, 1.05), w, '#c4642e',
          mirror)
    # blush on the cheek, in three soft steps
    steps = ((1.0, '#fadcd2'), (0.7, '#f7cbc0'), (0.42, '#f3b9ad'))[:X['blush']]
    for k, (sc, col) in enumerate(steps):
        ellipse(0.47, X['blush_v'], 0.13 * sc, 0.055 * sc, lv(k + 1), col, mirror, fn='dc')


def mouth():
    """A closed mouth: a line whose corners rise by lift (plus a small upturn, hook, at the very
    ends, and asym more on her left), thickness th in the middle thinning toward the corners."""
    m = X['mouth']
    w = m['w']
    mid = f'{num(MOUTH_V)}+{num(m["lift"] / w ** 2)}*s^2'
    if m['hook']:
        mid += f'+{num(m["hook"] / w ** 8, 1)}*s^8'
    if m['asym']:
        mid += f'+{num(m["asym"] / w)}*s'
    th = f'({num(m["th"])}*(1-(s*{num(1 / w)})^2)^{num(m["taper"])}+0.002)'
    decal('s', f'{mid}-{th}/2+w*{th}', lv(2), ('s', -w, w), ('w', 0, 1), '#b0524a', fn='dm')


def ear(mirror):
    """An ear on the side of the head: a pear-shaped shell in its own frame (e_h backward,
    e_k up, n out), with a flare that lifts its back edge off the head, a rolled rim and a
    hollow bowl.  A second surface closes it from behind."""
    E = np.array([-0.12, 0.80, -0.17])
    n = unit([0.30, 0.95, -0.12])
    ek = np.array([-0.2, 0, 0.98])
    ek = unit(ek - (ek @ n) * n)
    eh = np.cross(ek, n)
    h = '(0.105+0.03*sin(g))*cos(g)*r'
    k = '0.2*sin(g)*r'
    flare = '0.055*r*((1+cos(g))/2)^1.2'
    rim = '0.022*exp(-((r-0.84)*10)^2)*(0.55+0.45*cos(g))'
    front = f'0.012+{flare}+{rim}-0.028*exp(-(r*2)^2)'
    edge = '0.012+0.055*((1+cos(g))/2)^1.2+0.022*exp(-2.56)*(0.55+0.45*cos(g))-0.028*exp(-4)'
    back = f'({edge})*r^2-0.06*(1-r^2)'
    M = np.diag([1, -1, 1]) if mirror else np.eye(3)        # her right ear is the mirror image
    R, t = POSE['R'], POSE['t']
    E, eh, ek, n = t + R @ M @ E, R @ M @ eh, R @ M @ ek, R @ M @ n
    bowl = f'0.014+{flare}+{rim}-0.028*exp(-(r*2)^2)'
    for d, order, rmax, color in ((front, ('r', 'g'), 1, SKIN), (back, ('g', 'r'), 1, SKIN),
                                  (bowl, ('r', 'g'), 0.62, '#eebfb0')):
        xyz = [total([num(E[i]), term(eh[i], [f'({h})']), term(ek[i], [f'({k})']),
                      term(n[i], [f'({d})'])]) for i in range(3)]
        rng = {'r': f'r,0,{num(rmax)}', 'g': f'g,0,{num(2 * math.pi)}'}
        if mirror:
            order = order[::-1]
        emit(f'surface({xyz[0]},{xyz[1]},{xyz[2]},{rng[order[0]]},{rng[order[1]]}) | color={color}')


def features():
    emit('# The face is drawn on the skin of the front face, D = (1,a,b).  Each region gets its')
    emit('# own copy of hr without the parts that are negligible there (he: eyes and brows,')
    emit('# hc: cheeks, hm: mouth), and de, dc, dm lift it by the fraction c.')
    for name, D in (('e', front_region(0.1, 0.75, -0.32, 0.24)),
                    ('c', front_region(0.33, 0.61, -0.48, -0.36)),
                    ('m', front_region(-0.15, 0.15, -0.75, -0.6, sym=False))):
        node, bumps, err = region_hr(D)
        assert err < 2e-5, (name, err)
        emit(f'h{name}(a,b)={hr_expr(FRONT, node, bumps)}')
        emit(f'd{name}(a,b,c)=h{name}(a,b)*(1+c)')
    for c in (LID_UP, LID_LO, LASH_TH, BROW):
        c.define()
    emit('# her left eye, then her right eye')
    eye(False)
    eye(True)
    emit('# mouth')
    mouth()
    emit('# ears')
    ear(False)
    ear(True)


# The parts of the head before they are blended, for the construction figure (--stage primitives).
PARTS = [('pc', cranium, '#e9c4ae', 'skull: a superquadric'),
         ('pf', lowerface, '#a9c8e8', 'lower face: a superquadric cut by three half-spaces'),
         ('pn', neck, '#b5d6a4', 'neck: a slanted cylinder between two planes')]


def build(args):
    if args.stage == 'primitives':
        emit('@title Claude Chan - face: the primitives')
        emit('# Each primitive drawn on its own, before the soft union blends them into one head')
        for name, node, color, note in PARTS:
            emit(f'# {note}')
            emit(f'{name}(p,q,w)=1/({node.inv(1, HR)})')
            for f in FACES:
                tiles(f, [-1, 0, 1], [-1, 0, 1], (color,), name, lambda D, n=node: 1 / n.ev_inv(D, 1))
    else:
        emit(f'@title {X["title"]}')
        emit('# The head radius along the direction (p,q,w): soft unions and intersections of')
        emit('# superquadrics, a cylinder (the neck) and half-spaces, times exp(sum of bumps).')
        emit(f'hr(p,q,w)={hr_expr()}')
        emit('# the head as a cube-sphere: six cube faces, each cut into the same grid of tiles')
        # Every face is cut the same way, so neighbouring tiles of different faces sample their
        # shared edge at the same points (Arch meshes each surface on its own uniform grid).
        cuts = np.linspace(-1, 1, args.tiles + 1)
        for f in FACES:
            if args.stage == 'tiles':
                colors = ('#bcd3ee', '#e3edf9') if f == 'front' else ('#efc3ab', '#fbe4d6')
            else:
                colors = (SKIN,)
            tiles(f, cuts, cuts, colors)
        if args.stage == 'final':
            features()
    az, el = X['view']
    az = az if args.azimuth is None else args.azimuth
    el = el if args.elevation is None else args.elevation
    centre = POSE['t'] + POSE['R'] @ np.array([float(c) for c in args.center.split(',')])
    emit(f'@view 3d azimuth={num(az)} elevation={num(el)} unit={num(args.unit)} '
         f'center={",".join(num(c, 3).strip("()") for c in centre)}')
    emit(f'@set showAxes=false gridStyle=hidden implicitPrecision={args.prec}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('-o', '--out', help='default: claude-chan-face[-EXPRESSION].arch')
    ap.add_argument('--expression', choices=EXPRESSIONS, default='base')
    ap.add_argument('--prec', type=float, default=20)
    ap.add_argument('--azimuth', type=float, help="default: the expression's view")
    ap.add_argument('--elevation', type=float)
    ap.add_argument('--unit', type=float, default=210)
    ap.add_argument('--center', default='0,0,-0.3')
    ap.add_argument('--tiles', type=int, default=4, help='tiles per cube face side')
    ap.add_argument('--stage', choices=('final', 'tiles', 'primitives'), default='final',
                    help='tiles: the bare head with its tiles in two colours; primitives: the '
                         'parts of the head before they are blended')
    args = ap.parse_args()
    set_expression(args.expression)
    if not args.out:
        args.out = 'claude-chan-face' + ('' if args.expression == 'base' else
                                         f'-{args.expression}') + '.arch'
    build(args)
    with open(args.out, 'w') as fh:
        fh.write('\n'.join(LINES) + '\n')
    print(f'{args.out}: {sum(1 for s in LINES if s.startswith("surface"))} surfaces, '
          f'longest line {max(len(s) for s in LINES)} chars')


if __name__ == '__main__':
    main()
