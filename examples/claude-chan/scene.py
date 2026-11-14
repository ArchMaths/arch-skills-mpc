"""Tiny scene builder for Arch parametric surfaces.

Every surface is written as an Arch tuple (X,Y,Z,u,u0,u1,v,v0,v1). The builder also evaluates each
formula in Python, so it can flip surfaces whose normals point inward (Arch lights a surface whose
normal faces away from the camera at half strength) and report bounding boxes.
"""
import math, re
from contextlib import contextmanager

PI = math.pi


def fmt(v):
    if isinstance(v, str):
        return v
    if abs(v) < 5e-6:
        return '0'
    s = f"{v:.5f}".rstrip('0').rstrip('.')
    return s if v >= 0 else f"({s})"


# ---------- vectors ----------
def add(a, b): return tuple(x + y for x, y in zip(a, b))
def sub(a, b): return tuple(x - y for x, y in zip(a, b))
def mul(a, k): return tuple(x * k for x in a)
def dot(a, b): return sum(x * y for x, y in zip(a, b))
def cross(a, b): return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
def norm(a): return math.sqrt(dot(a, a))
def unit(a):
    n = norm(a)
    return tuple(x / n for x in a)
def lerp(a, b, t): return tuple(x + (y - x) * t for x, y in zip(a, b))


def frame(n, up=(0, 0, 1)):
    """Orthonormal frame (a, b, c) with c = n; a is horizontal-ish (perpendicular to up and n), b = c x a."""
    c = unit(n)
    a = cross(up, c)
    if norm(a) < 1e-6:
        a = cross((0, 1, 0), c)
    a = unit(a)
    b = cross(c, a)
    return a, b, c


def frame_ab(a_dir, c_dir):
    """Frame with c along c_dir and a as close to a_dir as possible."""
    c = unit(c_dir)
    a = unit(sub(a_dir, mul(c, dot(a_dir, c))))
    b = cross(c, a)
    return a, b, c


def bezier_poly(points):
    """Power-basis coefficients (per axis) of the Bezier curve through control points."""
    n = len(points) - 1
    dims = len(points[0])
    coeffs = [[0.0] * (n + 1) for _ in range(dims)]
    for i, p in enumerate(points):
        # Bernstein b_{i,n}(s) = C(n,i) s^i (1-s)^(n-i) = sum_k C(n,i) C(n-i,k) (-1)^k s^(i+k)
        for k in range(n - i + 1):
            c = math.comb(n, i) * math.comb(n - i, k) * (-1) ** k
            for d in range(dims):
                coeffs[d][i + k] += c * p[d]
    return coeffs


def horner(coeffs, var):
    """Arch expression for sum coeffs[i]*var^i (Horner form)."""
    cs = list(coeffs)
    while len(cs) > 1 and abs(cs[-1]) < 1e-9:
        cs.pop()
    expr = fmt(cs[-1])
    for c in reversed(cs[:-1]):
        expr = f"{fmt(c)}+{var}*({expr})"
    return expr


def bezier_eval(points, s):
    n = len(points) - 1
    out = [0.0] * len(points[0])
    for i, p in enumerate(points):
        b = math.comb(n, i) * s ** i * (1 - s) ** (n - i)
        for d in range(len(p)):
            out[d] += b * p[d]
    return tuple(out)


def rot_parts(axis):
    """K and K^2 for a rotation about the unit axis: R(a) = I + sin(a) K + (1 - cos(a)) K^2."""
    k = unit(axis)
    K = [[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]]
    K2 = [[sum(K[i][m] * K[m][j] for m in range(3)) for j in range(3)] for i in range(3)]
    return K, K2


def axis_angle(R):
    """Axis and angle of a rotation matrix."""
    ang = math.acos(max(-1.0, min(1.0, (R[0][0] + R[1][1] + R[2][2] - 1) / 2)))
    ax = (R[2][1] - R[1][2], R[0][2] - R[2][0], R[1][0] - R[0][1])
    return unit(ax), ang


# ---------- Python evaluation of Arch expressions ----------
def _pow(a, b):
    if a < 0 and abs(b - round(b)) > 1e-10:
        raise ValueError('strict pow')
    return a ** b


