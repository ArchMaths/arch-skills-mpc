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


def SA(s):
    return 0.43 + 1.35 * s + 0.8 * s ** 2


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
CAPE = [(10.7, 0.3, 0.28), (10.52, 0.6, 0.44), (10.3, 1.18, 0.68), (9.75, 1.4, 0.84), (9.15, 1.48, 0.92), (8.95, 1.5, 0.94)]
if want('cape'):
    sc.blank()
    sc.note('Capelet: cream with gold trim, beige lining and chrysanthemum emblems')
    cz_, ca_, cb_ = bezier_poly(CAPE)
    Zc, Ac, Bc = horner(cz_, 's'), horner(ca_, 's'), horner(cb_, 's')
    sc.comment("Capelet: s from the collar to the hem; q around from her right front edge, over the back, to her left front edge.")
    sc.func('cth(s,q)', '(0.3+0.32*s)+(2*pi-2*(0.3+0.32*s))*q')
    def cape(scale, qr, sr, color, ref, dz=0.0):
        X = f"{fmt(scale)}*({Ac})*sin(cth(s,q))"
        Y = f"0.03-{fmt(scale)}*({Bc})*cos(cth(s,q))"
        Z = f"{Zc}+{fmt(dz)}"
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
ARMS = {
    'L': dict(S=(0.8, 0.03, 10.1), E=(1.1, 0.14, 8.85), W=(1.2, -0.06, 7.65)),
    'R': dict(S=(-0.8, 0.03, 10.1), E=(-1.1, 0.14, 8.85), W=(-1.18, -0.04, 7.62)),
}


HS = 2.0    # hand size: on the sheet a hand is about 0.4 of the head height and half as wide as the cuff


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
        for k, (r0, r1, ln, col, nm) in enumerate([(0.15, 0.31, 0.22, CREAM, 'cuff'), (0.13, 0.26, 0.29, BLACK, 'cuffInner')]):
            Wc = add(W, mul(du, -0.05))
            R = f"({fmt(r0)}+{fmt(r1 - r0)}*s^0.8+0.028*s*sin(9*w))"
            Lc = (f"{R}*cos(w)", f"{R}*sin(w)", f"{fmt(ln)}*s+0.03*s*cos(9*w)")
            sc.surface(place(Lc, Wc, frame(du)), ('s', 0, 1), ('w', 0, '2*pi'), col, f'{nm}{tag}', ('tube', 'u'))
        # hand: palm faces the body, fingers curl forward a little
        pn = unit((-side, -0.25, 0))
        if tag == 'L':
            hand(add(W, mul(du, 0.12)), (0.12, -0.05, -1), pn, side, tag, curl=(0.55, 0.9), thumb_curl=0.2)
        else:
            hand(add(W, mul(du, 0.12)), (-0.04, -0.06, -1), pn, side, tag)

# =====================================================================
#  BOOK (held in her left hand)
# =====================================================================
if want('book'):
    sc.blank()
    sc.note('Leather book with gold corners and a chrysanthemum emblem')
    Wl = ARMS['L']['W']
    cover_n = unit((0.62, -0.78, 0))      # front cover faces front-right
    up = (0, 0, 1)
    across = unit(cross(up, cover_n))       # along the book width, toward the spine side first
    Bc = add(Wl, (0.03, -0.12, -0.68))
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
zz = np.linspace(7.55, 9.35, 60)
ca_fit = np.polyfit(zz - 8.5, [torso_ab(z)[0] + 0.045 for z in zz], 4)[::-1]
cb_fit = np.polyfit(zz - 8.5, [torso_ab(z)[1] + 0.04 for z in zz], 4)[::-1]


def corset_ab(z):
    fl = 0.16 * max(0, (7.98 - z) / 0.3) ** 1.5
    a = sum(c * (z - 8.5) ** i for i, c in enumerate(ca_fit)) + fl
    b = sum(c * (z - 8.5) ** i for i, c in enumerate(cb_fit)) + 0.6 * fl
    return a, b


def corset_front(x, z, off=0.0):
    a, b = corset_ab(z)
    return -(b * math.sqrt(max(0.0, 1 - (x / a) ** 2))) - off


