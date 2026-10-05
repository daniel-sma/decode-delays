"""Synthetic BTS-shaped fixture for offline development. NOT REAL DATA.

Generates aircraft rotations across ~30 hubs for July 2026, with a Northeast
thunderstorm on July 6 and a Chicago/Atlanta storm on July 7, propagates delay
down each tail the way real operations do, and fills the five BTS cause fields
using BTS's rule that they sum to the arrival delay. Outputs rows with the same
column names as the BTS PREZIP CSV so the real pipeline runs on it unchanged.
"""

from __future__ import annotations

import random
from datetime import date, datetime, timedelta, timezone
from math import asin, cos, radians, sin, sqrt
from zoneinfo import ZoneInfo

import airportsdata

HUBS = ["ATL", "DFW", "DEN", "ORD", "LAX", "CLT", "MCO", "LAS", "PHX", "MIA", "SEA", "IAH", "JFK", "EWR",
        "SFO", "DTW", "BOS", "MSP", "FLL", "LGA", "PHL", "BWI", "SLC", "DCA", "SAN", "IAD", "TPA", "BNA",
        "AUS", "MDW"]
CARRIERS = ["DL", "AA", "UA", "WN", "B6", "AS", "NK"]
# (day, airports, start ET hour, end ET hour, capacity hit 0..1)
STORMS = [
    (6, {"LGA", "JFK", "EWR"}, 13, 21, 0.9),
    (6, {"BOS", "PHL"}, 15, 20, 0.6),
    (6, {"SFO"}, 7, 11, 0.5),  # morning marine-layer low ceilings
    (7, {"ORD", "MDW"}, 14, 19, 0.7),
    (7, {"ATL"}, 16, 20, 0.6),
    (18, {"DFW"}, 15, 18, 0.5),
    (24, {"DEN"}, 14, 17, 0.4),
]
ET = ZoneInfo("America/New_York")


def _dist(a, b):
    la1, lo1, la2, lo2 = map(radians, (a["lat"], a["lon"], b["lat"], b["lon"]))
    h = sin((la2 - la1) / 2) ** 2 + cos(la1) * cos(la2) * sin((lo2 - lo1) / 2) ** 2
    return 2 * 3959 * asin(sqrt(h))


def _storm(day: int, code: str, t_utc: datetime) -> float:
    et = t_utc.astimezone(ET)
    for d, aps, h0, h1, sev in STORMS:
        if d == day and code in aps and et.date() == date(2026, 7, d) and h0 <= et.hour < h1:
            return sev
    return 0.0


