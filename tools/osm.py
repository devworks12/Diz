"""OSM（.osm.gz）の読み込みと、マルチポリゴン・座標変換・平面幾何の小道具（標準ライブラリのみ）"""
import gzip
import math
import xml.etree.ElementTree as ET


def load_osm(path):
    nodes, ways, rels = {}, {}, {}
    for _, el in ET.iterparse(gzip.open(path)):
        t = el.tag
        if t == "node":
            nodes[int(el.get("id"))] = (float(el.get("lat")), float(el.get("lon")),
                                        {c.get("k"): c.get("v") for c in el.findall("tag")})
            el.clear()
        elif t == "way":
            ways[int(el.get("id"))] = ([int(c.get("ref")) for c in el.findall("nd")],
                                       {c.get("k"): c.get("v") for c in el.findall("tag")})
            el.clear()
        elif t == "relation":
            rels[int(el.get("id"))] = ([(c.get("type"), int(c.get("ref")), c.get("role")) for c in el.findall("member")],
                                       {c.get("k"): c.get("v") for c in el.findall("tag")})
            el.clear()
    return nodes, ways, rels


class Proj:
    """緯度経度 → ローカルの平面（m）。x=東、z=南（three.js の向き）"""

    def __init__(self, lat0, lon0):
        self.lat0, self.lon0 = lat0, lon0
        self.kx = math.cos(math.radians(lat0)) * 111320.0
        self.kz = 110574.0

    def __call__(self, lat, lon):
        return ((lon - self.lon0) * self.kx, -(lat - self.lat0) * self.kz)


def join_rings(segs):
    """way の点列（端が同じ点でつながる）を閉じた輪にまとめる"""
    segs = [list(s) for s in segs if len(s) >= 2]
    rings = []
    while segs:
        cur = segs.pop(0)
        changed = True
        while cur[0] != cur[-1] and changed:
            changed = False
            for i, s in enumerate(segs):
                if s[0] == cur[-1]:
                    cur += s[1:]
                elif s[-1] == cur[-1]:
                    cur += s[::-1][1:]
                elif s[-1] == cur[0]:
                    cur = s[:-1] + cur
                elif s[0] == cur[0]:
                    cur = s[::-1][:-1] + cur
                else:
                    continue
                segs.pop(i)
                changed = True
                break
        if cur[0] == cur[-1] and len(cur) >= 4:
            rings.append(cur)
    return rings


# ------------------------------------------------------------------ 平面幾何
def area(r):
    s = 0.0
    n = len(r)
    for i in range(n):
        x1, z1 = r[i]
        x2, z2 = r[(i + 1) % n]
        s += x1 * z2 - x2 * z1
    return s / 2


def centroid(r):
    a = area(r)
    if abs(a) < 1e-6:
        return (sum(p[0] for p in r) / len(r), sum(p[1] for p in r) / len(r))
    cx = cz = 0.0
    n = len(r)
    for i in range(n):
        x1, z1 = r[i]
        x2, z2 = r[(i + 1) % n]
        f = x1 * z2 - x2 * z1
        cx += (x1 + x2) * f
        cz += (z1 + z2) * f
    return (cx / (6 * a), cz / (6 * a))


def pip(x, z, r):
    c = False
    n = len(r)
    j = n - 1
    for i in range(n):
        xi, zi = r[i]
        xj, zj = r[j]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi) + xi:
            c = not c
        j = i
    return c


def seg_dist(px, pz, ax, az, bx, bz):
    dx, dz = bx - ax, bz - az
    L2 = dx * dx + dz * dz
    t = 0.0 if L2 < 1e-12 else max(0.0, min(1.0, ((px - ax) * dx + (pz - az) * dz) / L2))
    qx, qz = ax + dx * t, az + dz * t
    return math.hypot(px - qx, pz - qz), t, qx, qz


def dist_to_ring(x, z, r):
    best = 1e18
    n = len(r)
    for i in range(n):
        d = seg_dist(x, z, *r[i], *r[(i + 1) % n])[0]
        if d < best:
            best = d
    return best


def seg_inter(p1, p2, p3, p4, eps=1e-9):
    """線分 p1p2 と p3p4 が（端点以外で）交わるか"""
    d1x, d1z = p2[0] - p1[0], p2[1] - p1[1]
    d2x, d2z = p4[0] - p3[0], p4[1] - p3[1]
    den = d1x * d2z - d1z * d2x
    if abs(den) < eps:
        return False
    t = ((p3[0] - p1[0]) * d2z - (p3[1] - p1[1]) * d2x) / den
    u = ((p3[0] - p1[0]) * d1z - (p3[1] - p1[1]) * d1x) / den
    return 1e-6 < t < 1 - 1e-6 and 1e-6 < u < 1 - 1e-6


def simplify(r, tol=0.4):
    """Douglas–Peucker（閉じた輪は最初と最後が同じでない前提）"""
    if len(r) < 4:
        return r

    def dp(pts):
        if len(pts) < 3:
            return pts
        a, b = pts[0], pts[-1]
        best, bi = -1, 0
        for i in range(1, len(pts) - 1):
            d = seg_dist(*pts[i], *a, *b)[0]
            if d > best:
                best, bi = d, i
        if best > tol:
            return dp(pts[: bi + 1])[:-1] + dp(pts[bi:])
        return [a, b]

    # 一番遠い2点で分けて単純化
    i0 = 0
    i1 = max(range(len(r)), key=lambda i: (r[i][0] - r[0][0]) ** 2 + (r[i][1] - r[0][1]) ** 2)
    a = dp(r[i0: i1 + 1])
    b = dp(r[i1:] + [r[0]])
    out = a[:-1] + b[:-1]
    return out if len(out) >= 3 else r


def principal_angle(r):
    """多角形の向き（最小外接長方形の辺の向き。ラジアン）"""
    best = (1e18, 0.0)
    n = len(r)
    for i in range(n):
        x1, z1 = r[i]
        x2, z2 = r[(i + 1) % n]
        L = math.hypot(x2 - x1, z2 - z1)
        if L < 0.5:
            continue
        a = math.atan2(z2 - z1, x2 - x1)
        c, s = math.cos(a), math.sin(a)
        us = [p[0] * c + p[1] * s for p in r]
        vs = [-p[0] * s + p[1] * c for p in r]
        ar = (max(us) - min(us)) * (max(vs) - min(vs))
        if ar < best[0]:
            best = (ar, a)
    return best[1]
