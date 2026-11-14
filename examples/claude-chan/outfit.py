# Run inside generate.py (shares its names): body, outfit and props.
import numpy as np

# ---------------- extra helpers ----------------
sc.blank()
sc.comment("Rounded box (superquadric): exponent e near 0 is boxy, 1 is an ellipsoid.")
sc.func('sqc(t,pw)', 'sign(cos(t))*abs(cos(t))^pw')
sc.func('sqs(t,pw)', 'sign(sin(t))*abs(sin(t))^pw')
sc.comment("Puffy capsule profile: like cr, plus a bulge bu in the middle.")
sc.func('cpf(u,r0,r1,bu)', '(r0+(r1-r0)*cf(u)+bu*sin(u)^2)*sqrt(sqrt(1-cos(u)^4))')


def rbox(C, half, fr, color, ref, e=0.25, e2=None):
    e2 = e if e2 is None else e2
    L = (f"{fmt(half[0])}*sqs(u,{fmt(e)})*sqc(v,{fmt(e2)})", f"{fmt(half[1])}*sqs(u,{fmt(e)})*sqs(v,{fmt(e2)})", f"{fmt(half[2])}*sqc(u,{fmt(e)})")
    sc.surface(place(L, C, fr), ('u', 0, 'pi'), ('v', 0, '2*pi'), color, ref, 'closed')


def puff(A, B, r0, r1, bu, color, ref, gather=0.0, ng=9, up=(0, 0, 1)):
    d = sub(B, A)
    fr = frame(d, up)
    R = f"cpf(u,{fmt(r0)},{fmt(r1)},{fmt(bu)})*(1+{fmt(gather)}*sin({ng}*w))"
    L = (f"{R}*cos(w)", f"{R}*sin(w)", f"{fmt(norm(d))}*cf(u)")
    sc.surface(place(L, A, fr), ('u', 0, 'pi'), ('w', 0, '2*pi'), color, ref, ('tube', 'u'))
    return fr


def torus(C, fr, R, r, color, ref, arc=(0, '2*pi')):
    L = (f"({fmt(R)}+{fmt(r)}*cos(v))*cos(u)", f"({fmt(R)}+{fmt(r)}*cos(v))*sin(u)", f"{fmt(r)}*sin(v)")
    sc.surface(place(L, C, fr), ('u', arc[0], arc[1]), ('v', 0, '2*pi'), color, ref, ('tube', 'u'))


def bead_tube(pts_fn_xyz, n_beads, r, color, ref, cross_a=(0, 1, 0), cross_b=(0, 0, 1)):
    """Beaded tube (a chain) along a centre line given as three Arch expressions in t (0..1)."""
    X, Y, Z = pts_fn_xyz
    R = f"{fmt(r)}*(0.45+0.55*abs(cos({n_beads}*pi*t)))"
    xyz = tuple(f"{[X, Y, Z][i]}+{R}*(cos(v)*{fmt(cross_a[i])}+sin(v)*{fmt(cross_b[i])})" for i in range(3))
    sc.surface(xyz, ('t', 0, 1), ('v', 0, '2*pi'), color, ref, ('tube', 'u'))


def flat_flower(C, n_dir, R, ref, color=ORANGE, center=GOLD, n=14, up=(0, 0, 1)):
    flower_funcs()
    fr = frame(n_dir, up)
    L = (f"fa(r,w,{n},{fmt(R)},0)", f"fb(r,w,{n},{fmt(R)},0)", f"fc(r,w,{n},{fmt(R)},0.02,0)")
    sc.surface(place(L, C, fr), ('r', 0, 1), ('w', 0, '2*pi'), color, ref, ('dir', fr[2]))
    if center:
        L = (f"{fmt(0.25 * R)}*r*cos(w)", f"{fmt(0.25 * R)}*r*sin(w)", f"{fmt(0.06 * R)}*(1-r^2)+{fmt(0.02 * R)}")
        sc.surface(place(L, C, fr), ('r', 0, 1), ('w', 0, '2*pi'), center, ref + 'Mid', ('dir', fr[2]))


SK_TOP, SK_HEM = 8.66, 1.61      # the pleated skirt, from the waist (under the corset) to its hem; the boots show below
SK_L = SK_TOP - SK_HEM
SA_EXPR = '0.43+0.079*ln(1+exp((s-0.057)/0.02))-6.5*max(0,s-0.62)^2'
DK_EXPR = '0.66+0.125*s-(0.09+0.125*s)*cos(t)'


def SA(s):
    """Half-width of the skirt, s from the waist (0) to the hem (1): narrow inside the corset, then from the
    corset's edge the straight A-line of the sheet's front view (0.56 out per unit down, joined smoothly),
    rounding off at the hem."""
    return 0.43 + 0.079 * math.log(1 + math.exp((s - 0.057) / 0.02)) - 6.5 * max(0, s - 0.62) ** 2


def DK(s, th):
    """Depth of the skirt over its half-width at angle th from the front: the sheet's side view has the front
    hanging nearly flat (0.57) and the back full (0.75 at the waist to 1 at the hem)."""
    return 0.66 + 0.125 * s - (0.09 + 0.125 * s) * math.cos(th)


def sk_s(h):
    return (SK_TOP - h) / SK_L


# =====================================================================
#  TORSO, COLLAR, JABOT, ASCOT
# =====================================================================
TORSO = [(7.4, 0.58, 0.41), (8.0, 0.42, 0.32), (8.5, 0.38, 0.3), (9.1, 0.6, 0.44), (9.75, 0.64, 0.44),
         (10.3, 0.92, 0.4), (10.52, 0.4, 0.25), (10.62, 0.18, 0.18)]
_tz = [bezier_eval(TORSO, s) for s in np.linspace(0, 1, 400)]


def torso_ab(z):
    zs = [p[0] for p in _tz]
    i = int(np.argmin([abs(zz - z) for zz in zs]))
    return _tz[i][1], _tz[i][2]


