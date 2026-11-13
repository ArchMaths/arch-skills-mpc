#!/usr/bin/env python3
"""Write pelican.arch: a 3D American white pelican on a wooden post, for the Arch calculator.

Every part is a parametric surface. Most parts are lofts: a cross-section swept along a
planar spine. The spine and the cross-section sizes are C2 cubic splines through a few knots;
each spline segment becomes its own surface, so every segment gets its own full mesh and
neighbouring segments share their edges exactly.

z is up, the bird faces +x, and +y is its left. Feet stand on the post top at z=0.
Needs numpy.  python3 generate.py [-o pelican.arch] [--prec 20] [--azimuth 55] [--elevation 14]
"""
import argparse
import math
import re

import numpy as np

# ---------------------------------------------------------------- numbers and polynomials

def num(v):
    """Short literal; negative numbers in parentheses so they are safe after any operator."""
    if abs(v) < 5e-7:
        return '0'
    s = f'{v:.6f}'.rstrip('0').rstrip('.')
    return f'({s})' if s.startswith('-') else s


def poly(c, var):
    """Horner form of c[0] + c[1] var + c[2] var^2 + ...; var is wrapped once in parentheses."""
    c = list(c)
    while len(c) > 1 and abs(c[-1]) < 5e-7:
        c.pop()
    if len(c) == 1:
        return num(c[0])
    v = var if re.fullmatch(r'[a-z]\w*', var) else f'({var})'
    out = num(c[-1])
    for k in range(len(c) - 2, -1, -1):
        out = f'{num(c[k])}+{v}*({out})' if abs(c[k]) >= 5e-7 else f'{v}*({out})'
    return out


def dpoly(c):
    return [k * c[k] for k in range(1, len(c))] or [0.0]


def spline(t, y, d0=None, d1=None):
    """C2 cubic spline through (t_i, y_i): natural, or clamped where an end slope is given.
    Returns per-segment coefficients in the local variable s in [0,1] (t = t_i + s h_i)."""
    t = np.asarray(t, float)
    y = np.asarray(y, float)
    n = len(t)
    h = np.diff(t)
    A = np.zeros((n, n))
    r = np.zeros(n)
    for i in range(1, n - 1):
        A[i, i - 1] = h[i - 1]
        A[i, i] = 2 * (h[i - 1] + h[i])
        A[i, i + 1] = h[i]
        r[i] = 3 * ((y[i + 1] - y[i]) / h[i] - (y[i] - y[i - 1]) / h[i - 1])
    if d0 is None:
        A[0, 0] = 1
    else:
        A[0, 0], A[0, 1] = 2 * h[0], h[0]
        r[0] = 3 * ((y[1] - y[0]) / h[0] - d0)
    if d1 is None:
        A[-1, -1] = 1
    else:
        A[-1, -2], A[-1, -1] = h[-1], 2 * h[-1]
        r[-1] = 3 * (d1 - (y[-1] - y[-2]) / h[-1])
    c = np.linalg.solve(A, r)
    segs = []
    for i in range(n - 1):
        b = (y[i + 1] - y[i]) / h[i] - h[i] * (2 * c[i] + c[i + 1]) / 3
        d = (c[i + 1] - c[i]) / (3 * h[i])
        segs.append([y[i], b * h[i], c[i] * h[i] ** 2, d * h[i] ** 3])
    return segs


def peval(c, s):
    out = np.zeros_like(s, dtype=float)
    for k in range(len(c) - 1, -1, -1):
        out = out * s + c[k]
    return out

# ---------------------------------------------------------------- scene objects

LINES = []
CHECKS = []
# The whole model is turned about z by YAW degrees: Arch clips 3D scenes to an axis-aligned box,
# and a bird lying along the box's diagonal can be drawn larger.
YAW = 0.0


def rot(v):
    a = math.radians(YAW)
    v = np.asarray(v, float)
    return np.array([math.cos(a) * v[0] - math.sin(a) * v[1], math.sin(a) * v[0] + math.cos(a) * v[1], v[2]])


def emit(line):
    LINES.append(line)


