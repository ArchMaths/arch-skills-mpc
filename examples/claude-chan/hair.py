# Run inside generate.py after outfit.py: long hair as smooth sculpted sheets.
import numpy as np

_cape = [bezier_eval(CAPE, s) for s in np.linspace(0, 1, 200)]


def cape_ab(z):
    best = min(_cape, key=lambda p: abs(p[0] - z))
    return best[1], best[2]


def ell_r(a, b, psi):
    return 1 / math.sqrt((math.sin(psi) / a) ** 2 + (math.cos(psi) / b) ** 2)


def envelope(psi, z):
    """Distance from the body axis to the outside of the figure at angle psi from the back."""
    r = 0.3
    if 8.9 <= z <= 10.75:
        a, b = cape_ab(z)
        r = max(r, ell_r(a, b, psi))
    if 7.6 <= z <= 9.3:
        r = max(r, ell_r(0.7, 0.55, psi))
    if z < 8.2:
        a = SA((8.4 - z) / 7.05) + 0.16
        r = max(r, ell_r(a, 0.88 * a, psi))
        if abs(psi) < 0.75 and 6.3 < z < 8.5:          # back bow and its tails
            r = max(r, 0.88 * (SA((8.4 - 8.0) / 7.05) + 0.2) + 0.32)
    if 1.25 < abs(psi) < 1.95 and 7.1 < z < 9.05:      # forearms and hands below the capelet
        r = max(r, 1.45)
    if 1.6 < psi < 2.1 and 6.0 < z < 7.6:              # the book in her left hand
        r = max(r, 1.68)
    return r


def cap_r(psi, z):
    k = 1 - ((z - 12.0) / 1.103) ** 2
    return ell_r(1.044, 1.083, psi) * math.sqrt(max(k, 0))


def head_r(psi, z):
    k = 1 - ((z - 12.0) / 1.03) ** 2
    return ell_r(0.88, 0.98, psi) * math.sqrt(max(k, 0))


ZTOP, ZLEN = 12.3, 8.2
KNOTS = np.concatenate([np.linspace(0.04, 0.32, 12), np.linspace(0.38, 0.94, 9)])


def fit_profile(req, top):
    """Quadratic spline a0 + a1 s + sum c_i max(0, s - s_i)^2 that stays above req (and near top at the head)."""
    S = np.linspace(0, 1, 330)
    target = np.where(np.isnan(top), req + 0.06, top)
    for _ in range(40):
        A = np.column_stack([np.ones_like(S), S] + [np.maximum(0, S - k) ** 2 for k in KNOTS])
        w = np.where(np.isnan(top), 1.0, 3.0)
        coef, *_ = np.linalg.lstsq(A * w[:, None], target * w, rcond=None)
        fit = A @ coef
        deficit = np.where(np.isnan(top), req + 0.03 - fit, 0)
        if deficit.max() <= 0:
            break
        target = target + np.maximum(deficit, 0) * 1.6
    margin = float(np.min(np.where(np.isnan(top), fit - req, 1)))
    expr = f"{fmt(coef[0])}+{fmt(coef[1])}*s" + ''.join(f"+{fmt(c)}*max(0,s-{fmt(k)})^2" for c, k in zip(coef[2:], KNOTS))
    return expr, margin, fit