def bust(z):
    return 0.085 * math.exp(-((z - 9.5) / 0.32) ** 2)


def chest_y(x, z):
    a, b = torso_ab(z)
    return -(b * math.sqrt(max(0.0, 1 - (x / a) ** 2)) + bust(z))


if want('body'):
    sc.blank()
    sc.note('Blouse: body, high ruffled collar and jabot')
    tz, ta, tb = bezier_poly(TORSO)
    Z = horner(tz, 's')
    sc.surface((f"({horner(ta, 's')})*cos(w)", f"({horner(tb, 's')})*sin(w)-0.085*exp(-(({Z}-9.5)/0.32)^2)*max(0,-sin(w))^2", Z),
               ('s', 0, 1), ('w', 0, '2*pi'), CREAM, 'blouse', ('tube', 'u'))
    sc.comment("High collar with a ruffle on top.")
    sc.surface(("(0.235+0.012*s)*cos(w)", "0.02+(0.235+0.012*s)*sin(w)", "10.42+0.46*s"), ('s', 0, 1), ('w', 0, '2*pi'), CREAM, 'collar', ('tube', 'u'))
    sc.surface(("(0.25+0.12*s+0.03*s*sin(16*w))*cos(w)", "0.02+(0.25+0.12*s+0.03*s*sin(16*w))*sin(w)", "10.86+0.11*s+0.035*s*cos(16*w)"),
               ('s', 0, 1), ('w', 0, '2*pi'), CREAM, 'collarRuffle', ('point', (0, 0.02, 10.5)))
    sc.comment("Jabot: four ruffled tiers cascading down the front.")
    for i, zt in enumerate([10.4, 10.12, 9.85, 9.58]):
        size = 1 - 0.07 * i
        yf = chest_y(0, zt - 0.15) - 0.03
        X = f"(0.04+{fmt(0.36 * size)}*s)*(1+0.12*s*sin(11*p))*sin(p)"
        Y = f"{fmt(yf)}-0.03*s-(0.04+{fmt(0.36 * size)}*s)*cos(p)*0.4-0.045*s*cos(11*p)"
        Zs = f"{fmt(zt)}-{fmt(0.32 * size)}*s*(0.45+0.55*cos(p))"
        sc.surface((X, Y, Zs), ('s', 0, 1), ('p', -1.3, 1.3), CREAM if i % 2 == 0 else '#f7f0e4', f'jabot{i + 1}', ('dir', (0, -1, 0.2)))

    sc.blank()
    sc.note('Black ascot bow with a chrysanthemum brooch')
    K = (0, -0.33, 10.6)
    fr = ((1, 0, 0), (0, 0, 1), (0, -1, 0))
    bow(K, fr, (0.3, 0.13, 0.06), 'ascot', loops=((1, -0.18), (-1, -0.18)))
    flower(add(K, (0, -0.075, 0.0)), unit((0, -1, 0.15)), 0.12, 'brooch')
    yl = chest_y(0.12, 9.6) - 0.2
    ribbon([add(K, (0.04, -0.02, -0.06)), (0.13, chest_y(0.12, 10.0) - 0.2, 10.0), (0.16, yl, 9.3)], 0.07, BLACK, 'ascotTailL', unit((0.1, -1, 0.25)), rim=GOLD)
    ribbon([add(K, (-0.04, -0.02, -0.06)), (-0.1, chest_y(0.1, 10.05) - 0.2, 10.05), (-0.11, yl + 0.01, 9.4)], 0.07, BLACK, 'ascotTailR', unit((-0.05, -1, 0.25)), rim=GOLD)
    flat_flower((0.16, yl - 0.012, 9.5), unit((0.05, -1, 0.25)), 0.045, 'ascotTailFlowerL', n=10, center=None)
    flat_flower((-0.11, yl - 0.002, 9.6), unit((0, -1, 0.25)), 0.045, 'ascotTailFlowerR', n=10, center=None)

# =====================================================================
#  CAPELET
# =====================================================================
CAPE = [(10.7, 0.3, 0.28), (10.52, 0.6, 0.43), (10.3, 1.18, 0.64), (9.8, 1.48, 0.82), (9.3, 1.62, 0.92), (9.12, 1.66, 0.94)]
CAPE_DROP, CAPE_FLARE = 0.95, 0.24     # the sheet's capelet is longer at the back (hem near the elbows) and stands out there


def cape_drop(th):
    """How far the capelet's hem hangs lower at angle th from the front (0 at the sides, CAPE_DROP at the back)."""
    return CAPE_DROP * max(0.0, -math.cos(th)) ** 1.5
