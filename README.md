# Schedule Builder — Bahrain Polytechnic

A local tool that browses the public "Browse Classes" data on
`ban-reg.polytechnic.bh` and builds conflict-free schedule options, letting
you pin an exact section for any course (like your 8–10 class) and
generating the possibilities for everything else around it.

## Why it runs locally instead of as a hosted webpage

Banner (the university's registration system) ties class search to a
server-side session cookie, and browsers won't forward that cookie to a
webpage hosted somewhere else, nor will Banner's server likely allow it
(CORS). Running this on your own machine sidesteps both issues: the little
server talks to Banner directly (no browser involved, no CORS), and your
browser talks to `localhost` (same origin, no CORS). You still get a normal
webpage — you just open it from your own computer.

## Setup

1. Install [Node.js](https://nodejs.org) version 18 or newer, if you don't
   have it already.
2. In this folder, run:
   ```
   npm install
   npm start
   ```
3. Open **http://localhost:3000** in your browser.

## Using it

1. Pick your term and click **Use this term**.
2. Search a subject (and optionally a course number or title), click
   **Find sections**, uncheck any sections you don't want considered, then
   **Add to my courses**.
3. Repeat for every course you need this term.
4. For any course where you want an exact section (e.g. "I want the 8–10
   class"), use its **Pin** dropdown — the builder will only build
   schedules around that exact section. Leave others unpinned to let the
   builder pick the best-fitting section automatically.
5. Click **Generate schedules** and flip through the ranked options. Each
   is a full weekly timetable.

## If something breaks

Banner's exact parameter names can vary slightly by version, and I built
this from the standard pattern used across Banner 9 systems rather than
by testing directly against Bahrain Polytechnic's server. The **Technical
log** panel at the bottom of the page shows exactly what request failed —
copy that and send it back and it can be fixed. Fastest fix if something's
off: open the real site's browse-classes page, open your browser's
DevTools → Network tab, do a real class search there, and share the exact
request URL that appears — that pins down any parameter name that needs
adjusting.

## What's in here

- `server.js` — the local proxy/server (Express). Handles the Banner
  session cookie so your browser never has to.
- `public/` — the frontend: term/course pickers, requirement list,
  schedule generator and weekly grid, all plain JS (no build step).
