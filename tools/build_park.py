#!/usr/bin/env python3
"""OSM 生データ（data/raw/tds.osm.gz）から 3D アプリ用の data/park.json を作る。

標準ライブラリだけで動く:  python3 tools/build_park.py [--report]

1. 園内（tourism=theme_park の外周）の面を種類ごとにまとめる（水面・岩・植栽・広場・建物）
2. 建物に高さとエリア（テーマポート）の様式を割り当てる
3. 歩ける線（footway / pedestrian / steps ...）と広場（highway=pedestrian の面）から歩行グラフを作る
   広場の中は、見通せる点どうしを直線でつなぐ（実際に広場を斜めに横切れるように）
4. アトラクション・ショー・レストラン・ショップ・トイレ・サービス・入口を「選べる施設」にし、
   いちばん近い通路（建物の中なら建物の出入口）につなぐ
"""
import json
import math
import re
import random
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import park_config as C  # noqa: E402
from osm import load_osm, Proj, area, centroid, pip, seg_dist, seg_inter, simplify, dist_to_ring, principal_angle  # noqa: E402,F401
from features import Features  # noqa: E402

REPORT = "--report" in sys.argv
random.seed(7)

nodes, ways, rels = load_osm(ROOT / "data/raw/tds.osm.gz")
P = Proj(*C.ORIGIN)
F = Features(nodes, ways, rels, P)
PARK = F.xz_ring(ways[C.PARK_WAY][0])


def in_park_pt(x, z, margin=C.PARK_MARGIN):
    return pip(x, z, PARK) or dist_to_ring(x, z, PARK) < margin


def in_park(ring, margin=C.PARK_MARGIN):
    return in_park_pt(*centroid(ring), margin)


def R(v, k=10):
    return round(v * k) / k


def flat(ring, k=10):
    out = []
    for x, z in ring:
        out += [R(x, k), R(z, k)]
    return out


# ------------------------------------------------------------------ 空間インデックス（線分の交差判定用）
class SegGrid:
    def __init__(self, cell=20.0):
        self.cell = cell
        self.g = defaultdict(list)
        self.segs = []

    def add_ring(self, ring, tag):
        n = len(ring)
        for i in range(n):
            self.add(ring[i], ring[(i + 1) % n], tag)

    def add(self, a, b, tag):
        k = len(self.segs)
        self.segs.append((a, b, tag))
        c = self.cell
        for gx in range(int(math.floor(min(a[0], b[0]) / c)), int(math.floor(max(a[0], b[0]) / c)) + 1):
            for gz in range(int(math.floor(min(a[1], b[1]) / c)), int(math.floor(max(a[1], b[1]) / c)) + 1):
                self.g[(gx, gz)].append(k)

    def crosses(self, a, b, skip=None):
        c = self.cell
        seen = set()
        for gx in range(int(math.floor(min(a[0], b[0]) / c)), int(math.floor(max(a[0], b[0]) / c)) + 1):
            for gz in range(int(math.floor(min(a[1], b[1]) / c)), int(math.floor(max(a[1], b[1]) / c)) + 1):
                for k in self.g.get((gx, gz), ()):
                    if k in seen:
                        continue
                    seen.add(k)
                    p, q, tag = self.segs[k]
                    if skip is not None and tag in skip:
                        continue
                    if seg_inter(a, b, p, q):
                        return tag
        return None


class PtGrid:
    def __init__(self, cell=10.0):
        self.cell = cell
        self.g = defaultdict(list)

    def add(self, x, z, v):
        self.g[(int(math.floor(x / self.cell)), int(math.floor(z / self.cell)))].append((x, z, v))

    def near(self, x, z, r):
        c = self.cell
        out = []
        for gx in range(int(math.floor((x - r) / c)), int(math.floor((x + r) / c)) + 1):
            for gz in range(int(math.floor((z - r) / c)), int(math.floor((z + r) / c)) + 1):
                for (px, pz, v) in self.g.get((gx, gz), ()):
                    d = math.hypot(px - x, pz - z)
                    if d <= r:
                        out.append((d, v, px, pz))
        out.sort(key=lambda t: t[0])
        return out


# ------------------------------------------------------------------ 面の分類
def kind_of(t):
    if t.get("natural") == "water" or t.get("water") or t.get("leisure") == "swimming_pool" or t.get("amenity") == "fountain" and t.get("natural") == "water":
        return "water"
    if t.get("natural") in ("bare_rock", "scree", "cliff", "stone"):
        return "rock"
    if t.get("natural") in ("sand", "beach"):
        return "sand"
    if t.get("landuse") == "forest" or t.get("natural") in ("wood", "scrub"):
        return "wood"
    if t.get("leisure") in ("garden", "park") or t.get("natural") in ("grassland", "heath") or t.get("landuse") in ("grass", "flowerbed", "meadow"):
        return "green"
    if t.get("highway") in ("pedestrian", "footway") or t.get("area:highway") in ("pedestrian", "footway") or t.get("place") == "square":
        return "plaza"
    if t.get("man_made") in ("pier", "bridge"):
        return "plaza"
    if t.get("amenity") == "parking" or t.get("highway") == "service":
        return "lot"
    if "building" in t or "building:part" in t:
        return "building"
    return None


