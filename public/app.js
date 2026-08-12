// ---------- small utilities ----------------------------------------------

const $ = (sel) => document.querySelector(sel);
const DAY_KEYS = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
const DAY_LABELS = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
const DAY_COLORS = ["#14213D","#A9812E","#2F6E4F","#5B4B8A","#A3392F","#2E6E8E","#8A5B2F"];

function log(...parts) {
  const el = $("#debugLog");
  const line = parts.map(p => (typeof p === "string" ? p : JSON.stringify(p))).join(" ");
  el.textContent += line + "\n";
  el.scrollTop = el.scrollHeight;
  console.log(...parts);
}

function setSession(ok, label) {
  $("#sessionDot").className = "dot " + (ok === null ? "" : ok ? "ok" : "err");
  $("#sessionLabel").textContent = label;
}

function timeToMinutes(hhmm) {
  if (!hhmm || hhmm.length < 4) return null;
  const h = parseInt(hhmm.slice(0, 2), 10);
  const m = parseInt(hhmm.slice(2, 4), 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function fmtTime(mins) {
  if (mins == null) return "TBA";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

// ---------- API calls -------------------------------------------------------

async function api(path, opts) {
  const r = await fetch(path, opts);
  let body;
  const text = await r.text();
  try { body = JSON.parse(text); } catch { body = text; }
  log(`${opts?.method || "GET"} ${path} -> ${r.status}`);
  if (!r.ok || (body && body.error)) {
    log("  detail:", typeof body === "string" ? body.slice(0, 400) : (body.error || JSON.stringify(body).slice(0,400)));
  }
  return { ok: r.ok, status: r.status, body };
}

// ---------- normalizing Banner's section records ---------------------------

function normalizeSection(raw) {
  const meetings = (raw.meetingsFaculty || []).map(mf => {
    const mt = mf.meetingTime || {};
    const days = DAY_KEYS.map(k => !!mt[k]);
    return {
      start: timeToMinutes(mt.beginTime),
      end: timeToMinutes(mt.endTime),
      days,
      type: mt.meetingType || mt.meetingTypeDescription || "",
      building: mt.building || "",
      room: mt.room || "",
    };
  });
  const instructor = (raw.faculty || []).map(f => f.displayName).filter(Boolean).join(", ") || "Staff";
  return {
    crn: raw.courseReferenceNumber,
    subject: raw.subject,
    subjectDescription: raw.subjectDescription || raw.subject,
    courseNumber: raw.courseNumber,
    courseTitle: raw.courseTitle,
    sequenceNumber: raw.sequenceNumber,
    instructor,
    seatsAvailable: raw.seatsAvailable,
    maxEnrollment: raw.maximumEnrollment,
    meetings,
  };
}

function meetingsOverlap(a, b) {
  if (a.start == null || a.end == null || b.start == null || b.end == null) return false; // TBA/arranged: can't conflict
  const sameDay = a.days.some((d, i) => d && b.days[i]);
  if (!sameDay) return false;
  return a.start < b.end && b.start < a.end;
}

function sectionsConflict(secA, secB) {
  for (const ma of secA.meetings) {
    for (const mb of secB.meetings) {
      if (meetingsOverlap(ma, mb)) return true;
    }
  }
  return false;
}

// ---------- app state --------------------------------------------------

let terms = [];
let selectedTerm = null;
let requirements = []; // {id, subject, courseNumber, courseTitle, sections:[...], included:Set(crn), anchor:crn|null}
let reqCounter = 0;
let lastResults = [];

// ---------- term & subject loading --------------------------------------

async function loadTerms() {
  setSession(null, "loading terms…");
  const { ok, body } = await api("/api/terms");
  if (!ok) { setSession(false, "could not reach Banner"); return; }
  terms = Array.isArray(body) ? body : (body.data || []);
  const sel = $("#termSelect");
  sel.innerHTML = "";
  terms.forEach(t => {
    const opt = document.createElement("option");
    opt.value = t.code;
    opt.textContent = `${t.description || t.code} (${t.code})`;
    sel.appendChild(opt);
  });
  const preferred = terms.find(t => t.code === "202502");
  if (preferred) sel.value = "202502";
  setSession(true, `${terms.length} terms found`);
}

async function useSelectedTerm() {
  const code = $("#termSelect").value;
  if (!code) return;
  $("#termHint").textContent = "setting term…";
  const { ok, body } = await api("/api/term", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ term: code }),
  });
  if (!ok) { $("#termHint").textContent = "failed to set term — see technical log below."; return; }
  selectedTerm = code;
  $("#termHint").textContent = `active term: ${code}`;
  await loadSubjects(code);
  $("#addCoursePanel").style.display = "block";
}

