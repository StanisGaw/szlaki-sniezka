#!/usr/bin/env bash
# Pobiera szlaki piesze wokół Śnieżki z Overpass API i zapisuje je do trails.json.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

BBOX="50.68,15.63,50.78,15.82"
UA="szlaki-sniezka/1.0"

curl -sS -A "$UA" --data-binary "[out:json][timeout:300];(relation[\"route\"=\"hiking\"]($BBOX););out body;" \
	https://overpass-api.de/api/interpreter -o "$TMP/rels.json"

curl -sS -A "$UA" --data-binary "[out:json][timeout:300];rel[\"route\"=\"hiking\"]($BBOX)->.r;way(r.r);out geom;" \
	https://overpass-api.de/api/interpreter -o "$TMP/ways.json"

python3 "$ROOT/scripts/build_trails.py" "$TMP/rels.json" "$TMP/ways.json" "$ROOT/trails.json"
