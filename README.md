# Decode Delays

**Where US flight delays actually started.**

When a flight is 15+ minutes late, the airline has to tell the Bureau of Transportation Statistics (BTS)
why, split across five causes. The biggest cause is usually **"Late Aircraft"**, which only means the
plane arrived late from its previous flight. And **"Weather"** only counts *extreme* weather; ordinary
thunderstorms that slow air traffic are filed under **"NAS"** (National Airspace System).

Decode Delays follows each aircraft's tail number upstream to the flight where the delay began, checks
the weather at that airport and hour, and maps where delay started and where it ended up.

## Run it

```bash
npm install
npm run dev                # opens with the bundled SYNTHETIC preview data (yellow banner)
```

To load real data (BTS July 2026, the latest released month, published Sept 21, 2026):

```bash
pip install -r requirements.txt
npm run data               # downloads ~30 MB from BTS + hourly METARs from Iowa Mesonet
npm run dev
```

Options:

```bash
python3 pipeline/build_data.py --days 2026-07-06,2026-07-07   # pick days (default: worst day + next)
python3 pipeline/build_data.py --zip path/to/download.zip      # if transtats.bts.gov blocks scripts, download
                                                               # the PREZIP file in a browser and pass it here
```

BTS download page: <https://www.transtats.bts.gov/DL_SelectFields.aspx?gnoyr_VQ=FGJ&QO_fu146_anzr=b0-gvzr>
(direct zip: `https://transtats.bts.gov/PREZIP/On_Time_Reporting_Carrier_On_Time_Performance_1987_present_2026_7.zip`).

### Deploy

`npm run build` writes a static site to `dist/` (relative paths, so any static host works). On Vercel or
Netlify, use build command `npm run build` and output directory `dist`. Commit `public/data/` after
running the real pipeline so the deployed site carries the data.

## How the decoding works

`pipeline/build_data.py`:

1. **Parse** every flight in the month, converting local scheduled times to UTC with each airport's time zone.
2. **Chain** flights by `Tail_Number`. A leg links to the previous one if it departs from where that one
   landed within 16 hours. Cancelled and diverted legs break the chain.
3. **Place each flight's own causes:** carrier and security delay at the origin. Weather and NAS go to the end
   of the flight (destination first) that had thunderstorms, IFR conditions or gusts of 35 kt or more in
   the METARs within ±1 hour. NAS with weather on record is reclassified as **weather**; otherwise it stays
   **airspace & volume**.
4. **Trace inherited delay:** a flight's `LateAircraftDelay` is split across the previous leg's decoded
   causes in proportion, recursively, so a 6pm delay in Denver can trace back to a 2pm storm at LaGuardia
   three legs earlier. Minutes that can't be traced (the upstream leg arrived under 15 minutes late, so it has
   no cause breakdown, or there's no tail match) stay **untraced** in grey.
5. **Conserve minutes:** decoded totals always equal reported totals. The pipeline only re-attributes.

Outputs go to `public/data/`: `summary.json` (month strip and trace stats) and `day-YYYY-MM-DD.json`
(airports × hours, delay-export arcs, per-flight columns with decoded contributions, and the weather strip).

### Caveats worth saying out loud

- BTS cause codes are self-reported by airlines and only exist for arrivals 15+ minutes late.
- "Where" a NAS delay happened is inferred from weather evidence, not from FAA ground-delay-program
  records. Adding the FAA ATCSCC advisory archive (fly.faa.gov) would be the next step.
- Weather is fetched for the 45 busiest airports. NAS delay at smaller airports stays "airspace" unless
  the other end of the flight had weather.

## App structure

The UI is built on **[Blueprint](https://blueprintjs.com/docs/)** (`@blueprintjs/core`, `icons`, `table`, v6),
Palantir's open-source React toolkit for data-dense interfaces, in its dark theme.

Layout takes cues from Palantir Foundry operations apps: an icon rail, a context panel, dense KPI tiles,
a check-list of root causes, and map callouts with key/value rows per airport.

| File | What it does |
|---|---|
| `src/App.tsx` | Shell: icon rail, Blueprint `Navbar` with breadcrumbs and day `SegmentedControl`, "About the data" `Drawer` |
| `src/components/HomeView.tsx` | **Home:** context panel (dataset, pipeline steps, month strip), KPI tiles, reported vs decoded bars, root-cause check list (filters the table), tail-number search above a `Table2` of the biggest delays |
| `src/components/FlightView.tsx` | **Flight page:** that aircraft's day on a map, the leg timeline, and the decode sidebar |
| `src/components/FlightMap.tsx` | deck.gl map of one tail's legs (coloured by root cause, selected leg white), airport callouts with arrival/departure rows that avoid overlapping, halo where the delay began |
| `src/components/TailTimeline.tsx` | Gantt of the plane's day: scheduled block (dashed), flown block, late portion by root cause (hatched = inherited) |
| `src/components/Panels.tsx` | Flight sidebar: explanation sentence, stats, reported vs decoded, "where the minutes came from" table, weather at the root airport, the plane's day |
| `src/components/CauseCompare.tsx` | Reported vs decoded 100% bars, the core comparison |
| `src/theme.ts`, `src/styles.css` | Category colours and labels, formatting, layout. Colours reference Blueprint design tokens. |

**Colour (Blueprint palette):** weather blue-4 `#4c90f0`, airspace turquoise-3 `#00a396`, airline
vermilion-3 `#d33d17`, untraced/late-aircraft gray-3 `#8f99a8` (hatched). The three hues pass an all-pairs
colour-vision-deficiency check on dark-gray-1 `#1c2127`. Vermilion rather than orange keeps "airline"
from reading as Blueprint's warning intent. Security (indigo-4 `#9881f3`) only appears in bars.

## Built with AI

Built with Claude Code, which wrote the pipeline, the attribution algorithm and the React/deck.gl app from
a product brief. Human direction covered the problem framing, choice of data and day, and design.