if want('hair'):
    sc.blank()
    sc.note('Long hair')
    sc.comment("""Long hair: three layered sheets around the back and sides. Each layer is an ellipse whose half-axes
crx(s), cry(s) (s from the crown, z = 12.3 - 8.2 s) hug the inside of the hair cap at the top, then keep
clear of the capelet, arms, book, bows and skirt, and flare out below the waist. The sheet is sculpted
into clumps: cg is 0 in a groove and 1 on a clump's ridge. Ridges stand out, each clump sways and waves
more toward its end, and ends in a pointed tip that curls outward.""")
    S = np.linspace(0, 1, 330)
    Z = ZTOP - ZLEN * S
    side_req, back_req, side_top, back_top = [], [], [], []
    for z in Z:
        # required half-axes: scale up until the ellipse clears the envelope at every angle
        a = max(envelope(p_, z) for p_ in (1.45, 1.6, 1.75)) + 0.1
        b = max(envelope(p_, z) for p_ in (0.0, 0.3)) + 0.1
        need = max(envelope(p_, z) + 0.08 for p_ in np.linspace(0, 1.75, 24))
        for p_ in np.linspace(0, 1.75, 24):
            k_ = (envelope(p_, z) + 0.08) / ell_r(a, b, p_)
            if k_ > 1:
                a, b = a * k_, b * k_
        flare = 0.35 * max(0, (7.4 - z) / 3.3) ** 1.4
        side_req.append(a + flare)
        back_req.append(b + flare * 0.8)
        if z > 12.0:       # at the crown: just inside the hair cap, outside the skull
            side_top.append(0.5 * (cap_r(1.57, z) * 0.985 + head_r(1.57, z)) if z < 12.3 else 0.85)
            back_top.append(0.5 * (cap_r(0.0, z) * 0.985 + head_r(0.0, z)))
        else:
            side_top.append(np.nan)
            back_top.append(np.nan)
    # hair falls from the widest part of the head: below the crown the radius never shrinks going down
    head_side = max(cap_r(1.57, z) for z in np.linspace(11.3, 12.3, 30))
    head_back = max(cap_r(0.0, z) for z in np.linspace(11.3, 12.3, 30))
    side_req = np.maximum.accumulate(np.maximum(np.array(side_req), np.where(Z < 12.0, head_side + 0.02, 0)))
    back_req = np.maximum.accumulate(np.maximum(np.array(back_req), np.where(Z < 12.0, head_back + 0.02, 0)))
    ex_side, m1, _ = fit_profile(np.array(side_req), np.array(side_top))
    ex_back, m2, _ = fit_profile(np.array(back_req), np.array(back_top))
    print(f'  hair clearance margins: side {m1:.3f}, back {m2:.3f}', file=sys.stderr)
    sc.func('crx(s)', ex_side)
    sc.func('cry(s)', ex_back)
    sc.func('cg(k,nc,ph)', 'abs(sin(pi*((k+1)/2*nc+ph)))')

    def curtain(nc, ph, fm, dr, ltip, lift, amp, color, ref):
        G = f"cg(k,{nc},{fmt(ph)})"
        F = f"({fmt(fm)}*k+0.07*s^2*sin(9*s+4*k+{fmt(ph * 5)}))"
        D = f"{fmt(dr)}*min(1,s/0.15)"
        M = (f"(1+({fmt(amp * 0.4)}+{fmt(amp * 1.3)}*s)*{G}^0.6+0.14*s^1.3*(0.5+0.5*sin(12*s+2.4*k+{fmt(ph * 4)}))"
             f"+0.3*max(0,s-0.8)^2/0.04*{G}^2)")
        X = f"(crx(s)+{D})*{M}*sin({F})"
        Y = f"0.03+(cry(s)+{D})*{M}*cos({F})"
        Zs = f"{fmt(ZTOP)}-{fmt(ZLEN)}*s+{fmt(lift)}*s^3-s^6*{fmt(ltip)}*({G}^3-0.3)+0.7*k^2*s^4"
        sc.surface((X, Y, Zs), ('s', 0, 1), ('k', -1, 1), color, ref, ('point', (0, 0, 8)))

    curtain(7, 0.5, 1.58, 0.0, 0.5, 0.2, 0.06, HAIR_DK, 'hairInner')
    curtain(6, 0.0, 1.62, 0.08, 0.6, 0.0, 0.07, HAIR, 'hairMiddle')
    curtain(5, 0.3, 1.45, 0.16, 0.75, 0.9, 0.08, HAIR_LT, 'hairOuter')

    sc.blank()
    sc.note('Sidelocks')
    sc.comment("""Sidelocks: flat, leaf-like locks with two grooves along them (three clumps), following a gentle S
down the front of the shoulder to a single point. sw and st are the half-width and half-thickness.""")
    sc.func('sw(s)', '(1-s)^0.8*(0.6+0.4*min(1,3*s))*(1+0.2*sin(pi*s))')
    sc.func('st(s)', '(1-s)^0.5*(0.7+0.3*min(1,3*s))')
    sc.func('sgr(w)', '0.3+0.7*abs(cos(1.5*pi*cos(w)))^0.7')

    def leaf_lock(pts, W0, T0, al, color, ref, wave):
        cx_, cy_, cz_ = bezier_poly(pts)
        X = f"{horner(cx_, 's')}+{wave[0]}+{fmt(W0)}*sw(s)*cos(w)*cos({al})-{fmt(T0)}*st(s)*sgr(w)*sin(w)*sin({al})"
        Y = f"{horner(cy_, 's')}+{wave[1]}+{fmt(W0)}*sw(s)*cos(w)*sin({al})+{fmt(T0)}*st(s)*sgr(w)*sin(w)*cos({al})"
        Z = horner(cz_, 's')
        sc.surface((X, Y, Z), ('s', 0, 1), ('w', 0, '2*pi'), color, ref, ('tube', 'u'))

    def bezier_left(pts, t):
        """Control points of the part of a Bezier curve from 0 to t (de Casteljau)."""
        out, cur = [], [tuple(p) for p in pts]
        while cur:
            out.append(cur[0])
            cur = [tuple(a_ + (b_ - a_) * t for a_, b_ in zip(p, q)) for p, q in zip(cur, cur[1:])]
        return out

    for sd, tag in ((1, 'L'), (-1, 'R')):
        m = sd
        locks = [
            ([(0.78 * m, -0.55, 12.45), (0.95 * m, -0.6, 11.45), (0.8 * m, -0.98, 10.1), (0.7 * m, -0.86, 9.2), (0.62 * m, -0.66, 8.4), (0.56 * m, -0.7, 8.05)],
             0.17, 0.07, HAIR, 1.4, 0.0),
            ([(0.95 * m, -0.25, 12.35), (1.13 * m, -0.38, 11.2), (1.24 * m, -0.72, 10.1), (1.3 * m, -0.82, 9.0), (1.24 * m, -0.62, 7.7), (1.2 * m, -0.6, 7.2)],
             0.21, 0.075, HAIR_LT, 1.0, 0.4),
        ]
        for k, (pts, W0, T0, col, al0, al1) in enumerate(locks):
            leaf_lock(pts, W0, T0, f"{fmt(al0 * m)}*(1-s)^2+{fmt(al1 * m)}*s", col, f'lock{tag}{k + 1}',
                      (f"{fmt(0.07 * m)}*sin({fmt(8 + 1.5 * k)}*s+{fmt(0.7 * k)})*s", f"0.03*sin({fmt(7 + k)}*s+{fmt(k)})*s"))

    sc.comment("Side hair behind the ears: wide shell strands that flare out a little at the tips.")
    side_strands = [(0.5, 2.3, 1.72, 1.9, 0.3, -0.06), (0.55, 2.4, 2.0, 2.2, 0.3, -0.08)]
    for sd, tag in ((1, 'L'), (-1, 'R')):
        for k, (a0, a1, p0, p1, wd, cu) in enumerate(side_strands):
            p0s, p1s = p0 * sd, p1 * sd
            args_ = f"t,w,{fmt(a0)},{fmt(a1)},{fmt(p0s)},{fmt(p1s)},{fmt(wd)}"
            th = f"sth(t,{fmt(a0)},{fmt(a1)})"
            ph = f"sph({args_})"
            rr = f"srr(t,w,{fmt(cu)})"
            sc.surface((f"hx({th},{ph},{rr})", f"hy({th},{ph},{rr})", f"hz({th},{ph},{rr})"),
                       ('t', 0, 1), ('w', 0, '2*pi'), HAIR if k == 0 else HAIR_DK, f'sideHair{tag}{k + 1}', ('tube', 'u'))

    sc.comment("Braid down the back of the head and onto the falling hair, tied with a small black bow.")
    ry = sc.ns['cry']
    path = []
    for th in np.linspace(0.45, 1.45, 7):
        R = 1.0
        P = (0, 0.03 + 1.1 * R * math.sin(th), 12.0 + 1.12 * R * math.cos(th))
        path.append(P)
    def outer_back(sv):
        G = abs(math.sin(math.pi * (0.5 * 5 + 0.3)))
        amp = 0.08
        M = (1 + (amp * 0.4 + amp * 1.3 * sv) * G ** 0.6 + 0.14 * sv ** 1.3 * (0.5 + 0.5 * math.sin(12 * sv + 1.2))
             + 0.3 * max(0, sv - 0.8) ** 2 / 0.04 * G ** 2)
        return 0.03 + (ry(sv) + 0.16 * min(1, sv / 0.15)) * M
    for z in np.linspace(11.85, 11.05, 5):
        sv = (ZTOP - z) / ZLEN
        path.append((0, outer_back(sv) + 0.035, z))
    for i, P in enumerate(path):
        nxt = path[min(i + 1, len(path) - 1)]
        prv = path[max(i - 1, 0)]
        T = unit(sub(nxt, prv))
        Nr = unit(cross((1, 0, 0), T))
        if Nr[1] < 0:
            Nr = mul(Nr, -1)
        sgn = 1 if i % 2 == 0 else -1
        ang = 0.75 * sgn
        a_ax = add(mul(T, math.cos(ang)), mul((1, 0, 0), math.sin(ang)))
        b_ax = cross(Nr, a_ax)
        size = 1 - 0.035 * i
        C = add(add(P, mul((1, 0, 0), 0.06 * sgn * size)), mul(Nr, 0.035))
        ellipsoid(C, (0.17 * size, 0.09 * size, 0.075 * size), HAIR_LT if sgn > 0 else HAIR, f'braid{i + 1}', fr=(a_ax, b_ax, Nr))
    end = path[-1]
    bow(add(end, (0, 0.1, -0.12)), ((1, 0, 0), (0, 0, 1), (0, 1, 0)), (0.2, 0.09, 0.045), 'braidBow', loops=((1, -0.2), (-1, -0.2)))

