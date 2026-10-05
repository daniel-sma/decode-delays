"""Decode Delays data pipeline.

Downloads (or reads) one month of BTS Reporting Carrier On-Time Performance data
plus hourly ASOS/METAR weather from the Iowa Environmental Mesonet, traces every
"Late Aircraft" minute back up its tail-number chain to the flight where the
delay actually started, and writes compact JSON for the web app to public/data/.

Usage:
    python pipeline/build_data.py                          # July 2026, the 6 most disrupted days
    python pipeline/build_data.py --days 2026-07-06,2026-07-07
    python pipeline/build_data.py --zip ~/Downloads/On_Time_...2026_7.zip
    python pipeline/build_data.py --synthetic              # offline fixture, NOT real data
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import sys
import time
import urllib.request
import zipfile
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import airportsdata

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "raw"
OUT = ROOT / "public" / "data"

BTS_URL = (
    "https://transtats.bts.gov/PREZIP/"
    "On_Time_Reporting_Carrier_On_Time_Performance_1987_present_{year}_{month}.zip"
)
IEM_URL = "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py"

# The app's clock. The story is a Northeast storm day, so hours are Eastern.
DISPLAY_TZ = ZoneInfo("America/New_York")
HOURS = 30  # midnight ET through 6am next day, so late western arrivals still land on the timeline

# Decoded root-cause categories (order is the app's legend order)
CATS = ["weather", "airspace", "airline", "security", "untraced"]
REPORTED = ["carrier", "weather", "nas", "security", "late"]

WX_AIRPORTS = 45  # fetch weather for the busiest N airports
EXPORT_DAYS = 6  # day files to write when --days isn't given
MAX_TURN_GAP_MIN = 16 * 60  # longer than this between legs = not the same rotation


# --------------------------------------------------------------------------- loading


def fetch(url: str, dest: Path) -> Path:
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"  downloading {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "decode-delays/1.0"})
    with urllib.request.urlopen(req, timeout=300) as r, open(dest, "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    return dest


def read_bts(zip_path: Path):
    with zipfile.ZipFile(zip_path) as z:
        name = next(n for n in z.namelist() if n.lower().endswith(".csv"))
        with z.open(name) as f:
            yield from csv.DictReader(io.TextIOWrapper(f, encoding="latin-1"))


def num(v: str | None) -> float | None:
    if v is None or v.strip() == "":
        return None
    return float(v)


def hhmm(v: str) -> tuple[int, int]:
    v = v.strip().split(".")[0].zfill(4)
    h, m = int(v[:2]), int(v[2:])
    return (0, m) if h == 24 else (h, m)  # BTS uses 2400 for midnight


# --------------------------------------------------------------------------- weather


def fetch_weather(stations: list[str], start: date, end: date) -> dict:
    """Hourly flags per station: {lid: {utc_hour_epoch: {ts, ifr, gust, metar}}}."""
    wx: dict[str, dict[int, dict]] = {}
    for lid in stations:
        dest = RAW / f"asos_{lid}_{start:%Y%m}.csv"
        params = [("station", lid), ("tz", "Etc/UTC"), ("format", "onlycomma"),
                  ("latlon", "no"), ("missing", "M"), ("trace", "T"), ("direct", "no"),
                  ("report_type", "3"), ("report_type", "4"),
                  ("year1", start.year), ("month1", start.month), ("day1", start.day),
                  ("year2", end.year), ("month2", end.month), ("day2", end.day)]
        for d in ["vsby", "skyc1", "skyl1", "skyc2", "skyl2", "skyc3", "skyl3", "gust", "wxcodes", "metar"]:
            params.append(("data", d))
        url = IEM_URL + "?" + "&".join(f"{k}={v}" for k, v in params)
        try:
            fetch(url, dest)
            time.sleep(0.5)  # IEM asks for polite request rates
        except Exception as e:  # weather is evidence, not a hard dependency
            print(f"  ! weather for {lid} unavailable: {e}")
            continue
        wx[lid] = parse_asos(dest)
    return wx


def parse_asos(path: Path) -> dict[int, dict]:
    hours: dict[int, dict] = {}
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            try:
                t = datetime.strptime(row["valid"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
            except (KeyError, ValueError):
                continue
            # A METAR at :51 describes the coming hour as well as the past one; bin to nearest hour.
            hour = int((t + timedelta(minutes=30)).timestamp() // 3600)
            wxc = row.get("wxcodes", "M")
            ts = "TS" in wxc
            vis = _f(row.get("vsby"))
            ceil = min((_f(row.get(f"skyl{i}")) or 99999
                        for i in (1, 2, 3) if row.get(f"skyc{i}") in ("BKN", "OVC", "VV")), default=99999)
            ifr = (vis is not None and vis < 3) or ceil < 1000
            gust = _f(row.get("gust")) or 0
            h = hours.setdefault(hour, {"ts": False, "ifr": False, "gust": 0, "metar": ""})
            h["ts"] |= ts
            h["ifr"] |= ifr
            h["gust"] = max(h["gust"], gust)
            if ts or ifr or not h["metar"]:
                h["metar"] = row.get("metar", "")
    return hours


def _f(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def adverse(h: dict | None) -> bool:
    return bool(h and (h["ts"] or h["ifr"] or h["gust"] >= 35))


# --------------------------------------------------------------------------- decode


def build(rows, wx_fetcher, days_arg: str | None, synthetic: bool, source: str, carrier: str | None = None):
    airports = airportsdata.load("IATA")
    tzcache: dict[str, ZoneInfo] = {}

    def tz(code):
        if code not in tzcache:
            tzcache[code] = ZoneInfo(airports[code]["tz"]) if code in airports else DISPLAY_TZ
        return tzcache[code]

    print("Parsing flights…")
    F = []  # list of flight dicts
    skipped_tz = set()
    for r in rows:
        if carrier and r["Reporting_Airline"] != carrier:
            continue
        o, d = r["Origin"], r["Dest"]
        if o not in airports or d not in airports:
            skipped_tz.add(o if o not in airports else d)
        fd = date.fromisoformat(r["FlightDate"])
        h, m = hhmm(r["CRSDepTime"])
        sdep = datetime(fd.year, fd.month, fd.day, h, m, tzinfo=tz(o))
        sdep_utc = int(sdep.timestamp() // 60)
        elapsed = num(r.get("CRSElapsedTime")) or 0
        cancelled = r["Cancelled"].startswith("1")
        diverted = r["Diverted"].startswith("1")
        dep_delay = num(r["DepDelay"])
        arr_delay = num(r["ArrDelay"])
        causes = {k: num(r[c]) for k, c in [("carrier", "CarrierDelay"), ("weather", "WeatherDelay"),
                                             ("nas", "NASDelay"), ("security", "SecurityDelay"),
                                             ("late", "LateAircraftDelay")]}
        has_causes = all(v is not None for v in causes.values())
        F.append({
            "date": r["FlightDate"],
            "carrier": r["Reporting_Airline"],
            "fn": r["Flight_Number_Reporting_Airline"],
            "tail": r["Tail_Number"].strip(),
            "o": o, "d": d,
            "sdep": sdep_utc,
            "sarr": sdep_utc + int(elapsed),
            "dep_delay": dep_delay,
            "arr_delay": arr_delay,
            "cancelled": cancelled,
            "ccode": r.get("CancellationCode", "").strip(),
            "diverted": diverted,
            "causes": {k: int(v) for k, v in causes.items()} if has_causes else None,
        })
    if skipped_tz:
        print(f"  ! {len(skipped_tz)} airport codes missing from airportsdata (using ET): {sorted(skipped_tz)[:10]}")
    print(f"  {len(F):,} flights")

    # Weather for the busiest airports, over the month's span.
    counts = defaultdict(int)
    for f in F:
        counts[f["o"]] += 1
    busiest = sorted(counts, key=counts.get, reverse=True)[:WX_AIRPORTS]
    dates = sorted({f["date"] for f in F})
    d0, d1 = date.fromisoformat(dates[0]) - timedelta(days=1), date.fromisoformat(dates[-1]) + timedelta(days=2)
    print(f"Weather for {len(busiest)} airports…")
    lid_of = {c: (airports[c].get("lid") or c) for c in busiest if c in airports}
    wx_by_lid = wx_fetcher(list(lid_of.values()), d0, d1)
    wx = {c: wx_by_lid.get(lid_of.get(c, c)) for c in busiest}

    def wx_at(code, minute_utc):
        w = wx.get(code)
        if w is None:
            return None
        hr = minute_utc // 60
        hs = [w.get(hr + k) for k in (-1, 0, 1)]
        hs = [x for x in hs if x]
        if not hs:
            return None
        return {"ts": any(x["ts"] for x in hs), "ifr": any(x["ifr"] for x in hs),
                "gust": max(x["gust"] for x in hs)}

    def locate(f):
        """Where did this flight's own weather/NAS delay most plausibly happen?

        Returns (airport, minute_utc, weather_evidence, confidence)."""
        arr_t = f["sarr"] + int(f["arr_delay"] or 0)
        dep_t = f["sdep"] + int(f["dep_delay"] or 0)
        dw, ow = wx_at(f["d"], f["sarr"]) or wx_at(f["d"], arr_t), wx_at(f["o"], dep_t)
        if adverse(dw):
            return f["d"], arr_t, True, "high"
        if adverse(ow):
            return f["o"], dep_t, True, "high"
        known = dw is not None and ow is not None
        # No storm on either end: NAS delay is usually arrival-side flow control.
        return f["d"], arr_t, False, "high" if known else "low"

    print("Tracing tail-number chains…")
    by_tail = defaultdict(list)
    for i, f in enumerate(F):
        if f["tail"] and not f["cancelled"]:
            by_tail[f["tail"]].append(i)
    prev = [None] * len(F)
    for idxs in by_tail.values():
        idxs.sort(key=lambda i: F[i]["sdep"])
        for a, b in zip(idxs, idxs[1:]):
            gap = F[b]["sdep"] - F[a]["sarr"]
            if F[a]["d"] == F[b]["o"] and -60 <= gap <= MAX_TURN_GAP_MIN and not F[a]["diverted"]:
                prev[b] = a

    # contributions: {(cat, airport, root_flight, minute_utc, hops): minutes}
    order = sorted(range(len(F)), key=lambda i: F[i]["sdep"])
    contrib: list[dict | None] = [None] * len(F)
    stats = {"late_total": 0, "late_traced": 0, "chain_breaks": 0}
    for i in order:
        f = F[i]
        c = f["causes"]
        if c is None or f["cancelled"] or f["diverted"]:
            continue
        out = defaultdict(float)
        if c["carrier"]:
            out[("airline", f["o"], i, f["sdep"] + int(f["dep_delay"] or 0), 0)] += c["carrier"]
        if c["security"]:
            out[("security", f["o"], i, f["sdep"] + int(f["dep_delay"] or 0), 0)] += c["security"]
        if c["weather"] or c["nas"]:
            ap, t, storm, _ = locate(f)
            if c["weather"]:
                out[("weather", ap, i, t, 0)] += c["weather"]
            if c["nas"]:
                out[("weather" if storm else "airspace", ap, i, t, 0)] += c["nas"]
        L = c["late"]
        if L:
            stats["late_total"] += L
            p = prev[i]
            pc = contrib[p] if p is not None else None
            pa = F[p]["arr_delay"] if p is not None else None
            if pc and pa and pa > 0:
                traced = min(L, pa)
                scale = traced / sum(pc.values())
                for (cat, ap, root, t, hops), mins in pc.items():
                    out[(cat, ap, root, t, hops + 1)] += mins * scale
                stats["late_traced"] += traced
                if L > traced:
                    out[("untraced", f["o"], i, f["sdep"], 0)] += L - traced
            else:
                stats["chain_breaks"] += 1
                out[("untraced", f["o"], i, f["sdep"], 0)] += L
        contrib[i] = dict(out)
    pct = 100 * stats["late_traced"] / max(1, stats["late_total"])
    print(f"  traced {pct:.1f}% of Late Aircraft minutes to a root cause")

    # ----------------------------------------------------------------------- month summary
    day_rows = defaultdict(lambda: {"flights": 0, "delayed": 0, "cancelled": 0,
                                    "reported": dict.fromkeys(REPORTED, 0),
                                    "decoded": dict.fromkeys(CATS, 0.0)})
    for i, f in enumerate(F):
        s = day_rows[f["date"]]
        s["flights"] += 1
        s["cancelled"] += f["cancelled"]
        if f["arr_delay"] is not None and f["arr_delay"] >= 15:
            s["delayed"] += 1
        if f["causes"]:
            for k in REPORTED:
                s["reported"][k] += f["causes"][k]
        for (cat, *_), mins in (contrib[i] or {}).items():
            s["decoded"][cat] += mins

    if days_arg:
        days = [d.strip() for d in days_arg.split(",")]
    else:
        # The most disrupted days of the month (cancellations weigh 3x a delay), in date order.
        score = lambda d: day_rows[d]["delayed"] + 3 * day_rows[d]["cancelled"]  # noqa: E731
        days = sorted(sorted(day_rows, key=score, reverse=True)[:EXPORT_DAYS])
    print(f"Writing days: {', '.join(days)}")

    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("day-*.json"):
        old.unlink()
    for day in days:
        write_day(day, F, contrib, prev, airports, wx, locate)

    summary = {
        "synthetic": synthetic,
        "source": source,
        "carrier": carrier,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "month": dates[0][:7],
        "categories": CATS,
        "reportedCategories": REPORTED,
        "displayTz": "America/New_York",
        "availableDays": days,
        "trace": {"lateMinutes": stats["late_total"], "lateTraced": round(stats["late_traced"]),
                  "chainBreaks": stats["chain_breaks"]},
        "stats": {"flights": len(F), "tails": len(by_tail), "wxAirports": sum(1 for w in wx.values() if w)},
        "days": [{"date": d, **_round(v)} for d, v in sorted(day_rows.items())],
    }
    (OUT / "summary.json").write_text(json.dumps(summary, separators=(",", ":")))
    print(f"Done → {OUT}")


def _round(v):
    return {**v, "decoded": {k: round(x) for k, x in v["decoded"].items()}}


def write_day(day, F, contrib, prev, airports, wx, locate):
    d = date.fromisoformat(day)
    day_start = int(datetime(d.year, d.month, d.day, tzinfo=DISPLAY_TZ).timestamp() // 60)

    def hour(minute_utc):
        return max(0, min(HOURS - 1, (minute_utc - day_start) // 60))

    ids = [i for i, f in enumerate(F) if f["date"] == day]
    # Pull in root flights from the previous evening so every chain can be shown.
    extra = set()
    for i in ids:
        for (_, _, root, *_r) in (contrib[i] or {}):
            if F[root]["date"] != day:
                extra.add(root)
        p = prev[i]
        if p is not None and F[p]["date"] != day:
            extra.add(p)
    ids = ids + sorted(extra)
    local = {g: k for k, g in enumerate(ids)}

    ap_codes = sorted({F[i]["o"] for i in ids} | {F[i]["d"] for i in ids})
    ap_index = {c: k for k, c in enumerate(ap_codes)}
    Z = lambda: [0] * HOURS  # noqa: E731
    ap_stats = {c: {"deps": Z(), "delayedDeps": Z(), "cancelled": Z(),
                    "felt": {k: Z() for k in CATS}, "origin": {k: Z() for k in CATS},
                    "exported": Z()} for c in ap_codes}
    reported = dict.fromkeys(REPORTED, 0)
    decoded = dict.fromkeys(CATS, 0.0)
    cancel_codes = defaultdict(int)
    arcs = defaultdict(lambda: {"minutes": 0.0, "flights": []})

    cols = {k: [] for k in ["carrier", "fn", "tail", "o", "d", "sdep", "sarr", "depDelay", "arrDelay",
                            "status", "causes", "decoded", "prev", "otherDay"]}
    for g in ids:
        f = F[g]
        k = local[g]
        today = f["date"] == day
        cols["carrier"].append(f["carrier"])
        cols["fn"].append(f["fn"])
        cols["tail"].append(f["tail"])
        cols["o"].append(ap_index[f["o"]])
        cols["d"].append(ap_index[f["d"]])
        cols["sdep"].append(f["sdep"] - day_start)
        cols["sarr"].append(f["sarr"] - day_start)
        cols["depDelay"].append(None if f["dep_delay"] is None else int(f["dep_delay"]))
        cols["arrDelay"].append(None if f["arr_delay"] is None else int(f["arr_delay"]))
        cols["status"].append("C" + (f["ccode"] or "?") if f["cancelled"] else "D" if f["diverted"] else "")
        cols["causes"].append([f["causes"][r] for r in REPORTED] if f["causes"] else None)
        p = prev[g]
        cols["prev"].append(local.get(p) if p is not None else None)
        cols["otherDay"].append(0 if today else 1)

        dec = []
        for (cat, ap, root, t, hops), mins in sorted((contrib[g] or {}).items(), key=lambda x: -x[1]):
            if mins < 0.5:
                continue
            dec.append([CATS.index(cat), ap_index.get(ap, -1), local.get(root, -1), t - day_start, hops, round(mins)])
        cols["decoded"].append(dec)

        if not today:
            continue
        s = ap_stats[f["o"]]
        hd = hour(f["sdep"])
        s["deps"][hd] += 1
        if f["cancelled"]:
            s["cancelled"][hd] += 1
            cancel_codes[f["ccode"] or "?"] += 1
        elif f["dep_delay"] is not None and f["dep_delay"] >= 15:
            s["delayedDeps"][hd] += 1
        if f["causes"]:
            for r in REPORTED:
                reported[r] += f["causes"][r]
        arr_h = hour(f["sarr"] + int(f["arr_delay"] or 0))
        for (cat, ap, root, t, hops), mins in (contrib[g] or {}).items():
            decoded[cat] += mins
            ap_stats[f["d"]]["felt"][cat][arr_h] += mins
            if ap in ap_stats:
                ap_stats[ap]["origin"][cat][hour(t)] += mins
                if ap != f["d"]:
                    ap_stats[ap]["exported"][hour(t)] += mins
            if hops >= 1 and ap != f["d"] and ap in ap_index:
                a = arcs[(ap_index[ap], ap_index[f["d"]], arr_h, CATS.index(cat))]
                a["minutes"] += mins
                if k not in a["flights"]:
                    a["flights"].append(k)

    out_airports = []
    for c in ap_codes:
        a = airports.get(c, {})
        s = ap_stats[c]
        out_airports.append({
            "code": c, "name": a.get("name", c), "city": a.get("city", ""),
            "lat": a.get("lat", 0), "lon": a.get("lon", 0),
            "deps": s["deps"], "delayedDeps": s["delayedDeps"], "cancelled": s["cancelled"],
            "felt": [[round(x) for x in s["felt"][k]] for k in CATS],
            "origin": [[round(x) for x in s["origin"][k]] for k in CATS],
            "exported": [round(x) for x in s["exported"]],
        })

    weather = {}
    for c, w in wx.items():
        if not w:
            continue
        hrs = []
        for h in range(HOURS):
            x = w.get(day_start // 60 + h)
            hrs.append(None if x is None else [int(x["ts"]), int(x["ifr"]), int(x["gust"]), x["metar"]])
        weather[c] = hrs

    out = {
        "date": day,
        "dayStartUtcMin": day_start,
        "hours": HOURS,
        "airports": out_airports,
        "flights": cols,
        "arcs": [[s, t, h, cat, round(v["minutes"]), v["flights"][:60]]
                 for (s, t, h, cat), v in arcs.items() if v["minutes"] >= 1],
        "weather": weather,
        "totals": {
            "flights": sum(1 for i in ids if F[i]["date"] == day),
            "cancelled": dict(cancel_codes),
            "reported": reported,
            "decoded": {k: round(v) for k, v in decoded.items()},
        },
    }
    path = OUT / f"day-{day}.json"
    path.write_text(json.dumps(out, separators=(",", ":")))
    print(f"  {path.name}: {len(ids):,} flights, {len(out['arcs']):,} arcs, {path.stat().st_size / 1e6:.1f} MB")


# --------------------------------------------------------------------------- main


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--year", type=int, default=2026)
    ap.add_argument("--month", type=int, default=7)
    ap.add_argument("--zip", type=Path, help="use an already-downloaded BTS PREZIP file")
    ap.add_argument("--days", help="comma-separated YYYY-MM-DD days to export (default: the 6 most disrupted days)")
    ap.add_argument("--synthetic", action="store_true", help="use the offline synthetic fixture (NOT real data)")
    ap.add_argument("--carrier", help="only keep this reporting carrier, e.g. WN for Southwest")
    args = ap.parse_args()

    if args.synthetic:
        sys.path.insert(0, str(ROOT / "pipeline"))
        from synthetic import synthetic_flights, synthetic_weather
        build(synthetic_flights(), synthetic_weather, args.days, True, "Synthetic fixture (pipeline/synthetic.py)", args.carrier)
        return

    zip_path = args.zip or fetch(BTS_URL.format(year=args.year, month=args.month),
                                 RAW / f"bts_{args.year}_{args.month}.zip")
    source = (f"BTS Reporting Carrier On-Time Performance, {args.year}-{args.month:02d}"
              f"{f' ({args.carrier} only)' if args.carrier else ''}; weather: Iowa Environmental Mesonet ASOS")
    build(read_bts(zip_path), fetch_weather, args.days, False, source, args.carrier)


if __name__ == "__main__":
    main()