if want('cape'):
    sc.blank()
    sc.note('Capelet: cream with gold trim, beige lining and chrysanthemum emblems')
    cz_, ca_, cb_ = bezier_poly(CAPE)
    Zc, Ac, Bc = horner(cz_, 's'), horner(ca_, 's'), horner(cb_, 's')
    sc.comment("""Capelet: s from the collar to the hem; q around from her left front edge, over the back, to her right
front edge (cth is the angle from the front). As on the sheet's side and back views it hangs lower at the
back (cdr) and stands out there (the flare in y).""")
    sc.func('cth(s,q)', '(0.3+0.32*s)+(2*pi-2*(0.3+0.32*s))*q')
    sc.func('cdr(s,q)', f"{fmt(CAPE_DROP)}*s^2*max(0,-cos(cth(s,q)))^1.5")
    def cape(scale, qr, sr, color, ref, dz=0.0):
        X = f"{fmt(scale)}*({Ac})*sin(cth(s,q))"
        Y = f"0.03-{fmt(scale)}*({Bc}+{fmt(CAPE_FLARE)}*s^2*max(0,-cos(cth(s,q))))*cos(cth(s,q))"
        Z = f"{Zc}-cdr(s,q)+{fmt(dz)}"
        sc.surface((X, Y, Z), ('s', sr[0], sr[1]), ('q', qr[0], qr[1]), color, ref, ('point', (0, 0.03, 10.4)))
    cape(1.0, (0, 1), (0, 1), CREAM, 'cape')
    cape(0.985, (0, 1), (0.02, 1), CREAM_DK, 'capeLining', dz=0.004)
    cape(1.01, (0, 1), (0.94, 1), GOLD, 'capeHemTrim', dz=-0.004)
    cape(1.01, (0, 0.012), (0.04, 1), GOLD, 'capeEdgeTrimR')
    cape(1.01, (0.988, 1), (0.04, 1), GOLD, 'capeEdgeTrimL')
    sc.surface(("0.3*cos(w)", "0.03+0.29*sin(w)", "10.6+0.2*s"), ('s', 0, 1), ('w', 0, '2*pi'), CREAM, 'capeCollar', ('tube', 'u'))
    torus((0, 0.03, 10.8), ((1, 0, 0), (0, 1, 0), (0, 0, 1)), 0.3, 0.012, GOLD, 'capeCollarTrim')
    # emblems on the front panels
    for side, tag in ((1, 'L'), (-1, 'R')):
        s0 = 0.5
        z0, a0, b0 = bezier_eval(CAPE, s0)
        th = 0.95 * side
        P = (a0 * math.sin(th), 0.03 - b0 * math.cos(th), z0)
        n = unit((math.sin(th) / a0, -math.cos(th) / b0, 0.55))
        flower(add(P, mul(n, 0.012)), n, 0.17, f'capeEmblem{tag}', layers=2, colors=(ORANGE, ORANGE_LT, AMBER, GOLD), flat=True)

# =====================================================================
#  ARMS: bishop sleeves with lacing and two-tone cuffs, hands
# =====================================================================
# Measured on the sheet's front view: the elbows at the waist, the cuffs at the hips and the fingertips at
# mid-thigh, the arms held a little away from the skirt.
ARMS = {
    'L': dict(S=(0.82, 0.03, 10.1), E=(1.38, 0.12, 8.42), W=(1.66, -0.02, 7.06)),
    'R': dict(S=(-0.82, 0.03, 10.1), E=(-1.38, 0.12, 8.42), W=(-1.66, -0.02, 7.06)),
}


HS = 3.0    # hand size: on the sheet a hand is half the head height and as wide as the cuff's opening


def hand(W, d, pn, side, tag, curl=(0.35, 0.45), thumb_curl=0.5):
    d = unit(d)
    pn = unit(sub(pn, mul(d, dot(pn, d))))
    across = unit(cross(pn, d))  # toward the thumb for the left hand
    ts = 1 if side > 0 else -1
    Pc = add(W, mul(d, 0.13 * HS))
    ellipsoid(Pc, (0.068 * HS, 0.032 * HS, 0.088 * HS), SKIN, f'palm{tag}', fr=(across, pn, d))
    offs = [0.046, 0.016, -0.015, -0.044]
    lens = [0.12, 0.14, 0.13, 0.105]
    for k, (o, ln) in enumerate(zip(offs, lens)):
        o, ln = o * HS, ln * HS
        base = add(add(Pc, mul(d, 0.07 * HS)), mul(across, -o * ts))
        c1 = curl[0] + 0.05 * k
        d1 = unit(add(mul(d, math.cos(c1)), mul(pn, math.sin(c1))))
        m = add(base, mul(d1, ln * 0.55))
        c2 = c1 + curl[1]
        d2 = unit(add(mul(d, math.cos(c2)), mul(pn, math.sin(c2))))
        tip = add(m, mul(d2, ln * 0.45))
        capsule(add(base, mul(d1, -0.01 * HS)), add(m, mul(d1, 0.012 * HS)), 0.02 * HS, 0.018 * HS, SKIN, f'finger{tag}{k + 1}a')
        capsule(m, tip, 0.018 * HS, 0.015 * HS, SKIN, f'finger{tag}{k + 1}b')
    tb = add(add(Pc, mul(across, 0.06 * ts * HS)), add(mul(d, -0.03 * HS), mul(pn, 0.02 * HS)))
    dt = unit(add(add(mul(d, 0.75), mul(pn, thumb_curl)), mul(across, 0.15 * ts)))
    capsule(tb, add(tb, mul(dt, 0.11 * HS)), 0.022 * HS, 0.017 * HS, SKIN, f'thumb{tag}')


HAND_L = (0.22, -0.05, -1)
HAND_AT = 0.2           # the hand starts this far past the wrist, inside the cuff