if want('corset'):
    sc.blank()
    sc.note('Black corset: gold buttons and piping, chain, ring and tassel')
    sc.func('ca(zq)', f"{horner(list(ca_fit), '(zq-8.5)')}+0.16*max(0,(7.98-zq)/0.3)^1.5")
    sc.func('cb(zq)', f"{horner(list(cb_fit), '(zq-8.5)')}+0.096*max(0,(7.98-zq)/0.3)^1.5")
    sc.comment("Bottom edge: points at the front, the sides and the back.")
    sc.func('czb(w)', '7.98-0.32*max(0,-sin(w))^10-0.2*cos(w)^10-0.14*max(0,sin(w))^10')
    Zx = "(czb(w)+(9.12-czb(w))*h)"
    sc.surface((f"ca({Zx})*cos(w)", f"cb({Zx})*sin(w)", Zx), ('h', 0, 1), ('w', 0, '2*pi'), BLACK, 'corset', ('tube', 'v'))
    for nm, Ze in (('corsetPipingTop', '9.12'), ('corsetPipingBottom', 'czb(w)')):
        sc.surface((f"(ca({Ze})+0.018*cos(v))*cos(w)", f"(cb({Ze})+0.018*cos(v))*sin(w)", f"{Ze}+0.018*sin(v)"),
                   ('w', 0, '2*pi'), ('v', 0, '2*pi'), GOLD, nm, ('tube', 'u'))
    for i, z in enumerate((8.3, 8.6, 8.9)):
        for side, tag in ((1, 'L'), (-1, 'R')):
            x = 0.13 * side
            ellipsoid((x, corset_front(x, z, 0.005), z), (0.036, 0.036, 0.022), GOLD, f'button{tag}{i + 1}', fr=((1, 0, 0), (0, 0, 1), (0, -1, 0)))
    # gold chain swag from her right side to a ring on her left
    ring = (0.36, corset_front(0.36, 8.14, 0.035), 8.14)
    xs = np.linspace(-0.42, 0.36, 40)
    zs = 8.62 - 0.4 * np.sin(np.pi * (xs + 0.42) / 0.78) ** 1.1 + (8.14 + 0.06 - 8.62) * (xs + 0.42) / 0.78 * 1.0
    ys = [corset_front(x, z, 0.045) for x, z in zip(xs, zs)]
    tt = (xs + 0.42) / 0.78
    px_ = np.polyfit(tt, xs, 3)[::-1]
    py_ = np.polyfit(tt, ys, 6)[::-1]
    pz_ = np.polyfit(tt, zs, 6)[::-1]
    bead_tube((horner(list(px_), 't'), horner(list(py_), 't'), horner(list(pz_), 't')), 26, 0.017, GOLD, 'corsetChain')
    torus(ring, ((1, 0, 0), (0, 0, 1), (0, -1, 0)), 0.065, 0.015, GOLD, 'corsetRing')
    tassel((ring[0], ring[1] - 0.005, ring[2] - 0.08), 0.55, GOLD, 'corsetTassel', r=0.045)
    flat_flower((0, corset_front(0, 7.86, 0.01), 7.86), unit((0, -1, 0.1)), 0.06, 'corsetFlower', n=10, center=GOLD_DK)

# =====================================================================
#  SKIRT: cream pleated underskirt with embroidery, petticoat, black overskirt with orange lining
# =====================================================================
SK_TOP, SK_HEM = 8.4, 1.35



def skirt_point(s, w, scale=1.0):
    a = SA(s) * scale
    return (a * math.cos(w), 0.88 * a * math.sin(w), SK_TOP - (SK_TOP - SK_HEM) * s)


