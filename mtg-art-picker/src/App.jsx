import React, { useState, useCallback, useEffect } from "react";
import { ChevronLeft, ChevronRight, Check, Loader2, Copy, RotateCcw, SkipForward, AlertTriangle, ExternalLink, ZoomIn, X } from "lucide-react";

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

function parseList(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const map = new Map();
  for (const line of lines) {
    const m = line.match(/^(\d+)\s+(.+)$/);
    if (!m) continue;
    const qty = parseInt(m[1], 10);
    const name = m[2].trim();
    map.set(name, (map.get(name) || 0) + qty);
  }
  return Array.from(map.entries()).map(([name, qty]) => ({ name, qty }));
}

const API_BASE = import.meta.env.VITE_API_BASE || "";

// Reads from the daily manifest built by worker/src/index.js instead of
// hitting Scryfall's live search API on every visitor's page load. See
// HANDOFF.md and worker/README.md for the full architecture.
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

  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e) => {
      if (e.key === "Escape") setZoomed(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomed]);

  const handleCompile = useCallback(async () => {
    const parsed = parseList(rawText);
    if (parsed.length === 0) {
      setError('No cards found. Use one card per line, formatted like "1 Card Name".');
      return;
    }
    setError(null);
    setEntries(parsed);
    setStage("loading");
    const opts = {};
    for (let i = 0; i < parsed.length; i++) {
      const { name } = parsed[i];
      setProgress({ done: i, total: parsed.length, current: name });
      try {
        opts[name] = await fetchPrints(name);
      } catch (e) {
        opts[name] = [];
      }
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

  const buildOutput = () => {
    const lines = [];
    let total = 0;
    let unresolved = 0;
    for (const { name, qty } of entries) {
      const opts = printOptions[name] || [];
      const sel = selections[name] ? Array.from(selections[name]) : [];
      if (opts.length === 0) {
        lines.push({ qty, name, set: null, cn: null, price: null, missing: true });
        unresolved++;
        continue;
      }
      if (sel.length === 0) {
        const p = cheapestOf(opts);
        lines.push({ qty, name, set: p.set, cn: p.cn, price: minPrice(p) });
        total += (minPrice(p) || 0) * qty;
      } else if (sel.length === 1) {
        const p = opts.find((o) => o.id === sel[0]);
        lines.push({ qty, name, set: p.set, cn: p.cn, price: minPrice(p) });
        total += (minPrice(p) || 0) * qty;
      } else {
        sel.forEach((id) => {
          const p = opts.find((o) => o.id === id);
          if (p) {
            lines.push({ qty: 1, name, set: p.set, cn: p.cn, price: minPrice(p) });
            total += minPrice(p) || 0;
          }
        });
      }
    }
    return { lines, total, unresolved };
  };

  const reset = () => {
    setStage("input");
    setRawText("");
    setEntries([]);
    setPrintOptions({});
    setSelections({});
    setReviewIndex(0);
    setError(null);
    setCopied(false);
    setZoomed(null);
  };

  const fontImport = (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
      * { box-sizing: border-box; }
      .fraunces { font-family: 'Fraunces', serif; }
      .inter { font-family: 'Inter', sans-serif; }
      .mono { font-family: 'IBM Plex Mono', monospace; }
      ::selection { background: #b23a48; color: #ece4d3; }
    `}</style>
  );

  const ROOT_BG = "#14181d";
  const PANEL_BG = "#1b2129";
  const ACCENT = "#b23a48";
  const TEAL = "#3c8c96";
  const TEXT = "#ece4d3";
  const SUBTEXT = "#9aa3ad";

  // ---------- INPUT STAGE ----------
  if (stage === "input") {
    return (
      <div className="inter" style={{ minHeight: "100vh", background: ROOT_BG, color: TEXT, padding: "48px 20px" }}>
        {fontImport}
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          <div className="mono" style={{ color: TEAL, fontSize: 12, letterSpacing: "0.15em", marginBottom: 8 }}>
            ART SELECTION · GRIXIS DECK
          </div>
          <h1 className="fraunces" style={{ fontSize: 34, fontWeight: 700, margin: "0 0 8px", lineHeight: 1.15 }}>
            Choose your printings
          </h1>
          <p style={{ color: SUBTEXT, fontSize: 15, lineHeight: 1.6, margin: "0 0 28px" }}>
            Paste your list below — one card per line, formatted as <span className="mono">qty card name</span>. You'll
            page through every card one at a time and pick the art you want. Skip any card to default to the cheapest
            printing.
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
        <div style={{ maxWidth: 420, width: "100%", textAlign: "center" }}>
          <Loader2 className="mono" size={26} style={{ color: TEAL, animation: "spin 1s linear infinite" }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
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
    const shown = opts.slice(0, visibleCount);

    return (
      <div className="inter" style={{ minHeight: "100vh", background: ROOT_BG, color: TEXT, padding: "28px 20px 60px" }}>
        {fontImport}
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
                {shown.map((o) => {
                  const isSel = sel.has(o.id);
                  return (
                    <div
                      key={o.id}
                      onClick={() => toggleSelect(name, o.id)}
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
                        onClick={(e) => {
                          e.stopPropagation();
                          setZoomed(o);
                        }}
                        title="Zoom in"
                        style={{
                          position: "absolute",
                          top: 6,
                          left: 6,
                          width: 24,
                          height: 24,
                          borderRadius: "50%",
                          background: "rgba(15,18,22,0.75)",
                          border: "none",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                          boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
                        }}
                      >
                        <ZoomIn size={13} color={TEXT} />
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
                          <span>{o.set} #{o.cn}</span>
                          {o.scryfallUri && (
                            <a
                              href={o.scryfallUri}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              title="View on Scryfall"
                              style={{ color: SUBTEXT, display: "flex", alignItems: "center" }}
                            >
                              <ExternalLink size={11} />
                            </a>
                          )}
                        </div>
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
                })}
              </div>
              {visibleCount < opts.length && (
                <button
                  onClick={() => setVisibleCount((v) => v + 24)}
                  className="inter"
                  style={{
                    marginTop: 16,
                    background: "transparent",
                    color: TEAL,
                    border: "1px solid #2a323d",
                    borderRadius: 6,
                    padding: "8px 16px",
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  Show more printings ({opts.length - visibleCount} remaining)
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
            <img
              src={zoomed.image}
              alt={`${name} — ${zoomed.setName}`}
              onClick={(e) => e.stopPropagation()}
              style={{
                maxWidth: "min(90vw, 560px)",
                maxHeight: "80vh",
                borderRadius: 14,
                boxShadow: "0 10px 40px rgba(0,0,0,0.5)",
                cursor: "default",
              }}
            />
            <div className="mono" style={{ color: SUBTEXT, fontSize: 13, marginTop: 14, textAlign: "center" }}>
              {zoomed.setName} · {zoomed.set} #{zoomed.cn}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ---------- DONE STAGE ----------
  if (stage === "done") {
    const { lines, total, unresolved } = buildOutput();
    const outputText = lines
      .map((l) => (l.missing ? `${l.qty} ${l.name}   [NOT FOUND — verify manually]` : `${l.qty} ${l.name} [${l.set}] ${l.cn}`))
      .join("\n");

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
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <div className="mono" style={{ color: TEAL, fontSize: 12, letterSpacing: "0.15em", marginBottom: 8 }}>
            SELECTION COMPLETE
          </div>
          <h1 className="fraunces" style={{ fontSize: 30, fontWeight: 700, margin: "0 0 6px" }}>Your finished list</h1>
          <p style={{ color: SUBTEXT, fontSize: 14.5, margin: "0 0 22px" }}>
            {lines.length} line{lines.length === 1 ? "" : "s"} · est. total{" "}
            <span className="mono" style={{ color: TEXT }}>
              ${total.toFixed(2)}
            </span>
            {unresolved > 0 && (
              <span style={{ color: ACCENT }}> · {unresolved} card{unresolved === 1 ? "" : "s"} not found</span>
            )}
          </p>

          <textarea
            readOnly
            value={outputText}
            className="mono"
            style={{
              width: "100%",
              minHeight: 260,
              background: PANEL_BG,
              border: "1px solid #2a323d",
              borderRadius: 6,
              color: TEXT,
              padding: 16,
              fontSize: 13,
              lineHeight: 1.7,
              resize: "vertical",
              outline: "none",
            }}
          />

          <div style={{ display: "flex", gap: 12, marginTop: 18, flexWrap: "wrap" }}>
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

          <p style={{ color: SUBTEXT, fontSize: 12.5, lineHeight: 1.6, marginTop: 24 }}>
            Format is <span className="mono">qty name [SET] collector-number</span>, matching{" "}
            <a href="https://www.tcgplayer.com/massentry" target="_blank" rel="noopener noreferrer" style={{ color: TEAL }}>
              TCGplayer's Mass Entry
            </a>{" "}
            syntax — paste this list directly in to add the exact printings you picked, not just any copy of each card.
          </p>
        </div>
      </div>
    );
  }

  return null;
}