class Scene:
    def __init__(self, title):
        self.title = title
        self.out = []
        self.ns = {k: getattr(math, k) for k in ('sin', 'cos', 'tan', 'sqrt', 'exp', 'floor', 'atan', 'asin', 'acos', 'ceil')}
        self.ns.update(pi=math.pi, abs=abs, ln=math.log, sign=lambda v: (v > 0) - (v < 0),
                       max=max, min=min, _pow=_pow)
        self.count = 0
        self.flipped = []
        self.report = []
        self.names = set()
        self.turn = None          # (pivot, axis, angle, blend, scale) while drawing inside a turned() block
        self.lift = 0.0           # added to z while drawing inside a raised() block

    # Arch '^' -> Python; '^' binds tighter than unary minus in both.
    def py(self, expr):
        return expr.replace('^', '**')

    def raw(self, line):
        self.out.append(line)

    def comment(self, text):
        for t in text.strip('\n').split('\n'):
            self.out.append('# ' + t if t else '#')

    def note(self, text):
        self.out.append('//' + text)

    def blank(self):
        self.out.append('')

    def func(self, sig, body):
        name, args = re.match(r'(\w+)\((.*)\)', sig).groups()
        low = [a.strip().lower() for a in args.split(',')]
        assert len(set(low)) == len(low), f'{sig}: parameter names clash (Arch ignores case)'
        assert not set(low) & {'x', 'y', 'z', 'e', 'pi'}, f'{sig}: reserved parameter name'
        self.ns[name] = eval(f"lambda {args}: {self.py(body)}", self.ns)
        self.out.append(f"{sig}={body}")

    def var(self, name, value):
        self.ns[name] = value
        self.out.append(f"{name}={fmt(value)}")

    def _f(self, X, Y, Z, u, v):
        f = eval(f"lambda {u},{v}: ({self.py(X)},{self.py(Y)},{self.py(Z)})", self.ns)

        def g(a, b):
            try:
                p = f(a, b)
                return p if all(isinstance(c, (int, float)) and math.isfinite(c) for c in p) else None
            except (ValueError, ZeroDivisionError, OverflowError, TypeError):
                return None
        return g

    # ---------- turning a group of parts (her head) ----------
    @contextmanager
    def turned(self, pivot, axis, angle, blend=None, scale=1.0):
        """Surfaces and curves drawn inside are turned by angle about axis through pivot and scaled about it.
        blend=None turns them rigidly; blend=(S, C) gives Arch expressions in the surface parameters for sin
        and 1-cos of a varying angle, so a part can turn with the head at one end and not at all at the
        other; a third expression in blend is the varying scale."""
        prev, self.turn = self.turn, (pivot, axis, angle, blend, scale)
        try:
            yield
        finally:
            self.turn = prev

    @contextmanager
    def unturned(self):
        prev, self.turn = self.turn, None
        try:
            yield
        finally:
            self.turn = prev

    @contextmanager
    def raised(self, dz):
        """Surfaces and curves drawn inside are moved up by dz."""
        prev, self.lift = self.lift, self.lift + dz
        try:
            yield
        finally:
            self.lift = prev

    def turn_point(self, P, turn=None):
        """Where a point of a turned group ends up (rigid turn and scale)."""
        turn = turn or self.turn
        if turn is None:
            return P
        p, axis, ang = turn[:3]
        k = turn[4] if len(turn) > 4 else 1.0
        K, K2 = rot_parts(axis)
        s, c = math.sin(ang), 1 - math.cos(ang)
        d = sub(P, p)
        return tuple(p[i] + k * (d[i] + sum((s * K[i][j] + c * K2[i][j]) * d[j] for j in range(3))) for i in range(3))

    def _turn(self, XYZ):
        p, axis, ang, blend, k = self.turn
        K, K2 = rot_parts(axis)
        V = XYZ
        out = []
        for i in range(3):
            if blend is None:
                s, c = math.sin(ang), 1 - math.cos(ang)
                M = [k * ((1 if i == j else 0) + s * K[i][j] + c * K2[i][j]) for j in range(3)]
                const = p[i] - sum(M[j] * p[j] for j in range(3))
                terms = [f"{fmt(M[j])}*({V[j]})" for j in range(3) if abs(M[j]) > 1e-9]
                out.append('+'.join(terms) + f"+{fmt(const)}")
            else:
                S, C = blend[:2]
                terms = []
                for j in range(3):
                    parts = ['1'] if i == j else []
                    if abs(K[i][j]) > 1e-9:
                        parts.append(f"{fmt(K[i][j])}*{S}")
                    if abs(K2[i][j]) > 1e-9:
                        parts.append(f"{fmt(K2[i][j])}*{C}")
                    if parts:
                        terms.append(f"({'+'.join(parts)})*({V[j]})")
                a = sum(K[i][j] * p[j] for j in range(3))
                b = sum(K2[i][j] * p[j] for j in range(3))
                e = '+'.join(terms) + f"-{fmt(a)}*{S}-{fmt(b)}*{C}"
                if len(blend) > 2:          # scale about the pivot by the third expression
                    e = f"{fmt(p[i])}+{blend[2]}*({e}-{fmt(p[i])})"
                out.append(e)
        return tuple(out)

    def _lift(self, XYZ):
        return XYZ if not self.lift else (XYZ[0], XYZ[1], f"{XYZ[2]}+{fmt(self.lift)}")

    def surface(self, XYZ, U, V, color, ref=None, orient='closed', opacity=None, hidden=False):
        """XYZ: three Arch expressions; U, V: (name, lo, hi); orient: how to decide the outside.
        'closed' outward from the centroid, ('point', p) away from p, ('dir', d) toward d,
        ('tube', 'u'|'v') away from the axis of rings at fixed u (or v), None = keep."""
        if self.turn:
            XYZ = self._turn(XYZ)
        X, Y, Z = self._lift(XYZ)
        u, u0, u1 = U
        v, v0, v1 = V
        lo_hi = [float(eval(self.py(fmt(t)), self.ns)) for t in (u0, u1, v0, v1)]
        g = self._f(X, Y, Z, u, v)
        swap = False
        N = 20
        pts = []
        for i in range(1, N):
            for j in range(1, N):
                a = lo_hi[0] + (lo_hi[1] - lo_hi[0]) * i / N
                b = lo_hi[2] + (lo_hi[3] - lo_hi[2]) * j / N
                P = g(a, b)
                Pa = g(a + (lo_hi[1] - lo_hi[0]) * 1e-4, b)
                Pb = g(a, b + (lo_hi[3] - lo_hi[2]) * 1e-4)
                if not (P and Pa and Pb):
                    continue
                n = cross(sub(Pa, P), sub(Pb, P))
                if norm(n) < 1e-14:
                    continue
                pts.append((i, j, P, unit(n)))
        if not pts:
            raise RuntimeError(f'{ref}: no valid samples')
        if orient is not None:
            if orient == 'closed':
                cen = mul(tuple(map(sum, zip(*[p[2] for p in pts]))), 1 / len(pts))
                score = sum(1 if dot(sub(P, cen), n) < 0 else -1 for _, _, P, n in pts)
            elif orient[0] == 'point':
                score = sum(1 if dot(sub(P, orient[1]), n) < 0 else -1 for _, _, P, n in pts)
            elif orient[0] == 'dir':
                score = sum(1 if dot(orient[1], n) < 0 else -1 for _, _, P, n in pts)
            elif orient[0] == 'tube':
                key = 0 if orient[1] == 'u' else 1
                rings = {}
                for p in pts:
                    rings.setdefault(p[key], []).append(p[2])
                rc = {k: mul(tuple(map(sum, zip(*ps))), 1 / len(ps)) for k, ps in rings.items()}
                score = sum(1 if dot(sub(P, rc[(i, j)[key]]), n) < 0 else -1 for i, j, P, n in pts)
            else:
                raise ValueError(orient)
            swap = score > 0
        lo = [min(p[2][k] for p in pts) for k in range(3)]
        hi = [max(p[2][k] for p in pts) for k in range(3)]
        self.report.append((ref, swap, lo, hi))
        if swap:
            self.flipped.append(ref)
            U, V = V, U
        opts = []
        if ref:
            assert ref.lower() not in self.names, ref
            self.names.add(ref.lower())
            opts.append(f"ref={ref}")
        opts.append(f"color={color}")
        if opacity is not None:
            opts.append(f"opacity={opacity}")
        if hidden:
            opts.append('hidden')
        self.out.append(f"({X},{Y},{Z},{U[0]},{fmt(U[1])},{fmt(U[2])},{V[0]},{fmt(V[1])},{fmt(V[2])}) | {' '.join(opts)}")
        self.count += 1

    def curve(self, XYZ, T, color, ref=None, thickness=2):
        if self.turn:
            XYZ = self._turn(XYZ)
        X, Y, Z = self._lift(XYZ)
        t, t0, t1 = T
        opts = [f"color={color}", f"thickness={thickness}"]
        if ref:
            assert ref.lower() not in self.names, ref
            self.names.add(ref.lower())
            opts.insert(0, f"ref={ref}")
        self.out.append(f"curve({X},{Y},{Z},{t},{fmt(t0)},{fmt(t1)}) | {' '.join(opts)}")
        self.count += 1

    def text(self):
        return '\n'.join([f"@title {self.title}"] + self.out) + '\n'
