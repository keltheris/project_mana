import { useState } from "react";
import { MessageSquarePlus, X, Loader2, Check, AlertTriangle } from "lucide-react";
import { PANEL_BG, ACCENT, TEAL, TEXT, SUBTEXT } from "./theme";

const API_BASE = import.meta.env.VITE_API_BASE || "";
const TYPES = [
  { id: "bug", label: "Bug" },
  { id: "feature", label: "Feature idea" },
  { id: "other", label: "Other" },
];
const MAX_LENGTH = 3000;

// `stage` is the current app stage (input/loading/review/done), sent along
// as triage context — it does not affect what's shown in this widget.
export default function FeedbackWidget({ stage }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("bug");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState(""); // honeypot — real users never touch this
  const [status, setStatus] = useState("idle"); // idle | submitting | success | error

  const close = () => {
    setOpen(false);
    setStatus("idle");
    setType("bug");
    setMessage("");
    setWebsite("");
  };

  const submit = async () => {
    if (message.trim().length < 3 || status === "submitting") return;
    setStatus("submitting");
    try {
      const res = await fetch(`${API_BASE}/api/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, message: message.trim(), stage, website }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setStatus("success");
      setTimeout(close, 1600);
    } catch (e) {
      setStatus("error");
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Send feedback"
        className="inter"
        style={{
          position: "fixed",
          top: 16,
          right: 16,
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
        <MessageSquarePlus size={13} /> Feedback
      </button>

      {open && (
        <div
          onClick={close}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(10,12,15,0.72)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            zIndex: 200,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="inter"
            style={{
              width: "100%",
              maxWidth: 440,
              background: PANEL_BG,
              border: "1px solid #2a323d",
              borderRadius: 10,
              padding: 22,
              position: "relative",
              boxShadow: "0 10px 40px rgba(0,0,0,0.5)",
            }}
          >
            <button
              onClick={close}
              title="Close"
              style={{
                position: "absolute",
                top: 14,
                right: 14,
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: "transparent",
                border: "1px solid #2a323d",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              <X size={14} color={SUBTEXT} />
            </button>

            {status === "success" ? (
              <div style={{ textAlign: "center", padding: "18px 0" }}>
                <Check size={26} color={TEAL} />
                <div className="fraunces" style={{ fontSize: 18, marginTop: 10, color: TEXT }}>
                  Thanks — got it!
                </div>
              </div>
            ) : (
              <>
                <div className="fraunces" style={{ fontSize: 19, fontWeight: 700, color: TEXT, marginBottom: 4 }}>
                  Send feedback
                </div>
                <p style={{ color: SUBTEXT, fontSize: 13, lineHeight: 1.5, margin: "0 0 16px" }}>
                  This tool's still in beta — a bug report or an idea helps a lot.
                </p>

                <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                  {TYPES.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setType(t.id)}
                      className="inter"
                      style={{
                        flex: 1,
                        background: type === t.id ? ACCENT : "transparent",
                        color: type === t.id ? "#fff" : SUBTEXT,
                        border: `1px solid ${type === t.id ? ACCENT : "#2a323d"}`,
                        borderRadius: 6,
                        padding: "7px 8px",
                        fontSize: 12.5,
                        cursor: "pointer",
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value.slice(0, MAX_LENGTH))}
                  placeholder="What happened, or what would help?"
                  className="inter"
                  style={{
                    width: "100%",
                    minHeight: 110,
                    background: "#14181d",
                    border: "1px solid #2a323d",
                    borderRadius: 6,
                    color: TEXT,
                    padding: 12,
                    fontSize: 13.5,
                    lineHeight: 1.5,
                    resize: "vertical",
                    outline: "none",
                  }}
                />

                {/* Honeypot: hidden from real visitors via CSS, bots that fill every field trip it. */}
                <input
                  type="text"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  style={{ position: "absolute", left: -9999, width: 1, height: 1, opacity: 0 }}
                  aria-hidden="true"
                />

                {status === "error" && (
                  <div style={{ display: "flex", gap: 6, alignItems: "center", color: ACCENT, fontSize: 12.5, marginTop: 10 }}>
                    <AlertTriangle size={13} /> Couldn't send that — try again in a moment.
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
                  <button
                    onClick={submit}
                    disabled={message.trim().length < 3 || status === "submitting"}
                    className="inter"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                      background: message.trim().length < 3 ? "#3a4148" : ACCENT,
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                      padding: "10px 18px",
                      fontSize: 13.5,
                      fontWeight: 600,
                      cursor: message.trim().length < 3 ? "default" : "pointer",
                    }}
                  >
                    {status === "submitting" ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : null}
                    {status === "submitting" ? "Sending…" : "Send"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
