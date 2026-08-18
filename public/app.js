// ---------- constants & small utilities -------------------------------------

const $ = (s) => document.querySelector(s);
const DAY_KEYS = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
const DAY_LABELS = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
const STORE_KEY = "sb_state_v1";
const FEEDBACK_URL = "https://github.com/mo7dm/Poly/issues"; // TODO: point at the real repo

// Neobrutalist course palette: one accent + black/white + 2-3 flat grays.
// Each COURSE gets one consistent fill for the whole session (not per section).
const COURSE_FILLS = [
  { bg: "#4FC3F7", fg: "#000" },
  { bg: "#000000", fg: "#fff" },
  { bg: "#888888", fg: "#fff" },
  { bg: "#ffffff", fg: "#000" },
  { bg: "#555555", fg: "#fff" },
  { bg: "#cccccc", fg: "#000" },
];

function log(...parts) {
  const el = $("#debugLog");
  if (!el) return;
  const line = parts.map(p => (typeof p === "string" ? p : JSON.stringify(p))).join(" ");
  el.textContent += line + "\n";
  el.scrollTop = el.scrollHeight;
  console.log(...parts);
}

let bannerTimer = null;
function showBanner(title, details) {
  $("#bannerTitle").textContent = title;
  $("#bannerDetails").textContent = details || "";
  $("#banner").hidden = false;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(dismissBanner, 12000);
}
function dismissBanner() {
  $("#banner").hidden = true;
  clearTimeout(bannerTimer);
}

function setBusy(btn, on, label) {
  if (!btn) return;
  btn.disabled = on;
  btn.classList.toggle("loading", on);
  if (on) {
    btn.dataset.orig = btn.textContent;
    btn.innerHTML = `<span class="btn-spinner"></span>${label || "working&hellip;"}`;
  } else if (btn.dataset.orig !== undefined) {
    btn.textContent = btn.dataset.orig;
    delete btn.dataset.orig;
  }
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

// ---------- state persistence ------------------------------------------------

function serializeRequirements() {
  return requirements.map(r => ({
    id: r.id,
    subject: r.subject,
    courseNumber: r.courseNumber,
    courseTitle: r.courseTitle,
    sections: r.sections,
    included: [...r.included],
    anchor: r.anchor,
    pinDoctor: r.pinDoctor,
  }));
}

function selectedSortModes() {
  return [...document.querySelectorAll(".rank-opt input:checked")].map(cb => cb.value);
}

function saveState() {
  try {
    const data = {
      selectedTerm,
      sort: selectedSortModes(),
      requirements: serializeRequirements(),
    };
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  } catch (err) {
    log("could not save state:", err);
  }
}

function restoreState() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(STORE_KEY));
  } catch { saved = null; }
  if (!saved) return;
  if (saved.sort) {
    const modes = Array.isArray(saved.sort) ? saved.sort : [saved.sort];
    document.querySelectorAll(".rank-opt input").forEach(cb => {
      cb.checked = modes.includes(cb.value);
    });
  }
  if (saved.selectedTerm) selectedTerm = saved.selectedTerm;
  if (Array.isArray(saved.requirements) && saved.requirements.length) {
    requirements = saved.requirements.map(r => ({
      ...r,
      included: new Set(r.included || []),
      id: typeof r.id === "number" ? r.id : ++reqCounter,
    }));
    reqCounter = Math.max(reqCounter, ...requirements.map(r => r.id || 0));
  }
}

// ---------- API calls ---------------------------------------------------------

async function api(path, opts, label = "Request", silent = false) {
  const r = await fetch(path, opts);
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  const failed = !r.ok || (body && typeof body === "object" && body.error);
  log(`${opts?.method || "GET"} ${path} -> ${r.status}`);
  if (failed) {
    const detail = typeof body === "string"
      ? text.slice(0, 600)
      : (body.error ? String(body.error) : JSON.stringify(body).slice(0, 600));
    log("  detail:", detail);
    const raw = body && typeof body === "object" && body.raw
      ? "\n\nServer response:\n" + String(body.raw).slice(0, 1500)
      : "";
    if (!silent) showBanner(`${label} failed (HTTP ${r.status})`, detail + raw);
  }
  return { ok: !failed, status: r.status, body };
}