AREAS = defaultdict(list)
for a in F.areas:
    k = kind_of(a["tags"])
    if not k or not in_park(a["outer"]):
        continue
    if k == "building" and a["tags"].get("building") in ("no",):
        continue
    AREAS[k].append(a)

# ------------------------------------------------------------------ 施設（POI）を集める
RAW = []   # {osm, name, tags, x, z, ring?}
for nid, (la, lo, t) in nodes.items():
    if not t or t.get("natural") == "tree":
        continue
    x, z = P(la, lo)
    if not in_park_pt(x, z):
        continue
    RAW.append({"osm": "n%d" % nid, "name": t.get("name", ""), "tags": t, "x": x, "z": z, "ring": None})
for a in F.areas:
    t = a["tags"]
    if not (t.get("name") or "tourism" in t or "shop" in t or t.get("amenity") in ("toilets", "restaurant", "fast_food")):
        continue
    if not in_park(a["outer"]):
        continue
    x, z = centroid(a["outer"])
    RAW.append({"osm": a["id"], "name": t.get("name", ""), "tags": t, "x": x, "z": z, "ring": a["outer"]})
BY_NAME = defaultdict(list)
for p in RAW:
    if p["name"]:
        BY_NAME[p["name"]].append(p)
BY_OSM = {p["osm"]: p for p in RAW}
for a in F.areas:
    BY_OSM.setdefault(a["id"], {"osm": a["id"], "name": a["tags"].get("name", ""), "tags": a["tags"],
                               "x": centroid(a["outer"])[0], "z": centroid(a["outer"])[1], "ring": a["outer"]})


def find_named(name):
    c = BY_NAME.get(name)
    if not c:
        return None
    # 点を優先（入口の位置に置かれていることが多い）
    c = sorted(c, key=lambda p: (p["ring"] is not None,))
    return c[0]


# ------------------------------------------------------------------ エリア（テーマポート）
ANCH = []
for port in C.PORTS:
    for nm in port["anchors"]:
        p = find_named(nm)
        if not p:
            print("  ! エリアの目印が見つかりません:", port["key"], nm, file=sys.stderr)
            continue
        ANCH.append((p["x"], p["z"], port["key"]))
PORT_BY = {p["key"]: p for p in C.PORTS}


def port_at(x, z):
    for (hx, hz, r, k) in C.PORT_HINTS:
        if math.hypot(x - hx, z - hz) < r:
            return k
    best = min(ANCH, key=lambda a: (a[0] - x) ** 2 + (a[1] - z) ** 2)
    return best[2]


# ------------------------------------------------------------------ 建物
def parse_h(v):
    if v is None:
        return None
    try:
        return float(str(v).replace("m", "").strip())
    except ValueError:
        return None


LM_RING_IDS = set()
for lm in C.LANDMARKS:
    if lm.get("osm"):
        LM_RING_IDS.add(lm["osm"])

BUILDINGS = []
bld_seg = SegGrid(16)      # 経路が建物を突き抜けないか調べる
for a in AREAS["building"]:
    t = a["tags"]
    ring = simplify(a["outer"], 0.25)
    if len(ring) < 3:
        continue
    A = abs(area(ring))
    if A < 4:
        continue
    cx, cz = centroid(ring)
    port = port_at(cx, cz)
    h = parse_h(t.get("height"))
    if h is None and t.get("building:levels"):
        h = float(parse_h(t.get("building:levels")) or 2) * 3.6 + 1.5
    if h is None and t.get("name") in C.HEIGHTS:
        h = C.HEIGHTS[t["name"]]
    roofonly = t.get("building") == "roof"
    if h is None:
        # 面積とエリアから推定（大きな箱は奥のショービル）
        base = {"med": 1.0, "ny": 1.15, "capecod": 0.75, "pd": 0.9, "lrd": 0.85, "arab": 0.9, "mermaid": 0.9, "mi": 0.9, "fs": 1.0}[PORT_BY[port]["style"]]
        if roofonly:
            h = 4.0
        elif A < 25:
            h = 3.6
        elif A < 80:
            h = 5.5
        elif A < 250:
            h = 8.5
        elif A < 800:
            h = 11.5
        elif A < 3000:
            h = 14.0
        else:
            h = 17.0
        # 同じ街並みでも高さがそろいすぎないように
        h = h * base * (0.88 + 0.24 * random.random())
    mh = parse_h(t.get("min_height")) or 0.0
    if roofonly and not mh:
        mh = max(2.6, h - 0.6)
    name = t.get("name", "")
    big = A > 2500   # ショービル（背景の大きな箱）
    rec = {"r": flat(ring), "h": R(h), "p": port, "s": PORT_BY[port]["style"], "a": R(principal_angle(ring), 1000)}
    if mh:
        rec["mh"] = R(mh)
    if roofonly:
        rec["roof"] = 1
    if big:
        rec["big"] = 1
    if name:
        rec["n"] = name
    if a["id"] in LM_RING_IDS:
        rec["lm"] = 1
    rec["id"] = a["id"]
    BUILDINGS.append(rec)
    if not roofonly and not mh:
        bld_seg.add_ring(ring, a["id"])

