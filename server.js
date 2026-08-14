// Bahrain Polytechnic Schedule Builder — local proxy + server
//
// Why this exists: ban-reg.polytechnic.bh is a Banner 9 (Ellucian) system.
// Its "browse classes without signing in" feature works, but the real data
// loads through background JSON calls that are tied to a server-side
// session cookie. A plain static webpage hosted elsewhere can't make those
// calls directly (the browser won't forward the session cookie cross-site,
// and the university's server almost certainly doesn't send back
// permissive CORS headers). Running this small server on YOUR OWN machine
// sidesteps both problems: the server talks to Banner (server-to-server,
// no CORS involved) and your browser talks to the server (same origin,
// no CORS involved either).
//
// Requires Node.js 18+ (for built-in fetch). No other network services
// are contacted except ban-reg.polytechnic.bh.

const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");

const BASE = "https://ban-reg.polytechnic.bh/StudentRegistrationSsb/ssb";

const app = express();
app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
      },
    },
  })
);
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// --- basic hardening on the proxy routes -----------------------------------
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests — slow down a little." },
});
app.use("/api", apiLimiter);

// Only letters and digits are valid for term/subject/courseNumber.
function isAlphaNum(value) {
  return typeof value === "string" && /^[A-Za-z0-9]+$/.test(value);
}
function isFreeText(value) {
  return typeof value === "string" && /^[A-Za-z0-9 ]*$/.test(value);
}
function rejectBadParams(required, optional) {
  return (req, res, next) => {
    for (const key of required) {
      const v = req.query[key] ?? req.body?.[key];
      if (v === undefined || v === "" || !isAlphaNum(v)) {
        return res
          .status(400)
          .json({ error: `Invalid ${key}: letters and numbers only, please.` });
      }
    }
    for (const key of optional || []) {
      const v = req.query[key];
      if (v !== undefined && v !== "" && !isFreeText(v)) {
        return res
          .status(400)
          .json({ error: `Invalid ${key}: letters and numbers only, please.` });
      }
    }
    next();
  };
}

// --- tiny in-memory cookie jar -------------------------------------------
// Banner ties "which term did you select" to a session cookie. Since this
// tool is for one person on their own machine, a single global jar is fine.
let cookieJar = "";

function storeCookies(res) {
  const setCookie = res.headers.getSetCookie
    ? res.headers.getSetCookie()
    : res.headers.raw
    ? res.headers.raw()["set-cookie"] || []
    : [];
  if (!setCookie || setCookie.length === 0) return;
  const existing = {};
  cookieJar.split(";").forEach((p) => {
    const [k, v] = p.trim().split("=");
    if (k) existing[k] = v;
  });
  setCookie.forEach((c) => {
    const [pair] = c.split(";");
    const [k, v] = pair.split("=");
    if (k) existing[k.trim()] = v;
  });
  cookieJar = Object.entries(existing)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

async function bannerFetch(pathAndQuery, options = {}) {
  const url = `${BASE}${pathAndQuery}`;
  const headers = Object.assign(
    {
      Accept: "application/json, text/plain, */*",
      "User-Agent": "Mozilla/5.0 (schedule-builder local tool)",
    },
    options.headers || {}
  );
  if (cookieJar) headers.Cookie = cookieJar;

  const res = await fetch(url, { ...options, headers, redirect: "manual" });
  storeCookies(res);
  return res;
}

async function ensureSession() {
  if (!cookieJar) {
    // First contact: just hitting any page on the domain gives us the
    // initial session cookie, same as a browser landing on the site.
    await bannerFetch("/term/termSelection?mode=search");
  }
}

// --- routes ----------------------------------------------------------------

// List available terms, e.g. [{code:"202502", description:"Spring 2025-2026"}, ...]
app.get("/api/terms", async (req, res) => {
  try {
    await ensureSession();
    const r = await bannerFetch(
      "/classSearch/getTerms?searchTerm=&offset=1&max=50"
    );
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res
        .status(502)
        .json({ error: "Banner did not return JSON for terms", raw: text.slice(0, 1000), status: r.status });
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Select a term for the session (must be called before subjects/sections)
app.post("/api/term", rejectBadParams(["term"]), async (req, res) => {
  try {
    const { term } = req.body;
    if (!term) return res.status(400).json({ error: "term is required" });
    await ensureSession();

    const body = new URLSearchParams({
      term,
      studyPath: "",
      studyPathText: "",
      startDatepicker: "",
      endDatepicker: "",
      uniqueSessionId: `sb${Date.now()}`,
    });

    const r = await bannerFetch("/term/search?mode=search", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const text = await r.text();

    // Some Banner instances also want this call to reset prior search state
    await bannerFetch("/classSearch/resetDataForm").catch(() => {});

    res.json({ ok: r.ok, status: r.status, raw: text.slice(0, 500) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// List subjects for the currently selected term
app.get("/api/subjects", rejectBadParams(["term"]), async (req, res) => {
  try {
    const term = req.query.term;
    if (!term) return res.status(400).json({ error: "term is required" });
    const r = await bannerFetch(
      `/classSearch/get_subject?term=${encodeURIComponent(
        term
      )}&offset=1&max=200&searchTerm=`
    );
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res
        .status(502)
        .json({ error: "Banner did not return JSON for subjects", raw: text.slice(0, 1000), status: r.status });
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Search sections. Query: term, subject, courseNumber (optional), title (optional keyword)
app.get(
  "/api/sections",
  rejectBadParams(["term"], ["subject", "courseNumber", "title"]),
  async (req, res) => {
  try {
    const { term, subject, courseNumber, title } = req.query;
    if (!term) return res.status(400).json({ error: "term is required" });

    // Banner keeps the previous search's filters "sticky" in the session
    // unless this is called right before every new search — without it,
    // changing the subject/course number and searching again silently
    // returns the same results as the last search.
    await bannerFetch("/classSearch/resetDataForm").catch(() => {});

    const qs = new URLSearchParams({
      txt_term: term,
      pageOffset: "0",
      pageMaxSize: "500",
      sortColumn: "subjectDescription",
      sortDirection: "asc",
      uniqueSessionId: `sb${Date.now()}`,
    });
    if (subject) qs.set("txt_subject", subject);
    if (courseNumber) qs.set("txt_courseNumber", courseNumber);
    if (title) qs.set("txt_courseTitle", title);

    const r = await bannerFetch(`/searchResults/searchResults?${qs.toString()}`);
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(502).json({
        error: "Banner did not return JSON for section search",
        raw: text.slice(0, 1500),
        status: r.status,
        urlTried: `${BASE}/searchResults/searchResults?${qs.toString()}`,
      });
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Debug helper: clears the stored session so you can start fresh
app.post("/api/reset-session", (req, res) => {
  cookieJar = "";
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Schedule Builder running: http://localhost:${PORT}`);
});