def vec_expr(o, e1, e2, n, P, Q, R):
    """World coordinates O + P e1 + Q e2 + R n as three expression strings (after the yaw)."""
    o, e1, e2, n = (rot(w) for w in (o, e1, e2, n))
    out = []
    for k in range(3):
        terms = [num(o[k])] if abs(o[k]) > 5e-7 else []
        for coef, part in ((e1[k], P), (e2[k], Q), (n[k], R)):
            if abs(coef) < 5e-7 or part == '0':
                continue
            if abs(coef - 1) < 5e-7:
                terms.append(f'({part})')
            elif abs(coef + 1) < 5e-7:
                terms.append(f'-({part})')
            else:
                terms.append(f'{num(coef)}*({part})')
        s = '+'.join(terms).replace('+-', '-') or '0'
        out.append(s)
    return out


def to_np(expr):
    e = expr.replace('^', '**')
    e = re.sub(r'\b(sin|cos|tan|sqrt|exp|abs|atan)\(', r'np.\1(', e)
    e = re.sub(r'\bpi\b', 'np.pi', e)
    return e


def surface(xyz, p1, p2, color, ref, extra='', outward=None, axis=None):
    """Emit a parametric surface; the parameter order is chosen so the normal faces outward.
    outward: a fixed direction, or None to point away from axis(u, v) (a function giving the
    spine point for each sample), or 'skip' for no check."""
    (a, a0, a1), (b, b0, b1) = p1, p2
    U, V = np.meshgrid(np.linspace(a0, a1, 23)[1:-1], np.linspace(b0, b1, 23)[1:-1], indexing='ij')
    env = {'np': np, a: U, b: V}
    P = np.array([np.broadcast_to(eval(to_np(c), env), U.shape) for c in xyz])
    swap = False
    if outward != 'skip':
        hu = 1e-5 * (a1 - a0)
        hv = 1e-5 * (b1 - b0)
        def at(du, dv):
            e = {'np': np, a: U + du, b: V + dv}
            return np.array([np.broadcast_to(eval(to_np(c), e), U.shape) for c in xyz])
        Su = at(hu, 0) - at(-hu, 0)
        Sv = at(0, hv) - at(0, -hv)
        N = np.cross(Su, Sv, axis=0)
        if outward is None:
            A = axis(U, V)
            ref_dir = P - np.array([rot(A[:, i, j]) for i, j in np.ndindex(U.shape)]).T.reshape(P.shape)
        else:
            ref_dir = rot(outward)[:, None, None] * np.ones_like(U)
        score = np.sum(np.sign(np.sum(N * ref_dir, axis=0)))
        swap = score < 0
    CHECKS.append((ref, P.reshape(3, -1)))
    r1 = f'{a},{num(a0)},{num(a1)}'
    r2 = f'{b},{num(b0)},{num(b1)}'
    ranges = f'{r2},{r1}' if swap else f'{r1},{r2}'
    emit(f'surface({xyz[0]},{xyz[1]},{xyz[2]},{ranges}) | ref={ref} color={color}{extra}')
    return P