# 園の外の建物（周りの街並み。おおまかな箱だけ）
CONTEXT = []
for a in F.areas:
    t = a["tags"]
    if "building" not in t or in_park(a["outer"], 20):
        continue
    r = simplify(a["outer"], 1.0)
    A = abs(area(r))
    if A < 60 or len(r) < 3:
        continue
    cx, cz = centroid(r)
    if abs(cx) > 1500 or abs(cz) > 1300:
        continue
    h = parse_h(t.get("height"))
    if h is None and t.get("building:levels"):
        h = float(parse_h(t.get("building:levels")) or 2) * 3.4
    if h is None:
        h = 6 if A < 300 else 10 if A < 3000 else 16
    CONTEXT.append({"r": flat(r, 1), "h": round(min(h, 80), 1)})

# ------------------------------------------------------------------ 水面・岩
water_seg = SegGrid(20)
for a in AREAS["water"]:
    if abs(area(a["outer"])) > 60:
        water_seg.add_ring(a["outer"], a["id"])


def area_rec(a, tol=0.35):
    o = simplify(a["outer"], tol)
    rec = {"o": flat(o)}
    hs = [flat(simplify(h, tol)) for h in a["holes"] if abs(area(h)) > 2]
    if hs:
        rec["h"] = hs
    return rec


GROUND = {}
for k in ("water", "rock", "sand", "wood", "green", "plaza", "lot"):
    GROUND[k] = [area_rec(a) for a in AREAS[k] if abs(area(a["outer"])) > 1.5]

# ------------------------------------------------------------------ 歩行グラフ
KIND = {"WALK": 0, "STAIRS": 1, "BRIDGE": 2}
WALKABLE = {"footway", "pedestrian", "path", "steps", "corridor", "living_street", "track"}

gx, gy, gz = [], [], []
nid_of = {}           # OSM ノード → グラフ番号
edges = {}            # (a,b) → [kind, cost, nameIdx]
NAMES = [""]
name_ix = {"": 0}
node_port = []


def nm_index(s):
    if s not in name_ix:
        name_ix[s] = len(NAMES)
        NAMES.append(s)
    return name_ix[s]


def gnode_osm(r):
    if r in nid_of:
        return nid_of[r]
    x, z = P(*nodes[r][:2])
    i = len(gx)
    gx.append(x); gy.append(0.0); gz.append(z)
    nid_of[r] = i
    return i


def gnode_free(x, z, y=0.0):
    i = len(gx)
    gx.append(x); gy.append(y); gz.append(z)
    return i


def add_edge(a, b, kind=0, cost=1.0, name=""):
    if a == b:
        return
    k = (a, b) if a < b else (b, a)
    if k in edges:
        old = edges[k]
        if kind == 1 and old[0] != 1:
            pass
        else:
            return
    edges[k] = [kind, cost, nm_index(name)]


walk_lines = []
for l in F.lines:
    t = l["tags"]
    h = t.get("highway")
    ok = h in WALKABLE or (h == "service" and t.get("foot") in ("yes", "designated"))
    if not ok:
        continue
    if t.get("access") in ("private", "no") and t.get("foot") not in ("yes", "designated"):
        continue
    if not any(in_park_pt(*p) for p in l["pts"]):
        continue
    if not all(in_park_pt(*p, 30) for p in l["pts"]):
        # 外へ出ていく道は、園内の部分だけ（端は切る）
        pass
    walk_lines.append(l)

bridge_nodes = {}
RIBBONS = []          # 表示用の通路（線）
for l in walk_lines:
    t = l["tags"]
    refs = [r for r in l["refs"] if in_park_pt(*P(*nodes[r][:2]), 30)]
    if len(refs) < 2:
        continue
    is_bridge = t.get("bridge") not in (None, "no") or t.get("man_made") == "bridge"
    kind = KIND["STAIRS"] if t.get("highway") == "steps" else (KIND["BRIDGE"] if is_bridge else KIND["WALK"])
    nm = t.get("name", "") or t.get("bridge:name", "")
    outline = t.get("area") == "yes"
    cost = 1.08 if outline else 1.0
    ids = [gnode_osm(r) for r in refs]
    for a, b in zip(ids, ids[1:]):
        add_edge(a, b, kind, cost, nm)
    if t.get("bridge") and t.get("bridge") != "no" and not outline:
        # 橋はゆるいアーチ（端は地面の高さ）
        pts = [(gx[i], gz[i]) for i in ids]
        L = [0.0]
        for p, q in zip(pts, pts[1:]):
            L.append(L[-1] + math.hypot(q[0] - p[0], q[1] - p[1]))
        tot = L[-1] or 1
        hmax = min(2.4, 0.07 * tot)
        for i, s in zip(ids, L):
            if 0 < s < tot:
                bridge_nodes[i] = max(bridge_nodes.get(i, 0), hmax * math.sin(math.pi * s / tot))
    if not outline:
        w = parse_h(t.get("width")) or {"pedestrian": 5.0, "steps": 3.0, "path": 2.0, "track": 3.0}.get(t.get("highway"), 3.2)
        RIBBONS.append({"p": flat([(gx[i], gz[i]) for i in ids]), "w": R(w), "k": 1 if kind == KIND["STAIRS"] else (2 if t.get("bridge") and t.get("bridge") != "no" else 0)})
