# DeTrace

> Concept work: a Southwest Airlines operations tool for tracing delays to their root cause. Not affiliated
> with or endorsed by Southwest Airlines; the logo is used for a portfolio mock-up only.

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
npm run dev                # http://localhost:5173, using the real data committed in public/data/
```

`public/data/` holds real data: BTS Reporting Carrier On-Time Performance for **July 2026** (the latest
month released, published Sept 21, 2026; 631,970 flights) and hourly ASOS/METAR weather for the 44 busiest
airports from the Iowa Environmental Mesonet. It is filtered to Southwest Airlines (`WN`, 124,994 flights, 792 aircraft) and covers Southwest's six most
disrupted days of the month.

### Delay cost

Costs use Airlines for America's 2025 average direct aircraft operating cost of **$98.41 per block minute**
(crew, fuel, maintenance, ownership; from DOT Form 41), applied to delay minutes. Cancellations and passenger
costs are not included. A flight's page also shows the cost it passed on to later flights of the same aircraft.

### Rebuilding the data

The **Build real data** GitHub Actions workflow (`.github/workflows/build-data.yml`) downloads the sources,
runs the pipeline (Southwest only by default, `--carrier WN`) and commits `public/data/`. It runs whenever the pipeline changes, or manually from the
Actions tab, where you can pick another year, month or specific days.

To build locally instead:

```bash
pip install -r requirements.txt
npm run data                                                  # July 2026, the 6 most disrupted days
python3 pipeline/build_data.py --days 2026-07-06,2026-07-28   # specific days
python3 pipeline/build_data.py --zip path/to/download.zip     # use a BTS zip you downloaded yourself
```

`npm run data:synthetic` writes an offline synthetic fixture instead. The app labels it as synthetic,
and it's only for development without network access.

### Deploy

The repo is ready for Vercel (`vercel.json`): import it at vercel.com/new, keep the detected settings, and deploy.
Pages are marked `noindex`. Each flight has its own URL, e.g. `/flight/2026-07-28/WN4067/VPS-BWI`; `vercel.json`
rewrites `/flight/*` to the app so those links can be opened or shared directly.


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

The look follows Palantir's operational design language (Gotham, Foundry, Apollo) on Blueprint's dark theme:
dense but aligned panels told apart by background and 1px borders rather than shadows, small uppercase section
headers, workspace tabs in the top bar, square corners, monospace for times and identifiers, status shown as
Blueprint intent tags (ON TIME, +2h 13m, CANCELLED), and causes identified by icons and labels, never colour
alone. The flight page puts a list-style sidebar on the left and a satellite map with an ops-console playback
scrubber on the right.

The map's satellite base is NASA Blue Marble (public domain), cropped to the US and reprojected to Web
Mercator by `pipeline/make_basemap.py` and bundled at `public/basemap/conus.jpg`. Where the browser can reach
Esri World Imagery, its sharper tiles draw on top; where it can't, the bundled image shows.

| File | What it does |
|---|---|
| `src/App.tsx` | Navbar with workspace tabs (delays table, open flight) and the calendar date picker |
| `src/components/DayPicker.tsx` | Month calendar in a popover. Only days with exported data can be picked; others explain why |
| `src/components/HomeView.tsx` | **Home:** delay-cost KPI tiles, tail/flight search, and a `Table2` of the biggest delays filtered from its column headers |
| `src/components/HeaderMenus.tsx` | Blueprint `Menu`s used as column-header filters (status, airport, root cause and where it started) |
| `src/components/FlightView.tsx` | **Flight page:** map + scrubber + sidebar, sharing one clock. The sidebar follows the leg in the air at the playhead |
| `src/components/FlightMap.tsx` | deck.gl map of one tail's legs (flown legs by root cause, unflown faint, selected white), the plane's position at the playhead, airport chips and detail cards |
| `src/components/Scrubber.tsx` | Playback: clock, transport controls (start, slower, −15m, previous event, play, next event, +15m, faster), hour ruler, leg spans, and a histogram of how late the plane is running, coloured by root cause |
| `src/components/Panels.tsx` | Flight sidebar: header with status, route fields, root-cause rows, the aircraft's flights, and an event log |
| `src/theme.ts`, `src/styles.css` | Category icons and labels, formatting, layout |

**Colour:** graphite neutrals (page `#17181C`, panels `#202126`, section heads `#292A30`, cards `#25262B`, 1px lines
`#303137`) with one muted purple accent (`#8067B7`) reserved for interaction, selection, focus and the active tab.
Status stays semantic: on time `#55A87A`, late `#C99655`, severe `#C96870`. On the map, legs use the same colours as the
sidebar's status tags (green on time, amber 15+ min late, red 3h+ late), the selected leg near-white and legs not flown yet a faint dashed white over darkened imagery. Blueprint's
own primary blue is swapped for the purple at build time (`vite.config.ts`). Category identity is always an icon plus a label.

## Built with AI

Built with Claude Code, which wrote the pipeline, the attribution algorithm and the React/deck.gl app from
a product brief. Human direction covered the problem framing, choice of data and day, and design.