class Loft:
    """A cross-section swept along a planar spine.

    plane: origin o and unit axes e1, e2 of the spine's plane (n = e1 x e2).
    knots: spine points (p, q) in plane coordinates.
    prof: name -> knot values of each cross-section size.
    section(P) returns (offset along the spine's in-plane normal, offset along n) as strings,
    given the profile expressions P[name], the angle parameter v, and P['_s'], the local spine
    parameter of the segment (0..1).
    cap: ('start', 'end') segments whose sizes shrink to zero like a rounded end.
    """

    def __init__(self, name, o, e1, e2, knots, prof, section, vrange=(0, 2 * math.pi),
                 cap=('start', 'end'), split=None):
        self.name = name
        self.o = np.array(o, float)
        self.e1 = np.array(e1, float) / np.linalg.norm(e1)
        self.e2 = np.array(e2, float) / np.linalg.norm(e2)
        self.n = np.cross(self.e1, self.e2)
        k = np.array(knots, float)
        t = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(k, axis=0), axis=1))])
        self.t = t
        self.sp = spline(t, k[:, 0])
        self.sq = spline(t, k[:, 1])
        prof = dict(prof)
        if 'up' in prof and 'dn' in prof:
            up, dn = np.array(prof.pop('up'), float), np.array(prof.pop('dn'), float)
            prof['am'], prof['ad'] = (up + dn) / 2, (up - dn) / 2
        self.prof = {name: spline(t, vals) for name, vals in prof.items()}
        self.section = section
        self.vrange = vrange
        self.cap = cap
        self.nseg = len(knots) - 1
        self.split = split or {}

    def seg_param(self, i):
        """(variable, range, s-expression, cap factor expression or None)."""
        if i == 0 and 'start' in self.cap:
            return 'w', (0.0, math.pi / 2), '1-cos(w)', 'sin(w)'
        if i == self.nseg - 1 and 'end' in self.cap:
            return 'w', (0.0, math.pi / 2), 'sin(w)', 'cos(w)'
        return 's', (0.0, 1.0), 's', None

    def point(self, i, s):
        """Numeric spine point (before the yaw) of segment i at local s, for orientation checks."""
        p = peval(self.sp[i], s)
        q = peval(self.sq[i], s)
        return self.o[:, None, None] + p * self.e1[:, None, None] + q * self.e2[:, None, None]

    def emit(self, color, colors=None, extra=''):
        """One surface per spline segment (more where split asks); colors overrides per segment."""
        colors = colors or {}
        for i in range(self.nseg):
            var, (w0, w1), sexpr, cap = self.seg_param(i)
            pc, qc = self.sp[i], self.sq[i]
            p, q = poly(pc, sexpr), poly(qc, sexpr)
            dp, dq = poly(dpoly(pc), sexpr), poly(dpoly(qc), sexpr)
            L = f'sqrt(({dp})^2+({dq})^2)'
            P = {}
            for name, segs in self.prof.items():
                e = poly(segs[i], sexpr)
                P[name] = f'{cap}*({e})' if cap else e
            P['_s'] = sexpr
            c, d = self.section(P)
            Pp = f'{p}-({c})*({dq})/{L}' if c != '0' else p
            Qq = f'{q}+({c})*({dp})/{L}' if c != '0' else q
            xyz = vec_expr(self.o, self.e1, self.e2, self.n, Pp, Qq, d)

            def axis(Wv, Vv, i=i, sexpr=sexpr, var=var):
                sv = eval(to_np(sexpr), {'np': np, var: Wv})
                return self.point(i, sv)

            pieces = self.split.get(i, 1)
            for j in range(pieces):
                a0 = w0 + (w1 - w0) * j / pieces
                a1 = w0 + (w1 - w0) * (j + 1) / pieces
                tag = f'{self.name}{i + 1}' + (chr(97 + j) if pieces > 1 else '')
                surface(xyz, (var, a0, a1), ('v',) + tuple(self.vrange), colors.get(i, color), tag, extra, axis=axis)

    # numeric evaluation, for fitting and placing details on the surface
    def sample(self, i, s, v):
        """World points of segment i at local spine parameter s (not w) and angle v (arrays)."""
        s, v = np.broadcast_arrays(np.asarray(s, float), np.asarray(v, float))
        p, q = peval(self.sp[i], s), peval(self.sq[i], s)
        dp, dq = peval(dpoly(self.sp[i]), s), peval(dpoly(self.sq[i]), s)
        L = np.sqrt(dp ** 2 + dq ** 2)
        _, _, _, cap = self.seg_param(i)
        capf = 1.0
        if cap == 'sin(w)':
            capf = np.sqrt(np.clip(1 - (1 - s) ** 2, 0, 1))
        elif cap == 'cos(w)':
            capf = np.sqrt(np.clip(1 - s ** 2, 0, 1))
        env = {'np': np, 'v': v}
        names = {}
        for name, segs in self.prof.items():
            env['PR_' + name] = capf * peval(segs[i], s)
            names[name] = 'PR_' + name
        env['PR__s'] = s
        names['_s'] = 'PR__s'
        c, d = self.section(names)
        cv = np.broadcast_to(eval(to_np(c), env), s.shape)
        dv = np.broadcast_to(eval(to_np(d), env), s.shape)
        P = p - cv * dq / L
        Q = q + cv * dp / L
        return (self.o[:, None] * np.ones(s.size) + np.outer(self.e1, P.ravel()) + np.outer(self.e2, Q.ravel())
                + np.outer(self.n, dv.ravel())).reshape((3,) + s.shape)

    def cloud(self, ns=40, nv=160):
        S, V = np.meshgrid(np.linspace(0, 1, ns), np.linspace(0, 2 * math.pi, nv), indexing='ij')
        return np.concatenate([self.sample(i, S, V).reshape(3, -1) for i in range(self.nseg)], axis=1)

    def frame(self, i, s, v):
        """Point, outward unit normal and unit tangent along the spine at (segment i, s, v)."""
        h = 1e-4
        x = self.sample(i, s, v)
        tu = self.sample(i, min(s + h, 1), v) - self.sample(i, max(s - h, 0), v)
        tv = self.sample(i, s, v + h) - self.sample(i, s, v - h)
        nrm = np.cross(tu, tv)
        nrm /= np.linalg.norm(nrm)
        axis = self.o + peval(self.sp[i], s) * self.e1 + peval(self.sq[i], s) * self.e2
        if np.dot(nrm, x - axis) < 0:
            nrm = -nrm
        return x, nrm, tu / np.linalg.norm(tu)


