# Run inside generate.py after outfit.py: all of Claude Chan's hair.
import numpy as np

ZHC = ZE + 0.42                          # height of the centre of the cranium
HDX, HDY, HDZ = 0.725, 0.815, 0.825      # the dome of the hair around the cranium
HY0 = 0.14
ZBOT = 5.3                               # where the longest locks end
TB = 0.09                                # how far down a lock eases from turning with the head to hanging straight
T0 = 1 / (1 + (ZHC - ZBOT) / (HDZ * math.pi / 2))   # part of a lock's length that lies on the dome
VF = HDZ * math.pi / 2 / T0              # how fast z falls with t below the dome

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


def dome(th, ph, k=1.0):
    """Point on the hair dome: th from the crown, ph from the front (+ toward her left)."""
    return (HDX * k * math.sin(th) * math.sin(ph), HY0 - HDY * k * math.sin(th) * math.cos(ph), ZHC + HDZ * k * math.cos(th))


def dome_normal(P):
    return unit((P[0] / HDX ** 2, (P[1] - HY0) / HDY ** 2, (P[2] - ZHC) / HDZ ** 2))


def interp_bezier(P):
    """Control points of the Bezier curve that passes through the points P at t = i/n."""
    n = len(P) - 1
    M = [[math.comb(n, k) * (i / n) ** k * (1 - i / n) ** (n - k) for k in range(n + 1)] for i in range(n + 1)]
    return [tuple(r) for r in np.linalg.solve(np.array(M), np.array(P, dtype=float))]


# ---------- how far out the falling hair must hang to clear the body ----------
US = np.linspace(0, 1 - T0, 300)
ZS = ZHC - VF * US
PSIS = np.linspace(0, 2.4, 40)


def clear_factor(rx, ry, z, margin):
    k = 1.0
    for p_ in PSIS:
        for _ in range(80):
            x_, y_ = k * rx * math.sin(p_), HY0 + k * ry * math.cos(p_)
            if math.hypot(x_, y_ - 0.03) >= envelope(math.atan2(x_, y_ - 0.03), z) + margin:
                break
            k *= 1.01
    return k


side_req, back_req = [], []
for z in ZS:
    rx = max(HDX, max(envelope(p_, z) for p_ in (1.45, 1.6, 1.75)) + 0.1)
    ry = max(HDY, max(envelope(p_, z) for p_ in (0.0, 0.3)) + 0.0)
    k = clear_factor(rx, ry, z, 0.08)
    flare = 0.5 * max(0, (8.0 - z) / 2.7) ** 1.3
    side_req.append(rx * k + flare)
    back_req.append(ry * k + flare * 0.8)
side_req = np.maximum.accumulate(np.array(side_req))
back_req = np.maximum.accumulate(np.array(back_req))
KNOTS = [0, 0.03, 0.06, 0.09, 0.115, 0.14, 0.165, 0.19, 0.215, 0.24, 0.27, 0.31, 0.36, 0.43, 0.52, 0.62, 0.72]


def fit_profile(req, base):
    """base + sum c_i max(0, u - k_i)^2: leaves the dome smoothly and stays outside req."""
    A = np.column_stack([np.maximum(0, US - k) ** 2 for k in KNOTS])
    ramp = np.minimum(1, US / 0.05)
    target = req - base + 0.05 * ramp
    for _ in range(80):
        coef, *_ = np.linalg.lstsq(A, target, rcond=None)
        fit = A @ coef
        deficit = req - base + 0.025 * ramp - fit
        if deficit.max() <= 0:
            break
        target = target + np.maximum(deficit, 0) * 1.5
    margin = float(np.min((fit - (req - base))[US > 0.05]))
    return ''.join(f"+{fmt(c)}*max(0,t-{fmt(T0 + k)})^2" for c, k in zip(coef, KNOTS)), margin


