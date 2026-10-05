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

| File | What it does |
|---|---|
| `src/App.tsx` | Blueprint `Navbar` (view switch, day `SegmentedControl`), hash routes `#/` (home) and `#/map`, play loop |
| `src/components/HomeView.tsx` | **Home:** headline, stat `Card`s, reported vs decoded bars, tail-number search (`InputGroup`) above a `Table2` of the biggest delays. Searching one tail shows its day in order. Click a row to trace it on the map. |
| `src/components/DelayMap.tsx` | deck.gl map: airport circles (size = minutes, colour = dominant root cause), arcs = delay carried by aircraft from root airport to where it landed, the selected plane's legs in white |
| `src/components/Timeline.tsx` | Hourly stacked bars in a `Card`, scrub and play through the day (Eastern time) |
| `src/components/Panels.tsx` | Map side panel: day overview, airport, flight (with the plane's tail chain) and arc views, built from `Section`/`SectionCard`, `HTMLTable` and `Tag` |
| `src/components/CauseCompare.tsx` | Reported vs decoded 100% bars, the core comparison |
| `src/theme.ts`, `src/styles.css` | Category colours and labels, formatting, layout. Colours reference Blueprint design tokens. |

**Colour (Blueprint palette):** weather blue-4 `#4c90f0`, airspace turquoise-3 `#00a396`, airline
vermilion-3 `#d33d17`, untraced/late-aircraft gray-3 `#8f99a8` (hatched). The three hues pass an all-pairs
colour-vision-deficiency check on dark-gray-1 `#1c2127`. Vermilion rather than orange keeps "airline"
from reading as Blueprint's warning intent. Security (indigo-4 `#9881f3`) only appears in bars.

## Built with AI

Built with Claude Code, which wrote the pipeline, the attribution algorithm and the React/deck.gl app from
a product brief. Human direction covered the problem framing, choice of data and day, and design.