def synthetic_flights(seed: int = 7):
    rng = random.Random(seed)
    A = airportsdata.load("IATA")
    tails = [f"N{rng.randint(100, 999)}{rng.choice('ABCDEFGHJKLMNPRSTUVWXYZ')}{c[0]}" for c in
             (CARRIERS * 150)]
    tails = list(dict.fromkeys(tails))
    fn_counter = {c: 100 for c in CARRIERS}
    for day in range(1, 32):
        busy = 1.25 if day in (5, 6) else 1.0
        for tail in tails:
            carrier = next(c for c in CARRIERS if tail.endswith(c[0]))
            here = rng.choice(HUBS)
            t = datetime(2026, 7, day, 6, 0, tzinfo=ZoneInfo(A[here]["tz"])).astimezone(timezone.utc)
            t += timedelta(minutes=rng.randint(0, 120))
            carry = 0.0  # minutes of lateness the aircraft brings to the next departure
            for _leg in range(rng.randint(3, 6)):
                dest = rng.choice([h for h in HUBS if h != here])
                block = int(_dist(A[here], A[dest]) / 7.5 + 35)
                sdep, sarr = t, t + timedelta(minutes=block)
                fn_counter[carrier] += 1
                o_sev, d_sev = _storm(day, here, sdep), _storm(day, dest, sarr)
                cancel = rng.random() < (0.002 + 0.25 * max(o_sev, d_sev) * busy)
                local = sdep.astimezone(ZoneInfo(A[here]["tz"]))
                row = {
                    "FlightDate": local.date().isoformat(),
                    "Reporting_Airline": carrier,
                    "Flight_Number_Reporting_Airline": str(fn_counter[carrier]),
                    "Tail_Number": tail,
                    "Origin": here, "Dest": dest,
                    "CRSDepTime": local.strftime("%H%M"),
                    "CRSArrTime": sarr.astimezone(ZoneInfo(A[dest]["tz"])).strftime("%H%M"),
                    "CRSElapsedTime": str(block),
                    "Cancelled": "1.00" if cancel else "0.00",
                    "CancellationCode": (("B" if rng.random() < 0.6 else "C") if max(o_sev, d_sev) else "A")
                    if cancel else "",
                    "Diverted": "0.00",
                }
                if cancel:
                    row.update(DepDelay="", ArrDelay="", CarrierDelay="", WeatherDelay="", NASDelay="",
                               SecurityDelay="", LateAircraftDelay="")
                    yield row
                    # Aircraft is swapped out; it resumes later with a clean slate.
                    t = sarr + timedelta(minutes=rng.randint(60, 180))
                    carry = 0.0
                    here = dest
                    continue
                inherited = carry
                own_carrier = rng.expovariate(1 / 6) if rng.random() < 0.35 else 0
                if rng.random() < 0.01:
                    own_carrier += rng.randint(45, 180)  # maintenance / crew
                security = rng.randint(5, 25) if rng.random() < 0.002 else 0
                ground_hold = (d_sev * rng.uniform(40, 150) * busy) if d_sev else 0  # ground delay program
                origin_wx = (o_sev * rng.uniform(20, 80)) if o_sev else 0
                extreme = rng.uniform(0, 40) if max(o_sev, d_sev) > 0.8 and rng.random() < 0.15 else 0
                congestion = rng.expovariate(1 / 4) * busy
                dep_delay = inherited + own_carrier + security + ground_hold + origin_wx + extreme - rng.uniform(0, 6)
                arr_delay = dep_delay + congestion + (d_sev * rng.uniform(5, 30)) - rng.uniform(0, 8)
                dep_delay, arr_delay = round(dep_delay), round(arr_delay)
                row.update(DepDelay=str(dep_delay), ArrDelay=str(arr_delay))
                if arr_delay >= 15:
                    parts = {"LateAircraftDelay": inherited, "CarrierDelay": own_carrier,
                             "SecurityDelay": security, "WeatherDelay": extreme,
                             "NASDelay": ground_hold + origin_wx + congestion + d_sev * 15}
                    total = sum(parts.values()) or 1
                    vals = {k: int(arr_delay * v / total) for k, v in parts.items()}
                    vals["NASDelay"] += arr_delay - sum(vals.values())
                    row.update({k: str(v) for k, v in vals.items()})
                else:
                    row.update(CarrierDelay="", WeatherDelay="", NASDelay="", SecurityDelay="",
                               LateAircraftDelay="")
                yield row
                turn = rng.randint(35, 75)
                carry = max(0.0, arr_delay - (turn - 30))
                t = sarr + timedelta(minutes=turn)
                here = dest
                if t.astimezone(ET).hour >= 23 or t.astimezone(ET).hour < 5:
                    break


def synthetic_weather(stations, start, end):
    """Hourly flags matching parse_asos() output, keyed by FAA LID."""
    A = airportsdata.load("IATA")
    by_lid = {(A[c].get("lid") or c): c for c in HUBS}
    out = {}
    t0 = datetime(start.year, start.month, start.day, tzinfo=timezone.utc)
    t1 = datetime(end.year, end.month, end.day, tzinfo=timezone.utc)
    for lid in stations:
        code = by_lid.get(lid)
        if not code:
            continue
        hours = {}
        t = t0
        while t < t1:
            sev = max((_storm(day, code, t) for day in range(1, 32)), default=0)
            ts = sev >= 0.5 and code != "SFO"
            ifr = sev > 0 and code == "SFO" or sev >= 0.8
            stamp = t.strftime("%d%H51Z")
            metar = (f"K{code} {stamp} 27018G38KT 2SM +TSRA BKN008CB OVC020 SYNTHETIC" if ts else
                     f"K{code} {stamp} 25006KT 2SM BR OVC006 SYNTHETIC" if ifr else
                     f"K{code} {stamp} 21008KT 10SM FEW040 SYNTHETIC")
            hours[int(t.timestamp() // 3600)] = {"ts": ts, "ifr": ifr, "gust": 38 if ts else 0, "metar": metar}
            t += timedelta(hours=1)
        out[lid] = hours
    return out
