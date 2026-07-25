import React from "react";
import { createRoot } from "react-dom/client";
import { Send, RotateCcw, Loader2, ChevronRight } from "lucide-react";

const h = React.createElement;
const { useState, useRef, useEffect } = React;

const DIFFICULTIES = [
  { id: "easy", label: "Warm-up", desc: "They mostly hear you out" },
  { id: "real", label: "Realistic", desc: "Mixed reactions, some pushback" },
  { id: "tough", label: "Worst case", desc: "Defensive, sharp, won't budge easily" },
];

const inputStyle = {
  width: "100%",
  background: "#26242E",
  border: "1px solid #3A3743",
  borderRadius: 8,
  color: "#F2EFE9",
  padding: "10px 12px",
  fontSize: 14,
  fontFamily: "'IBM Plex Sans', sans-serif",
  outline: "none",
  boxSizing: "border-box",
  resize: "vertical",
};

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function systemPrompt({ situation, otherPerson, theirStance, goal, difficulty }) {
  const diffText = {
    easy: "Be relatively receptive. Push back a little, but come around if the user makes a reasonable case.",
    real: "React the way a real person with this personality actually would — some genuine resistance, some good-faith moments. Not a pushover, not a cartoon villain.",
    tough: "Be genuinely difficult: defensive, deflecting, maybe a little sharp. Don't fold easily. Never break character to make it easy on them.",
  }[difficulty];

  return `You are roleplaying as a specific real person in a hard conversation, for someone rehearsing before the real thing. Stay fully in character as "${otherPerson}" — never break character, never coach, never say you're an AI.

The situation: ${situation}
Who you're playing: ${otherPerson}. Their likely stance/personality: ${theirStance || "Not specified — infer something realistic and consistent."}
The user's goal: ${goal}

Calibration: ${diffText}

Rules: speak only as ${otherPerson}, first person, 1-4 sentences per turn. No stage directions, no asterisks, no meta-commentary.`;
}