async function loadSubjects(term) {
  const { ok, body } = await api(`/api/subjects?term=${encodeURIComponent(term)}`);
  const sel = $("#subjectSelect");
  sel.innerHTML = '<option value="">All subjects…</option>';
  if (!ok) return;
  const list = Array.isArray(body) ? body : (body.data || []);
  list.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s.code;
    opt.textContent = `${s.code} — ${s.description}`;
    sel.appendChild(opt);
  });
}

// ---------- section search & requirement building ---------------------

async function findSections() {
  if (!selectedTerm) return;
  const subject = $("#subjectSelect").value;
  const courseNumber = $("#courseNumberInput").value.trim();
  const title = $("#titleInput").value.trim();

  const qs = new URLSearchParams({ term: selectedTerm });
  if (subject) qs.set("subject", subject);
  if (courseNumber) qs.set("courseNumber", courseNumber);
  if (title) qs.set("title", title);

  $("#searchResults").innerHTML = '<p class="hint">Searching…</p>';
  const { ok, body } = await api(`/api/sections?${qs.toString()}`);
  if (!ok) {
    $("#searchResults").innerHTML = '<p class="hint">Search failed — see technical log below to fix the request.</p>';
    return;
  }
  const rawList = body.data || [];
  if (rawList.length === 0) {
    $("#searchResults").innerHTML = '<p class="hint">No sections found for that search.</p>';
    return;
  }
  const sections = rawList.filter(Boolean).map(normalizeSection);

  // group by course (subject + courseNumber)
  const groups = new Map();
  sections.forEach(s => {
    const key = `${s.subject}${s.courseNumber}`;
    if (!groups.has(key)) groups.set(key, { subject: s.subject, courseNumber: s.courseNumber, courseTitle: s.courseTitle, sections: [] });
    groups.get(key).sections.push(s);
  });

  const container = $("#searchResults");
  container.innerHTML = "";

  if (groups.size > 1) {
    const bar = document.createElement("div");
    bar.className = "row";
    bar.style.marginTop = "12px";
    bar.innerHTML = `
      <span class="hint" style="margin:0;">${groups.size} courses found —</span>
      <button type="button" class="btn btn-ghost btn-small" id="globalSelectAll">Select all sections</button>
      <button type="button" class="btn btn-ghost btn-small" id="globalSelectNone">Unselect all sections</button>
    `;
    container.appendChild(bar);
    bar.querySelector("#globalSelectAll").onclick = () => {
      container.querySelectorAll(".sec-check").forEach(cb => (cb.checked = true));
    };
    bar.querySelector("#globalSelectNone").onclick = () => {
      container.querySelectorAll(".sec-check").forEach(cb => (cb.checked = false));
    };
  }

  groups.forEach(group => container.appendChild(renderCourseGroup(group)));
}

function meetingSummary(section) {
  if (section.meetings.length === 0) return "Arranged / TBA";
  return section.meetings.map(m => {
    if (m.start == null) return "TBA";
    const days = DAY_LABELS.filter((_, i) => m.days[i]).join("");
    return `${days || "?"} ${fmtTime(m.start)}–${fmtTime(m.end)}`;
  }).join("; ");
}