if want('arms'):
    for tag, A in ARMS.items():
        side = 1 if tag == 'L' else -1
        S, E, W = A['S'], A['E'], A['W']
        sc.blank()
        sc.note(f"{'Left' if side > 0 else 'Right'} arm: bishop sleeve, lacing, ruffled cuff, hand")
        puff(S, E, 0.21, 0.2, 0.13, CREAM, f'sleeveUpper{tag}', gather=0.035, ng=9)
        ellipsoid(E, (0.21, 0.21, 0.21), CREAM, f'elbow{tag}')
        d = sub(W, E)
        L = norm(d)
        M = add(E, mul(d, 0.42))
        puff(add(E, mul(d, -0.08)), M, 0.21, 0.17, 0.07, CREAM, f'sleeveMid{tag}', gather=0.04, ng=10)
        fr = frame(d)
        sc.surface(place(("cr(u,0.165,0.145)*cos(w)", "cr(u,0.165,0.145)*sin(w)", f"{fmt(L * 0.66)}*cf(u)"), add(E, mul(d, 0.38)), fr),
                   ('u', 0, 'pi'), ('w', 0, '2*pi'), CREAM, f'sleeveLower{tag}', ('tube', 'u'))
        # lacing on the outer side of the forearm: two zigzags crossing
        outward = unit(sub((side, -0.35, 0), mul(unit(d), dot((side, -0.35, 0), unit(d)))))
        lat = unit(cross(unit(d), outward))
        for k, ph in enumerate((0, 1)):
            parts = []
            for i in range(3):
                parts.append(f"{fmt(E[i])}+{fmt(unit(d)[i])}*{fmt(L)}*(0.5+0.42*t)+{fmt(outward[i])}*(0.163-0.012*t)+{fmt(lat[i])}*0.05*asin(sin(pi*(6*t+{ph})))*2/pi")
            sc.curve(tuple(parts), ('t', 0, 1), LACE, f'lacing{tag}{k + 1}', thickness=2)
        # cuff: cream frill outside, black frill inside
        du = unit(d)
        for k, (r0, r1, ln, col, nm) in enumerate([(0.15, 0.32, 0.3, CREAM, 'cuff'), (0.13, 0.27, 0.37, BLACK, 'cuffInner')]):
            Wc = add(W, mul(du, -0.05))
            R = f"({fmt(r0)}+{fmt(r1 - r0)}*s^0.8+0.028*s*sin(9*w))"
            Lc = (f"{R}*cos(w)", f"{R}*sin(w)", f"{fmt(ln)}*s+0.03*s*cos(9*w)")
            sc.surface(place(Lc, Wc, frame(du)), ('s', 0, 1), ('w', 0, '2*pi'), col, f'{nm}{tag}', ('tube', 'u'))
        # hand: palm faces the body, fingers curl forward a little
        pn = unit((-side, -0.25, 0)) if tag == 'R' else unit((side, -0.3, 0))      # her left palm faces the book
        if tag == 'L':
            hand(add(W, mul(du, HAND_AT)), HAND_L, pn, side, tag, curl=(0.55, 0.9), thumb_curl=0.2)
        else:
            hand(add(W, mul(du, HAND_AT)), (-0.4, -0.06, -1), pn, side, tag, curl=(0.25, 0.3))     # relaxed and turned out, as on the sheet

# =====================================================================
#  BOOK (held in her left hand)
# =====================================================================
def place_book():
    # The book hangs on the outside of her left hand, its cover facing out and forward and leaning out with
    # the skirt, pushed out until it clears the skirt.
    Wl, El = ARMS['L']['W'], ARMS['L']['E']
    palm = add(add(Wl, mul(unit(sub(Wl, El)), HAND_AT)), mul(unit(HAND_L), 0.13 * HS))
    o = unit((0.88, -0.48, 0))
    up = unit(add((0, 0, 1), mul(o, -0.42)))
    cover_n = unit(add(o, (0, 0, 0.42)))
    across = unit(cross(up, cover_n))       # along the book width, toward the spine side first
    Bc = add(add(palm, mul(cover_n, 0.032 * HS + 0.1)), mul(up, -0.36))

    def clear(P):
        s = sk_s(P[2])
        a = SA(s) + 0.1
        th = math.atan2(P[0], -P[1])
        return math.hypot(P[0] / a, P[1] / (DK(s, th) * a))
    box = [(i, j, k) for i in (-1, 0, 1) for j in (-1, -0.5, 0, 0.5, 1) for k in (-1, 1)]
    for _ in range(100):
        pts_ = [add(add(add(Bc, mul(across, 0.38 * i)), mul(up, 0.52 * j)), mul(cover_n, 0.09 * k)) for i, j, k in box]
        if min(clear(P) for P in pts_) >= 1.02:
            break
        Bc = add(Bc, mul(o, 0.01))
    fr = (across, up, cover_n)
    return Bc, fr, pts_


BOOK = place_book()      # also kept clear by the hair
if want('book'):
    sc.blank()
    sc.note('Leather book with gold corners and a chrysanthemum emblem')
    Bc, (across, up, cover_n), _ = BOOK
    fr = (across, up, cover_n)
    rbox(Bc, (0.38, 0.52, 0.09), fr, BROWN, 'bookCover', e=0.12)
    rbox(add(Bc, mul(across, -0.014)), (0.38, 0.51, 0.074), fr, '#efe3c8', 'bookPages', e=0.1)
    front = add(Bc, mul(cover_n, 0.092))
    L = ("(0.32*sqc(w,0.08)*r)", "(0.46*sqs(w,0.08)*r)", "0")
    sc.surface(place(L, front, fr), ('r', 0.94, 1), ('w', 0, '2*pi'), GOLD, 'bookFrame', ('dir', cover_n))
    for i, (sx, sy) in enumerate(((1, 1), (-1, 1), (1, -1), (-1, -1))):
        C = add(add(front, mul(across, 0.345 * sx)), mul(up, 0.49 * sy))
        rbox(C, (0.055, 0.055, 0.01), fr, GOLD, f'bookCorner{i + 1}', e=0.2)
    flower(add(front, mul(cover_n, 0.004)), cover_n, 0.19, 'bookEmblem', layers=2, flat=True)
    ribbon([add(Bc, add(mul(up, -0.5), mul(across, -0.05))), add(Bc, add(mul(up, -0.72), mul(across, -0.02))), add(Bc, add(mul(up, -0.9), mul(across, 0.02)))],
           0.03, ORANGE, 'bookmark', cover_n, vcut=0.3)

# =====================================================================
#  CORSET with gold buttons, chain, ring and tassel
# =====================================================================
CZB = 8.24          # the corset's lower edge at the sides of the points; the sheet's corset ends just above the hips
zz = np.linspace(7.55, 9.35, 60)
ca_fit = np.polyfit(zz - 8.5, [torso_ab(z)[0] + 0.045 for z in zz], 4)[::-1]
cb_fit = np.polyfit(zz - 8.5, [torso_ab(z)[1] + 0.04 for z in zz], 4)[::-1]


def corset_ab(z):
    fl = 0.32 * max(0, (CZB - z) / 0.3) ** 1.5
    a = sum(c * (z - 8.5) ** i for i, c in enumerate(ca_fit)) + fl
    b = sum(c * (z - 8.5) ** i for i, c in enumerate(cb_fit)) + 0.6 * fl
    return a, b