// ---------- normalizing Banner's section records ------------------------------

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
  // Banner's credit hours can live in a few fields; take the first non-empty one.
  const chSource = [raw.creditHours, raw.creditHourLow, raw.creditHourSession]
    .find(v => v != null && v !== "");
  let creditHours = 0;
  let creditHoursKnown = false;
  if (chSource !== undefined) {
    const n = Number(chSource);
    if (Number.isFinite(n)) {
      creditHours = n;
      creditHoursKnown = true;
    }
  }
  if (!creditHoursKnown) {
    console.warn("no credit hours found for section", raw.courseReferenceNumber, raw.subject, raw.courseNumber);
  }
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
    creditHours,
    creditHoursKnown,
    meetings,
  };
}

function meetingsOverlap(a, b) {
  if (a.start == null || a.end == null || b.start == null || b.end == null) return false; // TBA/arranged: can't conflict
  const sameDay = a.days.some((d, i) => d && b.days[i]);
  if (!sameDay) return false;
  return a.start < b.end && b.start < a.end;
}

function hasScheduledMeeting(sec) {
  return sec.meetings.some(m => m.start != null);
}

function sectionsConflict(secA, secB) {
  for (const ma of secA.meetings) {
    for (const mb of secB.meetings) {
      if (meetingsOverlap(ma, mb)) return true;
    }
  }
  return false;
}

function totalCredits(combo) {
  return combo.reduce((acc, s) => acc + (Number.isFinite(s.creditHours) ? s.creditHours : 0), 0);
}

function creditsLabel(combo) {
  return `${totalCredits(combo)} CH`;
}

// ---------- app state ---------------------------------------------------------

let terms = [];
let selectedTerm = null;
let requirements = []; // {id, subject, courseNumber, courseTitle, sections:[...], included:Set(crn), anchor:crn|null}
let reqCounter = 0;
let lastResults = [];
let currentCombo = null;

// ---------- term & subject loading ---------------------------------------------

async function loadTerms() {
  setSession(null, "loading terms&hellip;");
  const { ok, body } = await api("/api/terms", {}, "Loading terms");
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
  if (selectedTerm) {
    if (terms.some(t => t.code === selectedTerm)) sel.value = selectedTerm;
  } else {
    const preferred = terms.find(t => t.code === "202502");
    if (preferred) sel.value = "202502";
  }
  setSession(true, `${terms.length} terms found`);

  // If we restored a saved session, bring the UI back to where it was.
  if (selectedTerm) {
    $("#termHint").textContent = `active term: ${selectedTerm}`;
    $("#addCoursePanel").style.display = "block";
    if (requirements.length) {
      $("#requirementsPanel").style.display = "block";
      $("#generatePanel").style.display = "block";
      renderRequirements();
    }
    // Refresh the session term on the server side (best-effort, silent).
    await api("/api/term", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ term: selectedTerm }),
    }, "Term selection", true).catch(() => {});
    await loadSubjects(selectedTerm);
  }
}

async function useSelectedTerm() {
  const btn = $("#termLoadBtn");
  const code = $("#termSelect").value;
  if (!code) return;
  setBusy(btn, true, "setting term&hellip;");
  $("#termHint").textContent = "setting term&hellip;";
  const { ok, body } = await api("/api/term", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ term: code }),
  }, "Setting term");
  setBusy(btn, false);
  if (!ok) {
    $("#termHint").textContent = "failed to set term — see the banner above.";
    return;
  }
  selectedTerm = code;
  $("#termHint").textContent = `active term: ${code}`;
  saveState();
  await loadSubjects(code);
  $("#addCoursePanel").style.display = "block";
}

