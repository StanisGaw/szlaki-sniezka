#!/usr/bin/env python3
"""Łączy relacje i geometrie z Overpass API w trails.json używany przez aplikację."""
import json
import math
import sys
from datetime import date

SUMMIT = (50.73611, 15.73972)
MAX_DIST_KM = 6.0
COLORS = {"red", "blue", "green", "yellow", "black", "white"}


def dist_km(a, b):
    r = 6371.0
    dlat = math.radians(b[0] - a[0])
    dlon = math.radians(b[1] - a[1])
    h = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(a[0])) * math.cos(math.radians(b[0])) * math.sin(dlon / 2) ** 2)
    return 2 * r * math.asin(math.sqrt(h))


def color_of(tags):
    symbol = tags.get("osmc:symbol", "")
    if symbol:
        head = symbol.split(":")[0]
        if head in COLORS:
            return head
    for key in tags:
        if key.startswith("kct_") and key.split("_", 1)[1] in COLORS:
            return key.split("_", 1)[1]
    return "other"


def main(rels_path, ways_path, out_path):
    rels = json.load(open(rels_path, encoding="utf-8"))["elements"]
    ways = {e["id"]: e for e in json.load(open(ways_path, encoding="utf-8"))["elements"]
            if e["type"] == "way" and "geometry" in e}

    trails = []
    for rel in rels:
        tags = rel.get("tags", {})
        segments = []
        for member in rel.get("members", []):
            if member["type"] != "way":
                continue
            way = ways.get(member["ref"])
            if way:
                segments.append([[round(p["lat"], 5), round(p["lon"], 5)] for p in way["geometry"]])
        if not segments:
            continue

        points = [p for seg in segments for p in seg]
        to_summit = min(dist_km(SUMMIT, p) for p in points)
        if to_summit > MAX_DIST_KM:
            continue

        length = sum(dist_km(seg[i], seg[i + 1]) for seg in segments for i in range(len(seg) - 1))
        trails.append({
            "id": rel["id"],
            "name": tags.get("name:pl") or tags.get("name") or f"Szlak {rel['id']}",
            "nameOrig": tags.get("name", ""),
            "color": color_of(tags),
            "from": tags.get("from", ""),
            "to": tags.get("to", ""),
            "network": tags.get("network", ""),
            "distanceKm": round(length, 1),
            "distToSummitKm": round(to_summit, 2),
            "osmcSymbol": tags.get("osmc:symbol", ""),
            "segments": segments,
        })

    trails.sort(key=lambda t: (t["distToSummitKm"], t["name"]))
    payload = {
        "summit": {"lat": SUMMIT[0], "lon": SUMMIT[1]},
        "generated": date.today().isoformat(),
        "source": "OpenStreetMap via Overpass API (ODbL)",
        "trails": trails,
    }
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"zapisano {len(trails)} szlaków do {out_path}")


if __name__ == "__main__":
    main(*sys.argv[1:4])