def corset_front(x, z, off=0.0):
    a, b = corset_ab(z)
    return -(b * math.sqrt(max(0.0, 1 - (x / a) ** 2))) - off


if want('corset'):
    sc.blank()
    sc.note('Black corset: gold buttons and piping, chain, ring and tassel')
    sc.func('ca(zq)', f"{horner(list(ca_fit), '(zq-8.5)')}+0.32*max(0,({fmt(CZB)}-zq)/0.3)^1.5")
    sc.func('cb(zq)', f"{horner(list(cb_fit), '(zq-8.5)')}+0.19*max(0,({fmt(CZB)}-zq)/0.3)^1.5")
    sc.comment("Bottom edge: points at the front, the sides and the back.")
    sc.func('czb(w)', f'{fmt(CZB)}-0.32*max(0,-sin(w))^10-0.2*cos(w)^10-0.14*max(0,sin(w))^10')
    Zx = "(czb(w)+(9.12-czb(w))*h)"
    sc.surface((f"ca({Zx})*cos(w)", f"cb({Zx})*sin(w)", Zx), ('h', 0, 1), ('w', 0, '2*pi'), BLACK, 'corset', ('tube', 'v'))
    for nm, Ze in (('corsetPipingTop', '9.12'), ('corsetPipingBottom', 'czb(w)')):
        sc.surface((f"(ca({Ze})+0.018*cos(v))*cos(w)", f"(cb({Ze})+0.018*cos(v))*sin(w)", f"{Ze}+0.018*sin(v)"),
                   ('w', 0, '2*pi'), ('v', 0, '2*pi'), GOLD, nm, ('tube', 'u'))
    for i, z in enumerate((8.45, 8.7, 8.95)):
        for side, tag in ((1, 'L'), (-1, 'R')):
            x = 0.13 * side
            ellipsoid((x, corset_front(x, z, 0.005), z), (0.036, 0.036, 0.022), GOLD, f'button{tag}{i + 1}', fr=((1, 0, 0), (0, 0, 1), (0, -1, 0)))
    # gold chain swag from her right side to a ring on her left
    ring = (0.36, corset_front(0.36, 8.36, 0.035), 8.36)
    xs = np.linspace(-0.42, 0.36, 40)
    zs = 8.84 - 0.36 * np.sin(np.pi * (xs + 0.42) / 0.78) ** 1.1 + (8.36 + 0.06 - 8.84) * (xs + 0.42) / 0.78 * 1.0
    ys = [corset_front(x, z, 0.045) for x, z in zip(xs, zs)]
    tt = (xs + 0.42) / 0.78
    px_ = np.polyfit(tt, xs, 3)[::-1]
    py_ = np.polyfit(tt, ys, 6)[::-1]
    pz_ = np.polyfit(tt, zs, 6)[::-1]
    bead_tube((horner(list(px_), 't'), horner(list(py_), 't'), horner(list(pz_), 't')), 26, 0.017, GOLD, 'corsetChain')
    torus(ring, ((1, 0, 0), (0, 0, 1), (0, -1, 0)), 0.065, 0.015, GOLD, 'corsetRing')
    tassel((ring[0], ring[1] - 0.005, ring[2] - 0.08), 0.55, GOLD, 'corsetTassel', r=0.045)
    flat_flower((0, corset_front(0, 8.1, 0.01), 8.1), unit((0, -1, 0.1)), 0.06, 'corsetFlower', n=10, center=GOLD_DK)

# =====================================================================
#  SKIRT, after the sheet's three views and its skirt panel (三片式长裙与褶边衬裙):
#  a pleated cream skirt with a frilled petticoat; black panels at the sides; over them a cream overskirt
#  in two side pieces, each caught up by a bow at the front and one at the back so its hem swags low at
#  the side; black bands down the overskirt's edges to the bows; an orange tab at the front and the back.
# =====================================================================
def skirt_point(h, th, off=0.0):
    """Point at height h and angle th (from the front, + toward her left) on the pleated skirt, off further out."""
    s = sk_s(h)
    a = SA(s) + off
    return (a * math.sin(th), -a * DK(s, th) * math.cos(th), h)


def skirt_normal(h, th):
    s = sk_s(h)
    k = DK(s, th)
    return unit((k * math.sin(th), -math.cos(th), 0.45 * math.hypot(k * math.sin(th), math.cos(th))))


OV_F, OV_B = 0.64, 2.6          # the overskirt pieces run from 37 degrees (front bows) to 149 (back bows)
OV_TOP = 8.2                    # their top, under the corset's lower edge
BOW_ZF, BOW_ZB = 6.0, 5.65      # heights of the front and back bows


def OSR(h):
    """Radius of the overskirt at height h (before its folds)."""
    return SA(sk_s(h)) + 0.17 * min(1, max(0, OV_TOP - h) / 0.3)