if want('skirt'):
    sc.blank()
    sc.note('Skirt: cream pleated underskirt with orange embroidery and a frilled petticoat')
    sc.comment("Underskirt: s from the waist (z=8.4) to the hem (z=1.35); 24 soft pleats.")
    sc.func('sa(s)', '0.43+1.35*s+0.8*s^2')
    sc.func('spl(s,w)', '1+0.02*(0.25+0.75*s)*sin(24*w)')
    sc.surface(("sa(s)*spl(s,w)*cos(w)", "0.88*sa(s)*spl(s,w)*sin(w)", "8.4-7.05*s"), ('s', 0, 1), ('w', 0, '2*pi'), CREAM, 'underskirt', ('tube', 'u'))
    for k, (z0, z1, r0, r1, nw, col) in enumerate([(1.4, 1.06, 0.99, 1.05, 30, CREAM), (1.14, 0.88, 1.0, 1.07, 38, '#f8f2e8')]):
        Rk = f"sa(1)*({fmt(r0)}+{fmt(r1 - r0)}*s+0.022*s*sin({nw}*w))"
        sc.surface((f"{Rk}*cos(w)", f"0.88*{Rk}*sin(w)", f"{fmt(z0)}-{fmt(z0 - z1)}*s+0.03*s*cos({nw}*w)"),
                   ('s', 0, 1), ('w', 0, '2*pi'), col, f'petticoat{k + 1}', ('tube', 'u'))
    # embroidery on the front of the underskirt
    sc.comment("Embroidery: looping vines and fern sprigs in orange thread, small chrysanthemums between them.")
    def on_skirt(sx, wx, lift=1.012):
        return (f"sa({sx})*spl({sx},{wx})*{fmt(lift)}*cos({wx})", f"0.88*sa({sx})*spl({sx},{wx})*{fmt(lift)}*sin({wx})", f"8.4-7.05*({sx})")
    sc.curve(on_skirt("0.875+0.028*sin(26*t)", "(-pi/2+t+0.03*cos(26*t))"), ('t', -1.25, 1.25), ORANGE, 'vine', thickness=2)
    sc.curve(on_skirt("0.94", "(-pi/2+t)"), ('t', -1.35, 1.35), ORANGE, 'hemLine1', thickness=2)
    sc.curve(on_skirt("0.955", "(-pi/2+t)"), ('t', -1.35, 1.35), GOLD, 'hemLine2', thickness=2)
    sc.curve(on_skirt("0.8", "(-pi/2+t)"), ('t', -1.2, 1.2), ORANGE, 'hemLine3', thickness=2)
    for i, w0 in enumerate([-0.98, -0.56, -0.14, 0.28, 0.7]):
        wc = -math.pi / 2 + w0 + 0.21
        for k, sg in enumerate((1, -1)):
            sx = "(0.93-0.12*t)"
            wx = f"({fmt(wc)}+{fmt(sg)}*0.022*abs(sin(5*pi*t))*(1-t)/sa({sx}))"
            sc.curve(on_skirt(sx, wx), ('t', 0, 1), ORANGE_LT, f'sprig{i + 1}{"ab"[k]}', thickness=2)
    for i, w0 in enumerate([-1.05, -0.63, -0.21, 0.21, 0.63, 1.05]):
        w = -math.pi / 2 + w0
        s = 0.875
        P = skirt_point(s, w, 1.02)
        n = unit((math.cos(w) / 1.0, math.sin(w) / 0.88, 0.32))
        flat_flower(P, n, 0.085, f'hemFlower{i + 1}', n=12, center=GOLD)

    sc.blank()
    sc.note('Overskirt: black panels lined in orange, open at the front and draped up at the edges')
    sc.comment("""Overskirt: s from the waist down, q around from her right front edge, over the back, to her left
front edge. The opening widens downward (oth) and the hem lifts near the opening (ozh).""")
    sc.func('oth(s)', '0.28+0.44*s')
    sc.func('ophi(s,q)', 'oth(s)+(2*pi-2*oth(s))*q')
    sc.func('ozh(f)', '1.55+2.2*max(0,cos(f))^2')
    sc.func('oz(s,f)', '7.95-(7.95-ozh(f))*s')
    sc.func('orad(s,f)', '(sa((8.4-oz(s,f))/7.05)+0.07)*(1+0.028*s*sin(9*f))')
    def over(scale, sr, qr, color, ref, dr=0.0):
        F = "ophi(s,q)"
        X = f"({fmt(scale)}*orad(s,{F})+{fmt(dr)})*sin({F})"
        Y = f"-0.88*({fmt(scale)}*orad(s,{F})+{fmt(dr)})*cos({F})"
        sc.surface((X, Y, f"oz(s,{F})"), ('s', sr[0], sr[1]), ('q', qr[0], qr[1]), color, ref, ('point', (0, 0, 6)))
    over(1.0, (0, 1), (0, 1), BLACK, 'overskirt')
    over(0.988, (0.03, 1), (0, 1), ORANGE, 'overskirtLining')
    # orange lapels: the front edges turned back
    sc.func('olw(s)', '0.02+0.11*s')
    for side, tag in ((1, 'R'), (-1, 'L')):
        qa, qb = ("0", "olw(s)") if side > 0 else ("1-olw(s)", "1")
        F = f"ophi(s,{qa}+({qb}-{qa})*p)"
        X = f"(orad(s,{F})+0.012)*sin({F})"
        Y = f"-0.88*(orad(s,{F})+0.012)*cos({F})"
        sc.surface((X, Y, f"oz(s,{F})"), ('s', 0.02, 1), ('p', 0, 1), ORANGE, f'lapel{tag}', ('point', (0, 0, 6)))
        F = f"ophi(s,{qb if side > 0 else qa}+{fmt(0.006 * side)}*p)"
        X = f"(orad(s,{F})+0.016)*sin({F})"
        Y = f"-0.88*(orad(s,{F})+0.016)*cos({F})"
        sc.surface((X, Y, f"oz(s,{F})"), ('s', 0.02, 1), ('p', 0, 1), GOLD, f'lapelTrim{tag}', ('point', (0, 0, 6)))
    F = "ophi(1,q)"
    sc.surface((f"(orad(1,{F})+0.012)*sin({F})", f"-0.88*(orad(1,{F})+0.012)*cos({F})", f"oz(1,{F})+0.06*p"),
               ('q', 0.0, 1), ('p', 0, 1), GOLD, 'overskirtHemTrim', ('point', (0, 0, 6)))
    for i, (s, q) in enumerate([(0.86, 0.12), (0.88, 0.3), (0.88, 0.7), (0.86, 0.88)]):
        f = 0.28 + 0.44 * s
        f = f + (2 * math.pi - 2 * f) * q
        zf = 7.95 - (7.95 - (1.55 + 2.2 * max(0, math.cos(f)) ** 2)) * s
        a = SA((8.4 - zf) / 7.05) + 0.07
        P = (a * 1.02 * math.sin(f), -0.88 * a * 1.02 * math.cos(f), zf)
        n = unit((math.sin(f), -math.cos(f) / 0.88, 0.3))
        flat_flower(P, n, 0.11, f'overFlower{i + 1}', n=12, center=GOLD)

    sc.blank()
    sc.note('Back: long orange centre panel and a black bow')
    sc.func('bpw(s)', '0.17+0.25*s')
    F = "(pi+bpw(s)*p)"
    Zb = "8.05-6.95*s"
    Rb = f"(sa((8.4-({Zb}))/7.05)+0.12)*(1+0.02*sin(7*p))"
    sc.surface((f"{Rb}*sin({F})", f"-0.88*{Rb}*cos({F})", Zb), ('s', 0, 1), ('p', -1, 1), ORANGE, 'backPanel', ('point', (0, 0, 6)))
    for k, pp in enumerate((-1, 1)):
        F = f"(pi+bpw(s)*{pp}*(1-0.08*p))"
        Rb2 = f"(sa((8.4-({Zb}))/7.05)+0.13)"
        sc.surface((f"{Rb2}*sin({F})", f"-0.88*{Rb2}*cos({F})", Zb), ('s', 0, 1), ('p', 0, 1), GOLD, f'backPanelTrim{k + 1}', ('point', (0, 0, 6)))
    zb = 8.0
    a = SA((8.4 - zb) / 7.05) + 0.2
    bow((0, 0.88 * a, zb), ((1, 0, 0), (0, 0, 1), (0, 1, 0)), (0.42, 0.19, 0.08), 'backBow', loops=((1, -0.12), (-1, -0.12)))
    for side, tag in ((1, 'L'), (-1, 'R')):
        ribbon([(0.05 * side, 0.88 * a, zb - 0.08), (0.22 * side, 0.88 * a + 0.12, zb - 0.8), (0.3 * side, 0.88 * a + 0.22, zb - 1.6)], 0.09, BLACK, f'backBowTail{tag}', (0, 1, 0), rim=GOLD)

    sc.blank()
    sc.note('Hip bows: black with gold trim, chrysanthemum centre, gold chain and cream tassel')
    for side, tag in ((1, 'L'), (-1, 'R')):
        f = 0.98 * side
        zb = 7.72
        s = (7.95 - zb) / (7.95 - (1.55 + 2.2 * max(0, math.cos(f)) ** 2))
        a = (SA((8.4 - zb) / 7.05) + 0.07)
        P = (a * math.sin(f), -0.88 * a * math.cos(f), zb)
        n = unit((math.sin(f), -math.cos(f) / 0.88, 0.25))
        tang = unit((math.cos(f), 0.88 * math.sin(f), 0))
        upv = cross(n, tang)
        C = add(P, mul(n, 0.08))
        bow(C, (tang, upv, n), (0.3, 0.14, 0.07), f'hipBow{tag}', loops=((1, -0.15), (-1, -0.15)))
        flower(add(C, mul(n, 0.07)), n, 0.12, f'hipFlower{tag}')
        for k, (dx, ln) in enumerate(((0.05, 0.6), (-0.06, 0.5))):
            b0 = add(C, mul(tang, dx))
            ribbon([b0, add(add(b0, mul(tang, dx * 2)), (0, 0, -ln * 0.5)), add(add(b0, mul(tang, dx * 3.2)), add(mul(n, 0.04), (0, 0, -ln)))],
                   0.055, BLACK, f'hipBowTail{tag}{k + 1}', n, rim=GOLD)
        tassel(add(C, add(mul(n, 0.02), (0, 0, -0.12))), 0.62, CREAM, f'hipTassel{tag}', r=0.05)
        # chain loop from the bow toward the back
        f2 = 1.62 * side
        a2 = (SA((8.4 - 7.95) / 7.05) + 0.1)
        Q = (a2 * math.sin(f2), -0.88 * a2 * math.cos(f2), 7.95)
        xs = []
        for t in np.linspace(0, 1, 30):
            ff = f + (f2 - f) * t
            zz_ = zb + (7.95 - zb) * t - 0.45 * math.sin(math.pi * t)
            aa = (SA((8.4 - zz_) / 7.05) + 0.1)
            xs.append((aa * math.sin(ff), -0.88 * aa * math.cos(ff), zz_))
        T = np.linspace(0, 1, 30)
        polys = [np.polyfit(T, [p[i] for p in xs], 6)[::-1] for i in range(3)]
        bead_tube(tuple(horner(list(pp), 't') for pp in polys), 22, 0.016, GOLD, f'hipChain{tag}', cross_a=(0, 0, 1), cross_b=n)