for i, y in bridge_nodes.items():
    gy[i] = y

# 広場の中を見通しでつなぐ
plaza_cnt = 0
node_grid = PtGrid(8)
for i in range(len(gx)):
    node_grid.add(gx[i], gz[i], i)


def inside_area(x, z, a):
    if not pip(x, z, a["outer"]):
        return False
    return not any(pip(x, z, h) for h in a["holes"])


def near_area(x, z, a, tol=1.2):
    if inside_area(x, z, a):
        return True
    if dist_to_ring(x, z, a["outer"]) < tol:
        return True
    return any(dist_to_ring(x, z, h) < tol for h in a["holes"])


for a in AREAS["plaza"]:
    o = a["outer"]
    A = abs(area(o))
    if A < 20:
        continue
    xs = [p[0] for p in o]
    zs = [p[1] for p in o]
    seg = SegGrid(12)
    seg.add_ring(o, "o")
    for h in a["holes"]:
        seg.add_ring(h, "h")
    # 候補: 広場の上・縁にある通路の点 ＋ 広場の角（へこんだ角を回り込めるように）
    cand = []
    seen = set()
    cx0, cx1, cz0, cz1 = min(xs) - 2, max(xs) + 2, min(zs) - 2, max(zs) + 2
    for (d, i, px, pz) in node_grid.near((cx0 + cx1) / 2, (cz0 + cz1) / 2, math.hypot(cx1 - cx0, cz1 - cz0) / 2 + 2):
        if gy[i] > 0.3:
            continue
        if near_area(px, pz, a):
            cand.append(i)
            seen.add(i)
    for ring in [o] + a["holes"]:
        rr = simplify(ring, 0.8)
        n = len(rr)
        for j in range(n):
            px, pz = rr[j]
            # 角を少し内側へ（縁の線と交わらないように）
            qa, qb = rr[j - 1], rr[(j + 1) % n]
            vx = (qa[0] - px) / (math.hypot(qa[0] - px, qa[1] - pz) or 1) + (qb[0] - px) / (math.hypot(qb[0] - px, qb[1] - pz) or 1)
            vz = (qa[1] - pz) / (math.hypot(qa[0] - px, qa[1] - pz) or 1) + (qb[1] - pz) / (math.hypot(qb[0] - px, qb[1] - pz) or 1)
            vl = math.hypot(vx, vz)
            if vl < 1e-3:
                continue
            ix, iz = px + vx / vl * 0.9, pz + vz / vl * 0.9
            if not inside_area(ix, iz, a):
                ix, iz = px - vx / vl * 0.9, pz - vz / vl * 0.9
                if not inside_area(ix, iz, a):
                    continue
            # 近くにもう点があれば足さない
            if any(d < 2.5 for (d, *_r) in node_grid.near(ix, iz, 2.5)):
                continue
            i = gnode_free(ix, iz)
            node_grid.add(ix, iz, i)
            cand.append(i)
    if len(cand) < 2:
        continue
    pg = PtGrid(10)
    for i in cand:
        pg.add(gx[i], gz[i], i)
    for i in cand:
        nb = pg.near(gx[i], gz[i], 55)
        cnt = 0
        for (d, j, px, pz) in nb:
            if j == i or d < 0.3:
                continue
            if cnt >= 9:
                break
            k = (i, j) if i < j else (j, i)
            if k in edges:
                cnt += 1
                continue
            a2, b2 = (gx[i], gz[i]), (px, pz)
            mx, mz = (a2[0] + b2[0]) / 2, (a2[1] + b2[1]) / 2
            if not near_area(mx, mz, a, 0.6):
                continue
            if seg.crosses(a2, b2):
                continue
            if bld_seg.crosses(a2, b2) or water_seg.crosses(a2, b2):
                continue
            add_edge(i, j, KIND["WALK"], 1.0, "")
            cnt += 1
            plaza_cnt += 1

# 近すぎる別々の点（同じ場所で線が途切れている）をつなぐ
gap_cnt = 0
deg = defaultdict(int)
for (a, b) in edges:
    deg[a] += 1
    deg[b] += 1
for i in range(len(gx)):
    if deg[i] == 1:   # 行き止まり
        for (d, j, px, pz) in node_grid.near(gx[i], gz[i], 2.2):
            if j != i and (min(i, j), max(i, j)) not in edges and abs(gy[i] - gy[j]) < 0.5:
                if not bld_seg.crosses((gx[i], gz[i]), (px, pz)) and not water_seg.crosses((gx[i], gz[i]), (px, pz)):
                    add_edge(i, j, KIND["WALK"], 1.0, "")
                    gap_cnt += 1
                    break