def ellipse_section(P):
    """Ellipse with different radii on the two sides of the spine: up (cos v>0) and dn, width b."""
    return f'cos(v)*({P["am"]}+({P["ad"]})*cos(v))', f'({P["b"]})*sin(v)'


def round_section(P):
    return f'({P["r"]})*cos(v)', f'({P["r"]})*sin(v)'


def dome(name, centre, normal, tangent, r1, r2, h, color, extra=''):
    """Half ellipsoid: base radii r1 (along tangent) and r2, height h along the normal."""
    n = np.array(normal, float)
    n /= np.linalg.norm(n)
    t1 = np.array(tangent, float)
    t1 -= np.dot(t1, n) * n
    t1 /= np.linalg.norm(t1)
    t2 = np.cross(n, t1)
    Pp = f'{num(r1)}*sin(a)*cos(b)'
    Qq = f'{num(r2)}*sin(a)*sin(b)'
    Rr = f'{num(h)}*cos(a)'
    xyz = vec_expr(centre, t1, t2, n, Pp, Qq, Rr)
    c = np.array(centre, float)
    surface(xyz, ('a', 0, math.pi / 2), ('b', 0, 2 * math.pi), color, name, extra,
            outward=None, axis=lambda A, B: c[:, None, None] - 0.0 * A)

# ---------------------------------------------------------------- the bird