function renderCourseGroup(group) {
  const wrap = document.createElement("div");
  wrap.className = "course-group";

  const head = document.createElement("div");
  head.className = "course-group-head";
  head.innerHTML = `
    <span><span class="code">${group.subject} ${group.courseNumber}</span>${group.courseTitle || ""}</span>
    <span class="row" style="gap:6px;">
      <span class="hint" style="margin:0;">${group.sections.length} section(s)</span>
      <button type="button" class="btn btn-ghost btn-small select-all-btn">Select all</button>
      <button type="button" class="btn btn-ghost btn-small select-none-btn">Unselect all</button>
    </span>
  `;
  wrap.appendChild(head);

  group.sections.forEach(sec => {
    const row = document.createElement("div");
    row.className = "section-row";
    const seatsClass = sec.seatsAvailable != null && sec.seatsAvailable <= 0 ? "seats full" : "seats";
    row.innerHTML = `
      <input type="checkbox" class="sec-check" checked />
      <span class="crn">${sec.crn}</span>
      <span class="meet">${meetingSummary(sec)}</span>
      <span>${sec.instructor}</span>
      <span class="${seatsClass}">${sec.seatsAvailable != null ? sec.seatsAvailable + " seats" : ""}</span>
    `;
    row._section = sec;
    wrap.appendChild(row);
  });

  const btn = document.createElement("button");
  btn.className = "btn btn-primary btn-small add-course-btn";
  btn.textContent = "Add to my courses →";
  btn.onclick = () => addRequirement(group, wrap);
  wrap.appendChild(btn);

  head.querySelector(".select-all-btn").onclick = () => {
    wrap.querySelectorAll(".sec-check").forEach(cb => (cb.checked = true));
  };
  head.querySelector(".select-none-btn").onclick = () => {
    wrap.querySelectorAll(".sec-check").forEach(cb => (cb.checked = false));
  };

  return wrap;
}

function addRequirement(group, wrapEl) {
  const rows = [...wrapEl.querySelectorAll(".section-row")];
  const included = new Set();
  const sections = [];
  rows.forEach(r => {
    sections.push(r._section);
    if (r.querySelector(".sec-check").checked) included.add(r._section.crn);
  });
  if (included.size === 0) { alert("Check at least one section to add this course."); return; }

  reqCounter += 1;
  requirements.push({
    id: reqCounter,
    subject: group.subject,
    courseNumber: group.courseNumber,
    courseTitle: group.courseTitle,
    sections,
    included,
    anchor: null,
  });
  renderRequirements();
  $("#requirementsPanel").style.display = "block";
  $("#generatePanel").style.display = "block";
}

function renderRequirements() {
  const list = $("#requirementsList");
  list.innerHTML = "";
  requirements.forEach(req => {
    const card = document.createElement("div");
    card.className = "req-card";
    const anchorSec = req.sections.find(s => s.crn === req.anchor);
    const availableCount = req.sections.filter(s => req.included.has(s.crn)).length;

    card.innerHTML = `
      <div class="req-title">
        <span class="req-code">${req.subject} ${req.courseNumber}</span>${req.courseTitle || ""}
        <div class="req-count">${availableCount} section(s) in play</div>
      </div>
      ${anchorSec ? `<span class="pin-tag">pinned: CRN ${anchorSec.crn} · ${meetingSummary(anchorSec)}</span>` : ""}
      <select class="pin-select">
        <option value="">No pin — let the builder choose</option>
        ${req.sections.map(s => `<option value="${s.crn}" ${req.anchor === s.crn ? "selected" : ""}>Pin CRN ${s.crn} — ${meetingSummary(s)}</option>`).join("")}
      </select>
      <button class="btn btn-ghost btn-small remove-btn">Remove</button>
    `;
    card.querySelector(".pin-select").onchange = (e) => { req.anchor = e.target.value || null; renderRequirements(); };
    card.querySelector(".remove-btn").onclick = () => { requirements = requirements.filter(r => r.id !== req.id); renderRequirements(); };
    list.appendChild(card);
  });
}