# いちばん大きなつながりだけ残す
adj = defaultdict(list)
for (a, b) in edges:
    adj[a].append(b)
    adj[b].append(a)
comp = {}
comps = []
for s in range(len(gx)):
    if s in comp or s not in adj:
        continue
    q = [s]
    comp[s] = len(comps)
    k = 0
    while k < len(q):
        for n in adj[q[k]]:
            if n not in comp:
                comp[n] = len(comps)
                q.append(n)
        k += 1
    comps.append(q)
comps.sort(key=len, reverse=True)
main = set(comps[0])
keep = sorted(main)
remap = {o: i for i, o in enumerate(keep)}
NX = [gx[i] for i in keep]
NY = [gy[i] for i in keep]
NZ = [gz[i] for i in keep]
E = []
for (a, b), (kind, cost, ni) in edges.items():
    if a in remap and b in remap:
        E.append((remap[a], remap[b], kind, cost, ni))
osm_of = {v: k for k, v in nid_of.items()}
NPORT = [port_at(NX[i], NZ[i]) for i in range(len(NX))]

final_grid = PtGrid(8)
for i in range(len(NX)):
    final_grid.add(NX[i], NZ[i], i)

# 大きくても街並みの壁にする建物
for b in BUILDINGS:
    if b.get("big") and b.get("n") in C.FACADE:
        del b["big"]

# ------------------------------------------------------------------ 選べる施設
CAT = {"attr": "アトラクション", "show": "ショー・ステージ", "food": "レストラン・フード", "shop": "ショップ",
       "toilet": "トイレ", "service": "サービス", "entrance": "入口"}


def category(p):
    t, n = p["tags"], p["name"]
    if n in C.EXCLUDE:
        return None
    if n in C.ATTRACTIONS:
        return "attr"
    if n in C.SHOWS:
        return "show"
    if t.get("amenity") == "toilets":
        return "toilet"
    if t.get("amenity") in ("restaurant", "fast_food", "cafe", "bar", "ice_cream", "food_court") or t.get("shop") in ("beverages", "confectionery", "pastry"):
        return "food"
    if t.get("shop") and t.get("shop") not in ("ticket", "wedding", "massage"):
        return "shop"
    if t.get("tourism") == "information" and n:
        return "service"
    if t.get("amenity") in ("luggage_locker", "atm"):
        return "service"
    return None


def connect(p):
    """施設を通路につなぐ。建物の中なら、その建物の出入口のそばの通路へ。
    戻り値: (グラフの点, 距離, 表示位置 x, z)"""
    x, z = p["x"], p["z"]
    ring = p["ring"]
    if ring is not None:
        # 建物そのものが施設のとき: 出入口（main を優先）か、建物の縁にいちばん近い通路
        ents = ENTR_BY_B.get(p["osm"], [])
        if ents:
            mains = [e for e in ents if e[2]] or ents
            best = None
            for (ex, ez, _m) in mains:
                for (d, i, px, pz) in final_grid.near(ex, ez, 40):
                    if NY[i] > 0.3 or water_seg.crosses((ex, ez), (px, pz)) or bld_seg.crosses((ex, ez), (px, pz), skip={p["osm"]}):
                        continue
                    if best is None or d < best[1]:
                        best = (i, d, ex, ez)
                    break
            if best:
                return best
        R0 = max(math.hypot(q[0] - x, q[1] - z) for q in ring) + 30
        cands = []
        for (d, i, px, pz) in final_grid.near(x, z, R0):
            if NY[i] > 0.3:
                continue
            dr = dist_to_ring(px, pz, ring)
            if dr < 30 and not pip(px, pz, ring):
                cands.append((dr, i, px, pz))
        cands.sort()
        for (dr, i, px, pz) in cands[:40]:
            # 建物の縁の、その点にいちばん近いところ
            best_q, bd = None, 1e9
            for k in range(len(ring)):
                dd, t, qx, qz = seg_dist(px, pz, *ring[k], *ring[(k + 1) % len(ring)])
                if dd < bd:
                    bd, best_q = dd, (qx, qz)
            if bld_seg.crosses(best_q, (px, pz), skip={p["osm"]}) or water_seg.crosses(best_q, (px, pz)):
                continue
            return i, dr, best_q[0], best_q[1]
    host = None
    if ring is None:
        for b in BLD_RINGS:
            if b[1][0] - 1 <= x <= b[1][2] + 1 and b[1][1] - 1 <= z <= b[1][3] + 1 and pip(x, z, b[0]):
                host = b
                break
    else:
        host = next((b for b in BLD_RINGS if b[2] == p["osm"]), None) or (ring, None, p["osm"])
    skip = {host[2]} if host else None
    if host and abs(area(host[0])) < 2500:
        # 小さな建物は出入口（entrance=* の点）から（大きな建物は建物の中を広場が通っていることがある）
        ents = ENTR_BY_B.get(host[2], [])
        if ents:
            ex, ez, _m = min(ents, key=lambda e: math.hypot(e[0] - x, e[1] - z))
            x, z = ex, ez
    for (d, i, px, pz) in final_grid.near(x, z, 90):
        if NY[i] > 0.3:
            continue
        if bld_seg.crosses((x, z), (px, pz), skip=skip):
            continue
        if water_seg.crosses((x, z), (px, pz)):
            continue
        return i, d, p["x"], p["z"]
    best = final_grid.near(x, z, 200)
    return (best[0][1], best[0][0], p["x"], p["z"]) if best else (None, None, None, None)


