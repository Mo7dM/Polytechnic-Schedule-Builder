# Schedule Builder — Bahrain Polytechnic (Beta)

A local tool that browses the public **"Browse Classes"** data on
`ban-reg.polytechnic.bh` and builds **conflict-free schedule options**, letting
you pin an exact section for any course (like your 8–10 class) and generating
the possibilities for everything else around it.

> **Unofficial tool, not affiliated with or endorsed by Bahrain Polytechnic.
> Always confirm your final schedule on the official portal before
> registering.**

---

## What changed in v2 (mono-neobrutalism + beta hardening)

**Redesign — Mono Neobrutalism**
- Pure black/white base with a single light-blue accent (`#4FC3F7`) reserved for
  the one most important action per screen ("Generate schedules"). No gradients,
  no soft shadows, no translucency, zero border-radius anywhere.
- One monospace family throughout (JetBrains Mono), including body text.
- Thick 3px solid black borders on every panel, button, input and card, with
  hard offset shadows (`4px 4px 0 #000`). Buttons/cards "press into the page"
  on hover by sliding toward their shadow and shrinking it to zero.
- Weekly schedule grid keeps exposed structural grid lines and outlines each
  class block in thick black; courses are distinguished with the accent plus
  black/white/gray shades rather than a rainbow. The time window auto-fits the
  classes in your schedule, the hour axis is labeled in AM/PM, and every block
  shows the course, time range and room.
- A **schedule details** table under the grid lists every section in the option:
  course, day/time, room, instructor and CRN.
- Fully responsive — panels stack and the type scale shrinks under 640px.

**Beta readiness**
- **State persistence** — selected term, added courses, section selections and
  pins survive a page refresh (localStorage).
- **Proper error UI** — failed requests now show a user-facing banner/toast
  with a collapsible **Details** toggle; the raw technical log is collapsed
  behind a "Technical log" toggle instead of always visible.
- **Loading states** — every fetch disables its button and shows a spinner,
  not just a status string.
- **Export** — each generated option can be copied as plain text for
  WhatsApp/notes (course, days/times, room, instructor, CRN).
- **Schedule stats** — every option shows its total credit hours and a
  **conflict-free ✓** confirmation.
- **Edge cases handled visibly** — 0-seat sections show a `FULL` badge but stay
  selectable (waitlists exist), and arranged/TBA meetings are listed below the
  grid instead of breaking it.
- **Disclaimer footer + BETA badge** in the header, with a feedback/issues link.
- **Server hardening** — `helmet` security headers, a simple rate limiter on
  the proxy routes, and alphanumeric input validation on `term`, `subject` and
  `courseNumber` before anything is forwarded to Banner.
- **Favicon, `<title>` and meta description** updated.

---

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
4. For any course, you can **pin** what gets considered:
   - **Pin a section (CRN)** — "I want the 8–10 class exactly"; the builder uses
     only that section.
   - **Pin a doctor** — "I want Dr. X"; the builder considers only the sections
     of that course taught by that instructor.
   - Pins are mutually exclusive per course; leave both empty to let the
     builder pick the best-fitting section automatically.
5. Click **Generate schedules** and flip through the ranked options. Each is a
   full weekly timetable with a conflict-free confirmation and total credit
   hours, plus a section-by-section breakdown (course, day/time, room,
   instructor, CRN) under the grid. Use **Copy as text** to paste the option
   you want into WhatsApp or notes.

Your term, courses, pins and section selections are saved automatically, so a
refresh won't wipe your progress.

## Known limitations

- Built from the **standard Banner 9 (Ellucian) request pattern**, not by
  testing against every edge case in Bahrain Polytechnic's specific
  deployment. Parameter names can vary slightly between Banner versions.
- Credit hours are read from the search results when Banner provides them; if
  a course omits them the option shows "CH n/a".
- Sections with **arranged/TBA** meeting times can't be placed on the grid and
  are listed below it instead — they're never used to detect conflicts.
- The schedule generator caps its search at 300 results / 200,000
  combinations; very large searches are flagged rather than hanging.
- Seats shown come from the public browse view and may lag the real
  registration system — treat "seats available" as a hint, not a guarantee.
- The server keeps one shared Banner session cookie in memory (fine for one
  person on one machine). It talks only to `ban-reg.polytechnic.bh`.

## If something breaks

The **Technical log** panel (collapsed under a toggle) shows exactly what
request failed. Copy that and send it via the **Feedback / Issues** link. The
fastest fix if something's off: open the real site's browse-classes page, open
your browser's DevTools → Network tab, do a real class search there, and share
the exact request URL that appears — that pins down any parameter name that
needs adjusting.

## What's in here

- `server.js` — the local proxy/server (Express) with helmet, rate limiting and
  input validation. Handles the Banner session cookie so your browser never
  has to.
- `public/` — the frontend: term/course pickers, requirement list, schedule
  generator, weekly grid and export helpers, all plain JS (no build step).
- `public/favicon.svg` — the site icon.