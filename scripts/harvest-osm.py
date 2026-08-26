import json, sys, urllib.request, time

CENTER = (25.16, 55.24)
RADIUS = 30000
ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]

QUERY = f"""[out:json][timeout:280];
(
  nwr[shop][name](around:{RADIUS},{CENTER[0]},{CENTER[1]});
  nwr[amenity~"^(restaurant|cafe|fast_food|bar|pub|food_court|ice_cream|biergarten|nightclub|pharmacy|clinic|doctors|dentist|hospital|veterinary|bank|atm|bureau_de_change|fuel|car_wash|car_rental|driving_school|cinema|theatre|casino|library|school|university|college|kindergarten|language_school|marketplace|post_office|coworking_space|spa|gym|arts_centre|community_centre)$"][name](around:{RADIUS},{CENTER[0]},{CENTER[1]});
  nwr[leisure~"^(fitness_centre|sports_centre|swimming_pool|golf_course|bowling_alley|water_park|marina|park|garden|dance|escape_game|spa)$"][name](around:{RADIUS},{CENTER[0]},{CENTER[1]});
  nwr[healthcare][name](around:{RADIUS},{CENTER[0]},{CENTER[1]});
  nwr[office][name](around:{RADIUS},{CENTER[0]},{CENTER[1]});
  nwr[tourism~"^(hotel|hostel|guest_house|motel|apartment|attraction|museum|gallery|theme_park|zoo|aquarium)$"][name](around:{RADIUS},{CENTER[0]},{CENTER[1]});
);
out center tags;"""

KEEP = {
    "name","name:en","name:ar","amenity","shop","leisure","healthcare","office","tourism",
    "cuisine","opening_hours","phone","contact:phone","mobile","website","contact:website",
    "addr:street","addr:housenumber","addr:city","addr:suburb","addr:place",
    "brand","operator","stars","wheelchair","internet_access","outdoor_seating",
    "takeaway","delivery","drive_through","air_conditioning","smoking","wifi","self_service",
}

def fetch():
    last = None
    for url in ENDPOINTS:
        for attempt in range(3):
            try:
                sys.stderr.write(f"POST {url} attempt {attempt+1}\n"); sys.stderr.flush()
                req = urllib.request.Request(url, data=QUERY.encode("utf-8"),
                                             headers={"Content-Type":"text/plain",
                                                      "User-Agent":"BuisnessFindDubai/1.0 (harvest script)"})
                with urllib.request.urlopen(req, timeout=300) as r:
                    return json.loads(r.read().decode("utf-8"))
            except Exception as e:
                last = e
                sys.stderr.write(f"  failed: {e}\n"); sys.stderr.flush()
                time.sleep(8)
    raise SystemExit(f"all endpoints failed: {last}")

data = fetch()
out = []
seen = set()
for el in data.get("elements", []):
    t = el.get("tags") or {}
    if not t.get("name"):
        continue
    lat = el.get("lat"); lon = el.get("lon")
    if lat is None or lon is None:
        c = el.get("center") or {}
        lat = c.get("lat"); lon = c.get("lon")
    if lat is None or lon is None:
        continue
    key = (round(lat, 6), round(lon, 6), t["name"])
    if key in seen:
        continue
    seen.add(key)
    out.append({
        "i": f"{el['type'][0]}{el['id']}",
        "a": round(float(lat), 6),
        "o": round(float(lon), 6),
        "t": {k: v for k, v in t.items() if k in KEEP},
    })

out.sort(key=lambda r: r["t"]["name"])
path = sys.argv[1]
with open(path, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
sys.stderr.write(f"wrote {len(out)} records -> {path}\n")