function App() {
  const [email, setEmail] = useState(localStorage.getItem("understudy_email") || "");
  const [emailDraft, setEmailDraft] = useState("");
  const [phase, setPhase] = useState("setup");
  const [situation, setSituation] = useState("");
  const [otherPerson, setOtherPerson] = useState("");
  const [theirStance, setTheirStance] = useState("");
  const [goal, setGoal] = useState("");
  const [difficulty, setDifficulty] = useState("real");
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [notes, setNotes] = useState(null);
  const [error, setError] = useState("");
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending]);

  if (!email) {
    return h(
      "div",
      { style: { minHeight: "100vh", background: "#1C1B22", color: "#F2EFE9", fontFamily: "'IBM Plex Sans', sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 } },
      h(
        "div",
        { style: { maxWidth: 380, width: "100%" } },
        h("div", { style: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 26, marginBottom: 10 } }, "Understudy"),
        h("p", { style: { color: "#A39F9D", fontSize: 14, marginBottom: 20, lineHeight: 1.5 } }, "Enter your email to start. We use it to track your free rehearsals and manage your subscription — nothing else."),
        h("input", {
          style: { ...inputStyle, marginBottom: 12 },
          placeholder: "you@example.com",
          value: emailDraft,
          onChange: (e) => setEmailDraft(e.target.value),
        }),
        h(
          "button",
          {
            style: { width: "100%", background: "#E8A94C", border: "none", borderRadius: 8, padding: 13, fontWeight: 600, cursor: "pointer" },
            onClick: () => {
              if (!emailDraft.trim()) return;
              localStorage.setItem("understudy_email", emailDraft.trim());
              setEmail(emailDraft.trim());
            },
          },
          "Continue"
        )
      )
    );
  }

  const canBegin = situation.trim() && otherPerson.trim() && goal.trim();

  const beginRehearsal = () => {
    setPhase("rehearsal");
    setMessages([]);
    setError("");
  };

  const upgrade = async () => {
    const { data } = await postJSON("/api/create-checkout-session", { email });
    if (data.url) window.location.href = data.url;
  };

  const sendLine = async () => {
    if (!draft.trim() || sending) return;
    const userMsg = { role: "user", content: draft.trim() };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setDraft("");
    setSending(true);
    setError("");

    const { ok, status, data } = await postJSON("/api/chat", {
      messages: nextMessages,
      system: systemPrompt({ situation, otherPerson, theirStance, goal, difficulty }),
      email,
    });

    if (status === 402) {
      setPhase("paywall");
      setSending(false);
      return;
    }
    if (!ok) {
      setError("Couldn't reach the model. Try sending that again.");
      setSending(false);
      return;
    }
    setMessages([...nextMessages, { role: "assistant", content: data.text || "…" }]);
    setSending(false);
  };

  const endRehearsal = async () => {
    if (messages.length === 0) {
      setPhase("setup");
      return;
    }
    setPhase("loading-notes");
    setError("");

    const transcript = messages.map((m) => `${m.role === "user" ? "USER" : otherPerson.toUpperCase()}: ${m.content}`).join("\n");
    const debriefSystem = `You are a sharp, kind communication coach reviewing a rehearsed hard conversation. Respond with ONLY a JSON object, no markdown fences, in exactly this shape:
{"overallRead":"2-3 sentences","whatWorked":["..."],"patternsToWatch":["..."],"tryNextTime":["..."],"rephraseExample":{"original":"...","suggested":"..."}}
Keep arrays to 2-3 items. Be specific to what was actually said.`;
    const debriefUser = `Situation: ${situation}\nOther person: ${otherPerson} (${theirStance || "unspecified"})\nGoal: ${goal}\n\nTranscript:\n${transcript}`;

    const { ok, status, data } = await postJSON("/api/debrief", {
      messages: [{ role: "user", content: debriefUser }],
      system: debriefSystem,
      email,
    });

    if (status === 402) {
      setPhase("paywall");
      return;
    }
    if (!ok) {
      setError("Couldn't generate notes. Try ending it again.");
      setPhase("rehearsal");
      return;
    }
    try {
      const cleaned = data.text.replace(/```json|```/g, "").trim();
      setNotes(JSON.parse(cleaned));
      setPhase("notes");
    } catch (e) {
      setError("Couldn't parse the notes. Try ending it again.");
      setPhase("rehearsal");
    }
  };

  const rehearseAgain = () => {
    setPhase("setup");
    setMessages([]);
    setNotes(null);
    setDraft("");
    setError("");
  };

  return h(
    "div",
    { style: { minHeight: "100vh", background: "#1C1B22", color: "#F2EFE9", fontFamily: "'IBM Plex Sans', sans-serif", display: "flex", flexDirection: "column" } },
    h(
      "header",
      { style: { borderBottom: "1px solid #33313C", padding: "18px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" } },
      h(
        "div",
        { style: { display: "flex", alignItems: "baseline", gap: 10 } },
        h("span", { style: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 22 } }, "Understudy"),
        h("span", { style: { fontSize: 12, color: "#8B8792" } }, "rehearse the hard conversation")
      ),
      phase === "rehearsal" &&
        h(
          "button",
          {
            style: { background: "transparent", border: "1px solid #E8A94C", color: "#E8A94C", borderRadius: 6, padding: "7px 14px", fontSize: 13, cursor: "pointer" },
            onClick: endRehearsal,
          },
          "End rehearsal & get notes"
        )
    ),
    h(
      "main",
      { style: { flex: 1, display: "flex", justifyContent: "center", padding: "32px 20px" } },
      h(
        "div",
        { style: { width: "100%", maxWidth: 640 } },
        phase === "setup" && renderSetup(),
        phase === "rehearsal" && renderRehearsal(),
        phase === "loading-notes" &&
          h(
            "div",
            { style: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "80px 0", color: "#A39F9D", gap: 14 } },
            h(Loader2, { size: 22, color: "#E8A94C" }),
            h("span", { style: { fontSize: 14 } }, "Reviewing the rehearsal…")
          ),
        phase === "notes" && renderNotes(),
        phase === "paywall" && renderPaywall()
      )
    )
  );

  function renderSetup() {
    return h(
      "div",
      null,
      h("h1", { style: { fontFamily: "'Fraunces', serif", fontWeight: 500, fontSize: 28, lineHeight: 1.25, margin: "6px 0 28px" } }, "Set the scene before you're actually in it."),
      field("The situation", h("textarea", { rows: 3, style: inputStyle, value: situation, onChange: (e) => setSituation(e.target.value), placeholder: "e.g. Asking my manager for a raise after being told budgets are frozen." })),
      field("Who you're talking to", h("input", { style: inputStyle, value: otherPerson, onChange: (e) => setOtherPerson(e.target.value), placeholder: "e.g. My manager, Priya" })),
      field("Their likely stance (optional)", h("textarea", { rows: 2, style: inputStyle, value: theirStance, onChange: (e) => setTheirStance(e.target.value), placeholder: "e.g. Sympathetic but rules-bound" })),
      field("Your goal", h("input", { style: inputStyle, value: goal, onChange: (e) => setGoal(e.target.value), placeholder: "e.g. Leave with a concrete next step" })),
      field(
        "Difficulty",
        h(
          "div",
          { style: { display: "flex", gap: 8 } },
          DIFFICULTIES.map((d) =>
            h(
              "button",
              {
                key: d.id,
                onClick: () => setDifficulty(d.id),
                style: {
                  flex: 1,
                  textAlign: "left",
                  background: difficulty === d.id ? "#3A2E1A" : "#26242E",
                  border: difficulty === d.id ? "1px solid #E8A94C" : "1px solid #3A3743",
                  borderRadius: 8,
                  padding: "10px 12px",
                  cursor: "pointer",
                  color: "#F2EFE9",
                },
              },
              h("div", { style: { fontSize: 13, fontWeight: 600 } }, d.label),
              h("div", { style: { fontSize: 11, color: "#8B8792", marginTop: 2 } }, d.desc)
            )
          )
        )
      ),
      h(
        "button",
        {
          onClick: beginRehearsal,
          disabled: !canBegin,
          style: {
            width: "100%",
            marginTop: 12,
            background: canBegin ? "#E8A94C" : "#3A3743",
            color: canBegin ? "#1C1B22" : "#736F79",
            border: "none",
            borderRadius: 8,
            padding: 13,
            fontSize: 14,
            fontWeight: 600,
            cursor: canBegin ? "pointer" : "not-allowed",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
          },
        },
        "Begin rehearsal",
        h(ChevronRight, { size: 16 })
      )
    );
  }

  function renderRehearsal() {
    return h(
      "div",
      { style: { display: "flex", flexDirection: "column", height: "calc(100vh - 160px)" } },
      h(
        "div",
        { ref: scrollRef, style: { flex: 1, overflowY: "auto", border: "1px solid #33313C", borderRadius: 10, background: "#201F27", padding: 20, fontFamily: "'IBM Plex Mono', monospace", fontSize: 13.5, lineHeight: 1.7 } },
        messages.length === 0 && h("div", { style: { color: "#736F79", fontStyle: "italic" } }, "Say your opening line whenever you're ready."),
        messages.map((m, i) =>
          h(
            "div",
            { key: i, style: { marginBottom: 16 } },
            h("div", { style: { color: m.role === "user" ? "#6E8CA0" : "#E8A94C", fontWeight: 600, marginBottom: 3 } }, m.role === "user" ? "YOU" : otherPerson.toUpperCase()),
            h("div", { style: { color: "#F2EFE9" } }, m.content)
          )
        ),
        sending && h("div", { style: { color: "#736F79", fontSize: 12 } }, `${otherPerson || "they"} is responding…`)
      ),
      error && h("div", { style: { color: "#D97757", fontSize: 12, marginTop: 8 } }, error),
      h(
        "div",
        { style: { display: "flex", gap: 8, marginTop: 12 } },
        h("textarea", {
          rows: 2,
          style: { ...inputStyle, flex: 1 },
          value: draft,
          onChange: (e) => setDraft(e.target.value),
          onKeyDown: (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendLine();
            }
          },
          placeholder: "Say your line…",
        }),
        h(
          "button",
          {
            onClick: sendLine,
            disabled: sending || !draft.trim(),
            style: { background: "#E8A94C", border: "none", borderRadius: 8, width: 44, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", opacity: sending || !draft.trim() ? 0.5 : 1 },
          },
          h(Send, { size: 16, color: "#1C1B22" })
        )
      )
    );
  }

  function renderNotes() {
    if (!notes) return null;
    return h(
      "div",
      null,
      h(
        "div",
        { style: { borderBottom: "1px solid #33313C", paddingBottom: 18, marginBottom: 22 } },
        h("div", { style: { fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", color: "#E8A94C", textTransform: "uppercase", marginBottom: 8 } }, "Director's notes"),
        h("p", { style: { fontSize: 16, lineHeight: 1.6, margin: 0 } }, notes.overallRead)
      ),
      noteSection("What worked", notes.whatWorked, "#6E8CA0"),
      noteSection("Patterns to watch", notes.patternsToWatch, "#D97757"),
      noteSection("Try this next time", notes.tryNextTime, "#E8A94C"),
      notes.rephraseExample &&
        h(
          "div",
          { style: { marginTop: 26, marginBottom: 30 } },
          h("div", { style: { fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", color: "#E8A94C", textTransform: "uppercase", marginBottom: 10 } }, "One line, rephrased"),
          h(
            "div",
            { style: { background: "#201F27", border: "1px solid #33313C", borderRadius: 10, padding: 16 } },
            h("div", { style: { fontSize: 13, color: "#8B8792", marginBottom: 8 } }, "You said: ", h("span", { style: { fontStyle: "italic" } }, `"${notes.rephraseExample.original}"`)),
            h("div", { style: { fontSize: 14 } }, "Try: ", h("span", { style: { color: "#E8A94C" } }, `"${notes.rephraseExample.suggested}"`))
          )
        ),
      h(
        "button",
        {
          onClick: rehearseAgain,
          style: { width: "100%", background: "transparent", border: "1px solid #3A3743", color: "#F2EFE9", borderRadius: 8, padding: 12, fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 },
        },
        h(RotateCcw, { size: 15 }),
        "Rehearse again"
      )
    );
  }

  function renderPaywall() {
    return h(
      "div",
      { style: { textAlign: "center", padding: "60px 20px" } },
      h("div", { style: { fontFamily: "'Fraunces', serif", fontSize: 24, marginBottom: 12 } }, "You're out of free rehearsals"),
      h("p", { style: { color: "#A39F9D", fontSize: 14, marginBottom: 28, lineHeight: 1.6 } }, "Subscribe to keep rehearsing — unlimited scenarios, unlimited debriefs."),
      h(
        "button",
        { onClick: upgrade, style: { background: "#E8A94C", border: "none", borderRadius: 8, padding: "13px 28px", fontSize: 14, fontWeight: 600, cursor: "pointer" } },
        "Upgrade — $12/month"
      )
    );
  }
}

function field(label, control) {
  return h(
    "div",
    { style: { marginBottom: 20 } },
    h("label", { style: { display: "block", fontSize: 12, fontFamily: "'IBM Plex Mono', monospace", color: "#E8A94C", textTransform: "uppercase", marginBottom: 6 } }, label),
    control
  );
}

function noteSection(title, items, tone) {
  if (!items || items.length === 0) return null;
  return h(
    "div",
    { style: { marginBottom: 22 } },
    h("div", { style: { fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", color: tone, textTransform: "uppercase", marginBottom: 10 } }, title),
    h(
      "ul",
      { style: { margin: 0, padding: 0, listStyle: "none" } },
      items.map((item, i) =>
        h(
          "li",
          { key: i, style: { display: "flex", gap: 10, fontSize: 14, lineHeight: 1.6, color: "#DAD6D0", marginBottom: 8 } },
          h("span", { style: { color: tone } }, "—"),
          h("span", null, item)
        )
      )
    )
  );
}

createRoot(document.getElementById("root")).render(h(App));
