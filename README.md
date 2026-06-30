# SiteSnap (Web)

A construction-site documentation tool: import a floor plan, tap a spot to take a
timestamped photo, and it's pinned to that exact location. Revisit the same pin
over time to build a chronological photo history. Export a PDF report where the
floor-plan pin markers are real clickable links that jump to each pin's photo log.

## How it works

- Plain HTML/CSS/JS, no build step, no backend.
- All data (floor plan images, pins, photos) is stored locally in the browser's
  IndexedDB — nothing is ever uploaded anywhere. Hosting (e.g. GitHub Pages) only
  serves the app's code, never your project data.
- PDF export uses [jsPDF](https://github.com/parallax/jsPDF) (vendored in
  `js/vendor/`) with internal "GoTo" link annotations, so pin markers in the
  exported PDF are genuinely clickable in any PDF reader, even offline.
- A service worker (`sw.js`) caches the app shell so it works offline and can be
  added to your iPhone home screen (Safari → Share → Add to Home Screen).

## Running locally

Any static file server works, e.g.:

```
npx http-server .
```

Then open the printed URL. Camera access (`getUserMedia`) requires either
`localhost` or HTTPS — it will not work when opened directly as a `file://` path.

## Deploying

Push this folder to a GitHub repo and enable GitHub Pages (Settings → Pages →
deploy from the `main` branch, root folder). The resulting `https://<user>.github.io/<repo>/`
URL works on iPhone Safari, including "Add to Home Screen" for offline use.
