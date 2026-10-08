"""OSM の面（way・マルチポリゴン）と線を、園内の表示用データにまとめる"""
from osm import join_rings, area, centroid, pip, dist_to_ring


class Features:
    def __init__(self, nodes, ways, rels, proj):
        self.nodes, self.ways, self.rels, self.P = nodes, ways, rels, proj
        self.areas = []   # {id, tags, outer:[(x,z)...], holes:[[...]]}
        self.lines = []   # {id, tags, pts:[(x,z)...], refs}
        used_as_member = set()
        for rid, (mem, t) in rels.items():
            if t.get("type") != "multipolygon":
                continue
            outers = [ways[r][0] for (ty, r, role) in mem if ty == "way" and r in ways and role in ("outer", "")]
            inners = [ways[r][0] for (ty, r, role) in mem if ty == "way" and r in ways and role == "inner"]
            for (ty, r, role) in mem:
                if ty == "way" and r in ways and not (set(ways[r][1]) - {"source", "note"}):
                    used_as_member.add(r)
            orings = [self.xz_ring(r) for r in join_rings(outers)]
            irings = [self.xz_ring(r) for r in join_rings(inners)]
            orings = [r for r in orings if r]
            irings = [r for r in irings if r]
            for o in orings:
                hs = [h for h in irings if pip(*h[0], o)]
                self.areas.append({"id": "r%d" % rid, "tags": t, "outer": o, "holes": hs})
        for wid, (refs, t) in ways.items():
            if not t:
                continue
            if not all(r in nodes for r in refs):
                continue
            closed = len(refs) >= 4 and refs[0] == refs[-1]
            is_area = closed and (t.get("area") == "yes" or any(k in t for k in (
                "building", "building:part", "natural", "landuse", "leisure", "amenity", "water", "area:highway", "man_made", "tourism")))
            if t.get("highway") and t.get("area") != "yes":
                is_area = False
            if t.get("barrier") and not any(k in t for k in ("building", "natural", "landuse", "leisure", "amenity", "water", "tourism", "attraction")):
                is_area = False
            if t.get("natural") in ("coastline", "tree_row", "cliff") or t.get("waterway"):
                is_area = False
            if is_area:
                r = self.xz_ring(refs)
                if r:
                    self.areas.append({"id": "w%d" % wid, "tags": t, "outer": r, "holes": []})
            if not is_area or t.get("highway"):
                self.lines.append({"id": wid, "tags": t, "refs": refs, "pts": [self.P(*nodes[r][:2]) for r in refs]})

    def xz_ring(self, refs):
        if not all(r in self.nodes for r in refs):
            return None
        pts = [self.P(*self.nodes[r][:2]) for r in refs]
        if pts[0] == pts[-1]:
            pts = pts[:-1]
        if len(pts) < 3 or abs(area(pts)) < 0.5:
            return None
        if area(pts) < 0:   # 向きをそろえる（反時計回り = x→z で正）
            pts = pts[::-1]
        return pts


def in_park(ring, park, margin=0.0):
    c = centroid(ring)
    if pip(*c, park):
        return True
    return margin > 0 and dist_to_ring(*c, park) < margin