async function loadSubjects(term) {
  const { ok, body } = await api(`/api/subjects?term=${encodeURIComponent(term)}`, {}, "Loading subjects");
  const sel = $("#subjectSelect");
  sel.innerHTML = '<option value="">All subjects&hellip;</option>';
  if (!ok) return;
  const list = Array.isArray(body) ? body : (body.data || []);
  list.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s.code;
    opt.textContent = `${s.code} — ${s.description}`;
    sel.appendChild(opt);
  });
}

// ---------- section search & requirement building -----------------------------

async function findSections() {
  if (!selectedTerm) return;
  const btn = $("#findSectionsBtn");
  const subject = $("#subjectSelect").value;
  const courseNumber = $("#courseNumberInput").value.trim();
  const title = $("#titleInput").value.trim();

  const qs = new URLSearchParams({ term: selectedTerm });
  if (subject) qs.set("subject", subject);
  if (courseNumber) qs.set("courseNumber", courseNumber);
  if (title) qs.set("title", title);

  $("#searchResults").innerHTML = '<p class="hint">Searching&hellip;</p>';
  setBusy(btn, true, "searching&hellip;");
  const { ok, body } = await api(`/api/sections?${qs.toString()}`, {}, "Searching sections");
  setBusy(btn, false);
  if (!ok) {
    $("#searchResults").innerHTML = '<p class="hint">Search failed — see the banner above for details.</p>';
    return;
  }
  const rawList = body.data || [];
  if (rawList.length === 0) {
    $("#searchResults").innerHTML = '<p class="hint">No sections found for that search.</p>';
    return;
  }
  const sections = rawList.filter(Boolean).map(normalizeSection);

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
    bar.style.marginTop = "14px";
    bar.innerHTML = `
      <span class="hint" style="margin:0;">${groups.size} courses found —</span>
      <button type="button" class="btn btn-white btn-small" id="globalSelectAll">Select all sections</button>
      <button type="button" class="btn btn-white btn-small" id="globalSelectNone">Unselect all sections</button>
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
    <span class="row" style="gap:8px;">
      <span class="hint" style="margin:0;color:#ccc;">${group.sections.length} section(s)</span>
      <button type="button" class="btn btn-header btn-small select-all-btn">Select all</button>
      <button type="button" class="btn btn-header btn-small select-none-btn">Unselect all</button>
    </span>
  `;
  wrap.appendChild(head);

  group.sections.forEach(sec => {
    const row = document.createElement("div");
    row.className = "section-row";
    const isFull = sec.seatsAvailable != null && sec.seatsAvailable <= 0;
    row.innerHTML = `
      <input type="checkbox" class="sec-check" checked />
      <span class="crn">${sec.crn}</span>
      <span class="meet">${meetingSummary(sec)}</span>
      <span>${sec.instructor}</span>
      <span class="seats${isFull ? " full" : ""}">${isFull ? '<span class="full-badge">FULL</span>waitlist ok' : (sec.seatsAvailable != null ? sec.seatsAvailable + " seats" : "")}</span>
    `;
    row._section = sec;
    wrap.appendChild(row);
  });

  const btn = document.createElement("button");
  btn.className = "btn btn-black btn-small add-course-btn";
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
  if (included.size === 0) { showBanner("Nothing selected", "Check at least one section to add this course."); return; }

  reqCounter += 1;
  requirements.push({
    id: reqCounter,
    subject: group.subject,
    courseNumber: group.courseNumber,
    courseTitle: group.courseTitle,
    sections,
    included,
    anchor: null,
    pinDoctor: null,
  });
  renderRequirements();
  $("#requirementsPanel").style.display = "block";
  $("#generatePanel").style.display = "block";
  saveState();
}