if want('skirt'):
    sc.blank()
    sc.note('Skirt: cream pleated skirt with orange embroidery and a frilled petticoat')
    sc.comment(f"""Skirt: s from the waist (z={fmt(SK_TOP)}) to the hem (z={fmt(SK_HEM)}); t is the angle from the front, + toward her
left. sa(s) is its half-width: the straight A-line of the front view. Seen from the side the front hangs
nearly flat and the back is full, so the depth is dk(s,t) times the half-width: 0.57 at the front, 0.75
to 1 at the back from the waist to the hem. 24 soft pleats (spl). sz(h) is s at height h.""")
    sc.func('sa(s)', SA_EXPR)
    sc.func('dk(s,t)', DK_EXPR)
    sc.func('sz(h)', f"({fmt(SK_TOP)}-h)/{fmt(SK_L)}")
    sc.func('spl(s,t)', '1+0.02*(0.25+0.75*s)*sin(24*t)')
    Zs = f"{fmt(SK_TOP)}-{fmt(SK_L)}*s"
    sc.surface(("sa(s)*spl(s,t)*sin(t)", "-sa(s)*spl(s,t)*dk(s,t)*cos(t)", Zs), ('s', 0, 1), ('t', '-pi', 'pi'), CREAM, 'underskirt', ('tube', 'u'))
    for k, (z0, z1, r0, r1, nw, col) in enumerate([(1.66, 1.32, 0.99, 1.05, 30, CREAM), (1.4, 1.14, 1.0, 1.07, 38, '#f8f2e8')]):
        Rk = f"sa(1)*({fmt(r0)}+{fmt(r1 - r0)}*s+0.022*s*sin({nw}*t))"
        sc.surface((f"{Rk}*sin(t)", f"-{Rk}*dk(1,t)*cos(t)", f"{fmt(z0)}-{fmt(z0 - z1)}*s+0.03*s*cos({nw}*t)"),
                   ('s', 0, 1), ('t', '-pi', 'pi'), col, f'petticoat{k + 1}', ('tube', 'u'))
    sc.comment("Embroidery where the pleated skirt shows, at the front and the back: hem lines and fern sprigs in orange thread.")

    def on_skirt(sx, tx, lift=1.012):
        return (f"sa({sx})*spl({sx},{tx})*{fmt(lift)}*sin({tx})", f"-sa({sx})*spl({sx},{tx})*dk({sx},{tx})*{fmt(lift)}*cos({tx})", f"{fmt(SK_TOP)}-{fmt(SK_L)}*({sx})")
    for side, nm, c0, hw in (('Front', 'F', 0.0, 0.33), ('Back', 'B', math.pi, 0.3)):
        sc.curve(on_skirt("0.955", f"({fmt(c0)}+t)"), ('t', -hw, hw), GOLD, f'hemLine{nm}1', thickness=2)
        sc.curve(on_skirt("0.94", f"({fmt(c0)}+t)"), ('t', -hw, hw), ORANGE, f'hemLine{nm}2', thickness=2)
        sc.curve(on_skirt("0.875+0.022*sin(30*t)", f"({fmt(c0)}+t+0.012*cos(30*t))"), ('t', -hw, hw), ORANGE, f'vine{nm}', thickness=2)
        n_sp = 5 if nm == 'F' else 4
        for i in range(n_sp):
            tc = c0 + hw * 0.85 * (2 * i / (n_sp - 1) - 1)
            for k, sg in enumerate((1, -1)):
                sx = "(0.93-0.13*t)"
                tx = f"({fmt(tc)}+{fmt(sg)}*0.024*abs(sin(5*pi*t))*(1-t)/sa({sx}))"
                sc.curve(on_skirt(sx, tx), ('t', 0, 1), ORANGE_LT, f'sprig{nm}{i + 1}{"ab"[k]}', thickness=2)

    sc.blank()
    sc.note('Skirt: black side panels with orange facings, gold bands and chrysanthemum emblems')
    sc.comment("""Black side panels under the overskirt, from 20 to 162 degrees on each side (the pleated skirt shows
at the front and the back), from just under the bows down to a hem near 2; their lower corners flare a little.
q runs across a panel from its front edge, p down it.""")
    sc.func('bzh(q)', '1.95+0.1*sin(pi*q)')
    sc.func('bph(q,p)', '5.95-0.45*q-(5.95-0.45*q-bzh(q))*p')
    TB0, TB1 = 0.35, 2.83
    for sd, tag in ((1, 'L'), (-1, 'R')):
        TH = f"({fmt(TB0)}+{fmt(TB1 - TB0)}*q)"
        H = "bph(q,p)"
        R = f"(sa(sz({H}))+0.09+0.12*p^4*sin(pi*q)^2)"
        sc.surface((f"{fmt(sd)}*{R}*sin({TH})", f"-{R}*dk(sz({H}),{TH})*cos({TH})", H), ('q', 0, 1), ('p', 0, 1), BLACK, f'sidePanel{tag}', ('point', (0, 0, 4)))
        # the front edge turned back: an orange facing, edged in gold
        TF = f"({fmt(TB0 - 0.01)}+0.075*q)"
        H = f"bph(0,p)"
        R = f"(sa(sz({H}))+0.105)"
        sc.surface((f"{fmt(sd)}*{R}*sin({TF})", f"-{R}*dk(sz({H}),{TF})*cos({TF})", H), ('q', 0, 1), ('p', 0, 1), ORANGE, f'sideFacing{tag}', ('point', (0, 0, 4)))
        sc.curve((f"{fmt(sd)}*(sa(sz(bph(0,t)))+0.11)*sin({fmt(TB0 + 0.065)})", f"-(sa(sz(bph(0,t)))+0.11)*dk(sz(bph(0,t)),{fmt(TB0 + 0.065)})*cos({fmt(TB0 + 0.065)})", "bph(0,t)"),
                 ('t', 0, 1), GOLD, f'sideFacingTrim{tag}', thickness=2)
        for k, pp in enumerate((0.94, 0.985)):
            Hq = f"bph(t,{pp})"
            Rq = f"(sa(sz({Hq}))+0.105+0.12*{fmt(pp ** 4)}*sin(pi*t)^2)"
            TQ = f"({fmt(TB0)}+{fmt(TB1 - TB0)}*t)"
            sc.curve((f"{fmt(sd)}*{Rq}*sin({TQ})", f"-{Rq}*dk(sz({Hq}),{TQ})*cos({TQ})", Hq), ('t', 0, 1), GOLD, f'sideBand{tag}{k + 1}', thickness=2)
        for k, q in enumerate((0.12, 0.88)):
            th = sd * (TB0 + (TB1 - TB0) * q)
            top = 5.95 - 0.45 * q
            h = top - (top - (1.95 + 0.1 * math.sin(math.pi * q))) * 0.8
            flat_flower(skirt_point(h, th, 0.105), skirt_normal(h, th), 0.17, f'sideEmblem{tag}{k + 1}', n=12, color=ORANGE, center=GOLD)

    sc.blank()
    sc.note('Skirt: cream overskirt in two side pieces, caught up by bows at the front and the back')
    sc.comment(f"""Overskirt: on each side a cream piece from {fmt(round(math.degrees(OV_F)))} to {fmt(round(math.degrees(OV_B)))} degrees, just outside the skirt
(osr). Each end is caught up by a bow, so the hem (ozh, measured on the front and back views) rises
steeply to the bows and swags down to 2.6 behind the side (110 degrees), so from the side the hem
falls toward the back; the cloth falls in folds that deepen toward the hem. q runs across a piece from
the front bow to the back bow, p down from the waist to the hem. Lined in orange, with the hem turned
back over the side (oft) so the lining shows there, as drawn on the sheet.""")
    sc.func('osr(h)', f"sa(sz(h))+0.17*min(1,max(0,{fmt(OV_TOP)}-h)/0.3)")
    sc.func('ozh(q)', '2.6+2.87*max(0,1-q/0.653)^2.6+2.5*max(0,(q-0.653)/0.347)^1.6')
    sc.func('oph(q,p)', f"{fmt(OV_TOP)}-({fmt(OV_TOP)}-ozh(q))*p")
    sc.func('ofd(q,p)', '0.1*p^1.2*(0.5+0.5*sin(10*pi*q))')
    sc.func('oft(q)', '0.26*sin(pi*q)^3')
    TH = f"({fmt(OV_F)}+{fmt(OV_B - OV_F)}*q)"
    for sd, tag in ((1, 'L'), (-1, 'R')):
        for nm, col, dr, p0 in (('overskirt', CREAM, 0.0, 0.0), ('overskirtLining', ORANGE, -0.015, 0.03)):
            H = "oph(q,p)"
            R = f"(osr({H})+ofd(q,p)+{fmt(dr)})"
            sc.surface((f"{fmt(sd)}*{R}*sin({TH})", f"-{R}*dk(sz({H}),{TH})*cos({TH})", H), ('q', 0, 1), ('p', p0, 1), col, f'{nm}{tag}', ('point', (0, 0, 4)))
        H = "(ozh(q)+oft(q)*v)"
        R = f"(osr(ozh(q))+ofd(q,1)+0.02+0.035*v)"
        sc.surface((f"{fmt(sd)}*{R}*sin({TH})", f"-{R}*dk(sz(ozh(q)),{TH})*cos({TH})", H), ('q', 0, 1), ('v', 0, 1), ORANGE, f'overskirtTurn{tag}', ('point', (0, 0, 4)))
        TT = TH.replace('q', 't')
        R = "(osr(ozh(t))+ofd(t,1)+0.012)"
        sc.curve((f"{fmt(sd)}*{R}*sin({TT})", f"-{R}*dk(sz(ozh(t)),{TT})*cos({TT})", "ozh(t)"), ('t', 0, 1), GOLD, f'overskirtHem{tag}', thickness=2)
        H = "(ozh(t)+oft(t)+0.14+0.05*sin(40*t))"
        R = f"(osr({H})+ofd(t,1)+0.012)"
        sc.curve((f"{fmt(sd)}*{R}*sin({TT})", f"-{R}*dk(sz({H}),{TT})*cos({TT})", H), ('t', 0, 1), ORANGE, f'overskirtVine{tag}', thickness=2)

        # black bands down the overskirt's front and back edges, from the waist to the bows
        for nm, te, dirn, zb_ in (('F', OV_F, 1, BOW_ZF), ('B', OV_B, -1, BOW_ZB)):
            H = f"({fmt(OV_TOP - 0.05)}-{fmt(OV_TOP - 0.05 - zb_)}*p)"
            R = f"(osr({H})+0.02)"
            TE = f"({fmt(te)}+{fmt(dirn)}*(v-0.25)*0.36/{R})"
            sc.surface((f"{fmt(sd)}*{R}*sin({TE})", f"-{R}*dk(sz({H}),{TE})*cos({TE})", H), ('p', 0, 1), ('v', 0, 1), BLACK, f'edgeBand{nm}{tag}', ('point', (0, 0, 4)))
            for k, vv in enumerate((-0.25, 1)):
                Ht = H.replace('p', 't')
                Rt = f"(osr({Ht})+0.026)"
                TE = f"({fmt(te)}+{fmt(dirn * (vv - 0.25) * 0.36)}/{Rt})"
                sc.curve((f"{fmt(sd)}*{Rt}*sin({TE})", f"-{Rt}*dk(sz({Ht}),{TE})*cos({TE})", Ht), ('t', 0, 1), GOLD, f'edgeBandTrim{nm}{tag}{k + 1}', thickness=2)

    sc.blank()
    sc.note('Skirt: orange tabs at the front (her left) and the back, edged in gold')
    sc.comment("""The front tab hangs from the corset's point on her left of the centre line, widening down to a slanting
cut that is lowest on the outside. The back tab hangs at the centre back to a slanting point, lowest on
her left. Both lie on the pleated skirt; x is measured across, so each follows the skirt's curve.""")
    # front tab: x from ftx0(h) to ftx1(h); its foot slants from 4.8 (inside) to 4.25 (outside)
    sc.func('fth(v,p)', '8.0-(8.0-(4.8-0.55*v))*p')
    FX = "(0.05+0.01*(8-fth(v,p))+(0.35+0.3*(8-fth(v,p)))*v)"
    H = "fth(v,p)"
    A = f"(sa(sz({H}))+0.07)"
    TF = f"asin(min(0.97,{FX}/{A}))"
    sc.surface((FX, f"-{A}*dk(sz({H}),{TF})*cos({TF})", H), ('v', 0, 1), ('p', 0, 1), ORANGE, 'frontTab', ('dir', (0, -1, 0.2)))
    sc.func('bth(v,p)', '8.05-(8.05-(4.42+0.45*(1-2*v)))*p')
    BX = "((0.35+0.12*(8.05-bth(v,p)))*(2*v-1))"
    H = "bth(v,p)"
    A = f"(sa(sz({H}))+0.07)"
    TB = f"(pi-asin(min(0.97,{BX}/{A})))"
    sc.surface((BX, f"-{A}*dk(sz({H}),{TB})*cos({TB})", H), ('v', 0, 1), ('p', 0, 1), ORANGE, 'backTab', ('dir', (0, 1, 0.2)))
    for nm, fh, fx_, sgn in (('frontTab', 'fth', FX, -1), ('backTab', 'bth', BX, 1)):
        for k, (vv, pp) in enumerate((('0', 't'), ('1', 't'), ('t', '1'))):
            Ht = f"{fh}({vv},{pp})"
            Xt = fx_.replace('fth(v,p)', Ht).replace('bth(v,p)', Ht).replace('*v)', f'*{vv})').replace('(2*v-1)', f'(2*{vv}-1)')
            At = f"(sa(sz({Ht}))+0.077)"
            Tt = f"asin(min(0.97,{Xt}/{At}))" if sgn < 0 else f"(pi-asin(min(0.97,{Xt}/{At})))"
            sc.curve((Xt, f"-{At}*dk(sz({Ht}),{Tt})*cos({Tt})", Ht), ('t', 0, 1), GOLD, f'{nm}Trim{k + 1}', thickness=2)

    sc.blank()
    sc.note('Skirt: four black bows with chrysanthemums and gold tassels where the overskirt is caught up')
    for sd, tag in ((1, 'L'), (-1, 'R')):
        for fb, th0, zb_, sz_ in (('F', OV_F, BOW_ZF, 1.0), ('B', OV_B, BOW_ZB, 0.92)):
            th = sd * th0
            s_ = sk_s(zb_)
            k_ = DK(s_, th)
            P = ((OSR(zb_) + 0.03) * math.sin(th), -(OSR(zb_) + 0.03) * k_ * math.cos(th), zb_)
            n = skirt_normal(zb_, th)
            tang = unit((math.cos(th), k_ * math.sin(th), 0))
            upv = cross(n, tang)
            C = add(P, mul(n, 0.07))
            bow(C, (tang, upv, n), (0.56 * sz_, 0.22 * sz_, 0.09), f'bow{fb}{tag}', loops=((1, -0.2), (-1, -0.2)))
            flower(add(add(C, mul(n, 0.08)), mul(upv, 0.2 * sz_)), n, 0.2 * sz_, f'bowFlower{fb}{tag}')
            for k, (dx, ln) in enumerate(((0.09, 1.25), (-0.1, 1.05))):
                b0 = add(C, mul(tang, dx))
                ln *= sz_
                ribbon([b0, add(add(b0, mul(tang, dx * 2.2)), add(mul(n, 0.06), (0, 0, -ln * 0.5))), add(add(b0, mul(tang, dx * 3.6)), add(mul(n, 0.1), (0, 0, -ln)))],
                       0.14, BLACK, f'bowTail{fb}{tag}{k + 1}', n, rim=GOLD, vcut=0.3)
            for k, dx in enumerate((0.07, -0.08)):
                tassel(add(add(C, mul(n, 0.1)), add(mul(tang, dx * sz_), (0, 0, -0.12))), 0.95 * sz_, GOLD, f'bowTassel{fb}{tag}{k + 1}', r=0.05)