BLD_RINGS = []
for a in AREAS["building"]:
    o = a["outer"]
    xs = [q[0] for q in o]
    zs = [q[1] for q in o]
    BLD_RINGS.append((o, (min(xs), min(zs), max(xs), max(zs)), a["id"]))
ENTR_BY_B = defaultdict(list)
for wid, (refs, t) in ways.items():
    if "building" not in t:
        continue
    for r in refs:
        if r in nodes and nodes[r][2].get("entrance"):
            ENTR_BY_B["w%d" % wid].append((*P(*nodes[r][:2]), nodes[r][2].get("entrance") == "main"))

POIS = []
seen_names = set()
items = sorted(RAW, key=lambda p: (p["ring"] is not None, p["osm"]))
for p in items:
    cat = category(p)
    if not cat:
        continue
    nm = p["name"]
    if cat == "attr":
        disp, port = C.ATTRACTIONS[nm]
    elif cat == "show":
        disp, port = C.SHOWS[nm] or nm, port_at(p["x"], p["z"])
    else:
        disp = C.NAME_FIX.get(nm, C.RENAME.get(nm, nm))
        port = port_at(p["x"], p["z"])
    if cat != "toilet" and not disp:
        if cat == "food" and p["tags"].get("amenity") == "ice_cream":
            disp = "アイスクリームワゴン"
        elif cat == "food" and p["tags"].get("shop") == "beverages":
            disp = "ドリンクワゴン"
        elif cat == "service" and p["tags"].get("amenity") == "luggage_locker":
            disp = "コインロッカー"
        else:
            continue
    # 「日本語名 English name」の英語部分は外す（英語名は en に）
    m = re.match(r"^(.*[\u3040-\u30ff\u4e00-\u9fff！？）])\s+[A-Za-z][A-Za-z0-9 '’.&!-]*$", disp or "")
    if m:
        disp = m.group(1)
    key = (cat, disp)
    if cat not in ("toilet",) and disp not in ("ポップコーンワゴン", "アイスクリームワゴン", "ドリンクワゴン", "コインロッカー", "飲料販売機", "ポップコーン") and key in seen_names:
        continue
    seen_names.add(key)
    n, d, px, pz = connect(p)
    if n is None:
        print("  ! 通路につなげない施設:", nm, file=sys.stderr)
        continue
    rec = {"c": cat, "n": disp, "p": port, "x": R(px), "z": R(pz), "g": n, "osm": p["osm"]}
    if p["name"] in C.HOTEL:
        rec["sub"] = C.HOTEL[p["name"]]
    en = p["tags"].get("name:en")
    if en and en != disp:
        rec["en"] = en
    if cat == "food":
        a = p["tags"].get("amenity") or p["tags"].get("shop")
        rec["t"] = {"restaurant": "レストラン", "fast_food": "軽食", "bar": "ラウンジ・バー", "ice_cream": "ワゴン",
                    "beverages": "ワゴン", "confectionery": "ワゴン", "pastry": "軽食", "food_court": "フードコート", "cafe": "カフェ"}.get(a, "")
        if "ワゴン" in disp or "ポップコーン" in disp:
            rec["t"] = "ワゴン"
    if p["tags"].get("toilets:wheelchair") == "yes" or p["tags"].get("wheelchair") == "yes":
        rec["wc"] = 1
    POIS.append(rec)

# 入口
for e in C.ENTRANCES:
    if e["at"] == "toll_booth":
        pts = [P(*nodes[k][:2]) for k, v in nodes.items() if v[2].get("barrier") == "toll_booth" and in_park_pt(*P(*nodes[k][:2]))]
        if not pts:
            continue
        x = sum(p[0] for p in pts) / len(pts)
        z = sum(p[1] for p in pts) / len(pts)
        q = {"x": x, "z": z, "ring": None, "osm": "", "name": e["name"], "tags": {}}
    else:
        q = find_named(e["at"])
        if not q:
            print("  ! 入口が見つかりません:", e, file=sys.stderr)
            continue
        q = dict(q, ring=None)
    n, d, _x, _z = connect(q)
    POIS.append({"c": "entrance", "n": e["name"], "sub": e["sub"], "p": port_at(q["x"], q["z"]), "x": R(q["x"]), "z": R(q["z"]), "g": n, "key": e["key"]})