function renderRequirements() {
  const list = $("#requirementsList");
  list.innerHTML = "";
  requirements.forEach(req => {
    const card = document.createElement("div");
    card.className = "req-card";
    const anchorSec = req.sections.find(s => s.crn === req.anchor);

    // Sections actually in play depend on whichever pin is active.
    let inPlay;
    if (req.anchor) {
      inPlay = req.sections.filter(s => req.included.has(s.crn) && s.crn === req.anchor);
    } else if (req.pinDoctor) {
      inPlay = req.sections.filter(s => req.included.has(s.crn) && s.instructor === req.pinDoctor);
    } else {
      inPlay = req.sections.filter(s => req.included.has(s.crn));
    }
    const availableCount = inPlay.length;
    const doctors = [...new Set(req.sections.map(s => s.instructor).filter(Boolean))].sort();

    card.innerHTML = `
      <div class="req-title">
        <span class="req-code">${req.subject} ${req.courseNumber}</span>${req.courseTitle || ""}
        <span class="req-count">${availableCount} section(s) in play</span>
        ${anchorSec ? `<span class="pin-tag">pinned: CRN ${anchorSec.crn} · ${meetingSummary(anchorSec)}</span>` : ""}
        ${req.pinDoctor ? `<span class="pin-tag">pinned doctor: ${req.pinDoctor}</span>` : ""}
      </div>
      <div class="req-controls">
        <select class="pin-select">
          <option value="">No section pin</option>
          ${req.sections.map(s => `<option value="${s.crn}" ${req.anchor === s.crn ? "selected" : ""}>Pin CRN ${s.crn} — ${meetingSummary(s)}</option>`).join("")}
        </select>
        <select class="doctor-select">
          <option value="">No doctor pin</option>
          ${doctors.map(inst => `<option value="${inst}" ${req.pinDoctor === inst ? "selected" : ""}>Pin doctor: ${inst}</option>`).join("")}
        </select>
        <button class="btn btn-white btn-small remove-btn">Remove</button>
      </div>
    `;
    card.querySelector(".pin-select").onchange = (e) => {
      req.anchor = e.target.value || null;
      if (req.anchor) req.pinDoctor = null; // section pin wins over doctor pin
      renderRequirements();
      saveState();
    };
    card.querySelector(".doctor-select").onchange = (e) => {
      req.pinDoctor = e.target.value || null;
      if (req.pinDoctor) req.anchor = null; // doctor pin wins over section pin
      renderRequirements();
      saveState();
    };
    card.querySelector(".remove-btn").onclick = () => { requirements = requirements.filter(r => r.id !== req.id); renderRequirements(); saveState(); };
    list.appendChild(card);
  });
}

// ---------- schedule generation -----------------------------------------------

function generateSchedules() {
  if (requirements.length === 0) return;
  const btn = $("#generateBtn");
  setBusy(btn, true, "building&hellip;");
  $("#generateStatus").textContent = "Building&hellip;";

  const pools = requirements.map(req => {
    if (req.anchor) {
      const s = req.sections.find(sec => sec.crn === req.anchor);
      return [s]; // a pinned section is included even if its time is TBA/arranged
    }
    let candidates = req.sections.filter(s => req.included.has(s.crn));
    if (req.pinDoctor) {
      candidates = candidates.filter(s => s.instructor === req.pinDoctor);
    }
    return candidates.filter(hasScheduledMeeting); // TBA/arranged sections aren't usable unless pinned
  });

  if (pools.some(p => p.length === 0)) {
    $("#generateStatus").textContent = "One of your courses has no timed (non-TBA) sections in play. Pin a specific section to include it even if its time is TBA, or adjust your pins above.";
    setBusy(btn, false);
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
    setBusy(btn, false);
    return;
  }

  const modes = selectedSortModes();
  if (modes.length === 0) {
    $("#generateStatus").textContent = "Pick at least one ranking criterion above.";
    setBusy(btn, false);
    return;
  }

  const raw = results.map(combo => modes.map(m => scoreCombo(combo, m)));
  const mins = modes.map((_, i) => Math.min(...raw.map(r => r[i])));
  const maxs = modes.map((_, i) => Math.max(...raw.map(r => r[i])));
  const scored = raw.map((scores, idx) => ({
    combo: results[idx],
    score: scores.reduce((acc, s, i) => {
      const span = maxs[i] - mins[i];
      return acc + (span > 0 ? (s - mins[i]) / span : 0);
    }, 0),
  }));
  scored.sort((a, b) => a.score - b.score);

  lastResults = scored.map(s => s.combo);
  $("#generateStatus").textContent = `${results.length} valid combination(s) found${explored > MAX_EXPLORED ? " (search capped — narrow your options for a full count)" : ""}.`;
  setBusy(btn, false);
  renderResults();
}

