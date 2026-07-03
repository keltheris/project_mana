import React, { useState, useCallback, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, ChevronDown, Check, Loader2, Copy, RotateCcw, SkipForward, AlertTriangle, ExternalLink, ZoomIn, X, Home } from "lucide-react";
import { ROOT_BG, PANEL_BG, ACCENT, TEAL, TEXT, SUBTEXT } from "./theme";
import FeedbackWidget from "./FeedbackWidget";

const TCGPLAYER_MASS_ENTRY_URL = "https://www.tcgplayer.com/massentry";

const SAMPLE_LIST = `1 Kess, Dissident Mage
1 Watery Grave
1 Blood Crypt
5 Island
5 Swamp
4 Mountain
1 Sol Ring
1 Rhystic Study
1 Counterspell
1 Cyclonic Rift
1 Damnation
1 Snapcaster Mage
1 Dark Confidant
1 Grave Titan`;

// Bounds on what a pasted decklist can contain — not just tidiness, but a
// cap on how much downstream work one paste can trigger: each entry fires
// its own /api/prints request in handleCompile, and an unbounded paste (or
// one absurd "quantity") turns into unbounded outbound calls, some of which
// fall through to a live Scryfall lookup on a cache miss.
const MAX_RAW_TEXT_LENGTH = 20000;
const MAX_ENTRIES = 500;
const MAX_QTY = 999;
const MAX_NAME_LENGTH = 200; // no real card name is anywhere close to this

function parseList(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const map = new Map();
  for (const line of lines) {
    const m = line.match(/^(\d+)\s+(.+)$/);
    if (!m) continue;
    const qty = Math.min(parseInt(m[1], 10), MAX_QTY);
    const name = m[2].trim().slice(0, MAX_NAME_LENGTH);
    if (!name) continue;
    map.set(name, Math.min((map.get(name) || 0) + qty, MAX_QTY));
  }
  return Array.from(map.entries()).map(([name, qty]) => ({ name, qty }));
}

const API_BASE = import.meta.env.VITE_API_BASE || "";

// Reads from the daily manifest built by worker/src/index.js instead of
// hitting Scryfall's live search API on every visitor's page load. See
// README.md and worker/README.md for the full architecture.
async function fetchPrints(name) {
  const url = `${API_BASE}/api/prints?name=${encodeURIComponent(name)}`;
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`Manifest API returned ${res.status} for "${name}"`);
  }
  const json = await res.json();
  return Array.isArray(json) ? json.filter((o) => o.image) : [];
}

function minPrice(o) {
  const vals = [o.prices?.usd, o.prices?.usdFoil, o.prices?.usdEtched].filter((v) => v != null);
  return vals.length ? Math.min(...vals) : null;
}

// TCGplayer's Mass Entry [SET] CN matching is unreliable for these
// categories, confirmed against real TCGplayer product pages: Secret Lair
// Drop numbers are a display-name disambiguator rather than a matchable
// card-number field, and special treatment variants (Borderless, Showcase,
// etc.) are catalogued by descriptive name instead of number. A missing
// tcgplayerId means Scryfall itself has no known TCGplayer product to
// match, and promos are rarely sold there at all.
function isMassEntryRisky(o) {
  return !!(o.promo || o.treatment || o.set === "SLD" || !o.tcgplayerId);
}

// Nobody picking a deck's art cares which printing of a basic land they get,
// and defaulting to "cheapest" here just means a random, possibly ugly, art
// gets silently baked into the export. Leaving these unresolved and passing
// the plain qty/name straight through — same as what the player typed — is
// more useful than a specific printing they never asked for.
const BASIC_LAND_NAMES = new Set(
  ["Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes"].flatMap((n) => [
    n.toLowerCase(),
    `snow-covered ${n.toLowerCase()}`,
  ])
);
function isBasicLand(name) {
  return BASIC_LAND_NAMES.has(name.trim().toLowerCase());
}

function massEntryLine(l) {
  if (l.missing) return `${l.qty} ${l.name}   [NOT FOUND — verify manually]`;
  if (l.basic) return `${l.qty} ${l.name}`;
  return `${l.qty} ${l.name} [${l.set}] ${l.cn}`;
}

// Unlike the Mass Entry syntax, this doesn't need to exactly match a
// [SET] collector-number pair — it just needs to contain words TCGplayer's
// own product search can find, so it holds up for prints (Secret Lair,
// promos, special treatments) that Mass Entry's strict matching rejects.
function searchableLine(l) {
  if (l.missing) return `${l.qty} ${l.name}   [NOT FOUND — verify manually]`;
  if (l.basic) return `${l.qty} ${l.name}`;
  const treatment = l.treatment ? ` · ${l.treatment}` : "";
  return `${l.qty} ${l.name} — ${l.setName} (${l.set}) #${l.cn}${treatment}`;
}

const MASS_ENTRY_PREFILL_MAX_URL_LENGTH = 6000;