# 名前の無い施設（トイレ・ワゴン）には近くの目印を添える
named = [p for p in POIS if p["c"] in ("attr", "food", "shop", "show") and p["n"] and "ワゴン" not in p["n"] and "ポップコーン" not in p["n"] and "販売機" not in p["n"]]
for p in POIS:
    if p["c"] == "toilet" or p["n"] in ("ポップコーンワゴン", "アイスクリームワゴン", "ドリンクワゴン", "コインロッカー", "飲料販売機", "ポップコーン"):
        near = min(named, key=lambda q: math.hypot(q["x"] - p["x"], q["z"] - p["z"]))
        d = math.hypot(near["x"] - p["x"], near["z"] - p["z"])
        where = f"{near['n']}{'そば' if d < 25 else '付近'}"
        if p["c"] == "toilet":
            p["n"] = "トイレ"
            p["sub"] = where
        else:
            p["sub"] = where
# 同じ名前が並ぶものは、エリア名でも区別
ports_name = {k["key"]: k["name"] for k in C.PORTS}
for p in POIS:
    p.setdefault("sub", "")
for i, p in enumerate(POIS):
    p["id"] = "%s%d" % (p["c"][0], i)
# 安定したキー（URL 共有用）
for p in POIS:
    if p["c"] == "entrance":
        p["id"] = "e:" + p.pop("key")
    elif p["c"] in ("attr", "show"):
        p["id"] = p["c"][0] + ":" + p["n"]
    else:
        p["id"] = p["c"][0] + ":" + (p.get("osm") or p["id"])
for p in POIS:
    p.pop("osm", None)

# ------------------------------------------------------------------ 表示用のその他
TREES = []
# 個別の木
for nid, (la, lo, t) in nodes.items():
    if t.get("natural") == "tree":
        x, z = P(la, lo)
        if in_park_pt(x, z):
            TREES.append([R(x), R(z), round(0.8 + 0.5 * random.random(), 2)])
# 林・植え込みの中に木を散らす
for a in AREAS["wood"] + AREAS["green"]:
    o = a["outer"]
    A = abs(area(o))
    dens = 1 / 45.0 if a in AREAS["wood"] else 1 / 160.0
    n = int(A * dens)
    if n <= 0:
        continue
    xs = [p[0] for p in o]
    zs = [p[1] for p in o]
    tries = 0
    k = 0
    while k < n and tries < n * 6:
        tries += 1
        x = random.uniform(min(xs), max(xs))
        z = random.uniform(min(zs), max(zs))
        if not inside_area(x, z, a):
            continue
        if bld_seg.crosses((x - 1.2, z), (x + 1.2, z)):
            continue
        TREES.append([R(x), R(z), round(0.6 + 0.6 * random.random(), 2)])
        k += 1
# 木の種類はエリアで変える
for t in TREES:
    t.append(port_at(t[0], t[1]))

LINES = defaultdict(list)
for l in F.lines:
    t = l["tags"]
    if not any(in_park_pt(*p) for p in l["pts"]):
        continue
    b = t.get("barrier")
    if b in ("wall", "retaining_wall", "city_wall"):
        LINES["wall"].append(flat(l["pts"]))
    elif b in ("fence", "railing", "handrail", "guard_rail"):
        LINES["fence"].append(flat(l["pts"]))
    elif b == "hedge":
        LINES["hedge"].append(flat(l["pts"]))
    elif t.get("railway") in ("narrow_gauge", "monorail", "light_rail"):
        lay = parse_h(t.get("layer")) or 0
        LINES["rail" if t.get("railway") != "monorail" else "mono"].append({"p": flat(l["pts"]), "y": 7.5 if lay >= 1 else 0})
    elif t.get("waterway") in ("river", "canal", "stream", "ditch"):
        LINES["canal"].append({"p": flat(l["pts"]), "w": parse_h(t.get("width")) or 5})
    elif t.get("natural") == "cliff":
        LINES["cliff"].append(flat(l["pts"]))

# 海（東京湾）: 海岸線（natural=coastline。陸が左側）をつないで、南西側を海の多角形にする
SEA = None
coast = [ways[k][0] for k, (refs, t) in ways.items() if t.get("natural") == "coastline" and all(r in nodes for r in refs)]
chains = [list(c) for c in coast]
changed = True
while changed:
    changed = False
    for i in range(len(chains)):
        for j in range(len(chains)):
            if i != j and chains[i] and chains[j] and chains[i][-1] == chains[j][0]:
                chains[i] = chains[i] + chains[j][1:]
                chains[j] = []
                changed = True
    chains = [c for c in chains if c]
best, bestd = None, 1e18
for c in chains:
    pts = [P(*nodes[r][:2]) for r in c]
    # 窓の中で途切れずに続く区間に分け、いちばん園に近い区間を使う
    runs, cur = [], []
    for p in pts:
        if abs(p[0]) < 2600 and abs(p[1]) < 2600:
            cur.append(p)
        else:
            if len(cur) > 3:
                runs.append(cur)
            cur = []
    if len(cur) > 3:
        runs.append(cur)
    for run in runs:
        dmin = min(math.hypot(*p) for p in run)
        if dmin < bestd:
            best, bestd = run, dmin