function dailyIntervals(combo) {
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

// ---------- results rendering ------------------------------------------------

function renderResults() {
  $("#resultsPanel").style.display = "block";
  const shown = lastResults.slice(0, 20);
  $("#resultsMeta").textContent = `${shown.length} of ${lastResults.length} option(s), best first.`;

  const tabs = $("#resultsTabs");
  tabs.innerHTML = "";
  shown.forEach((combo, i) => {
    const b = document.createElement("button");
    b.className = "tab-btn" + (i === 0 ? " active" : "");
    b.textContent = `Option ${i + 1} · ${creditsLabel(combo)}`;
    b.onclick = () => {
      [...tabs.children].forEach(c => c.classList.remove("active"));
      b.classList.add("active");
      drawWeekGrid(combo);
    };
    tabs.appendChild(b);
  });
  if (shown.length) drawWeekGrid(shown[0]);
}

function courseKey(sec) {
  return `${sec.subject} ${sec.courseNumber}`;
}

function buildCourseColorMap(combo) {
  // One consistent color per COURSE across the whole session, stable across options.
  const keys = [...new Set(combo.map(courseKey))].sort();
  const map = {};
  keys.forEach((k, i) => { map[k] = COURSE_FILLS[i % COURSE_FILLS.length]; });
  return map;
}

function drawWeekGrid(combo) {
  currentCombo = combo;
  const grid = $("#resultsGrid");
  grid.innerHTML = "";

  const usedDays = [0,1,2,3,4,5,6].filter(i => combo.some(sec => sec.meetings.some(m => m.days[i] && m.start != null)));
  const days = usedDays.length ? usedDays : [0,1,2,3,4]; // default Sun-Thu if nothing timed

  const PX_PER_MIN = 1.0;
  const GRID_PAD = 12; // headroom so the first/last hour labels are never clipped

  // Fit the time window to the classes actually in this schedule.
  let minStart = null, maxEnd = null;
  combo.forEach(sec => sec.meetings.forEach(m => {
    if (m.start == null) return;
    if (minStart == null || m.start < minStart) minStart = m.start;
    if (maxEnd == null || m.end > maxEnd) maxEnd = m.end;
  }));
  const DAY_START = minStart == null ? 7 * 60 : Math.max(6 * 60, Math.floor((minStart - 30) / 60) * 60);
  const DAY_END = maxEnd == null ? 19 * 60 : Math.min(22 * 60, Math.ceil((maxEnd + 30) / 60) * 60);
  const gridHeight = (DAY_END - DAY_START) * PX_PER_MIN;

  const colorMap = buildCourseColorMap(combo);

  // Legend: swatch per course so the grid is readable without hovering.
  const legend = document.createElement("div");
  legend.className = "week-legend";
  Object.entries(colorMap).forEach(([key, fill]) => {
    const item = document.createElement("span");
    item.className = "legend-item";
    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    swatch.style.background = fill.bg;
    item.appendChild(swatch);
    const label = document.createElement("span");
    label.textContent = key;
    item.appendChild(label);
    legend.appendChild(item);
  });
  grid.appendChild(legend);

  // Scroll wrapper: keeps the grid readable at narrow widths instead of squeezing.
  const scroll = document.createElement("div");
  scroll.className = "week-scroll";

  const week = document.createElement("div");
  week.className = "week-grid";

  // Day-of-week header (sticky so it stays visible while the page scrolls).
  const head = document.createElement("div");
  head.className = "week-head";
  head.style.gridTemplateColumns = `54px repeat(${days.length}, 1fr)`;
  head.appendChild(Object.assign(document.createElement("div"), { textContent: "" }));
  days.forEach(d => head.appendChild(Object.assign(document.createElement("div"), { textContent: DAY_LABELS[d] })));
  week.appendChild(head);

  const body = document.createElement("div");
  body.className = "week-body";
  body.style.display = "grid";
  body.style.gridTemplateColumns = `54px repeat(${days.length}, 1fr)`;
  body.style.height = (gridHeight + GRID_PAD * 2) + "px";
  body.style.position = "relative";

  // Hour labels (with AM/PM) down the left edge.
  const hourCol = document.createElement("div");
  hourCol.className = "hour-col";
  hourCol.style.position = "relative";
  for (let h = DAY_START / 60; h <= DAY_END / 60; h++) {
    const lbl = document.createElement("div");
    lbl.className = "hour-label";
    lbl.textContent = h === 0 ? "12AM" : h < 12 ? `${h}AM` : h === 12 ? "12PM" : `${h - 12}PM`;
    lbl.style.position = "absolute";
    lbl.style.top = (GRID_PAD + (h * 60 - DAY_START) * PX_PER_MIN) + "px";
    lbl.style.transform = "translateY(-50%)";
    hourCol.appendChild(lbl);
  }
  body.appendChild(hourCol);

  days.forEach(d => {
    const col = document.createElement("div");
    col.className = "day-col";
    col.style.position = "relative";
    body.appendChild(col);
  });

  const colEls = [...body.children].slice(1);
  combo.forEach(sec => {
    const fill = colorMap[courseKey(sec)];
    sec.meetings.forEach(m => {
      if (m.start == null) return;
      days.forEach((d, colIdx) => {
        if (!m.days[d]) return;
        const block = document.createElement("div");
        block.className = "class-block";
        block.style.top = (GRID_PAD + (m.start - DAY_START) * PX_PER_MIN) + "px";
        block.style.height = Math.max((m.end - m.start) * PX_PER_MIN - 2, 26) + "px";
        block.style.background = fill.bg;
        block.style.color = fill.fg;
        const room = [m.building, m.room].filter(Boolean).join(" ");
        block.innerHTML = `<span class="b-code">${courseKey(sec)}</span><span class="b-time">${fmtTime(m.start)}–${fmtTime(m.end)}</span><span class="b-room">${room || "room TBA"}</span>`;
        block.title = `CRN ${sec.crn} · ${sec.instructor} · ${room || "room TBA"}`;
        colEls[colIdx].appendChild(block);
      });
    });
  });

  week.appendChild(body);
  scroll.appendChild(week);
  grid.appendChild(scroll);

  // Conflict-free confirmation strip.
  const confirm = document.createElement("div");
  confirm.className = "confirm-strip";
  confirm.textContent = `✓ conflict-free · ${creditsLabel(combo)} · no overlapping sections`;
  grid.appendChild(confirm);

  // Detailed breakdown of every section in this schedule (below the grid).
  const detailList = document.createElement("div");
  detailList.className = "schedule-details";
  detailList.innerHTML = `
    <div class="sd-head"><span>course</span><span>day / time</span><span>room</span><span>instructor</span><span>CRN</span><span>CH</span></div>
  `;
  combo.forEach(sec => {
    const timed = sec.meetings.filter(m => m.start != null);
    const rows = timed.length ? timed : [null];
    rows.forEach((m, ri) => {
      const row = document.createElement("div");
      row.className = "sd-row";
      const first = ri === 0;
      const courseCell = first
        ? `<span class="sd-code">${courseKey(sec)}</span><span class="sd-title">${sec.courseTitle || ""}</span>`
        : "";
      let timeCell, roomCell;
      if (m) {
        const md = DAY_LABELS.filter((_, di) => m.days[di]).join("");
        timeCell = `<span class="sd-time">${md} ${fmtTime(m.start)}–${fmtTime(m.end)}</span>`;
        roomCell = `<span>${[m.building, m.room].filter(Boolean).join(" ") || "TBA"}</span>`;
      } else {
        timeCell = `<span class="sd-time">arranged / TBA</span>`;
        roomCell = "<span>—</span>";
      }
      row.innerHTML = `
        <div class="sd-course">${courseCell}</div>
        ${timeCell}
        ${roomCell}
        <span>${first ? sec.instructor : ""}</span>
        <span class="sd-crn">${first ? sec.crn : ""}</span>
        <span class="sd-ch">${first ? (sec.creditHoursKnown ? `${sec.creditHours} CH` : "CH ?") : ""}</span>
      `;
      detailList.appendChild(row);
    });
  });
  grid.appendChild(detailList);

  $("#tbaNotice").hidden = true;
}

// ---------- export: copy as text ------------------------------------------

function copyScheduleText() {
  if (!currentCombo) return;
  const term = selectedTerm || "selected term";
  const lines = [];
  lines.push(`SCHEDULE BUILDER — TERM ${term}`);
  lines.push(`${creditsLabel(currentCombo)} · CONFLICT-FREE ✓`);
  lines.push("");
  currentCombo.forEach((sec, i) => {
    const timed = sec.meetings.filter(m => m.start != null);
    const untimedCount = sec.meetings.length - timed.length;
    if (timed.length) {
      timed.forEach(m => {
        const days = DAY_LABELS.filter((_, di) => m.days[di]).join("");
        const room = [m.building, m.room].filter(Boolean).join(" ") || "";
        lines.push(`${i + 1}. ${sec.subject} ${sec.courseNumber} ${sec.courseTitle || ""} — CRN ${sec.crn}`);
        lines.push(`   ${days} ${fmtTime(m.start)}–${fmtTime(m.end)}${room ? " · " + room : ""}`);
      });
    } else {
      lines.push(`${i + 1}. ${sec.subject} ${sec.courseNumber} ${sec.courseTitle || ""} — CRN ${sec.crn}`);
      lines.push(`   arranged / TBA`);
    }
    if (untimedCount) lines.push(`   (+ ${untimedCount} arranged/TBA meeting${untimedCount > 1 ? "s" : ""})`);
  });
  const text = lines.join("\n");

  const done = () => { $("#exportStatus").textContent = "copied ✓"; };
  const fail = () => { showBanner("Copy failed", "Clipboard blocked — copy manually from the text below."); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(fail);
  } else {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); done(); } catch { fail(); }
    ta.remove();
  }
}

// ---------- technical log toggle ----------------------------------------------

function toggleDebug() {
  const panel = $("#debugPanel");
  const btn = $("#debugToggle");
  const show = panel.hidden;
  panel.hidden = !show;
  btn.textContent = show ? "Hide technical log" : "Show technical log";
}

// ---------- wire up -----------------------------------------------------------

$("#termLoadBtn").onclick = useSelectedTerm;
$("#findSectionsBtn").onclick = findSections;
$("#generateBtn").onclick = generateSchedules;
$("#bannerClose").onclick = dismissBanner;
$("#copyTextBtn").onclick = copyScheduleText;
document.querySelectorAll(".rank-opt input").forEach(cb => cb.addEventListener("change", saveState));
$("#debugToggle").onclick = toggleDebug;
document.getElementById("feedbackLink").href = FEEDBACK_URL;

restoreState();
loadTerms();