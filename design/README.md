# Design hand-off

PNG exports of the two pages at 2× (2880×1800, a 1440×900 frame at @2x). Drop them into Figma as reference
frames and draw or annotate over them.

| File | Screen |
|---|---|
| `01-home.png` | Home: KPI strip, search, Biggest delays table |
| `02-home-root-cause-filter-open.png` | Home with the Decoded root cause header filter open |
| `03-flight.png` | Flight page: sidebar, satellite map, scrubber |
| `04-flight-sidebar-scrolled.png` | Flight page with the sidebar scrolled to Cost and Event log |

## Editable Figma layers

To get real, editable frames (text, boxes, icons as layers) rather than images:

1. Run the app: `npm install && npm run dev`, then open http://localhost:5173.
2. Install the free **html.to.design** Figma plugin and its Chrome extension.
3. On each page (home, then open a flight), click the extension and send the page to Figma.

The map is a WebGL canvas, so it imports as an image; everything else imports as layers.

## Sending changes back

Export the edited frames as PNG (or share a Figma link if the Figma connector is enabled for the session), and
note anything that isn't visible in a still (hover states, what a click does).