// ---------- schedule generation -----------------------------------------

function generateSchedules() {
  if (requirements.length === 0) return;
  $("#generateStatus").textContent = "Building…";

  const pools = requirements.map(req => {
    if (req.anchor) {
      const s = req.sections.find(sec => sec.crn === req.anchor);
      return [s];
    }
    return req.sections.filter(s => req.included.has(s.crn));
  });

  if (pools.some(p => p.length === 0)) {
    $("#generateStatus").textContent = "One of your courses has no sections selected — check it above.";
    return;
  }

  const results = [];
  const MAX_RESULTS = 300;
  const MAX_EXPLORED = 200000;
  let explored = 0;

  function backtrack(idx, chosen) {
    if (results.length >= MAX_RESULTS || explored > MAX_EXPLORED) return;
    explored += 1;
    if (idx === pools.length) {
      results.push([...chosen]);
      return;
    }
    for (const candidate of pools[idx]) {
      let ok = true;
      for (const c of chosen) {
        if (sectionsConflict(c, candidate)) { ok = false; break; }
      }
      if (ok) {
        chosen.push(candidate);
        backtrack(idx + 1, chosen);
        chosen.pop();
        if (results.length >= MAX_RESULTS) return;
      }
    }
  }
  backtrack(0, []);

  if (results.length === 0) {
    $("#generateStatus").textContent = "No conflict-free combination exists with the current sections/pins. Try un-pinning a class or including more sections.";
    $("#resultsPanel").style.display = "none";
    return;
  }

  const sortMode = $("#sortSelect").value;
  const scored = results.map(combo => ({ combo, score: scoreCombo(combo, sortMode) }));
  scored.sort((a, b) => a.score - b.score);

  lastResults = scored.map(s => s.combo);
  $("#generateStatus").textContent = `${results.length} valid combination(s) found${explored > MAX_EXPLORED ? " (search capped — narrow your options for a full count)" : ""}.`;
  renderResults();
}

function dailyIntervals(combo) {
  // returns array[7] of sorted {start,end} lists across all chosen sections
  const byDay = Array.from({ length: 7 }, () => []);
  combo.forEach(sec => sec.meetings.forEach(m => {
    if (m.start == null) return;
    m.days.forEach((on, i) => { if (on) byDay[i].push({ start: m.start, end: m.end }); });
  }));
  byDay.forEach(list => list.sort((a, b) => a.start - b.start));
  return byDay;
}

function scoreCombo(combo, mode) {
  const byDay = dailyIntervals(combo);
  if (mode === "compact") {
    let gap = 0;
    byDay.forEach(list => {
      for (let i = 1; i < list.length; i++) {
        const g = list[i].start - list[i - 1].end;
        if (g > 0) gap += g;
      }
    });
    return gap;
  }
  if (mode === "earliest") {
    let total = 0, count = 0;
    byDay.forEach(list => { if (list.length) { total += list[list.length - 1].end; count++; } });
    return count ? total / count : 0;
  }
  if (mode === "latest") {
    let total = 0, count = 0;
    byDay.forEach(list => { if (list.length) { total += list[0].start; count++; } });
    return count ? -total / count : 0;
  }
  if (mode === "fewdays") {
    return byDay.filter(l => l.length > 0).length;
  }
  return 0;
}

// ---------- results rendering -------------------------------------------

function renderResults() {
  $("#resultsPanel").style.display = "block";
  const shown = lastResults.slice(0, 20);
  $("#resultsMeta").textContent = `Showing ${shown.length} of ${lastResults.length} option(s), best first.`;

  const tabs = $("#resultsTabs");
  tabs.innerHTML = "";
  shown.forEach((combo, i) => {
    const b = document.createElement("button");
    b.className = "tab-btn" + (i === 0 ? " active" : "");
    b.textContent = `Option ${i + 1}`;
    b.onclick = () => {
      [...tabs.children].forEach(c => c.classList.remove("active"));
      b.classList.add("active");
      drawWeekGrid(combo);
    };
    tabs.appendChild(b);
  });
  if (shown.length) drawWeekGrid(shown[0]);
}