def run_hair():
    sc.blank()
    sc.note('Hair')
    sc.comment(f"""Her hair flows from the crown. A lock is described by t, from the crown (0) down to the end of
the longest hair (1): up to t = {fmt(T0)} it lies on a dome around the head (ha is the angle from the
crown), below that it falls. hzz(t) is the height, hrx(t) and hry(t) are the half-axes of the ellipse the
hair lies on at that height: they follow the dome, then keep clear of the shoulders, capelet, arms, book
and skirt and flare out toward the ends (fitted by the generator). hu(t) is 0 on the dome and grows to 1
down the fall. hdw keeps a lock's width steady as the hair spreads.""")
    gx, m1 = fit_profile(side_req, HDX)
    gy, m2 = fit_profile(back_req, HDY)
    print(f'  hair clearance margins: side {m1:.3f}, back {m2:.3f}', file=sys.stderr)
    sc.func('ha(t)', f"1.5708*min(1,t/{fmt(T0)})")
    sc.func('hu(t)', f"max(0,t-{fmt(T0)})/{fmt(1 - T0)}")
    sc.func('hzz(t)', f"{fmt(ZHC)}+{fmt(HDZ)}*cos(ha(t))-{fmt(VF)}*max(0,t-{fmt(T0)})")
    sc.func('hrx(t)', f"{fmt(HDX)}*sin(ha(t)){gx}")
    sc.func('hry(t)', f"{fmt(HDY)}*sin(ha(t)){gy}")
    sc.func('hdw(t)', 'min(1,1.54/(hrx(t)+hry(t)))')
    sc.comment(f"""Her head is tilted and turned (see the generator); a lock turns with it where it lies on the head and
hangs straight below. hb(t) is 1 on the head and eases to 0 by t = {fmt(T0 + TB)}; hs and hk are the sine and
one minus the cosine of the head's turn times hb.""")
    sc.func('hb(t)', f"1-min(1,max(0,(t-{fmt(T0)})/{fmt(TB)}))^2*(3-2*min(1,max(0,(t-{fmt(T0)})/{fmt(TB)})))")
    sc.func('hs(t)', f"sin({fmt(HEAD_TURN['angle'])}*hb(t))")
    sc.func('hk(t)', f"1-cos({fmt(HEAD_TURN['angle'])}*hb(t))")
    sc.comment("""A lock is a tube around its own flow line. lpc is the angle of that line around the head: a starting
angle pb+p0 (0 = straight back, + toward her left) whose part p0 closes up by sg as the hair spreads (sg = 1
falls straight down, sg = 0 fans out over the shoulders; pb is 0 for the back and pi for the front), a drift dr, and a wave of size am that grows down the
lock. lrc is how far the line stands off the hair surface: its layer la, and the wave again a quarter turn
later, so the lock snakes in and out as well as side to side. Across the lock (w runs around it) lwd is
the half-width and lth the thickness, a crescent lcs with three ridges that is flat underneath. ltp tapers
the lock toward its end te, and lq runs 0..1 over the last stretch, where the tip turns through three
quarters of a circle: sideways like a hook, or outward like a scroll.""")
    sc.func('ltp(t,te)', 'min(1,max(0,te-t)/0.13)^0.6')
    sc.func('lq(t,te)', 'max(0,1-max(0,te-t)/0.08)')
    sc.func('lcs(w)', '(0.65*sin(w)+0.35*abs(sin(w)))*(0.78+0.22*cos(2*pi*cos(w)))')
    sc.func('lpc(t,pb,p0,sg,dr,am,kk,ph)', 'pb+p0*(1-sg*(1-hdw(t)))+dr*hu(t)+am*hu(t)^1.5*sin(kk*hu(t)+ph)')
    sc.func('lrc(t,la,am,kk,ph)', 'la*min(1,t/0.04)+0.6*am*hu(t)^1.5*cos(kk*hu(t)+ph)')
    sc.func('lwd(t,te,hw)', 'hw*ltp(t,te)*hdw(t)')
    sc.func('lth(t,w,te,th)', 'th*ltp(t,te)*lcs(w)*min(1,t/0.04)')

    def lock(ref, p0, sg, dr, hw, te, la, th, am, kk, ph, col, curl=('side', 1, 0.12), start=0.012, pb=0.0):
        """One lock: main part, then its curled tip as a second surface (so the curl gets a fine mesh)."""
        PC = f"lpc(t,{fmt(pb)},{fmt(p0 - pb)},{fmt(sg)},{fmt(dr)},{fmt(am)},{fmt(kk)},{fmt(ph)})"
        RC = f"lrc(t,{fmt(la)},{fmt(am)},{fmt(kk)},{fmt(ph)})"
        WD = f"lwd(t,{fmt(te)},{fmt(hw)})"
        TH = f"lth(t,w,{fmt(te)},{fmt(th)})"
        end = te if curl is None else te - 0.08
        with sc.turned(**HEAD_TURN, blend=('hs(t)', 'hk(t)')):
            sc.surface((f"(hrx(t)+({RC}+{TH})*sin(ha(t)))*sin({PC}+{WD}*cos(w))", f"{fmt(HY0)}+(hry(t)+({RC}+{TH})*sin(ha(t)))*cos({PC}+{WD}*cos(w))",
                        f"hzz(t)+({RC}+{TH})*cos(ha(t))"), ('t', start, end), ('w', 0, '2*pi'), col, ref, ('tube', 'u'))
        if curl is None:
            return
        AL = f"(4.712*lq(t,{fmt(te)}))"
        ZC = f"hzz(t)+{fmt(VF * 0.08)}*lq(t,{fmt(te)})"
        if curl[0] == 'side':
            _, sgn, rc = curl
            PSI = f"{PC}+{fmt(sgn * rc / 1.6)}*(1-cos{AL})+{WD}*cos(w)*cos{AL}"
            xyz = (f"(hrx(t)+{RC}+{TH})*sin({PSI})", f"{fmt(HY0)}+(hry(t)+{RC}+{TH})*cos({PSI})",
                   f"{ZC}-{fmt(rc)}*sin{AL}+{fmt(sgn * 0.77 * hw)}*ltp(t,{fmt(te)})*cos(w)*sin{AL}")
        else:
            _, rc = curl
            RAD = f"{RC}+{fmt(rc)}*(1-cos{AL})+{TH}*cos{AL}"
            xyz = (f"(hrx(t)+{RAD})*sin({PC}+{WD}*cos(w))", f"{fmt(HY0)}+(hry(t)+{RAD})*cos({PC}+{WD}*cos(w))",
                   f"{ZC}-{fmt(rc)}*sin{AL}+{TH}*sin{AL}")
        sc.surface(xyz, ('t', te - 0.08, te), ('w', 0, '2*pi'), col, ref + 'Curl', ('tube', 'u'))

    sc.comment("A dark cap and an inner sheet under the locks, so no gap shows skin.")
    with sc.turned(**HEAD_TURN):
        sc.surface((f"{fmt(HDX * 0.98)}*sin(u)*cos(v)", f"{fmt(HY0)}+{fmt(HDY * 0.98)}*sin(u)*sin(v)", f"{fmt(ZHC)}+{fmt(HDZ * 0.98)}*cos(u)"),
               ('u', 0, 1.75), ('v', 0, '2*pi'), HAIR_DK, 'hairCap', ('point', (0, HY0, ZHC)))
    with sc.turned(**HEAD_TURN, blend=('hs(t)', 'hk(t)')):
        sc.surface(("(hrx(t)-0.03)*sin(k*(1-0.64*(1-hdw(t))))", f"{fmt(HY0)}+(hry(t)-0.03)*cos(k*(1-0.64*(1-hdw(t))))", "hzz(t)"),
                   ('t', T0 * 0.9, 0.7), ('k', -1.2, 1.2), HAIR_DK, 'hairUnder', ('point', (0, 0, 9)))

    rng = np.random.default_rng(11)
    R = rng.random
    def cdir(rc):
        return ('out', rc) if R() < 0.3 else ('side', 1 if R() < 0.5 else -1, rc)
    sc.comment("""Long locks. Down the back they fall straight in three layers (wide ones underneath, the main
layer, thin lighter strands on top); at the sides they fan out over the shoulders and arms.""")
    for i, p0 in enumerate((-1.0, -0.68, -0.34, 0.0, 0.34, 0.68, 1.0)):
        lock(f'backU{i + 1}', p0, 0.66, 0.05 * (R() - 0.5), 0.28, 0.86 + 0.1 * R(), 0.0, 0.05, 0.07 + 0.04 * R(), 8 + 3 * R(), 6.28 * R(), HAIR_DK, curl=cdir(0.11))
    for i, p0 in enumerate((-0.85, -0.51, -0.17, 0.17, 0.51, 0.85)):
        lock(f'back{i + 1}', p0, 0.68, 0.06 * (R() - 0.5), 0.24, 0.9 + 0.1 * R(), 0.04, 0.055, 0.09 + 0.05 * R(), 9 + 4 * R(), 6.28 * R(), HAIR, curl=cdir(0.13))
    for i, p0 in enumerate((-0.7, -0.3, 0.1, 0.45, 0.8)):
        lock(f'backT{i + 1}', p0, 0.68, 0.12 * (R() - 0.5), 0.1, 0.8 + 0.18 * R(), 0.085, 0.04, 0.12 + 0.06 * R(), 10 + 5 * R(), 6.28 * R(), HAIR_LT, curl=cdir(0.12))
    side = [  # p0 (her right; mirrored for her left), layer, half-width, colour
        (1.3, 'U', 0.3, HAIR_DK), (1.62, 'U', 0.28, HAIR_DK), (1.18, 'M', 0.24, HAIR), (1.5, 'M', 0.24, HAIR), (1.8, 'M', 0.2, HAIR),
        (1.35, 'T', 0.1, HAIR_LT), (1.68, 'T', 0.1, HAIR_LT)]
    for sd, tag in ((-1, 'R'), (1, 'L')):
        for i, (p0, lay, hw_, col) in enumerate(side):
            if sd > 0 and p0 > 1.25:
                # her left ear shows: the hair above it is swept back under the ornament
                lock(f'tuck{i + 1}', p0, 0.0, -1.2, hw_, T0 + 0.05, {'U': 0.0, 'M': 0.035, 'T': 0.07}[lay], 0.05, 0.0, 1, 0, col, curl=None)
                continue
            la_, th_ = {'U': (0.0, 0.05), 'M': (0.04, 0.055), 'T': (0.085, 0.04)}[lay]
            lock(f'side{tag}{i + 1}', sd * p0, 0.25, -sd * (0.1 + 0.1 * R()), hw_, 0.74 + 0.16 * R(), la_, th_, 0.1 + 0.06 * R(), 9 + 4 * R(), 6.28 * R(), col, curl=cdir(0.13))
    sc.comment("Locks in front of the ears that fall over the chest.")
    for ref, p0, hw_, te, col in (('frontR1', -1.93, 0.13, 0.69, HAIR), ('frontR2', -2.08, 0.08, 0.6, HAIR_LT), ('frontR3', -1.84, 0.07, 0.74, HAIR_DK),
                                  ('frontL1', 1.9, 0.12, 0.67, HAIR), ('frontL2', 2.05, 0.08, 0.58, HAIR_LT)):
        sd = 1 if p0 > 0 else -1
        lock(ref, p0, 1.25, 0.04 * (R() - 0.5), hw_, te, 0.05, 0.04, 0.05 + 0.03 * R(), 8 + 3 * R(), 6.28 * R(), col, curl=('side', sd if R() < 0.7 else -sd, 0.09), pb=sd * math.pi)

    # ---------- bangs and the locks that frame the face ----------
    sc.blank()
    sc.note('Bangs')
    sc.comment("""Bangs and the locks framing the face are blades: a Bezier centre line (written as a polynomial in t)
that leaves the crown, follows the dome to the hairline and hangs to a point just in front of the face.
Across it (w) the blade has the same crescent section as the long locks; its width and thickness
vectors are polynomials too.""")
    fyf = sc.ns['fy']

    def blade(ref, pts, nrms, wid, thk, color):
        n = len(pts) - 1
        sides = []
        for i in range(n + 1):
            T = unit(sub(pts[min(i + 1, n)], pts[max(i - 1, 0)]))
            s_ = cross(T, nrms[i])
            sides.append(unit(s_))
        C = bezier_poly(interp_bezier(pts))
        U = bezier_poly(interp_bezier([mul(s_, w_) for s_, w_ in zip(sides, wid)]))
        Vv = bezier_poly(interp_bezier([mul(n_, t_) for n_, t_ in zip(nrms, thk)]))
        xyz = tuple(f"{horner(C[i], 't')}+cos(w)*({horner(U[i], 't')})+lcs(w)*({horner(Vv[i], 't')})" for i in range(3))
        with sc.turned(**HEAD_TURN):
            sc.surface(xyz, ('t', 0, 1), ('w', 0, '2*pi'), color, ref, ('tube', 'u'))

    def bang(ref, phis, tip, w0, color, ths=(0.14, 0.75, 1.32), fwd_=0.05, off=0.04, tk=1.0):
        p0, p1, p2 = dome(ths[0], phis[0], 1.005), dome(ths[1], phis[1], 1.035), dome(ths[2], phis[2], 1.045)
        xt, zt = tip
        p4 = (xt, fyf(xt, zt) - off, zt)
        x3, z3 = p2[0] + (xt - p2[0]) * 0.55, p2[2] + (zt - p2[2]) * 0.5
        y3 = min(0.5 * (p2[1] + p4[1]) - fwd_, fyf(x3, z3) - 0.075)
        p3 = (x3, y3, z3)
        n3 = unit((0.4 * x3, -1, 0.15))
        n4 = unit((0.4 * xt, -1, 0.0))
        blade(ref, [p0, p1, p2, p3, p4], [dome_normal(p0), dome_normal(p1), dome_normal(p2), n3, n4],
              [0.18 * w0, 0.95 * w0, w0, 0.6 * w0, 0.0], [0.008 * tk, 0.04 * tk, 0.045 * tk, 0.03 * tk, 0.0], color)

    bang('bang1', (0.3, 0.2, 0.1), (0.03, ZE - 0.05), 0.16, HAIR)
    bang('bang2', (0.05, -0.1, -0.2), (-0.14, ZE + 0.03), 0.15, HAIR_LT)
    bang('bang3', (0.5, 0.4, 0.3), (0.11, ZE + 0.11), 0.13, HAIR_LT)
    bang('bang4', (-0.15, -0.4, -0.55), (-0.28, ZE + 0.1), 0.17, HAIR)
    bang('bang5', (-0.4, -0.72, -0.92), (-0.47, ZE + 0.06), 0.18, HAIR_LT)
    bang('bang6', (-0.7, -1.05, -1.27), (-0.6, ZE - 0.02), 0.18, HAIR)
    bang('bang7', (0.72, 0.97, 1.12), (0.57, ZE + 0.09), 0.17, HAIR)
    bang('bang8', (1.0, 1.26, 1.42), (0.62, ZE + 0.13), 0.16, HAIR_LT)
    bang('bang9', (0.45, 0.6, 0.7), (0.37, ZE + 0.3), 0.13, HAIR)
    bang('bang10', (0.62, 0.85, 0.97), (0.5, ZE + 0.2), 0.14, HAIR_LT)
    for sd, tag in ((1, 'L'), (-1, 'R')):
        pts = [dome(0.3, 1.5 * sd, 1.005), dome(1.15, 1.62 * sd, 1.04), (0.71 * sd, -0.07, ZE + 0.06), (0.69 * sd, -0.13, ZE - 0.2)]
        xt, zt = 0.6 * sd, ZE - 0.38
        pts.append((xt, fyf(xt, zt) - 0.045, zt))
        nr = [dome_normal(pts[0]), dome_normal(pts[1]), unit((sd, -0.25, 0)), unit((sd, -0.3, 0)), unit((sd, -0.5, 0))]
        blade(f'frame{tag}', pts, nr, [0.04, 0.15, 0.14, 0.1, 0.0], [0.008, 0.04, 0.04, 0.03, 0.0], HAIR)

    sc.comment("""Thin wisps from the bangs that cross the eyes, and locks that fall from the temples in front of the
cheeks to below the jaw, so the face shows as a soft narrow oval between them, as on the sheet.""")
    bang('wisp1', (0.22, 0.02, -0.14), (-0.25, ZE - 0.07), 0.035, HAIR_LT, off=0.042, tk=0.45)
    bang('wisp2', (0.42, 0.36, 0.3), (0.27, ZE - 0.03), 0.03, HAIR_LT, off=0.042, tk=0.45)
    bang('wisp3', (-0.45, -0.78, -0.98), (-0.5, ZE - 0.1), 0.032, HAIR, off=0.042, tk=0.45)

    def face_normal(x, z, e=1e-4):
        return unit(((fyf(x + e, z) - fyf(x - e, z)) / (2 * e), -1, (fyf(x, z + e) - fyf(x, z - e)) / (2 * e)))

    def cheek_lock(ref, sd, dx, x2, x3, x4, z4, w0, color, gap=0.045):
        p0 = dome(0.6, (1.12 + dx) * sd, 1.01)
        p1 = dome(1.22, (1.18 + 0.5 * dx) * sd, 1.045)
        z2, z3 = ZE + 0.02, ZE - 0.28
        p2 = (x2 * sd, fyf(x2 * sd, z2) - gap, z2)
        p3 = (x3 * sd, fyf(x3 * sd, z3) - gap, z3)
        p4 = (x4 * sd, -0.3, z4)
        # keep clear of the face: wherever the centre line is over the face it stays gap/2 in front of it;
        # if it does not, bring the lower part of the lock forward
        for _ in range(12):
            pts = [p0, p1, p2, p3, p4]
            Cb = interp_bezier(pts)
            worst = min([fyf(P[0], P[2]) - P[1] for P in (bezier_eval(Cb, u) for u in np.linspace(0, 1, 300))
                         if HC + 0.01 < P[2] < ZE + 0.6 and abs(P[0]) < sc.ns['fwd'](P[2])] or [1])
            if worst > gap * 0.5:
                break
            p3, p4 = sub(p3, (0, 0.006, 0)), sub(p4, (0, 0.012, 0))
        assert worst > gap * 0.5, (ref, worst)
        nr = [dome_normal(p0), dome_normal(p1), face_normal(p2[0], z2), face_normal(p3[0], z3), unit((0.6 * sd, -1, 0))]
        blade(ref, pts, nr, [0.035, 0.9 * w0, w0, 0.85 * w0, 0.0], [0.008, 0.03, 0.028, 0.024, 0.0], color)

    for sd, tag in ((1, 'L'), (-1, 'R')):
        # on the sheet the hair covers the outer part of each cheek, leaving about +-0.42 of the face showing
        cheek_lock(f'cheekLock{tag}1', sd, 0.0, 0.6, 0.47, 0.36, ZE - 0.82, 0.08, HAIR)
        cheek_lock(f'cheekLock{tag}2', sd, -0.07, 0.575, 0.42, 0.3, ZE - 0.68, 0.05, HAIR_LT)
        cheek_lock(f'cheekLock{tag}3', sd, 0.06, 0.615, 0.53, 0.44, ZE - 0.96, 0.065, HAIR_DK)

    # ---------- the braid crown ----------
    sc.blank()
    sc.note('Braid')
    sc.comment("""A braided crown around the back of the head. The braid follows an oval ring on the dome: bdx, bdy, bdz
give the direction from the head's centre to the ring at angle a, with ro scaling the ring (1 = its
centre line). Its three strands weave as sin(tau) across the ring and sin(2 tau) in height, tau a third
of a turn apart: the classic three-strand braid.""")
    THC, TH_, TV_ = 68 * math.pi / 180, math.tan(66 * math.pi / 180), math.tan(32 * math.pi / 180)
    sc.func('bdx(a,ro)', f"ro*{fmt(TH_)}*cos(a)")
    sc.func('bdy(a,ro)', f"{fmt(math.sin(THC))}+ro*{fmt(TV_ * math.cos(THC))}*sin(a)")
    sc.func('bdz(a,ro)', f"{fmt(math.cos(THC))}-ro*{fmt(TV_ * math.sin(THC))}*sin(a)")
    sc.func('bdn(a,ro)', 'sqrt(bdx(a,ro)^2+bdy(a,ro)^2+bdz(a,ro)^2)')
    NB = 13
    with sc.turned(**HEAD_TURN):
        for j in range(3):
            tau = f"({NB}*a+{fmt(2 * math.pi * j / 3)})"
            RO = f"(1+0.1*sin{tau}+0.085*cos(v))"
            RR = f"(1.13+0.04*sin(2*{tau})+0.07*sin(v))"
            for q in range(4):
                sc.surface((f"{fmt(HDX)}*{RR}*bdx(a,{RO})/bdn(a,{RO})", f"{fmt(HY0)}+{fmt(HDY)}*{RR}*bdy(a,{RO})/bdn(a,{RO})", f"{fmt(ZHC)}+{fmt(HDZ)}*{RR}*bdz(a,{RO})/bdn(a,{RO})"),
                           ('a', q * math.pi / 2, (q + 1) * math.pi / 2), ('v', 0, '2*pi'), (HAIR, HAIR_LT, HAIR_DK)[j], f'braid{j + 1}{"abcd"[q]}', ('tube', 'u'))
    return THC, TH_, TV_


if want('hair') or want('ornament'):
    if want('hair'):
        THC, TH_, TV_ = run_hair()
    else:
        THC, TH_, TV_ = 68 * math.pi / 180, math.tan(66 * math.pi / 180), math.tan(32 * math.pi / 180)
    # the ornament sits on the side of the head, above and just behind her left ear
    P_ = dome(1.03, 1.5, 1.1)
    ORN_N = unit(add(mul(dome_normal(P_), 0.9), (0.1, -0.4, 0)))
    ORN_P = add(P_, mul(ORN_N, 0.1))