# =====================================================================
#  BOOTS
# =====================================================================
if want('boots'):
    sc.blank()
    sc.note('Cream lace-up ankle boots with brown heels')
    for side, tag in ((1, 'L'), (-1, 'R')):
        x = 0.33 * side
        toe = unit((0.14 * side, -1, 0))
        fr = (unit(cross(toe, (0, 0, 1))), toe, (0, 0, 1))
        rbox((x, -0.3, 0.17), (0.15, 0.34, 0.15), fr, '#efe2cf', f'boot{tag}', e=0.55, e2=0.75)
        capsule((x, -0.1, 0.15), (x, -0.1, 1.5), 0.155, 0.145, '#efe2cf', f'bootShaft{tag}')
        rbox((x, -0.29, 0.025), (0.165, 0.36, 0.028), fr, BROWN_DK, f'bootSole{tag}', e=0.3, e2=0.7)
        rbox((x, -0.04, 0.08), (0.11, 0.1, 0.08), fr, BROWN_DK, f'bootHeel{tag}', e=0.25)
        for k, ph in enumerate((0, 1)):
            X = f"{fmt(x)}+0.06*asin(sin(pi*(7*t+{ph})))*2/pi"
            Y = f"-0.262+0.01*t-0.2*max(0,0.3-t)/0.3"
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