function drawWeekGrid(combo) {
  const grid = $("#resultsGrid");
  grid.innerHTML = "";

  const usedDays = [0,1,2,3,4,5,6].filter(i => combo.some(sec => sec.meetings.some(m => m.days[i] && m.start != null)));
  const days = usedDays.length ? usedDays : [0,1,2,3,4]; // default Sun-Thu if nothing timed

  const DAY_START = 7 * 60, DAY_END = 19 * 60; // 7am-7pm window
  const PX_PER_MIN = 0.9;
  const gridHeight = (DAY_END - DAY_START) * PX_PER_MIN;

  const week = document.createElement("div");
  week.className = "week-grid";
  week.style.gridTemplateColumns = `50px repeat(${days.length}, 1fr)`;

  const head = document.createElement("div");
  head.className = "week-head";
  head.style.gridTemplateColumns = `50px repeat(${days.length}, 1fr)`;
  head.appendChild(Object.assign(document.createElement("div"), { textContent: "" }));
  days.forEach(d => head.appendChild(Object.assign(document.createElement("div"), { textContent: DAY_LABELS[d] })));
  week.appendChild(head);

  const body = document.createElement("div");
  body.className = "week-body";
  body.style.display = "grid";
  body.style.gridTemplateColumns = `50px repeat(${days.length}, 1fr)`;
  body.style.height = gridHeight + "px";
  body.style.position = "relative";

  // hour labels column
  const hourCol = document.createElement("div");
  hourCol.style.position = "relative";
  for (let h = 7; h <= 19; h++) {
    const lbl = document.createElement("div");
    lbl.textContent = h <= 12 ? `${h}` : `${h - 12}`;
    lbl.style.position = "absolute";
    lbl.style.top = ((h * 60 - DAY_START) * PX_PER_MIN - 6) + "px";
    lbl.style.fontSize = "0.65rem";
    lbl.style.fontFamily = "var(--font-mono)";
    lbl.style.color = "#8892A6";
    lbl.style.right = "6px";
    hourCol.appendChild(lbl);
  }
  body.appendChild(hourCol);

  days.forEach(d => {
    const col = document.createElement("div");
    col.style.position = "relative";
    col.style.borderLeft = "1px solid var(--line)";
    body.appendChild(col);
  });

  const colEls = [...body.children].slice(1);
  combo.forEach((sec, secIdx) => {
    const color = DAY_COLORS[secIdx % DAY_COLORS.length];
    sec.meetings.forEach(m => {
      if (m.start == null) return;
      days.forEach((d, colIdx) => {
        if (!m.days[d]) return;
        const block = document.createElement("div");
        block.className = "class-block";
        block.style.top = ((m.start - DAY_START) * PX_PER_MIN) + "px";
        block.style.height = Math.max((m.end - m.start) * PX_PER_MIN, 24) + "px";
        block.style.left = "2px";
        block.style.right = "2px";
        block.style.background = color;
        block.innerHTML = `<span class="b-code">${sec.subject}${sec.courseNumber}</span><span class="b-time">${fmtTime(m.start)}–${fmtTime(m.end)}</span>`;
        block.title = `CRN ${sec.crn} · ${sec.instructor} · ${m.building} ${m.room}`;
        colEls[colIdx].appendChild(block);
      });
    });
  });

  week.appendChild(body);
  grid.appendChild(week);
}

// ---------- wire up -------------------------------------------------------

$("#termLoadBtn").onclick = useSelectedTerm;
$("#findSectionsBtn").onclick = findSections;
$("#generateBtn").onclick = generateSchedules;

loadTerms();