// TCGplayer's Mass Entry page reads a `c` query param to pre-seed its own
// textbox (each entry prefixed with `||`), so this still goes through the
// same fuzzy set/number matching as a manual paste — it only removes the
// copy/paste step, it doesn't fix what Mass Entry gets wrong.
function buildMassEntryPrefillUrl(lines) {
  const c = lines.map((l) => `||${massEntryLine(l)}`).join("");
  const url = `${TCGPLAYER_MASS_ENTRY_URL}?productline=Magic&c=${encodeURIComponent(c)}`;
  return url.length <= MASS_ENTRY_PREFILL_MAX_URL_LENGTH ? url : TCGPLAYER_MASS_ENTRY_URL;
}

function cheapestOf(opts) {
  const priced = opts.filter((o) => minPrice(o) != null);
  const pool = priced.length ? priced : opts;
  return pool.reduce((best, o) => {
    const bestP = minPrice(best);
    const p = minPrice(o);
    return p != null && (bestP == null || p < bestP) ? o : best;
  }, pool[0]);
}

export default function App() {
  const [stage, setStage] = useState("input"); // input | loading | review | done
  const [rawText, setRawText] = useState("");
  const [entries, setEntries] = useState([]);
  const [printOptions, setPrintOptions] = useState({});
  const [progress, setProgress] = useState({ done: 0, total: 0, current: "" });
  const [selections, setSelections] = useState({});
  const [reviewIndex, setReviewIndex] = useState(0);
  const [visibleCount, setVisibleCount] = useState(24);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [zoomed, setZoomed] = useState(null);
  const [outputTab, setOutputTab] = useState("search"); // search | massentry
  const [doneChecks, setDoneChecks] = useState({}); // key -> true, for the direct-links checklist
  const [showImportHelp, setShowImportHelp] = useState(false);
  const compileRunId = useRef(0);
  const zoomCloseRef = useRef(null);
  const zoomReturnFocusRef = useRef(null);

  // Standard modal focus handling: move focus into the zoom overlay when it
  // opens (so the background grid isn't left silently eating keystrokes)
  // and hand it back to whatever triggered the zoom when it closes.
  useEffect(() => {
    if (zoomed) {
      zoomReturnFocusRef.current = document.activeElement;
      zoomCloseRef.current?.focus();
    } else if (zoomReturnFocusRef.current) {
      zoomReturnFocusRef.current.focus();
      zoomReturnFocusRef.current = null;
    }
  }, [zoomed]);

  const handleCompile = useCallback(async () => {
    if (rawText.length > MAX_RAW_TEXT_LENGTH) {
      setError(`That list is too long (max ${MAX_RAW_TEXT_LENGTH.toLocaleString()} characters) — try splitting it into smaller batches.`);
      return;
    }
    const parsed = parseList(rawText);
    if (parsed.length === 0) {
      setError('No cards found. Use one card per line, formatted like "1 Card Name".');
      return;
    }
    if (parsed.length > MAX_ENTRIES) {
      setError(`That's ${parsed.length} distinct cards — max is ${MAX_ENTRIES} per list. Try splitting it into smaller batches.`);
      return;
    }
    setError(null);
    setEntries(parsed);
    setStage("loading");
    const runId = ++compileRunId.current;
    const opts = {};
    for (let i = 0; i < parsed.length; i++) {
      const { name } = parsed[i];
      setProgress({ done: i, total: parsed.length, current: name });
      try {
        opts[name] = await fetchPrints(name);
      } catch (e) {
        opts[name] = [];
      }
      if (compileRunId.current !== runId) return; // user navigated away (e.g. Start Over) mid-load
    }
    setProgress({ done: parsed.length, total: parsed.length, current: "" });
    setPrintOptions(opts);
    setStage("review");
    setReviewIndex(0);
    setVisibleCount(24);
  }, [rawText]);

  const toggleSelect = (name, id) => {
    setSelections((prev) => {
      const next = { ...prev };
      const set = new Set(next[name] || []);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      next[name] = set;
      return next;
    });
  };

  const clearSelection = (name) => {
    setSelections((prev) => ({ ...prev, [name]: new Set() }));
  };

  const goNext = () => {
    if (reviewIndex + 1 >= entries.length) {
      setStage("done");
    } else {
      setReviewIndex((i) => i + 1);
      setVisibleCount(24);
    }
  };
  const goPrev = () => {
    if (reviewIndex > 0) {
      setReviewIndex((i) => i - 1);
      setVisibleCount(24);
    }
  };

  // Shared by the review grid's render and the keyboard handler below, so
  // arrow-key navigation inside the zoom view walks the same ordering the
  // grid displays instead of computing it a second, possibly different, way.
  const sortedOptsFor = (name) => {
    const opts = printOptions[name] || [];
    return [...opts].sort((a, b) => Number(isMassEntryRisky(a)) - Number(isMassEntryRisky(b)));
  };

  // Card-to-card navigation (when nothing is zoomed) and in-zoom navigation
  // both live here rather than as separate effects, since both keys (arrows)
  // mean different things depending on whether the zoom overlay is open.
  useEffect(() => {
    const onKey = (e) => {
      if (zoomed) {
        const { name } = entries[reviewIndex] || {};
        if (!name) return;
        if (e.key === "Escape") {
          setZoomed(null);
        } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          const list = sortedOptsFor(name);
          const idx = list.findIndex((o) => o.id === zoomed.id);
          const next = list[e.key === "ArrowRight" ? idx + 1 : idx - 1];
          if (next) {
            e.preventDefault();
            setZoomed(next);
          }
        } else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleSelect(name, zoomed.id);
        }
        return;
      }

      if (stage !== "review") return;
      const tag = document.activeElement?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;

      if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomed, stage, reviewIndex, entries, printOptions]);

  const buildOutput = () => {
    const lines = [];
    let total = 0;
    let unresolved = 0;
    for (const { name, qty } of entries) {
      const opts = printOptions[name] || [];
      const sel = selections[name] ? Array.from(selections[name]) : [];
      if (opts.length === 0) {
        lines.push({ qty, name, set: null, cn: null, price: null, missing: true, key: `${name}::missing` });
        unresolved++;
        continue;
      }
      if (sel.length === 0 && isBasicLand(name)) {
        lines.push({ qty, name, set: null, cn: null, price: null, basic: true, key: `${name}::basic` });
      } else if (sel.length === 0) {
        const p = cheapestOf(opts);
        lines.push({ qty, name, set: p.set, setName: p.setName, cn: p.cn, treatment: p.treatment, price: minPrice(p), tcgplayerId: p.tcgplayerId, risky: isMassEntryRisky(p), key: `${name}::${p.id}` });
        total += (minPrice(p) || 0) * qty;
      } else if (sel.length === 1) {
        const p = opts.find((o) => o.id === sel[0]);
        lines.push({ qty, name, set: p.set, setName: p.setName, cn: p.cn, treatment: p.treatment, price: minPrice(p), tcgplayerId: p.tcgplayerId, risky: isMassEntryRisky(p), key: `${name}::${p.id}` });
        total += (minPrice(p) || 0) * qty;
      } else {
        sel.forEach((id) => {
          const p = opts.find((o) => o.id === id);
          if (p) {
            lines.push({ qty: 1, name, set: p.set, setName: p.setName, cn: p.cn, treatment: p.treatment, price: minPrice(p), tcgplayerId: p.tcgplayerId, risky: isMassEntryRisky(p), key: `${name}::${p.id}` });
            total += minPrice(p) || 0;
          }
        });
      }
    }
    return { lines, total, unresolved };
  };

  const reset = () => {
    compileRunId.current++; // invalidate any in-flight handleCompile loop
    setStage("input");
    setRawText("");
    setEntries([]);
    setPrintOptions({});
    setSelections({});
    setReviewIndex(0);
    setError(null);
    setCopied(false);
    setZoomed(null);
    setOutputTab("search");
    setDoneChecks({});
  };

  const fontImport = (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
      * { box-sizing: border-box; }
      .fraunces { font-family: 'Fraunces', serif; }
      .inter { font-family: 'Inter', sans-serif; }
      .mono { font-family: 'IBM Plex Mono', monospace; }
      ::selection { background: #b23a48; color: #ece4d3; }
      .art-zoom-btn { opacity: 0.7; transition: opacity 0.15s, transform 0.15s; }
      .art-card:hover .art-zoom-btn, .art-card:focus-within .art-zoom-btn { opacity: 1; transform: translate(-50%, -50%) scale(1.08); }
      .art-card:focus-visible, .art-zoom-btn:focus-visible { outline: 2px solid ${TEAL}; outline-offset: 2px; }
    `}</style>
  );

  const feedbackWidget = <FeedbackWidget stage={stage} />;

  const betaPill = (
    <span
      className="mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        marginLeft: 8,
        fontSize: 9.5,
        letterSpacing: "0.08em",
        padding: "2px 6px",
        borderRadius: 3,
        background: "rgba(178,58,72,0.15)",
        color: ACCENT,
        border: "1px solid rgba(178,58,72,0.4)",
        verticalAlign: "middle",
      }}
    >
      BETA
    </span>
  );

  const homeButton = (
    <button
      onClick={reset}
      title="Start over"
      className="inter"
      style={{
        position: "fixed",
        top: 16,
        left: 16,
        display: "flex",
        alignItems: "center",
        gap: 5,
        background: PANEL_BG,
        color: SUBTEXT,
        border: "1px solid #2a323d",
        borderRadius: 6,
        padding: "7px 11px",
        fontSize: 12.5,
        cursor: "pointer",
        zIndex: 50,
      }}
    >
      <Home size={13} /> Start over
    </button>
  );

  // ---------- INPUT STAGE ----------
  if (stage === "input") {
    return (
      <div className="inter" style={{ minHeight: "100vh", background: ROOT_BG, color: TEXT, padding: "48px 20px" }}>
        {fontImport}
        {feedbackWidget}
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          <div className="mono" style={{ color: TEAL, fontSize: 12, letterSpacing: "0.15em", marginBottom: 8 }}>
            PROJECT MANA · EVERY PRINTING, YOUR PICK{betaPill}
          </div>
          <h1 className="fraunces" style={{ fontSize: 34, fontWeight: 700, margin: "0 0 8px", lineHeight: 1.15 }}>
            Choose your printings
          </h1>
          <p style={{ color: SUBTEXT, fontSize: 15, lineHeight: 1.6, margin: "0 0 28px" }}>
            Paste your list below — one card per line, formatted as <span className="mono">qty card name</span>. You'll
            page through every card one at a time and pick the art you want. Skip any card to default to the cheapest
            printing.
          </p>
          <p style={{ color: SUBTEXT, fontSize: 13, lineHeight: 1.6, margin: "0 0 28px" }}>
            <strong style={{ color: TEXT }}>This is a beta.</strong> Printing data and export formatting may
            occasionally be off — if something looks wrong, use the "Feedback" button in the corner to let me know.
          </p>
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder={"1 Kess, Dissident Mage\n1 Watery Grave\n5 Island\n1 Sol Ring\n..."}
            className="mono"
            style={{
              width: "100%",
              minHeight: 220,
              background: PANEL_BG,
              border: "1px solid #2a323d",
              borderRadius: 6,
              color: TEXT,
              padding: 16,
              fontSize: 13.5,
              lineHeight: 1.6,
              resize: "vertical",
              outline: "none",
            }}
            onFocus={(e) => (e.target.style.borderColor = TEAL)}
            onBlur={(e) => (e.target.style.borderColor = "#2a323d")}
          />
          {error && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", color: ACCENT, fontSize: 13.5, marginTop: 10 }}>
              <AlertTriangle size={15} /> {error}
            </div>
          )}
          <div style={{ display: "flex", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
            <button
              onClick={handleCompile}
              className="inter"
              style={{
                background: ACCENT,
                color: "#fff",
                border: "none",
                borderRadius: 6,
                padding: "12px 22px",
                fontSize: 14.5,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Load card options
            </button>
            <button
              onClick={() => setRawText(SAMPLE_LIST)}
              className="inter"
              style={{
                background: "transparent",
                color: SUBTEXT,
                border: "1px solid #2a323d",
                borderRadius: 6,
                padding: "12px 22px",
                fontSize: 14.5,
                cursor: "pointer",
              }}
            >
              Use sample list
            </button>
          </div>

          <button
            onClick={() => setShowImportHelp((v) => !v)}
            className="mono"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              background: "transparent",
              border: "none",
              color: TEAL,
              fontSize: 12,
              padding: 0,
              marginTop: 22,
              cursor: "pointer",
            }}
          >
            <ChevronDown size={13} style={{ transform: showImportHelp ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
            Importing a TCGplayer precon deck?
          </button>
          {showImportHelp && (
            <p style={{ color: SUBTEXT, fontSize: 12.5, lineHeight: 1.6, marginTop: 8, maxWidth: 560 }}>
              On the precon's TCGplayer page, look for <strong style={{ color: TEXT }}>Export → Download Deck Text File</strong>,
              open the file it downloads, and paste the contents straight into the box above — it's already in the
              exact <span className="mono">qty card name</span> format this tool expects.
            </p>
          )}

          <p className="mono" style={{ color: SUBTEXT, fontSize: 11.5, marginTop: 36 }}>
            Card data and images via{" "}
            <a href="https://scryfall.com" target="_blank" rel="noopener noreferrer" style={{ color: TEAL }}>
              Scryfall
            </a>
          </p>
        </div>
      </div>
    );
  }

  // ---------- LOADING STAGE ----------
  if (stage === "loading") {
    const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
    return (
      <div className="inter" style={{ minHeight: "100vh", background: ROOT_BG, color: TEXT, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        {fontImport}
        {homeButton}
        {feedbackWidget}
        <div style={{ maxWidth: 420, width: "100%", textAlign: "center" }}>
          <Loader2 className="mono" size={26} style={{ color: TEAL, animation: "spin 1s linear infinite" }} />
          <div className="fraunces" style={{ fontSize: 20, margin: "16px 0 6px" }}>Fetching printings…</div>
          <div className="mono" style={{ color: SUBTEXT, fontSize: 12.5, marginBottom: 18 }}>
            {progress.done} / {progress.total} — {progress.current}
          </div>
          <div style={{ height: 6, background: "#2a323d", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: TEAL, transition: "width 0.2s" }} />
          </div>
        </div>
      </div>
    );
  }

  // ---------- REVIEW STAGE ----------
  if (stage === "review") {
    const { name, qty } = entries[reviewIndex];
    const opts = printOptions[name] || [];
    const sel = selections[name] || new Set();
    const sortedOpts = sortedOptsFor(name);
    const shown = sortedOpts.slice(0, visibleCount);
    const firstRiskyIndex = shown.findIndex((o) => isMassEntryRisky(o));

    return (
      <div className="inter" style={{ minHeight: "100vh", background: ROOT_BG, color: TEXT, padding: "28px 20px 60px" }}>
        {fontImport}
        {homeButton}
        {feedbackWidget}
        <div style={{ maxWidth: 920, margin: "0 auto" }}>
          {/* progress rule */}
          <div style={{ display: "flex", gap: 3, marginBottom: 22 }}>
            {entries.map((_, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: 3,
                  borderRadius: 2,
                  background: i < reviewIndex ? TEAL : i === reviewIndex ? ACCENT : "#2a323d",
                }}
              />
            ))}
          </div>

          <div className="mono" style={{ color: SUBTEXT, fontSize: 12, letterSpacing: "0.1em", marginBottom: 4 }}>
            CARD {reviewIndex + 1} OF {entries.length} · QTY {qty}
          </div>
          <h2 className="fraunces" style={{ fontSize: 30, fontWeight: 700, margin: "0 0 4px" }}>{name}</h2>
          <p style={{ color: SUBTEXT, fontSize: 13.5, margin: "0 0 22px" }}>
            {opts.length === 0
              ? "No printings found on Scryfall — check the spelling, or skip and it'll pass through unresolved."
              : sel.size === 0
              ? "No selection yet — the cheapest printing will be used automatically."
              : sel.size === 1
              ? `1 printing selected — you'll get ${qty} cop${qty === 1 ? "y" : "ies"} of it.`
              : `${sel.size} printings selected — one of each will be added, regardless of the original quantity (${qty}).`}
          </p>

          {opts.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: SUBTEXT, border: "1px dashed #2a323d", borderRadius: 8 }}>
              Nothing found for "{name}"
            </div>
          ) : (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                  gap: 14,
                }}
              >
                {shown.map((o, i) => {
                  const isSel = sel.has(o.id);
                  const card = (
                    <div
                      className="art-card"
                      onClick={() => toggleSelect(name, o.id)}
                      role="button"
                      tabIndex={0}
                      aria-pressed={isSel}
                      aria-label={`${name} — ${o.setName}, ${o.set} #${o.cn}${isSel ? ", selected" : ""}`}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggleSelect(name, o.id);
                        }
                      }}
                      style={{
                        cursor: "pointer",
                        position: "relative",
                        borderRadius: 8,
                        overflow: "hidden",
                        border: isSel ? `2px solid ${ACCENT}` : "2px solid transparent",
                        background: PANEL_BG,
                        transition: "border-color 0.15s, transform 0.15s",
                      }}
                    >
                      <img src={o.image} alt={`${name} — ${o.setName}`} style={{ width: "100%", display: "block" }} loading="lazy" />
                      <button
                        className="art-zoom-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setZoomed(o);
                        }}
                        onKeyDown={(e) => {
                          // Only Enter/Space need stopping — those are the keys the
                          // parent card also listens for, and letting this event
                          // bubble up would preventDefault() the button's own native
                          // click-on-Enter before it fires. Other keys (Escape, the
                          // in-zoom arrow nav) must keep bubbling to the window
                          // listener, which is why this isn't a blanket stopPropagation.
                          if (e.key === "Enter" || e.key === " ") e.stopPropagation();
                        }}
                        title="Zoom in"
                        style={{
                          position: "absolute",
                          top: "50%",
                          left: "50%",
                          transform: "translate(-50%, -50%)",
                          width: 44,
                          height: 44,
                          borderRadius: "50%",
                          background: "rgba(15,18,22,0.7)",
                          border: "1px solid rgba(236,228,211,0.25)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                          boxShadow: "0 2px 10px rgba(0,0,0,0.45)",
                        }}
                      >
                        <ZoomIn size={19} color={TEXT} />
                      </button>
                      {isSel && (
                        <div
                          style={{
                            position: "absolute",
                            top: 6,
                            right: 6,
                            width: 24,
                            height: 24,
                            borderRadius: "50%",
                            background: ACCENT,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
                          }}
                        >
                          <Check size={14} color="#fff" strokeWidth={3} />
                        </div>
                      )}
                      <div
                        className="mono"
                        style={{
                          fontSize: 10.5,
                          padding: "5px 7px",
                          background: "#0f1216",
                          color: SUBTEXT,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                            <span>{o.set} #{o.cn}</span>
                            {o.promo && (
                              <span
                                title="Promo-only print — likely not sold on TCGplayer"
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 2,
                                  fontSize: 8.5,
                                  padding: "1px 4px",
                                  borderRadius: 3,
                                  background: "rgba(201,162,39,0.18)",
                                  color: "#c9a227",
                                  border: "1px solid rgba(201,162,39,0.4)",
                                  flexShrink: 0,
                                }}
                              >
                                <AlertTriangle size={8} /> PROMO
                              </span>
                            )}
                          </span>
                          {o.scryfallUri && (
                            <a
                              href={o.scryfallUri}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") e.stopPropagation();
                              }}
                              title="View on Scryfall"
                              style={{ color: SUBTEXT, display: "flex", alignItems: "center" }}
                            >
                              <ExternalLink size={11} />
                            </a>
                          )}
                        </div>
                        {o.treatment && (
                          <div style={{ fontSize: 9.5, color: "#7d8a97", marginTop: 2 }}>
                            {o.rarity && `${o.rarity} · `}
                            {o.treatment}
                          </div>
                        )}
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 3 }}>
                          {o.prices?.usd == null && o.prices?.usdFoil == null && o.prices?.usdEtched == null && (
                            <span>—</span>
                          )}
                          {o.prices?.usd != null && (
                            <span style={{ color: TEAL }}>${o.prices.usd.toFixed(2)}</span>
                          )}
                          {o.prices?.usdFoil != null && (
                            <span style={{ color: TEAL }}>
                              <span style={{ color: SUBTEXT }}>foil </span>${o.prices.usdFoil.toFixed(2)}
                            </span>
                          )}
                          {o.prices?.usdEtched != null && (
                            <span style={{ color: TEAL }}>
                              <span style={{ color: SUBTEXT }}>etched </span>${o.prices.usdEtched.toFixed(2)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                  return (
                    <React.Fragment key={o.id}>
                      {i === firstRiskyIndex && firstRiskyIndex > 0 && (
                        <div
                          className="mono"
                          style={{
                            gridColumn: "1 / -1",
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            color: "#c9a227",
                            fontSize: 10.5,
                            letterSpacing: "0.04em",
                            margin: "2px 0 -4px",
                          }}
                        >
                          <AlertTriangle size={12} />
                          LESS LIKELY TO BE AVAILABLE ON TCGPLAYER
                          <div style={{ flex: 1, height: 1, background: "rgba(201,162,39,0.3)" }} />
                        </div>
                      )}
                      {card}
                    </React.Fragment>
                  );
                })}
              </div>
              {visibleCount < opts.length && (
                <button
                  onClick={() => setVisibleCount((v) => v + 24)}
                  className="inter"
                  style={{
                    marginTop: 16,
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    background: "rgba(60,140,150,0.12)",
                    color: TEAL,
                    border: `1px solid ${TEAL}`,
                    borderRadius: 8,
                    padding: "13px 16px",
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  <ChevronDown size={16} /> Show more printings ({opts.length - visibleCount} remaining)
                </button>
              )}
            </>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 32, gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={goPrev}
              disabled={reviewIndex === 0}
              className="inter"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "transparent",
                color: reviewIndex === 0 ? "#4a525c" : TEXT,
                border: "1px solid #2a323d",
                borderRadius: 6,
                padding: "10px 18px",
                fontSize: 14,
                cursor: reviewIndex === 0 ? "default" : "pointer",
              }}
            >
              <ChevronLeft size={16} /> Back
            </button>

            <div style={{ display: "flex", gap: 10 }}>
              {sel.size > 0 && (
                <button
                  onClick={() => clearSelection(name)}
                  className="inter"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    background: "transparent",
                    color: SUBTEXT,
                    border: "1px solid #2a323d",
                    borderRadius: 6,
                    padding: "10px 16px",
                    fontSize: 13.5,
                    cursor: "pointer",
                  }}
                >
                  <SkipForward size={14} /> Clear selection
                </button>
              )}
              <button
                onClick={goNext}
                className="inter"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  background: ACCENT,
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  padding: "10px 20px",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {reviewIndex + 1 >= entries.length ? "Finish" : "Next"} <ChevronRight size={16} />
              </button>
            </div>
          </div>

          <p className="mono" style={{ color: SUBTEXT, fontSize: 10.5, letterSpacing: "0.03em", marginTop: 14 }}>
            Keyboard: <span style={{ color: TEXT }}>← →</span> switch cards ·{" "}
            <span style={{ color: TEXT }}>Tab</span>, then <span style={{ color: TEXT }}>Enter</span> to pick a
            printing · <span style={{ color: TEXT }}>Esc</span> closes zoom
          </p>
        </div>

        {zoomed && (
          <div
            onClick={() => setZoomed(null)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(10,12,15,0.88)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
              zIndex: 100,
              cursor: "zoom-out",
            }}
          >
            <button
              ref={zoomCloseRef}
              onClick={() => setZoomed(null)}
              title="Close"
              style={{
                position: "absolute",
                top: 20,
                right: 20,
                width: 36,
                height: 36,
                borderRadius: "50%",
                background: PANEL_BG,
                border: "1px solid #2a323d",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              <X size={18} color={TEXT} />
            </button>
            <div style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
              <img
                src={zoomed.image}
                alt={`${name} — ${zoomed.setName}`}
                style={{
                  maxWidth: "min(90vw, 560px)",
                  maxHeight: "80vh",
                  display: "block",
                  borderRadius: 14,
                  boxShadow: "0 10px 40px rgba(0,0,0,0.5)",
                  cursor: "default",
                }}
              />
              {sel.has(zoomed.id) && (
                <div
                  style={{
                    position: "absolute",
                    top: 10,
                    right: 10,
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: ACCENT,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
                  }}
                >
                  <Check size={16} color="#fff" strokeWidth={3} />
                </div>
              )}
            </div>
            <div className="mono" style={{ color: SUBTEXT, fontSize: 13, marginTop: 14, textAlign: "center" }}>
              {zoomed.setName} · {zoomed.set} #{zoomed.cn}
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleSelect(name, zoomed.id);
              }}
              className="inter"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginTop: 12,
                background: sel.has(zoomed.id) ? ACCENT : "transparent",
                color: sel.has(zoomed.id) ? "#fff" : TEXT,
                border: `1px solid ${sel.has(zoomed.id) ? ACCENT : "#2a323d"}`,
                borderRadius: 6,
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <Check size={14} /> {sel.has(zoomed.id) ? "Selected" : "Select this printing"}
            </button>
            <p className="mono" style={{ color: SUBTEXT, fontSize: 10.5, marginTop: 16, textAlign: "center" }}>
              ← → browse printings · Enter select · Esc close
            </p>
          </div>
        )}
      </div>
    );
  }

  // ---------- DONE STAGE ----------
  if (stage === "done") {
    const { lines, total, unresolved } = buildOutput();
    const searchText = lines.map(searchableLine).join("\n");
    const massEntryText = lines.map(massEntryLine).join("\n");
    const outputText = outputTab === "search" ? searchText : massEntryText;
    const massEntryPrefillUrl = buildMassEntryPrefillUrl(lines);

    const copy = async () => {
      try {
        await navigator.clipboard.writeText(outputText);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      } catch (e) {}
    };

    return (
      <div className="inter" style={{ minHeight: "100vh", background: ROOT_BG, color: TEXT, padding: "48px 20px" }}>
        {fontImport}
        {homeButton}
        {feedbackWidget}
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <div className="mono" style={{ color: TEAL, fontSize: 12, letterSpacing: "0.15em", marginBottom: 8 }}>
            PROJECT MANA · EVERY PRINTING, YOUR PICK{betaPill}
          </div>
          <h1 className="fraunces" style={{ fontSize: 30, fontWeight: 700, margin: "0 0 6px" }}>Your finished list</h1>
          <p style={{ color: SUBTEXT, fontSize: 14.5, margin: "0 0 10px" }}>
            {lines.length} line{lines.length === 1 ? "" : "s"} · est. total{" "}
            <span className="mono" style={{ color: TEXT }}>
              ${total.toFixed(2)}
            </span>
            {unresolved > 0 && (
              <span style={{ color: ACCENT }}> · {unresolved} card{unresolved === 1 ? "" : "s"} not found</span>
            )}
          </p>
          <p style={{ color: SUBTEXT, fontSize: 13, lineHeight: 1.6, margin: "0 0 22px" }}>
            <strong style={{ color: TEXT }}>Beta note:</strong> double-check quantities and printings against
            TCGplayer before buying. Something look wrong? Use the "Feedback" button in the corner.
          </p>

          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            {[
              { id: "search", label: "Search names" },
              { id: "massentry", label: "Mass Entry format" },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setOutputTab(t.id)}
                className="inter"
                style={{
                  background: outputTab === t.id ? PANEL_BG : "transparent",
                  color: outputTab === t.id ? TEXT : SUBTEXT,
                  border: `1px solid ${outputTab === t.id ? "#3a4148" : "#2a323d"}`,
                  borderBottom: outputTab === t.id ? "1px solid " + PANEL_BG : `1px solid #2a323d`,
                  borderRadius: "6px 6px 0 0",
                  padding: "8px 14px",
                  fontSize: 13,
                  fontWeight: outputTab === t.id ? 600 : 400,
                  cursor: "pointer",
                  position: "relative",
                  top: 1,
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          <textarea
            readOnly
            value={outputText}
            className="mono"
            style={{
              width: "100%",
              minHeight: 260,
              background: PANEL_BG,
              border: "1px solid #2a323d",
              borderRadius: "0 6px 6px 6px",
              color: TEXT,
              padding: 16,
              fontSize: 13,
              lineHeight: 1.7,
              resize: "vertical",
              outline: "none",
            }}
          />

          <p style={{ color: SUBTEXT, fontSize: 12.5, lineHeight: 1.6, marginTop: 10 }}>
            {outputTab === "search" ? (
              <>
                Each line is written to paste into <span className="mono">TCGplayer's own search bar</span> — card
                name plus set name, so it finds the right product page even for prints (Secret Lair drops, promos,
                special treatments) that Mass Entry's strict matching often gets wrong.
              </>
            ) : (
              <>
                Format is <span className="mono">qty name [SET] collector-number</span>, matching{" "}
                <a href={TCGPLAYER_MASS_ENTRY_URL} target="_blank" rel="noopener noreferrer" style={{ color: TEAL }}>
                  TCGplayer's Mass Entry
                </a>{" "}
                syntax. Works well for standard boosters — for Secret Lair, promos, and special treatments, use the
                "Search names" tab or the direct links below instead.
              </>
            )}
          </p>

          <div style={{ display: "flex", gap: 12, marginTop: 14, flexWrap: "wrap" }}>
            <button
              onClick={copy}
              className="inter"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                background: ACCENT,
                color: "#fff",
                border: "none",
                borderRadius: 6,
                padding: "11px 20px",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <Copy size={15} /> {copied ? "Copied!" : "Copy list"}
            </button>
            <a
              href={massEntryPrefillUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inter"
              title="Opens Mass Entry with this list already typed in — you'll still want to review it there before checkout"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                background: "transparent",
                color: TEAL,
                border: `1px solid ${TEAL}`,
                borderRadius: 6,
                padding: "11px 20px",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                textDecoration: "none",
              }}
            >
              Open in Mass Entry, pre-filled <ExternalLink size={15} />
            </a>
            <button
              onClick={reset}
              className="inter"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                background: "transparent",
                color: SUBTEXT,
                border: "1px solid #2a323d",
                borderRadius: 6,
                padding: "11px 20px",
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              <RotateCcw size={15} /> Start over
            </button>
          </div>

          {lines.length > 0 && (
            <div style={{ marginTop: 32 }}>
              <div style={{ color: TEXT, fontSize: 14, fontWeight: 600, marginBottom: 3 }}>Direct TCGplayer links</div>
              <p style={{ color: SUBTEXT, fontSize: 12.5, lineHeight: 1.5, marginBottom: 10 }}>
                One link per card, straight to the exact printing you picked — always correct, since it's a real
                product page rather than a text match.
              </p>
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 2 }}>
                <div
                  className="mono"
                  style={{
                    position: "relative",
                    background: ACCENT,
                    color: "#fff",
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: "0.03em",
                    padding: "5px 10px",
                    borderRadius: 5,
                    marginRight: 6,
                  }}
                >
                  CHECK 'EM OFF AS YOU GO
                  <div
                    style={{
                      position: "absolute",
                      bottom: -5,
                      right: 13,
                      width: 0,
                      height: 0,
                      borderLeft: "5px solid transparent",
                      borderRight: "5px solid transparent",
                      borderTop: `5px solid ${ACCENT}`,
                    }}
                  />
                </div>
              </div>
              <div style={{ border: "1px solid #2a323d", borderRadius: 6, overflow: "hidden" }}>
                {lines.map((l, i) => {
                  const done = !!doneChecks[l.key];
                  return (
                    <div
                      key={l.key}
                      className="mono"
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 10,
                        padding: "9px 12px",
                        fontSize: 12.5,
                        borderTop: i === 0 ? "none" : "1px solid #2a323d",
                        color: SUBTEXT,
                        opacity: done ? 0.45 : 1,
                        transition: "opacity 0.15s",
                      }}
                    >
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          textDecoration: done ? "line-through" : "none",
                        }}
                      >
                        {l.qty} {l.name} {l.missing || l.basic ? "" : `[${l.set}] ${l.cn}`}
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
                        {l.tcgplayerId ? (
                          <a
                            href={`https://www.tcgplayer.com/product/${l.tcgplayerId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: TEAL, display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}
                          >
                            TCGplayer <ExternalLink size={11} />
                          </a>
                        ) : l.basic ? (
                          <span title="Basic land — any printing works, so this was left unresolved on purpose" style={{ flexShrink: 0, fontSize: 11 }}>
                            any printing
                          </span>
                        ) : (
                          <span title="No known TCGplayer listing — try searching by name" style={{ flexShrink: 0, fontSize: 11 }}>
                            no link found
                          </span>
                        )}
                        <input
                          type="checkbox"
                          checked={done}
                          onChange={() => setDoneChecks((prev) => ({ ...prev, [l.key]: !prev[l.key] }))}
                          title="Mark done"
                          style={{ width: 15, height: 15, accentColor: ACCENT, cursor: "pointer", flexShrink: 0 }}
                        />
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}