# =====================================================================
#  BOOTS
# =====================================================================
if want('boots'):
    sc.blank()
    sc.note('Cream lace-up ankle boots with brown heels')
    for side, tag in ((1, 'L'), (-1, 'R')):
        x = 0.38 * side          # the sheet's boots: shafts 0.43 wide, 0.76 apart
        toe = unit((0.14 * side, -1, 0))
        fr = (unit(cross(toe, (0, 0, 1))), toe, (0, 0, 1))
        rbox((x, -0.32, 0.17), (0.21, 0.36, 0.16), fr, '#efe2cf', f'boot{tag}', e=0.55, e2=0.75)
        capsule((x, -0.1, 0.15), (x, -0.1, 1.5), 0.215, 0.2, '#efe2cf', f'bootShaft{tag}')
        rbox((x, -0.31, 0.025), (0.225, 0.38, 0.028), fr, BROWN_DK, f'bootSole{tag}', e=0.3, e2=0.7)
        rbox((x, -0.02, 0.08), (0.15, 0.12, 0.08), fr, BROWN_DK, f'bootHeel{tag}', e=0.25)
        for k, ph in enumerate((0, 1)):
            X = f"{fmt(x)}+0.08*asin(sin(pi*(7*t+{ph})))*2/pi"
            Y = f"-0.322+0.01*t-0.2*max(0,0.3-t)/0.3"
            Z = f"0.3+1.0*t"
            sc.curve((X, Y, Z), ('t', 0, 1), '#8a4a2a', f'bootLace{tag}{k + 1}', thickness=2)

# =====================================================================
#  DISPLAY BASE
# =====================================================================
if want('base'):
    sc.blank()
    sc.note('Display base')
    sc.surface(("3.4*sqs(u,0.3)*cos(v)", "3.4*sqs(u,0.3)*sin(v)", "-0.2+0.2*sqc(u,0.3)"), ('u', 0, 'pi'), ('v', 0, '2*pi'), '#2b2226', 'base', 'closed')
    torus((0, 0, -0.02), ((1, 0, 0), (0, 1, 0), (0, 0, 1)), 3.38, 0.035, GOLD, 'baseRim')
    torus((0, 0, 0.0), ((1, 0, 0), (0, 1, 0), (0, 0, 1)), 3.12, 0.012, GOLD, 'baseRing')
    sc.surface(("2.75*r*cos(w)", "2.45*r*sin(w)", "0.006"), ('r', 0, 1), ('w', 0, '2*pi'), 'black', 'shadow', ('dir', (0, 0, 1)), opacity=0.25)
    flower((0, -3.05, 0.012), (0, 0, 1), 0.2, 'baseEmblem', layers=2, flat=True, up=(0, 1, 0))