if best:
    W = 4000
    sea = best + [(best[-1][0], W), (-W, W), (-W, best[0][1])]
    if area(sea) < 0:
        sea = sea[::-1]
    SEA = flat(simplify(sea, 2.0), 1)

# ランドマークの位置
LMS = []
for lm in C.LANDMARKS:
    x = z = None
    ring = None
    if lm.get("osm") and lm["osm"] in BY_OSM:
        q = BY_OSM[lm["osm"]]
        x, z, ring = q["x"], q["z"], q["ring"]
    elif lm.get("at_poi"):
        q = find_named(lm["at_poi"])
        if q:
            x, z = q["x"], q["z"]
    elif lm.get("at"):
        x, z = lm["at"]
    if x is None:
        print("  ! ランドマークが見つかりません:", lm["name"], file=sys.stderr)
        continue
    rec = {"k": lm["kind"], "n": lm["name"], "x": R(x), "z": R(z), "h": lm["h"]}
    if lm.get("r"):
        rec["r"] = lm["r"]
    if ring:
        rec["a"] = R(principal_angle(ring), 1000)
        rec["ring"] = flat(simplify(ring, 0.3))
        src = next((a for a in F.areas if a["id"] == lm.get("osm")), None)
        if src and src["holes"]:
            rec["holes"] = [flat(simplify(h, 0.3)) for h in src["holes"] if abs(area(h)) > 20]
    if lm.get("peak_poi"):
        q = find_named(lm["peak_poi"])
        if q:
            rec["px"], rec["pz"] = R(q["x"]), R(q["z"])
    LMS.append(rec)

# エリア名のラベル位置（目印の重心）
PLAB = []
for port in C.PORTS:
    pts = [(a[0], a[1]) for a in ANCH if a[2] == port["key"]]
    if not pts:
        continue
    lx, lz = port.get("label") or (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
    PLAB.append({"k": port["key"], "n": port["name"], "en": port["en"], "c": port["color"], "s": port["style"], "x": R(lx), "z": R(lz)})

# ------------------------------------------------------------------ 書き出し
nodes_out = []
for i in range(len(NX)):
    nodes_out += [R(NX[i]), R(NY[i], 100), R(NZ[i])]
edges_out = []
cost_out = []
ename = []
for (a, b, kind, cost, ni) in E:
    edges_out += [a, b, kind]
    cost_out.append(round(cost, 2))
    ename.append(ni)
PORT_IX = {p["key"]: i for i, p in enumerate(C.PORTS)}
ts_file = ROOT / "data/raw/timestamp.txt"
ts = ts_file.read_text().strip() if ts_file.exists() else ""
out = {
    "meta": {"title": "東京ディズニーシー", "origin": list(C.ORIGIN), "osm_timestamp": ts},
    "park": flat(simplify(PARK, 0.5)),
    "sea": SEA,
    "ports": [{"key": p["key"], "name": p["name"], "en": p["en"], "color": p["color"], "style": p["style"], "parent": p.get("parent")} for p in C.PORTS],
    "portLabels": PLAB,
    "cats": CAT,
    "pois": POIS,
    "presets": C.PRESETS,
    "nodes": nodes_out,
    "nodePort": [PORT_IX[k] for k in NPORT],
    "edges": edges_out,
    "cost": cost_out,
    "ename": ename,
    "names": NAMES,
    "ground": GROUND,
    "ribbons": RIBBONS,
    "buildings": BUILDINGS,
    "context": CONTEXT,
    "landmarks": LMS,
    "trees": TREES,
    "lines": LINES,
}
(ROOT / "data").mkdir(exist_ok=True)
js = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
(ROOT / "data/park.json").write_text(js)

if REPORT:
    from collections import Counter
    print(f"park.json {len(js) / 1e6:.2f} MB")
    print(f"歩行グラフ: 点 {len(NX)}  辺 {len(E)}（広場の見通し {plaza_cnt}・途切れ補修 {gap_cnt}）  つながり {len(comps)} 個（最大 {len(comps[0])}, 次 {[len(c) for c in comps[1:6]]}）")
    print(f"建物 {len(BUILDINGS)}（園の外 {len(CONTEXT)}）  木 {len(TREES)}  通路 {len(RIBBONS)}  ランドマーク {len(LMS)}")
    print("面:", {k: len(v) for k, v in GROUND.items()})
    print("施設:", dict(Counter(p["c"] for p in POIS)))
    found = {p["n"] for p in POIS if p["c"] == "attr"}
    miss = [v[0] for v in C.ATTRACTIONS.values() if v[0] not in found]
    if miss:
        print("  ! 見つからないアトラクション:", miss)
    lost = [c for c in comps[1:] if len(c) > 15]
    for c in lost[:12]:
        xs = [gx[i] for i in c]
        zs = [gz[i] for i in c]
        print(f"  離れた通路: {len(c)} 点 付近 ({sum(xs) / len(xs):.0f},{sum(zs) / len(zs):.0f})")
