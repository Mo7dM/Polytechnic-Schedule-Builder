# Schedule Builder — Bahrain Polytechnic (Beta)

A local tool that browses the public **"Browse Classes"** data on
`ban-reg.polytechnic.bh` and builds **conflict-free schedule options**, letting
you pin an exact section for any course (like your 8–10 class) and generating
the possibilities for everything else around it.

> **Unofficial tool, not affiliated with or endorsed by Bahrain Polytechnic.
> Always confirm your final schedule on the official portal before
> registering.**

---

## Setup

1. Install [Node.js](https://nodejs.org) version 18 or newer, if you don't
   have it already.
2. Clone:
   ```
    git clone https://github.com/Mo7dM/Polytechnic-Schedule-Builder.git
    cd Polytechnic-Schedule-Builder
   ```
3. In this folder, run:
   ```
   npm install
   npm start
   ```
4. Open **http://localhost:3000** in your browser.

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

## What's in here

- `server.js` — the local proxy/server (Express) with helmet, rate limiting and
  input validation. Handles the Banner session cookie so your browser never
  has to.
- `public/` — the frontend: term/course pickers, requirement list, schedule
  generator, weekly grid and export helpers, all plain JS (no build step).