def build(prec):
    X, Y, Z = np.array([1.0, 0, 0]), np.array([0, 1.0, 0]), np.array([0, 0, 1.0])
    O = np.zeros(3)
    PLUME, CREST, DARK = '#d8d3c9', '#dccf9f', '#46423f'
    BILL, NAIL, POUCH, RAMUS, SKIN = '#e99d66', '#d8653a', '#eea44f', '#df8b52', '#f0b24c'
    LEG, CLAW = '#ee8c3d', '#6a5d52'

    emit('@title Pelican')
    emit('# A delicate 3D American white pelican standing on a wooden post, written by generate.py.')
    emit('# Every part is a parametric surface. Most are lofts: an ellipse swept along a curved spine')
    emit('# whose shape and sizes are cubic splines; each spline segment is its own surface, so the')
    emit('# segments share their edges exactly. The bird faces +x before the whole model is turned')
    emit(f'# {num(YAW)} degrees about z. No colour is pure black or pure white, so light and dark mode')
    emit('# show the same colours (Arch only changes the 3D background).')

    # ---- body, neck and head: one loft from the tail to the face
    emit('//Body, neck and head')
    body = Loft('body', O, X, Z,
                knots=[(-3.25, 2.25), (-2.5, 2.38), (-1.2, 2.5), (0.2, 2.62), (1.25, 3.0), (1.62, 3.75),
                       (1.45, 4.5), (1.55, 5.15), (1.85, 5.6), (2.25, 5.72), (2.75, 5.5)],
                prof={'up': [0.10, 0.58, 1.00, 1.02, 0.80, 0.50, 0.40, 0.37, 0.46, 0.46, 0.30],
                      'dn': [0.10, 0.60, 1.18, 1.30, 1.08, 0.62, 0.43, 0.40, 0.44, 0.40, 0.22],
                      'b': [0.32, 0.80, 1.18, 1.24, 0.96, 0.55, 0.40, 0.37, 0.43, 0.41, 0.25]},
                section=ellipse_section, split={2: 2, 3: 2})
    body.emit(PLUME)
    cloud = body.cloud()

    def body_halfwidth(x, z, r=0.07):
        near = (np.abs(cloud[0] - x) < r) & (np.abs(cloud[2] - z) < r)
        return float(np.max(np.abs(cloud[1][near]))) if near.any() else 0.0

    # ---- bill: upper mandible with a ridge and a hooked nail, the pouch, the rami of the lower mandible
    th = math.radians(-32)
    u = np.array([math.cos(th), math.sin(th)])          # along the bill, in (x, z)
    nb = np.array([-math.sin(th), math.cos(th)])        # up from the bill
    B0 = np.array([2.38, 5.52])

    def bp(k, off=0.0):
        return tuple(B0 + k * u + off * nb)

    emit('//Bill')
    def bill_section(P):
        c = f'cos(v)*({P["am"]}+({P["ad"]})*cos(v))+({P["rg"]})*((cos(v)+abs(cos(v)))/2)^12'
        return c, f'({P["b"]})*sin(v)'
    bill = Loft('bill', O, X, Z,
                knots=[bp(0), bp(0.55, 0.01), bp(1.4, 0.0), bp(2.3, -0.02), bp(2.95, -0.04), bp(3.22, -0.11)],
                prof={'up': [0.13, 0.085, 0.06, 0.055, 0.06, 0.05],
                      'dn': [0.06, 0.04, 0.03, 0.028, 0.032, 0.03],
                      'b': [0.26, 0.2, 0.165, 0.17, 0.18, 0.11],
                      'rg': [0.03, 0.025, 0.02, 0.018, 0.015, 0.01]},
                section=bill_section, cap=('end',))
    bill.emit(BILL, colors={4: NAIL})

    emit('//Pouch')
    pk = [-0.55, 0.0, 0.6, 1.4, 2.2, 2.85, 3.05]
    W = [0.2, 0.24, 0.185, 0.15, 0.155, 0.16, 0.12]
    pouch = Loft('pouch', O, X, Z, knots=[bp(k, -0.055) for k in pk],
                 prof={'D': [0.32, 0.52, 0.64, 0.58, 0.40, 0.17, 0.05], 'W': W},
                 section=lambda P: (f'-({P["D"]})*sin(v)', f'({P["W"]})*cos(v)*(1+0.6*sin(v))'),
                 vrange=(0, math.pi), cap=('end',))
    pouch.emit(POUCH)
    for side, tag in ((1, 'L'), (-1, 'R')):
        ram = Loft('ramus' + tag, O, X, Z, knots=[bp(k, -0.055) for k in pk[1:]],
                   prof={'W': W[1:], 'r': [0.04, 0.034, 0.03, 0.03, 0.03, 0.025]},
                   section=lambda P, side=side: (f'({P["r"]})*cos(v)', f'{side}*({P["W"]})+({P["r"]})*sin(v)'),
                   cap=('end',))
        ram.emit(RAMUS)

    # ---- eyes: bare facial skin, iris, pupil and a highlight, stacked as thin domes on the head
    emit('//Eyes')
    fwd = np.array([u[0], 0, u[1]])
    for side, tag in ((1, 'L'), (-1, 'R')):
        v_eye = 3 * math.pi / 2 + 0.3 if side > 0 else math.pi / 2 - 0.3
        P0, n0, t0 = body.frame(9, 0.1, v_eye)
        dome('face' + tag, P0 - 0.03 * n0 + 0.05 * fwd, n0, fwd, 0.19, 0.12, 0.042, SKIN)
        dome('iris' + tag, P0 - 0.014 * n0, n0, fwd, 0.09, 0.09, 0.046, '#ece2bd')
        dome('pupil' + tag, P0 - 0.004 * n0, n0, fwd, 0.05, 0.05, 0.045, '#2e2723')
        dome('glint' + tag, P0 + 0.03 * n0 + 0.022 * Z + 0.015 * fwd, n0, fwd, 0.014, 0.014, 0.013, '#f3f1ea')

    # ---- crest: a small pale tuft at the nape
    emit('//Crest')
    Pc, nc, tc = body.frame(7, 0.95, 0.15)
    back = np.array([-1.0, 0, 0])
    for k, (y0, y1, L) in enumerate(((0.0, 0.0, 0.62), (0.05, 0.13, 0.55), (-0.05, -0.13, 0.55), (0.1, 0.22, 0.45), (-0.1, -0.22, 0.45))):
        r0 = Pc - 0.08 * nc
        kn = [(r0[0], r0[2]), (r0[0] - 0.3 * L, r0[2] + 0.02), (r0[0] - 0.7 * L, r0[2] - 0.06), (r0[0] - L, r0[2] - 0.17)]
        leaf = Loft(f'crest{k + 1}', O, X, Z, knots=kn,
                    prof={'H': [0.05, 0.065, 0.05, 0.02], 'T': [0.03, 0.025, 0.02, 0.015], 'Y': [y0, (2 * y0 + y1) / 3, (y0 + 2 * y1) / 3, y1]},
                    section=lambda P: (f'({P["H"]})*cos(v)', f'-(({P["Y"]})+({P["T"]})*sin(v))'))
        leaf.emit(CREST)

    # ---- wings, folded along the body: coverts, tertials, secondaries and primaries
    emit('//Wings')
    def wing_leaf(name, side, knots, H, T, gap, color, ymin=0.0, scallop=0.0, nsc=4, gap_top=None):
        """A thin curved leaf lying on the body: height H across, thickness T; its lateral position
        follows the body's width at its upper edge, centre and lower edge, plus gap. scallop gives
        the lower edge rounded feather tips, nsc per spline segment."""
        Y0, Y1, Y2 = [], [], []
        kn = np.array(knots, float)
        for i, ((x, z), h) in enumerate(zip(knots, H)):
            t = kn[min(i + 1, len(kn) - 1)] - kn[max(i - 1, 0)]
            nx, nz = -t[1] / np.hypot(*t), t[0] / np.hypot(*t)     # spine normal, the +cos(v) side
            # gap off the body at the lower edge, gap_top at the upper edge, their mean at the centre
            g = {k: gap if k * nz < 0 or gap_top is None else gap_top for k in (-1, 1)}
            g[0] = (g[-1] + g[1]) / 2
            yd, ym, yu = (max(ymin, body_halfwidth(x + k * h * nx, z + k * h * nz)) + g[k] for k in (-1, 0, 1))
            Y0.append(ym)
            Y1.append((yu - yd) / 2)
            Y2.append((yu + yd) / 2 - ym)
        mid = kn[len(kn) // 2 + 1] - kn[len(kn) // 2 - 1]
        lower = '(1+cos(v))/2' if mid[0] < 0 else '(1-cos(v))/2'   # the +cos(v) side is down when the spine runs backwards
        sgn = -side   # n = X x Z = -y

        def section(P):
            edge = f'({P["H"]})'
            if scallop:
                edge = f'({P["H"]})*(1+{num(scallop)}*{lower}*abs(sin({nsc}*pi*({P["_s"]}))))'
            lat = f'({P["Y0"]})+({P["Y1"]})*cos(v)+({P["Y2"]})*cos(v)^2+({P["T"]})*sin(v)'
            return f'{edge}*cos(v)', f'{sgn}*({lat})'
        leaf = Loft(name, O, X, Z, knots=knots, prof={'H': H, 'T': T, 'Y0': Y0, 'Y1': Y1, 'Y2': Y2}, section=section)
        leaf.emit(color)

    for side, tag in ((1, 'L'), (-1, 'R')):
        for k in range(5):
            dz = 0.075 * k
            wing_leaf(f'primary{k + 1}{tag}', side,
                      [(-0.6 - 0.12 * k, 2.68 + dz), (-1.7, 2.66 + dz), (-2.75, 2.58 + 0.85 * dz),
                       (-3.3 - 0.06 * k, 2.47 + 0.7 * dz), (-3.6 - 0.07 * k, 2.4 + 0.6 * dz)],
                      [0.02, 0.12, 0.12, 0.1, 0.02], [0.022] * 5, 0.03 + 0.022 * k, DARK, ymin=0.07 + 0.025 * k)
        wing_leaf('second' + tag, side, [(0.75, 2.5), (0.1, 2.4), (-0.9, 2.35), (-1.85, 2.35), (-2.6, 2.38)],
                  [0.05, 0.3, 0.32, 0.28, 0.05], [0.035, 0.045, 0.045, 0.045, 0.035], 0.045, DARK, scallop=0.12)
        wing_leaf('covert' + tag, side, [(1.15, 2.95), (0.65, 2.92), (-0.25, 2.85), (-1.2, 2.75), (-2.0, 2.66), (-2.6, 2.58)],
                  [0.05, 0.5, 0.6, 0.56, 0.44, 0.05], [0.05, 0.085, 0.095, 0.085, 0.065, 0.04], 0.075, PLUME, scallop=0.08,
                  gap_top=-0.02)
        for k in range(3):
            wing_leaf(f'tertial{k + 1}{tag}', side,
                      [(-0.9 - 0.15 * k, 3.05 - 0.1 * k), (-1.8 - 0.1 * k, 2.95 - 0.1 * k), (-2.6 - 0.1 * k, 2.82 - 0.1 * k),
                       (-3.05 - 0.12 * k, 2.72 - 0.1 * k)],
                      [0.03, 0.17, 0.15, 0.02], [0.028, 0.035, 0.035, 0.028], 0.16 + 0.03 * k, PLUME, ymin=0.25)

    # ---- tail: a short fan of feathers under the wing tips
    emit('//Tail')
    R0 = np.array([-2.75, 0.0, 2.27])
    for k, a in enumerate(np.linspace(-32, 32, 7)):
        al = math.radians(a)
        e1 = np.array([-math.cos(al), math.sin(al), 0.0])
        L = 0.95 - 0.12 * abs(a) / 32
        tail = Loft(f'tail{k + 1}', R0, e1, Z, knots=[(0, 0), (0.4 * L, -0.01), (0.8 * L, -0.04), (L, -0.06)],
                    prof={'T': [0.03, 0.025, 0.02, 0.012], 'Wf': [0.06, 0.1, 0.1, 0.05]},
                    section=lambda P: (f'({P["T"]})*cos(v)', f'({P["Wf"]})*sin(v)'))
        tail.emit(PLUME)

    # ---- legs and webbed feet (all four toes are joined by webs, as in every pelican)
    emit('//Legs and feet')
    for side, tag in ((1, 'L'), (-1, 'R')):
        leg = Loft('leg' + tag, np.array([0, 0.58 * side, 0]), X, Z,
                   knots=[(0.05, 1.8), (0.16, 1.15), (0.28, 0.6), (0.38, 0.14)],
                   prof={'r': [0.25, 0.175, 0.135, 0.12]}, section=round_section, cap=('end',))
        leg.emit(LEG)
        F = np.array([0.46, 0.62 * side, 0.0])
        toes = [(math.radians(a) * side, L) for a, L in ((-72, 0.46), (-27, 0.92), (4, 1.12), (33, 1.08))]
        for k, (phi, L) in enumerate(toes):
            e1 = np.array([math.cos(phi), math.sin(phi), 0])
            toe = Loft(f'toe{k + 1}{tag}', F, e1, Z,
                       knots=[(0.05, 0.13), (0.3 * L, 0.135), (0.65 * L, 0.1), (L, 0.065)],
                       prof={'r': [0.08, 0.07, 0.055, 0.042]}, section=round_section, cap=('end',))
            toe.emit(LEG)
            claw = Loft(f'claw{k + 1}{tag}', F, e1, Z,
                        knots=[(L - 0.04, 0.068), (L + 0.05, 0.058), (L + 0.13, 0.02)],
                        prof={'r': [0.038, 0.03, 0.014]}, section=round_section, cap=('end',))
            claw.emit(CLAW)
        for k in range(3):
            (pa, La), (pb, Lb) = toes[k], toes[k + 1]
            phi = f'({num(pa)}+({num(pb - pa)})*f)'
            Le = f'({num(La)}+({num(Lb - La)})*f)*(0.97-0.24*sin(pi*f))'
            xyz = vec_expr(F, X, Y, Z, f'r*{Le}*cos({phi})', f'r*{Le}*sin({phi})', '0.11-0.05*r-0.012*sin(pi*f)*r')
            surface(xyz, ('r', 0, 1), ('f', 0, 1), LEG, f'web{k + 1}{tag}', outward=(0, 0, 1))

    # ---- the post: a worn top, a grained side and growth rings
    emit('//Post')
    C = np.array([0.3, 0.0, 0.0])
    Rp = 1.75
    grain = '(0.018*sin(23*a)+0.012*sin(41*a+2)+0.01*sin(7*a+0.5)*cos(3*h))'
    rim = grain.replace('*h)', '*(-0.13))')
    # Top and side are split into the same four quarters, so their shared rim has the same vertices.
    for k in range(4):
        a = ('a', k * math.pi / 2, (k + 1) * math.pi / 2)
        xyz = vec_expr(C, X, Y, Z, f'q*({num(Rp)}+{rim})*cos(a)', f'q*({num(Rp)}+{rim})*sin(a)', '(-0.13)*q^12')
        surface(xyz, ('q', 0, 1), a, '#a2825f', f'postTop{k + 1}', outward=(0, 0, 1))
        xyz = vec_expr(C, X, Y, Z, f'({num(Rp)}+{grain})*cos(a)', f'({num(Rp)}+{grain})*sin(a)', 'h')
        surface(xyz, a, ('h', -3.0, -0.13), '#7d6048', f'postSide{k + 1}',
                outward=None, axis=lambda A, H: np.array([C[0] + 0 * A, C[1] + 0 * A, H]))
    # A contact shadow under the bird: opaque, a little darker in steps. (Translucent surfaces would
    # let the page show through Arch's canvas: lighter in light mode, darker in dark mode.)
    for k, (sx, sy, col) in enumerate(((1.25, 1.0, '#9b7b5a'), (0.98, 0.8, '#947556'), (0.72, 0.6, '#8d6f51'))):
        xyz = vec_expr(np.array([0.35, 0, 0.008 * (k + 1)]), X, Y, Z, f'{num(sx)}*q*cos(a)', f'{num(sy)}*q*sin(a)', '0')
        surface(xyz, ('q', 0, 1), ('a', 0, 2 * math.pi), col, f'shadow{k + 1}', outward=(0, 0, 1))
    for k, rr in enumerate((0.35, 0.75, 1.15, 1.5)):
        x, y, z = vec_expr(C, X, Y, Z, f'{num(rr)}*cos(q)', f'{num(rr)}*sin(q)', num(0.03 - 0.13 * (rr / Rp) ** 12))
        emit(f'curve({x},{y},{z},q,0,2*pi) | ref=ring{k + 1} color=#6b5039 thickness=1')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('-o', default='pelican.arch')
    ap.add_argument('--prec', type=float, default=20)
    ap.add_argument('--yaw', type=float, default=45)
    ap.add_argument('--azimuth', type=float, default=55, help='camera azimuth relative to the bird')
    ap.add_argument('--elevation', type=float, default=14)
    ap.add_argument('--zmin', type=float, default=-1.0, help='lowest z to keep inside the 3D box')
    args = ap.parse_args()
    global YAW
    YAW = args.yaw
    build(args.prec)
    # Arch clips 3D scenes to a box of half-size 8*scale3D = about 246/unit around the view centre.
    allp = np.concatenate([p for _, p in CHECKS], axis=1)
    lo = allp.min(axis=1)
    hi = allp.max(axis=1)
    lo[2] = max(lo[2], args.zmin)
    centre = (lo + hi) / 2
    half = float(np.max(hi - lo)) / 2 + 0.08
    unit = math.floor(246 / half)
    emit(f'@view 3d azimuth={num(args.azimuth + YAW)} elevation={num(args.elevation)} unit={unit} '
         f'center={num(round(centre[0], 2))},{num(round(centre[1], 2))},{num(round(centre[2], 2))}')
    emit(f'@set implicitPrecision={num(args.prec)} orderedDrawing=true showAxes=false gridStyle=hidden')
    with open(args.o, 'w') as f:
        f.write('\n'.join(LINES) + '\n')
    print(f'{len(CHECKS)} surfaces, {sum(len(l) for l in LINES)} chars; '
          f'bounds x {allp[0].min():.2f}..{allp[0].max():.2f} y {allp[1].min():.2f}..{allp[1].max():.2f} '
          f'z {allp[2].min():.2f}..{allp[2].max():.2f}')


if __name__ == '__main__':
    main()
