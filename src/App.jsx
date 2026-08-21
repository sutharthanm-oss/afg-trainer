import React, { useState, useRef, useEffect, useCallback } from "react";
import { Mic, Phone, PhoneOff, Send, ChevronRight, CheckCircle2, XCircle, Loader2, Clock, User, Award, Copy, Check, HelpCircle, Eye, EyeOff, FileDown } from "lucide-react";
import { jsPDF } from "jspdf";

/* ---------------------------------------------------------
   CallSpar — v1.0
   Mobile-first web app. Add to Home Screen for an app feel.
   --------------------------------------------------------- */


// Small emergency fallback set, used only if the live /api/starters,
// /api/objections, /api/prospects calls fail. The real source of truth for
// all three libraries is Airtable — add, edit, or retire entries there and
// they appear in the app immediately, no redeploy needed.
const FALLBACK_STARTERS = [
  { id: "CS-01", en: "Hi, quick question. I believe you already have insurance for your life, hospitalization, car, and maybe even your home. But have you bought insurance for your income?",
    bm: "Hai, satu soalan pantas. Saya percaya awak sudah ada insurans untuk nyawa, hospitalisasi, kereta, dan mungkin rumah awak. Tapi adakah awak sudah beli insurans untuk pendapatan awak?",
    manglish: "Hi, quick question ah. I believe you already got insurance for life, hospitalization, car, maybe your house also got. But have you bought insurance for your income or not?",
    ta: "வணக்கம், ஒரு சின்ன கேள்வி. உங்களுக்கு வாழ்க்கை, மருத்துவமனை, கார், வீடு எல்லாத்துக்கும் இன்சூரன்ஸ் இருக்கும்னு நினைக்கிறேன். ஆனா உங்க மாத வருமானத்துக்கு இன்சூரன்ஸ் வாங்கியிருக்கீங்களா?",
    zh: "嗨，问你一个小问题。我相信你已经有人寿保险、住院保险、车险，甚至可能连房子都保了。可是，你有没有买保护你收入的保险呢？" },
];

function starterText(starter, language) {
  if (!starter) return "";
  if (language === "Bahasa Malaysia") return starter.bm;
  if (language === "Manglish") return starter.manglish;
  if (language === "Tamil") return starter.ta;
  if (language === "Mandarin") return starter.zh;
  return starter.en;
}

const FALLBACK_OBJECTIONS = [
  { id: "OBJ-001", category: "Already insured", difficulty: "Beginner", main: "I already have insurance." },
  { id: "OBJ-002", category: "Busy/no time", difficulty: "Beginner", main: "I'm busy right now." },
  { id: "OBJ-004", category: "Not interested", difficulty: "Beginner", main: "I'm not interested." },
];

const FALLBACK_PROSPECTS = [
  { id: "PRO-001", name: "Aisyah binti Rahman", age: "28–34", occupation: "Marketing Executive", location: "Urban, KL", personality: "Friendly, slightly distracted, busy schedule", difficulty: "Beginner", hiddenConcern: "Worried about affording anything on her salary", hiddenMotivation: "Wants to feel like a responsible adult" },
  { id: "PRO-006", name: "Nur Fatimah binti Zulkifli", age: "26–32", occupation: "Primary School Teacher", location: "Suburban, Shah Alam", personality: "Polite, conflict-avoidant, agreeable on the surface", difficulty: "Beginner", hiddenConcern: "Genuinely can't stretch her budget further", hiddenMotivation: "Wants to say yes but fears her husband's disapproval" },
];

// DEMO MODE: when true, agents only see the Quick Practice button — no Mode/Language/
// Difficulty/Starter customization, no separate "Start the call" button. Set to false to
// restore full customization for everyone once the demo period is over.
const DEMO_MODE = true;

const CONSTITUTION_SUMMARY = `Rules: appointments must be earned, never gifted. Weak communication must be challenged. No coaching during roleplay. Resistance changes with agent performance. The prospect remembers contradictions and may fully reject the appointment. Stay within the approved objection library. Product knowledge, recruitment, needs analysis, policy comparison are out of scope. This is a simulation.`;

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function byDifficulty(arr, difficulty) {
  const filtered = arr.filter((x) => x.difficulty === difficulty);
  return filtered.length ? filtered : arr;
}
function pickThreeObjections(objectionsList, difficulty) {
  const pool = byDifficulty(objectionsList.filter((o) => o.id !== "OBJ-020"), difficulty);
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 3);
}
function newSessionId(agentCode) {
  const d = new Date();
  const ds = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const rand = Math.floor(Math.random() * 900 + 100);
  return `CS-${ds}-${agentCode || "AGENT"}-${rand}`;
}

async function callClaude(messages, system, maxTokens = 1024) {
  let resp;
  try {
    resp = await fetch("/api/claude", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, system, maxTokens }),
    });
  } catch (networkErr) {
    throw new Error("Couldn't reach the server: " + networkErr.message);
  }
  const rawText = await resp.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch (parseErr) {
    throw new Error("Server returned an unexpected response (HTTP " + resp.status + ")");
  }
  if (!resp.ok) {
    throw new Error(data?.error || "Server error (HTTP " + resp.status + ")");
  }
  if (!data.text) {
    throw new Error("Empty response from the model. Please try again.");
  }
  return data.text;
}

function extractJson(text) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON found. Raw (first 300 chars): " + cleaned.slice(0, 300));
  let candidate = cleaned.slice(start, end + 1);

  // Layer 1: parse as-is.
  try {
    return JSON.parse(candidate);
  } catch (e1) {}

  // Layer 2: repair common, harmless issues — raw line breaks/tabs inside a string value
  // (invalid JSON, but none of our fields legitimately need real newlines preserved), and
  // trailing commas before a closing bracket.
  const repaired = candidate
    .replace(/[\r\n\t]+/g, " ")
    .replace(/,\s*([}\]])/g, "$1");
  try {
    return JSON.parse(repaired);
  } catch (e2) {
    throw new Error("Unable to parse JSON after repair. Raw (first 300 chars): " + candidate.slice(0, 300));
  }
}

// The assessment schema has ~25 known fields in a fixed order. Unlike a roleplay reply,
// we can't fall back to "just show the raw text" if parsing fails — a broken assessment
// genuinely has nothing sensible to display. So instead of hoping the model always
// escapes quotes perfectly, this extracts each field by anchoring on the NEXT field name
// in sequence, tolerating any stray quotes in between. This is what actually makes a
// malformed response recoverable instead of a hard failure.
const ASSESSMENT_STRING_FIELDS = [
  "communication_evidence", "communication_improvement",
  "objection_handling_evidence", "objection_handling_improvement",
  "appointment_closing_evidence", "appointment_closing_improvement",
  "listening_evidence", "listening_improvement",
  "questioning_evidence", "questioning_improvement",
  "confidence_tone_evidence", "confidence_tone_improvement",
  "script_intent_evidence", "script_intent_improvement",
  "pass_status", "appointment_outcome", "compliance_result", "compliance_issue",
  "one_biggest_mistake", "highest_impact_improvement",
  "strongest_sentence", "strongest_question", "better_response", "better_close",
  "full_report", "flagged_technique", "flagged_technique_reason",
];
const ASSESSMENT_NUMBER_FIELDS = [
  "communication", "objection_handling", "appointment_closing", "listening",
  "questioning", "confidence_tone", "script_intent", "overall", "ai_confidence",
];
const ASSESSMENT_ARRAY_FIELDS = ["all_mistakes", "things_done_well"];
const ASSESSMENT_FIELD_ORDER = [
  "communication", "communication_evidence", "communication_improvement",
  "objection_handling", "objection_handling_evidence", "objection_handling_improvement",
  "appointment_closing", "appointment_closing_evidence", "appointment_closing_improvement",
  "listening", "listening_evidence", "listening_improvement",
  "questioning", "questioning_evidence", "questioning_improvement",
  "confidence_tone", "confidence_tone_evidence", "confidence_tone_improvement",
  "script_intent", "script_intent_evidence", "script_intent_improvement",
  "overall", "pass_status", "appointment_outcome", "compliance_result", "compliance_issue",
  "ai_confidence", "one_biggest_mistake", "highest_impact_improvement",
  "strongest_sentence", "strongest_question", "better_response", "better_close",
  "full_report", "flagged_technique", "flagged_technique_reason",
  "all_mistakes", "things_done_well",
];

function extractAssessmentJson(text) {
  try {
    return extractJson(text);
  } catch (e) {}

  const cleaned = text.replace(/```json|```/g, "").trim();
  const result = {};

  function nextFieldPattern(index) {
    // Match up to whichever of: the next known field name, or the final closing brace,
    // comes first — this is what lets a stray quote inside the VALUE be tolerated.
    for (let j = index + 1; j < ASSESSMENT_FIELD_ORDER.length; j++) {
      const nf = ASSESSMENT_FIELD_ORDER[j];
      return `(?="${nf}"\\s*:|\\}\\s*$)`;
    }
    return `(?=\\}\\s*$)`;
  }

  ASSESSMENT_FIELD_ORDER.forEach((field, idx) => {
    if (ASSESSMENT_NUMBER_FIELDS.includes(field)) {
      const m = cleaned.match(new RegExp(`"${field}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`));
      result[field] = m ? Number(m[1]) : 0;
    } else if (ASSESSMENT_STRING_FIELDS.includes(field)) {
      const lookahead = nextFieldPattern(idx);
      const m = cleaned.match(new RegExp(`"${field}"\\s*:\\s*"([\\s\\S]*?)"\\s*,?\\s*${lookahead}`));
      result[field] = m ? m[1].replace(/\\"/g, '"').replace(/\\n|\\t/g, " ").trim() : "";
    } else if (ASSESSMENT_ARRAY_FIELDS.includes(field)) {
      const m = cleaned.match(new RegExp(`"${field}"\\s*:\\s*\\[([\\s\\S]*?)\\]`));
      if (!m) {
        result[field] = [];
      } else {
        result[field] = m[1]
          .split(/",\s*"|"\s*,\s*"/)
          .map((s) => s.replace(/^"|"$/g, "").replace(/\\"/g, '"').trim())
          .filter(Boolean);
      }
    }
  });

  // A recovered result is only useful if the core scores actually came through — if every
  // category is still zero, the repair didn't really work and we should treat this as a
  // genuine failure rather than show a fake all-zero assessment.
  const gotRealScores = ASSESSMENT_NUMBER_FIELDS.slice(0, 7).some((f) => result[f] > 0);
  if (!gotRealScores) {
    throw new Error("Could not recover assessment scores from response. Raw (first 300 chars): " + cleaned.slice(0, 300));
  }
  return result;
}

// Roleplay replies specifically get extra, more forgiving fallback layers on top of
// extractJson, since a broken "reply" line should never actually break the conversation —
// unlike the assessment, which genuinely needs real structured score data to be meaningful.
function extractRoleplayReply(text) {
  try {
    return extractJson(text);
  } catch (e) {}

  const cleaned = text.replace(/```json|```/g, "").trim();

  // Layer 3: loosely pull out just the fields we actually need via regex, rather than
  // requiring the entire blob to be strictly valid JSON. Anchored on the *next known field
  // name* (not just "any unescaped quote") so a stray quote inside the reply text itself
  // (e.g. the prospect saying the word "hard sell" in quotes) doesn't truncate the sentence.
  function looseReplyField() {
    // Try a few anchor patterns, since field order can occasionally vary.
    const patterns = [
      /"reply"\s*:\s*"([\s\S]*?)"\s*,\s*"endRoleplay"/,
      /"reply"\s*:\s*"([\s\S]*?)"\s*,\s*"endReason"/,
      /"reply"\s*:\s*"([\s\S]*?)"\s*\}\s*$/,
    ];
    for (const re of patterns) {
      const m = cleaned.match(re);
      if (m) return m[1].replace(/\\"/g, '"').replace(/\\n|\\t/g, " ").trim();
    }
    return null;
  }
  function looseField(name) {
    const m = cleaned.match(new RegExp(`"${name}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`));
    if (!m) return null;
    try {
      return JSON.parse('"' + m[1] + '"');
    } catch (e) {
      return m[1];
    }
  }
  const looseReply = looseReplyField();
  if (looseReply !== null && looseReply.length > 0) {
    return {
      reply: looseReply,
      endRoleplay: /"endRoleplay"\s*:\s*true/.test(cleaned),
      endReason: looseField("endReason") || "",
    };
  }

  // Layer 4: absolute last resort — nothing parsed as structured data at all. Rather than
  // breaking the conversation, treat the raw model output itself as the spoken line, with
  // any stray JSON punctuation stripped off the ends.
  const fallbackText = cleaned.replace(/^[{\s]+|[}\s]+$/g, "").trim();
  if (fallbackText) {
    return { reply: fallbackText, endRoleplay: false, endReason: "" };
  }

  throw new Error("Unable to parse response after all repair attempts. Raw (first 300 chars): " + cleaned.slice(0, 300));
}

function extractJsonArray(text) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("No JSON array found");
  return JSON.parse(cleaned.slice(start, end + 1));
}

// Fallback list, used only if the live /api/agents call fails (e.g. during local dev
// without env vars set). The real source of truth is the Airtable Agents table.
const FALLBACK_AGENTS = [
  { code: "A16187", name: "Sutharthan Marimuthu" },
];

export default function App() {
  const [screen, setScreen] = useState(() =>
    typeof window !== "undefined" && window.location.pathname.toLowerCase().includes("dashboard") ? "admin" : "setup"
  );
  const [adminSecretInput, setAdminSecretInput] = useState("");
  const [adminAuthed, setAdminAuthed] = useState(false);
  const [adminAuthState, setAdminAuthState] = useState("idle"); // idle | checking | error
  const [adminAgents, setAdminAgents] = useState([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState("");
  const [newAgentCode, setNewAgentCode] = useState("");
  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentAccessCode, setNewAgentAccessCode] = useState("");
  const [adminActionState, setAdminActionState] = useState("idle"); // idle | saving | done | error
  const [flaggedTechniques, setFlaggedTechniques] = useState([]);
  const [dashboardData, setDashboardData] = useState(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [expandedAgentRow, setExpandedAgentRow] = useState(null);
  const [expandedSessionId, setExpandedSessionId] = useState(null);
  const [dashboardRange, setDashboardRange] = useState("all");
  const [flagsLoading, setFlagsLoading] = useState(false);
  const [rankedUnlocked, setRankedUnlocked] = useState(false);
  const [godModeUnlocked, setGodModeUnlocked] = useState(false);
  const [showGodModeUnlock, setShowGodModeUnlock] = useState(false);
  const [godModePassword, setGodModePassword] = useState("");
  const [godModeUnlockState, setGodModeUnlockState] = useState("idle"); // idle | checking | error
  const [showRankedUnlock, setShowRankedUnlock] = useState(false);
  const [rankedUnlockPassword, setRankedUnlockPassword] = useState("");
  const [rankedUnlockState, setRankedUnlockState] = useState("idle"); // idle | checking | error
  const [agentName, setAgentName] = useState("");
  const [agentCode, setAgentCode] = useState("");
  const [agentList, setAgentList] = useState([]);
  const [agentListState, setAgentListState] = useState("loading"); // loading | ready | error
  const [starters, setStarters] = useState(FALLBACK_STARTERS);
  const [objectionLibrary, setObjectionLibrary] = useState(FALLBACK_OBJECTIONS);
  const [prospectLibrary, setProspectLibrary] = useState(FALLBACK_PROSPECTS);
  const [contentListState, setContentListState] = useState("loading"); // loading | ready | error
  const [selectedAgentCode, setSelectedAgentCode] = useState("");
  const [accessPassword, setAccessPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showGodModePassword, setShowGodModePassword] = useState(false);
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  const [verifyState, setVerifyState] = useState("idle"); // idle | verifying | verified | invalid | error
  const [mySessions, setMySessions] = useState([]);
  const [mySessionsState, setMySessionsState] = useState("idle"); // idle | loading | ready
  const [verifyError, setVerifyError] = useState("");
  const [copiedWhere, setCopiedWhere] = useState("");
  const [showMicHelp, setShowMicHelp] = useState(false);
  const [showGuide, setShowGuide] = useState(true);
  const [showFullBreakdown, setShowFullBreakdown] = useState(false);

  function copyText(text, where) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        setCopiedWhere(where);
        setTimeout(() => setCopiedWhere(""), 2000);
      }).catch(() => {
        setMicError("Couldn't copy automatically — please select and copy the text manually.");
      });
    }
  }

  const [mode, setMode] = useState("Practice");
  const [language, setLanguage] = useState("English");
  const [starterId, setStarterId] = useState("CS-01");
  const [difficulty, setDifficulty] = useState("Beginner");

  const [prospect, setProspect] = useState(null);
  const [objections, setObjections] = useState([]);
  const [sessionId, setSessionId] = useState("");
  const [messages, setMessages] = useState([]);
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const [autoPlayTypingAs, setAutoPlayTypingAs] = useState(""); // "agent" | "prospect" | ""
  const messagesRef = useRef([]);
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const [micError, setMicError] = useState("");
  const [sending, setSending] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [roleplayEnded, setRoleplayEnded] = useState(false);
  const [pendingEndReason, setPendingEndReason] = useState("");
  const [showScript, setShowScript] = useState(true);
  const [assessment, setAssessment] = useState(null);
  const [assessing, setAssessing] = useState(false);
  const [submitState, setSubmitState] = useState("idle"); // idle | submitting | done | error
  const [submitError, setSubmitError] = useState("");

  const recognitionRef = useRef(null);
  const micTimeoutRef = useRef(null);
  const timerRef = useRef(null);
  const chatEndRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    async function loadAgents() {
      setAgentListState("loading");
      try {
        const resp = await fetch("/api/agents");
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || "Failed to load agents");
        setAgentList(data.agents || []);
        setAgentListState("ready");
      } catch (e) {
        // Fall back to the embedded list so the app is still usable if the API route
        // isn't configured yet (e.g. missing AIRTABLE_TOKEN during initial deploy).
        setAgentList(FALLBACK_AGENTS);
        setAgentListState("ready");
      }
    }
    loadAgents();
  }, []);

  useEffect(() => {
    async function loadContent() {
      setContentListState("loading");
      try {
        const [startersResp, objectionsResp, prospectsResp] = await Promise.all([
          fetch("/api/starters"),
          fetch("/api/objections"),
          fetch("/api/prospects"),
        ]);
        const [startersData, objectionsData, prospectsData] = await Promise.all([
          startersResp.json(),
          objectionsResp.json(),
          prospectsResp.json(),
        ]);
        if (!startersResp.ok || !startersData.starters?.length) throw new Error("starters");
        if (!objectionsResp.ok || !objectionsData.objections?.length) throw new Error("objections");
        if (!prospectsResp.ok || !prospectsData.prospects?.length) throw new Error("prospects");
        setStarters(startersData.starters);
        setObjectionLibrary(objectionsData.objections);
        setProspectLibrary(prospectsData.prospects);
        setContentListState("ready");
      } catch (e) {
        // Fall back to the small embedded set so the app is still usable if the
        // API routes aren't configured yet or Airtable is briefly unreachable.
        setContentListState("ready");
      }
    }
    loadContent();
  }, []);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 280) + "px";
    }
  }, [input]);

  async function unlockRankedMode() {
    if (!rankedUnlockPassword.trim()) return;
    setRankedUnlockState("checking");
    try {
      const resp = await fetch("/api/admin-agents", { headers: { "x-admin-secret": rankedUnlockPassword.trim() } });
      if (resp.ok) {
        setRankedUnlocked(true);
        setShowRankedUnlock(false);
        setRankedUnlockState("idle");
      } else {
        setRankedUnlockState("error");
      }
    } catch (e) {
      setRankedUnlockState("error");
    }
  }

  async function unlockGodMode() {
    if (!godModePassword.trim()) return;
    setGodModeUnlockState("checking");
    try {
      const resp = await fetch("/api/admin-agents", { headers: { "x-admin-secret": godModePassword.trim() } });
      if (resp.ok) {
        setGodModeUnlocked(true);
        setShowGodModeUnlock(false);
        setGodModeUnlockState("idle");
      } else {
        setGodModeUnlockState("error");
      }
    } catch (e) {
      setGodModeUnlockState("error");
    }
  }

  async function loadAdminAgents(secret) {
    setAdminLoading(true);
    setAdminError("");
    try {
      const resp = await fetch("/api/admin-agents", { headers: { "x-admin-secret": secret } });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Failed to load agents.");
      setAdminAgents(data.agents || []);
      setAdminAuthed(true);
      setAdminAuthState("idle");
      loadFlaggedTechniques(secret);
      loadDashboard(secret, "all");
    } catch (e) {
      setAdminAuthState("error");
      setAdminError(e.message);
    } finally {
      setAdminLoading(false);
    }
  }

  async function loadDashboard(secret, range) {
    setDashboardLoading(true);
    try {
      const url = range === "all" ? "/api/dashboard?range=all" : "/api/dashboard";
      const resp = await fetch(url, { headers: { "x-admin-secret": secret } });
      const data = await resp.json();
      if (resp.ok) setDashboardData(data);
    } catch (e) {
      // Non-critical — Admin panel still works without the dashboard loading.
    } finally {
      setDashboardLoading(false);
    }
  }

  async function loadFlaggedTechniques(secret) {
    setFlagsLoading(true);
    try {
      const resp = await fetch("/api/flagged-techniques", { headers: { "x-admin-secret": secret } });
      const data = await resp.json();
      if (resp.ok) setFlaggedTechniques(data.flags || []);
    } catch (e) {
      // Non-critical — Admin panel still works without this list loading.
    } finally {
      setFlagsLoading(false);
    }
  }

  async function reviewFlag(flagId, status) {
    try {
      await fetch("/api/flagged-techniques", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-admin-secret": adminSecretInput.trim() },
        body: JSON.stringify({ id: flagId, status, reviewedBy: "Admin" }),
      });
      setFlaggedTechniques((prev) => prev.filter((f) => f.id !== flagId));
    } catch (e) {
      // Silent — the item will just still appear next load if this failed.
    }
  }

  async function checkAdminSecret() {
    if (!adminSecretInput.trim()) return;
    setAdminAuthState("checking");
    await loadAdminAgents(adminSecretInput.trim());
  }

  async function addNewAgent() {
    if (!newAgentCode.trim() || !newAgentName.trim() || !newAgentAccessCode.trim()) {
      setAdminError("Please fill in agent code, name, and an access code.");
      return;
    }
    setAdminActionState("saving");
    setAdminError("");
    try {
      const resp = await fetch("/api/admin-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-secret": adminSecretInput.trim() },
        body: JSON.stringify({ code: newAgentCode.trim().toUpperCase(), name: newAgentName.trim(), accessCode: newAgentAccessCode.trim() }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Failed to add agent.");
      setAdminActionState("done");
      setNewAgentCode("");
      setNewAgentName("");
      setNewAgentAccessCode("");
      await loadAdminAgents(adminSecretInput.trim());
      setTimeout(() => setAdminActionState("idle"), 2000);
    } catch (e) {
      setAdminActionState("error");
      setAdminError(e.message);
    }
  }

  async function toggleAgentStatus(agent) {
    const newStatus = agent.status === "Active" ? "Suspended" : "Active";
    setAdminActionState("saving");
    try {
      const resp = await fetch("/api/admin-agents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-admin-secret": adminSecretInput.trim() },
        body: JSON.stringify({ id: agent.id, status: newStatus }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Failed to update agent.");
      await loadAdminAgents(adminSecretInput.trim());
      setAdminActionState("idle");
    } catch (e) {
      setAdminActionState("error");
      setAdminError(e.message);
    }
  }

  function selectAgent(code) {
    setSelectedAgentCode(code);
    const found = agentList.find((a) => a.code === code);
    setAgentCode(found ? found.code : "");
    setAgentName(found ? found.name : "");
    setAccessPassword("");
    setShowPassword(false);
    setVerifyState("idle");
    setMySessions([]);
    setMySessionsState("idle");
  }

  async function loadMySessions(code) {
    setMySessionsState("loading");
    try {
      const resp = await fetch("/api/my-sessions?agentCode=" + encodeURIComponent(code));
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Failed to load sessions");
      setMySessions(data.sessions || []);
      setMySessionsState("ready");
    } catch (e) {
      setMySessions([]);
      setMySessionsState("ready");
    }
  }

  async function verifyAccessCode() {
    if (!accessPassword.trim()) return;
    setVerifyState("verifying");
    setVerifyError("");
    try {
      const resp = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentCode, password: accessPassword.trim() }),
      });
      if (resp.status === 404) {
        setVerifyError("The verification service isn't set up on this deployment yet (api/verify.js is missing). This is a setup issue, not a wrong code.");
        setVerifyState("error");
        return;
      }
      const rawText = await resp.text();
      let data;
      try {
        data = JSON.parse(rawText);
      } catch (e) {
        setVerifyError("Server returned an unexpected response (HTTP " + resp.status + ").");
        setVerifyState("error");
        return;
      }
      if (!resp.ok) {
        setVerifyError(data.error || "Server error (HTTP " + resp.status + ").");
        setVerifyState("error");
        return;
      }
      setVerifyState(data.valid ? "verified" : "invalid");
      if (data.valid) loadMySessions(agentCode);
    } catch (e) {
      setVerifyError("Couldn't reach the server: " + e.message);
      setVerifyState("error");
    }
  }

  useEffect(() => {
    if (screen === "roleplay" && !roleplayEnded) {
      timerRef.current = setInterval(() => {
        setSeconds((s) => {
          if (s >= 899) {
            clearInterval(timerRef.current);
            endRoleplay("15-minute time limit reached.");
            return s;
          }
          return s + 1;
        });
      }, 1000);
      return () => clearInterval(timerRef.current);
    }
  }, [screen, roleplayEnded]);

  function startMic() {
    setMicError("");
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setMicError("Voice input isn't supported in this browser. Please type instead.");
      return;
    }
    // Fully clean up any previous recognition instance before starting a new one.
    // iOS Safari throws "aborted" errors on the 2nd+ attempt if the previous
    // instance's audio session hasn't been fully released first.
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.abort();
      } catch (e) {}
      recognitionRef.current = null;
    }

    const attemptStart = (isRetry) => {
      try {
        const rec = new SpeechRecognition();
        // Web Speech API doesn't have a distinct "Malaysian Mandarin" locale — zh-CN
        // (Simplified Chinese) is the closest widely-supported option for recognition.
        rec.lang = language === "Tamil" ? "ta-MY" : language === "Bahasa Malaysia" ? "ms-MY" : language === "Mandarin" ? "zh-CN" : "en-MY";
        rec.interimResults = true;
        rec.continuous = false;

        const clearHangTimer = () => {
          if (micTimeoutRef.current) {
            clearTimeout(micTimeoutRef.current);
            micTimeoutRef.current = null;
          }
        };

        rec.onresult = (e) => {
          clearHangTimer();
          let transcript = "";
          for (let i = 0; i < e.results.length; i++) transcript += e.results[i][0].transcript;
          setInput(transcript);
        };
        rec.onstart = () => setListening(true);
        rec.onend = () => {
          clearHangTimer();
          setListening(false);
        };
        rec.onerror = (e) => {
          clearHangTimer();
          setListening(false);
          if (e.error === "aborted" && !isRetry) {
            // Known iOS Safari quirk: silently retry once after a brief pause.
            recognitionRef.current = null;
            setTimeout(() => attemptStart(true), 350);
            return;
          }
          if (e.error === "not-allowed" || e.error === "service-not-allowed") {
            setMicError("Microphone access was blocked. Check your browser's site permissions for the microphone, or type instead.");
          } else if (e.error === "no-speech") {
            setMicError("Didn't catch that — tap the mic and try again.");
          } else if (e.error === "aborted") {
            setMicError("Voice input didn't start cleanly this time. Tap the mic again, or type instead.");
          } else {
            setMicError("Voice input hit an error (" + e.error + "). Please type instead.");
          }
        };
        recognitionRef.current = rec;
        rec.start();

        // Safety net: iOS Safari can silently hang on repeat mic uses — no result,
        // no error, no end event, ever. If nothing happens within 10 seconds,
        // force it to stop and tell the person plainly, instead of leaving the
        // mic looking "listening" forever with no way out.
        micTimeoutRef.current = setTimeout(() => {
          try { rec.abort(); } catch (e) {}
          setListening(false);
          setMicError("Voice input stalled and didn't capture anything — this is a known iOS Safari issue with repeated mic use, not something wrong on your end. Please use the \"Copy script\" button, your keyboard's own dictation button, or type instead.");
        }, 10000);
      } catch (err) {
        setListening(false);
        setMicError("Voice input couldn't start in this browser. Please type instead.");
      }
    };
    attemptStart(false);
  }
  function stopMic() {
    if (micTimeoutRef.current) {
      clearTimeout(micTimeoutRef.current);
      micTimeoutRef.current = null;
    }
    try {
      recognitionRef.current?.abort();
    } catch (e) {}
    setListening(false);
  }

  function buildRoleplaySystemPrompt(overrides) {
    const ov = overrides || {};
    const p = ov.prospect || prospect;
    const objs = ov.objections || objections;
    const sid = ov.starterId || starterId;
    const lang = ov.language || language;
    const starter = starters.find((s) => s.id === sid);
    return `You are playing a fictional Malaysian insurance prospect in a training simulation for appointment-setting agents. ${CONSTITUTION_SUMMARY}

PROSPECT PROFILE (stay fully in character, never break character, never reveal hidden fields directly):
Name: ${p.name} | Age: ${p.age} | Occupation: ${p.occupation}
Personality: ${p.personality}
Hidden concern (only surface through your behaviour, never state directly): ${p.hiddenConcern}
Hidden motivation (only surface through your behaviour, never state directly): ${p.hiddenMotivation}

CONVERSATION STARTER THE AGENT IS USING (in ${lang}): "${starterText(starter, lang)}"

APPROVED OBJECTIONS YOU MUST RAISE, IN ORDER, ONE AT A TIME, ONLY WHEN NATURALLY RELEVANT (do not dump all three at once):
1. [${objs[0]?.id}] ${objs[0]?.main} (category: ${objs[0]?.category})
2. [${objs[1]?.id}] ${objs[1]?.main} (category: ${objs[1]?.category})
3. [${objs[2]?.id}] ${objs[2]?.main} (category: ${objs[2]?.category})

RULES:
- Respond ONLY in character as the prospect, in ${lang === "Manglish" ? "natural Manglish (mixed English/Malay)" : lang}. Keep replies short and conversational (1-3 sentences), like real speech.
- Increase resistance (become more guarded, short, skeptical) if the agent talks too much, interrupts, ignores your objection, pressures you, or contradicts themselves.
- Decrease resistance (become warmer, more open) if the agent listens, acknowledges your concern, asks good questions, and communicates clearly.
- Do not give an appointment easily. Require a specific date, time, a general location or platform (an exact venue name is not required — "a coffee shop near your office" or "a call on Zoom" is acceptable), and your clear agreement before accepting.
${ov.noRejection ? "- This is a scripted product demonstration. Raise realistic objections and questions, but do NOT fully reject the appointment under any circumstances — always remain open to eventually agreeing." : "- You may fully reject the appointment if the agent performs poorly or pressures you after you've declined."}
- Never coach the agent. Never break character. Never mention that you are an AI or that this is a simulation.
${ov.forceAccept ? "\nIMPORTANT — THIS IS THE FINAL TURN: Whatever day, time, and location or platform is already on the table from the conversation so far, you must now warmly and unambiguously CONFIRM it exactly as-is — repeat it back briefly so it's clear (e.g. \"Great, Thursday 6:30pm at the cafe works for me!\"). Do NOT propose a new day, time, or location of your own, do NOT hedge, do NOT ask any further questions, do NOT raise any new objection. Just confirm what's already been discussed. Set endRoleplay to true with endReason describing the confirmed appointment." : ""}

OUTPUT FORMAT: Respond with ONLY valid JSON, no other text:
{"reply": "<your in-character spoken response>", "endRoleplay": <true if a fully confirmed appointment was just secured, OR you are giving a final firm rejection, otherwise false>, "endReason": "<short reason if ending, else empty string>"}`;
  }

  async function sendMessage(text) {
    if (!text.trim() || sending || roleplayEnded) return;
    const userMsg = { role: "user", text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setSending(true);
    const apiMessages = newMessages.map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.role === "assistant" ? JSON.stringify({ reply: m.text }) : m.text,
    }));

    async function attempt() {
      const raw = await callClaude(apiMessages, buildRoleplaySystemPrompt(), 400);
      return extractRoleplayReply(raw);
    }

    try {
      let parsed;
      try {
        parsed = await attempt();
      } catch (firstErr) {
        // A malformed JSON reply is usually a one-off glitch — silently retry once
        // before ever bothering the agent with an error message.
        parsed = await attempt();
      }
      setMessages((prev) => [...prev, { role: "assistant", text: parsed.reply }]);
      if (parsed.endRoleplay) {
        setTimeout(() => endRoleplay(parsed.endReason || "Roleplay concluded."), 400);
      }
    } catch (e) {
      setMessages((prev) => [...prev, { role: "assistant", text: "(Connection issue: " + e.message + " — please try sending that again.)" }]);
    } finally {
      setSending(false);
    }
  }

  function endRoleplay(reason) {
    clearInterval(timerRef.current);
    setRoleplayEnded(true);
    setPendingEndReason(reason);
    // Deliberately does NOT call runAssessment() here — the agent reads back through the
    // conversation first and taps "Next" (rendered below) when ready to actually be scored.
  }

  async function runAssessment(endReason) {
    setAssessing(true);
    const starter = starters.find((s) => s.id === starterId);
    const transcript = messages.map((m) => `${m.role === "user" ? "AGENT" : "PROSPECT"}: ${m.text}`).join("\n");
    const system = `You are a strict certified assessor evaluating an appointment-setting roleplay. Do not inflate scores. Do not be a people-pleaser. A weak performance must get a weak score. Score out of these weights: Communication Effectiveness 25, Objection Handling 25, Appointment Closing 20, Listening 10, Questioning 10, Confidence/Tone 5, Script Intent Alignment 5 (total 100). Passing score is 80. A confirmed appointment requires: 45-minute meeting, specific date, specific time, a general location or platform (an exact venue name is not required — a general reference like "a cafe near your office" or "on Zoom" counts as confirmed), clear commitment, permission to send details. Automatically fail (compliance) for guarantees, false claims, fake urgency, or pressure after final rejection.

GLOBAL FORMATTING RULE — applies to every single field in this response, not just one section: your entire reply is a JSON object. Anywhere, in any field (evidence, mistakes, strengths, the full report, anywhere at all), that you quote or reference the exact words either party said, wrap that excerpt in single quotes ('like this') — never in double quotes ("like this"). A double quote inside a JSON string value that isn't the field's own delimiter breaks the entire response and makes it fail completely. This rule matters more than anything else in this prompt: an unparseable response helps no one, however good the actual assessment inside it would have been.

For EVERY one of the 7 category scores, the evidence field MUST include at least one exact, verbatim quote from what the agent actually said in this specific conversation — word for word, not paraphrased. A description of quality without a quote (e.g. "Clear, confident delivery throughout") is not acceptable, even if true — the agent needs to see the literal sentence that earned or cost them points, not a summary judgment about it. CRITICAL FORMATTING RULE: since this whole response is JSON, wrap each quoted excerpt in single quotes ('like this'), never in double quotes — double quotes inside a JSON string value break the response and make it unusable. Format each evidence field as: a single-quoted excerpt, followed by a brief explanation of why that specific line mattered for this category. If a score isn't full marks, quote the specific line that fell short and explain the gap. If a category scored full marks, quote the specific line that earned it.

List EVERY distinct mistake you can identify (not just the single biggest one) — each as a short, specific, standalone point. Same for strengths — list EVERY distinct thing the agent did well, not just one. Use empty arrays if genuinely none apply, but do not pad the lists with filler either.

For EVERY one of the 7 categories, also give a specific, actionable "how to improve" recommendation — a concrete action the agent can take next time, not a vague restatement like "communicate better". If a category already scored full marks, the improvement field should say what to keep doing to maintain that, not invent a fake weakness.

Conversation starter used (${language}): "${starterText(starter, language)}"
End reason: ${endReason}

Respond with ONLY valid JSON in this exact shape:
{"communication":0,"communication_evidence":"","communication_improvement":"","objection_handling":0,"objection_handling_evidence":"","objection_handling_improvement":"","appointment_closing":0,"appointment_closing_evidence":"","appointment_closing_improvement":"","listening":0,"listening_evidence":"","listening_improvement":"","questioning":0,"questioning_evidence":"","questioning_improvement":"","confidence_tone":0,"confidence_tone_evidence":"","confidence_tone_improvement":"","script_intent":0,"script_intent_evidence":"","script_intent_improvement":"","overall":0,"pass_status":"Pass or Retry","appointment_outcome":"Secured or Not Secured","compliance_result":"Pass or Fail","compliance_issue":"","ai_confidence":0,"one_biggest_mistake":"","highest_impact_improvement":"","strongest_sentence":"","strongest_question":"","better_response":"","better_close":"","full_report":"","flagged_technique":"","flagged_technique_reason":"","all_mistakes":[],"things_done_well":[]}

If the agent used an effective technique that is NOT part of the approved objection library or standard script (per AI Constitution Article 24), briefly describe it in flagged_technique and explain why it worked in flagged_technique_reason. Leave both as empty strings if nothing notable falls outside the approved library. This flag is for Admin review only — it does not affect the score.`;

    async function attemptAssessment() {
      const raw = await callClaude([{ role: "user", content: `TRANSCRIPT:\n${transcript}\n\nProduce the assessment JSON now.` }], system, 2200);
      return extractAssessmentJson(raw);
    }

    try {
      let parsed;
      let lastErr;
      const ATTEMPTS = 3;
      for (let i = 0; i < ATTEMPTS; i++) {
        try {
          parsed = await attemptAssessment();
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
        }
      }
      if (lastErr) throw lastErr;
      setAssessment(parsed);
      setScreen("assessment");
    } catch (e) {
      setAssessment({ error: true });
      setScreen("assessment");
    } finally {
      setAssessing(false);
    }
  }

  function buildMasterAgentSystemPrompt(closeNow, overrides) {
    const ov = overrides || {};
    const sid = ov.starterId || starterId;
    const lang = ov.language || language;
    const starter = starters.find((s) => s.id === sid);
    return `You are playing a master-level, top-performing insurance appointment-setting agent in a scripted product demonstration. You are speaking with a fictional prospect. Handle whatever they say smoothly and briefly using natural, proven techniques (acknowledge the concern, reframe it, redirect toward the appointment) — never sound robotic or scripted, sound like a confident real person. Keep each response to 1-3 natural sentences, like real speech, in ${lang === "Manglish" ? "natural Manglish (mixed English/Malay)" : lang}.

Conversation starter already used to open (do not repeat it): "${starterText(starter, lang)}"

RULE: The appointment is always a 45-minute meeting. Never propose, agree to, or mention any other duration (not 15, not 20, not 30 minutes) at any point in the conversation — this applies from your very first mention of time commitment through to the final close.
RULE: Whenever you propose meeting logistics (day, time, or location) at any point in the conversation, always state a specific location yourself — never turn the location into an open question back to the prospect (avoid phrasing like "you tell me which area" or "where's convenient for you"). Naming a concrete, generic type of place ("a cafe near your office", "a quick Zoom call") is always better than deferring the decision to them.
${closeNow ? "\nThis is your final turn. You must close now: propose a specific day and time, the 45-minute duration, and a general location or platform (e.g. \"a cafe near your office\" or \"a quick Zoom call\"), using a confident two-choice close. Do not ask any open question of any kind on this turn." : ""}
${ov.finalConfirm ? "\nIMPORTANT — THIS IS THE VERY LAST LINE OF THE CALL: The prospect just confirmed the appointment. Give one brief, warm closing line acknowledging it — you may restate the day/time/location and thank them, similar to \"Perfect, see you then!\". Do not ask any question, do not add any new information, do not negotiate further. This is the goodbye line." : ""}

Respond with ONLY valid JSON, no other text: {"reply": "<what the agent says next>"}`;
  }

  async function generateMasterAgentLine(closeNow, overrides) {
    // Claude is now playing the AGENT side, which is the opposite of every other call in
    // this app — so the role mapping must be inverted from generateProspectLine: the
    // agent's own past lines (internal role "user") become this call's "assistant" turns,
    // and the prospect's lines (internal role "assistant") become this call's "user" turns.
    // The opening line is also dropped entirely — it was the agent's own fixed script, not
    // something to "respond to", and the system prompt already tells Claude not to repeat
    // it. Skipping it is what makes the array correctly both start AND end on a "user" turn
    // (Anthropic requires both) — inverting the roles alone still left it starting on
    // "assistant", which is equally invalid as ending on one.
    const apiMessages = messagesRef.current.slice(1).map((m) => ({
      role: m.role === "user" ? "assistant" : "user",
      content: m.role === "user" ? JSON.stringify({ reply: m.text }) : m.text,
    }));
    const raw = await callClaude(apiMessages, buildMasterAgentSystemPrompt(closeNow, overrides), 300);
    const parsed = extractRoleplayReply(raw);
    return parsed.reply;
  }

  async function generateProspectLine(overrides) {
    const apiMessages = messagesRef.current.map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.role === "assistant" ? JSON.stringify({ reply: m.text }) : m.text,
    }));
    const raw = await callClaude(apiMessages, buildRoleplaySystemPrompt(overrides), 400);
    return extractRoleplayReply(raw);
  }

  function buildPerfectDemoAssessment(closingLine) {
    // Pull actual lines from the conversation that just happened, instead of generic
    // canned text — the whole point of quoting evidence is showing the real words used,
    // and a scripted demo shouldn't be exempt from that standard either.
    const agentLines = messagesRef.current.filter((m) => m.role === "user").map((m) => m.text).filter(Boolean);
    const openingLine = agentLines[0] || "";
    const secondLine = agentLines[1] || openingLine;
    const midLine = agentLines[Math.floor(agentLines.length / 2)] || secondLine;
    const thirdLine = agentLines[2] || midLine;
    const finalCloseLine = closingLine || agentLines[agentLines.length - 1] || "";
    const quote = (t) => (t ? `"${t}"` : "(no line captured for this turn)");

    return {
      communication: 25, communication_evidence: `${quote(openingLine)} — clear, confident, benefit-first framing right from the opening line.`,
      communication_improvement: "Keep leading with a clear, specific benefit statement like this one in every opening.",
      objection_handling: 25, objection_handling_evidence: `${quote(secondLine)} — acknowledged the prospect's concern and reframed it smoothly instead of dismissing it.`,
      objection_handling_improvement: "Continue naming the specific concern before redirecting, exactly as done here.",
      appointment_closing: 20, appointment_closing_evidence: `${quote(finalCloseLine)} — closed with a confident close and a specific date, time, and location.`,
      appointment_closing_improvement: "Keep using a confident close with concrete specifics, as shown here.",
      listening: 10, listening_evidence: `${quote(midLine)} — responded directly to what the prospect actually said, not a generic script.`,
      listening_improvement: "Continue reflecting the prospect's own words back before redirecting.",
      questioning: 10, questioning_evidence: `${quote(thirdLine)} — used a targeted question to surface the prospect's real concern.`,
      questioning_improvement: "Keep asking specific, open questions like this one before proposing a solution.",
      confidence_tone: 5, confidence_tone_evidence: `${quote(openingLine)} — warm, assured tone throughout, never pushy.`,
      confidence_tone_improvement: "Maintain this same warm, unhurried tone in every session.",
      script_intent: 5, script_intent_evidence: `${quote(openingLine)} — stayed fully aligned with the starter's intent from open to close.`,
      script_intent_improvement: "Continue anchoring every response back to the starter's core question.",
      overall: 100, pass_status: "Pass", appointment_outcome: "Secured", compliance_result: "Pass", compliance_issue: "",
      ai_confidence: 100,
      one_biggest_mistake: "None — this is a scripted, gold-standard example run, not a graded live session.",
      highest_impact_improvement: "Nothing to improve — this demonstrates the ceiling of what a fully executed session looks like.",
      strongest_sentence: finalCloseLine,
      strongest_question: thirdLine,
      better_response: "", better_close: "",
      full_report: "MASTER INVITER MODE — this session was auto-generated end-to-end as a scripted product demonstration and was never independently assessed by the strict grading model. The quotes above are real lines from this actual generated conversation, but the scores themselves are fixed at 100 by design and must never be treated as, or compared against, a real agent's genuine performance.",
      flagged_technique: "", flagged_technique_reason: "",
      all_mistakes: [],
      things_done_well: ["Opened exactly on script", "Handled every objection without conceding ground", "Closed with a specific date, time, and location", "Never once broke character or lost the thread of the conversation"],
    };
  }

  async function runMasterInviterDemo() {
    // No agent login required — this is a scripted, password-gated demo, not tied to any
    // individual agent's real record (Submit Assessment is already disabled for it). If
    // someone happens to already be logged in, keep showing their real name; otherwise
    // fall back to a generic label so the transcript and PDF don't show blanks.
    const demoAgentName = agentName || "CallSpar Demo";
    const demoAgentCode = agentCode || "DEMO";
    if (!agentName) setAgentName(demoAgentName);
    if (!agentCode) setAgentCode(demoAgentCode);

    const randomStarter = pick(starters);
    const p = pick(prospectLibrary);
    const objs = pickThreeObjections(objectionLibrary, "Beginner");
    setStarterId(randomStarter.id);
    setLanguage("English");
    setDifficulty("Beginner");
    setMode("Demo");
    setProspect(p);
    setObjections(objs);
    setSessionId(newSessionId(demoAgentCode));
    setMessages([]);
    messagesRef.current = [];
    setSeconds(0);
    setRoleplayEnded(false);
    setShowScript(false);
    setShowFullBreakdown(false);
    setAssessment(null);
    setSubmitState("idle");
    setSubmitError("");
    setIsAutoPlaying(true);
    setScreen("roleplay");

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    function pushMessage(msg) {
      messagesRef.current = [...messagesRef.current, msg];
      setMessages(messagesRef.current);
    }

    try {
      // Turn 1: open exactly on script, no API call needed.
      pushMessage({ role: "user", text: starterText(randomStarter, "English") });
      await sleep(900);

      const MAX_EXCHANGES = 4;
      let closingLine = "";
      const overrides = { prospect: p, objections: objs, starterId: randomStarter.id, language: "English", noRejection: true };
      for (let i = 0; i < MAX_EXCHANGES; i++) {
        setAutoPlayTypingAs("prospect");
        const prospectTurn = await generateProspectLine(overrides);
        setAutoPlayTypingAs("");
        pushMessage({ role: "assistant", text: prospectTurn.reply });
        await sleep(900);
        // Deliberately NOT trusting prospectTurn.endRoleplay to cut the loop short here —
        // the model sometimes flags general willingness ("I'm open to it, when and where?")
        // as if a specific date/time/location had already been agreed, which isn't true.
        // Ending early on that misread skipped the master agent's turn entirely, so the
        // demo stopped right on the prospect's open question with no proposal ever locked
        // in. Always running the full fixed number of rounds guarantees the agent gets to
        // actually propose and close, not just get asked to.

        const isLastTurn = i === MAX_EXCHANGES - 1;
        setAutoPlayTypingAs("agent");
        const agentLine = await generateMasterAgentLine(isLastTurn, overrides);
        setAutoPlayTypingAs("");
        closingLine = agentLine;
        pushMessage({ role: "user", text: agentLine });
        await sleep(900);
      }

      // Always finish with one guaranteed, explicitly forced acceptance turn — a scripted
      // demo can't end ambiguously, it needs to visibly land on a specific, confirmed yes.
      setAutoPlayTypingAs("prospect");
      const finalTurn = await generateProspectLine({ ...overrides, forceAccept: true });
      setAutoPlayTypingAs("");
      pushMessage({ role: "assistant", text: finalTurn.reply });
      await sleep(900);

      // One last short agent line acknowledging the confirmation — without this, the call
      // ends on the prospect's voice, which reads as unfinished. A real close ends with
      // both sides having clearly landed on the same page.
      setAutoPlayTypingAs("agent");
      const goodbyeLine = await generateMasterAgentLine(false, { ...overrides, finalConfirm: true });
      setAutoPlayTypingAs("");
      closingLine = goodbyeLine;
      pushMessage({ role: "user", text: goodbyeLine });
      await sleep(900);

      // Deliberately stay on the roleplay screen instead of auto-jumping to the score —
      // the whole point of watching Master Inviter is to actually read the conversation.
      // The agent taps "Next" (rendered below) when ready to see the score and report.
      setRoleplayEnded(true);
      setAssessment(buildPerfectDemoAssessment(closingLine));
    } catch (e) {
      pushMessage({ role: "assistant", text: "(Demo interrupted: " + e.message + ")" });
      setRoleplayEnded(true);
      setAssessment(buildPerfectDemoAssessment(""));
    } finally {
      setIsAutoPlaying(false);
      setAutoPlayTypingAs("");
    }
  }

  function quickPractice() {
    setMode("Practice");
    setLanguage("English");
    setDifficulty("Beginner");
    const randomStarter = pick(starters);
    setStarterId(randomStarter.id);
    startSession("Beginner");
  }

  function startSession(overrideDifficulty) {
    if (!selectedAgentCode || !agentCode.trim()) {
      alert("Please select your name from the approved agent list.");
      return;
    }
    if (verifyState !== "verified") {
      alert("Please enter and verify your access code first.");
      return;
    }
    const effectiveDifficulty = overrideDifficulty || difficulty;
    const prospectPool = byDifficulty(prospectLibrary, effectiveDifficulty);
    const p = pick(prospectPool);
    const objs = pickThreeObjections(objectionLibrary, effectiveDifficulty);
    setProspect(p);
    setObjections(objs);
    setSessionId(newSessionId(agentCode));
    setMessages([]);
    setSeconds(0);
    setRoleplayEnded(false);
    setShowScript(true);
    setShowFullBreakdown(false);
    setMicError("");
    setShowMicHelp(false);
    setAssessment(null);
    setSubmitState("idle");
    setSubmitError("");
    setScreen("roleplay");
  }

  function downloadSessionPDF() {
    if (!assessment || assessment.error) return;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const marginX = 48;
    const maxW = pageW - marginX * 2;
    let y = 56;

    function ensureSpace(needed) {
      if (y + needed > doc.internal.pageSize.getHeight() - 48) {
        doc.addPage();
        y = 56;
      }
    }
    function heading(text, size = 14) {
      ensureSpace(size + 14);
      doc.setFont(undefined, "bold").setFontSize(size).setTextColor(22, 40, 60);
      doc.text(text, marginX, y);
      y += size + 8;
      doc.setFont(undefined, "normal").setTextColor(20, 20, 20);
    }
    function body(text, size = 10) {
      doc.setFont(undefined, "normal").setFontSize(size).setTextColor(40, 40, 40);
      const lines = doc.splitTextToSize(String(text || "—"), maxW);
      lines.forEach((line) => {
        ensureSpace(size + 4);
        doc.text(line, marginX, y);
        y += size + 4;
      });
      y += 4;
    }
    function rule() {
      ensureSpace(10);
      doc.setDrawColor(200, 200, 200);
      doc.line(marginX, y, pageW - marginX, y);
      y += 14;
    }

    doc.setFont(undefined, "bold").setFontSize(18).setTextColor(22, 40, 60);
    doc.text("CallSpar - Appointment Sparring", marginX, y);
    y += 22;
    doc.setFont(undefined, "normal").setFontSize(11).setTextColor(90, 90, 90);
    doc.text("Session Report", marginX, y);
    y += 24;

    heading("Session Details", 12);
    body(`Agent: ${agentName} (${agentCode})`);
    body(`Session ID: ${sessionId}`);
    body(`Date: ${new Date().toLocaleString()}`);
    body(`Mode: ${mode}  ·  Language: ${language}  ·  Difficulty: ${difficulty}  ·  Starter: ${starterId}`);
    body(`Prospect: ${prospect?.name || "—"} (${prospect?.occupation || "—"}${prospect?.location ? `, ${prospect.location}` : ""})`);
    rule();

    heading("Result", 12);
    body(`Overall Score: ${assessment.overall}/100  —  ${assessment.pass_status === "Pass" ? "PASS" : "RETRY"}`);
    body(`Appointment: ${assessment.appointment_outcome}  ·  AI Confidence: ${assessment.ai_confidence}%  ·  Compliance: ${assessment.compliance_result}`);
    rule();

    heading("Category Scores", 12);
    [
      ["Communication", assessment.communication, 25, assessment.communication_evidence, assessment.communication_improvement],
      ["Objection Handling", assessment.objection_handling, 25, assessment.objection_handling_evidence, assessment.objection_handling_improvement],
      ["Appointment Closing", assessment.appointment_closing, 20, assessment.appointment_closing_evidence, assessment.appointment_closing_improvement],
      ["Listening", assessment.listening, 10, assessment.listening_evidence, assessment.listening_improvement],
      ["Questioning", assessment.questioning, 10, assessment.questioning_evidence, assessment.questioning_improvement],
      ["Confidence & Tone", assessment.confidence_tone, 5, assessment.confidence_tone_evidence, assessment.confidence_tone_improvement],
      ["Script Intent", assessment.script_intent, 5, assessment.script_intent_evidence, assessment.script_intent_improvement],
    ].forEach(([label, val, max, evidence, improvement]) => {
      heading(`${label}: ${val}/${max}`, 11);
      if (evidence) body("Why: " + evidence);
      if (improvement) body("Improve: " + improvement);
    });
    rule();

    heading("Your #1 Focus", 12);
    body(assessment.highest_impact_improvement);
    heading("What Happened", 12);
    body(assessment.one_biggest_mistake);
    if (assessment.strongest_sentence) { heading("Strongest Sentence", 12); body(`"${assessment.strongest_sentence}"`); }
    if (assessment.better_close) { heading("A Better Close", 12); body(assessment.better_close); }
    if (assessment.compliance_result === "Fail") { heading("Compliance Issue", 12); body(assessment.compliance_issue); }
    rule();

    heading("Full Conversation Transcript", 12);
    messages.forEach((m) => {
      const speaker = m.role === "user" ? `${agentName || "Agent"}:` : `${prospect?.name || "Prospect"}:`;
      doc.setFont(undefined, "bold").setFontSize(10).setTextColor(22, 40, 60);
      ensureSpace(14);
      doc.text(speaker, marginX, y);
      y += 14;
      body(m.text);
    });

    // Plain doc.save() relies on the browser's "download" attribute, which iOS Safari
    // doesn't reliably support — it often navigates the whole app away to show the PDF
    // instead of downloading it, leaving no way back. Opening it in a new tab instead
    // keeps this app tab untouched underneath.
    const blob = doc.output("blob");
    const blobUrl = URL.createObjectURL(blob);
    const opened = window.open(blobUrl, "_blank");
    if (!opened) {
      // Pop-up blocked — fall back to a normal download attempt in the current tab.
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `CallSpar_${sessionId}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  }

  function downloadAllSessionsPDF() {
    if (!dashboardData || dashboardData.totalSessions === 0) return;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const marginX = 48;
    const maxW = pageW - marginX * 2;
    let y = 56;

    function ensureSpace(needed) {
      if (y + needed > doc.internal.pageSize.getHeight() - 48) {
        doc.addPage();
        y = 56;
      }
    }
    function heading(text, size = 14) {
      ensureSpace(size + 14);
      doc.setFont(undefined, "bold").setFontSize(size).setTextColor(22, 40, 60);
      doc.text(text, marginX, y);
      y += size + 8;
      doc.setFont(undefined, "normal").setTextColor(20, 20, 20);
    }
    function body(text, size = 10) {
      doc.setFont(undefined, "normal").setFontSize(size).setTextColor(40, 40, 40);
      const lines = doc.splitTextToSize(String(text || "—"), maxW);
      lines.forEach((line) => {
        ensureSpace(size + 4);
        doc.text(line, marginX, y);
        y += size + 4;
      });
      y += 4;
    }
    function rule() {
      ensureSpace(10);
      doc.setDrawColor(200, 200, 200);
      doc.line(marginX, y, pageW - marginX, y);
      y += 14;
    }

    doc.setFont(undefined, "bold").setFontSize(18).setTextColor(22, 40, 60);
    doc.text("CallSpar - Appointment Sparring", marginX, y);
    y += 22;
    doc.setFont(undefined, "normal").setFontSize(11).setTextColor(90, 90, 90);
    doc.text(`All-Agent Session Report — ${dashboardData.date}`, marginX, y);
    y += 18;
    doc.setFontSize(10);
    doc.text(`${dashboardData.totalSessions} sessions · ${dashboardData.uniqueAgents} agents · avg score ${dashboardData.averageScore ?? "—"}`, marginX, y);
    y += 24;

    dashboardData.agents.forEach((a) => {
      const displayName = adminAgents.find((ag) => ag.code === a.agentCode)?.name || a.agentCode;
      ensureSpace(60);
      heading(displayName, 15);
      body(`${a.attempts} attempt${a.attempts !== 1 ? "s" : ""} · ${a.passCount} pass · ${a.retryCount} retry · avg ${a.avgScore ?? "—"} · best ${a.bestScore ?? "—"}`);
      rule();

      a.sessions.forEach((s) => {
        heading(`${s.sessionId} — ${s.score ?? "—"}/100 (${s.pass || "—"})`, 12);
        body(`${s.time ? new Date(s.time).toLocaleString() : "—"} · ${s.mode} · ${s.difficulty} · Appointment: ${s.outcome}${s.prospectName ? ` · vs. ${s.prospectName}${s.prospectLocation ? `, ${s.prospectLocation}` : ""}` : ""}`);
        if (s.categoryEvidence) { heading("Category breakdown", 11); body(s.categoryEvidence); }
        if (s.allMistakes && s.allMistakes.length) { heading("Mistakes", 11); s.allMistakes.forEach((m) => body("• " + m)); }
        if (s.thingsDoneWell && s.thingsDoneWell.length) { heading("Done well", 11); s.thingsDoneWell.forEach((g) => body("• " + g)); }
        if (s.transcript) {
          heading("Conversation Transcript", 11);
          s.transcript.split("\n").forEach((line) => body(line));
        } else {
          body("(No transcript saved for this session — it was submitted before transcript logging was added.)");
        }
        y += 8;
      });
      ensureSpace(20);
      y += 10;
    });

    const blob = doc.output("blob");
    const blobUrl = URL.createObjectURL(blob);
    const opened = window.open(blobUrl, "_blank");
    if (!opened) {
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `CallSpar_All_Sessions_${dashboardData.date}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  }

  async function submitToAirtable() {
    if (!assessment || assessment.error) return;
    setSubmitState("submitting");
    try {
      const resp = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentCode,
          sessionId,
          mode,
          language,
          difficulty,
          starterId,
          assessment,
          transcript: messages.map((m) => `${m.role === "user" ? "AGENT" : "PROSPECT"}: ${m.text}`).join("\n"),
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setSubmitError(data.error || "Submission failed.");
        setSubmitState("error");
        return;
      }
      setSubmitState("done");
    } catch (e) {
      setSubmitError(e.message);
      setSubmitState("error");
    }
  }

  function resetApp() {
    setScreen("setup");
    setMessages([]);
    setAssessment(null);
    setSeconds(0);
    setRoleplayEnded(false);
    setSubmitState("idle");
    setSubmitError("");
  }

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  /* ---------------- UI ---------------- */

  if (screen === "setup") {
    return (
      <div className="min-h-screen bg-white text-slate-900 flex flex-col">
        <div className="px-6 pt-8 pb-6 border-b border-slate-100">
          <div className="h-10 mb-5" />
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">CallSpar <span className="text-teal-700">- Appointment Sparring</span></h1>
          <p className="text-slate-500 text-sm mt-1.5">Set up your session, then start the call.</p>

          <button onClick={() => setShowGuide((v) => !v)} className="mt-3 text-xs text-teal-700 font-medium underline">
            {showGuide ? "Hide quick guide" : "Show quick guide"}
          </button>

          {showGuide && (
            <div className="mt-3 grid grid-cols-1 gap-3">
              <div className="bg-teal-50 border border-teal-200 rounded-lg p-3.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-teal-700 mb-2">
                  <CheckCircle2 size={13} /> Do
                </div>
                <ul className="space-y-1.5 text-sm text-slate-800">
                  <li>• Read your script exactly as shown to open the call</li>
                  <li>• Speak or type naturally, like a real conversation</li>
                  <li>• Get a specific date, time, and a location or platform before ending</li>
                  <li>• Read your coaching report after every session</li>
                </ul>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-lg p-3.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-red-600 mb-2">
                  <XCircle size={13} /> Don't
                </div>
                <ul className="space-y-1.5 text-sm text-slate-800">
                  <li>• Don't share your access code with anyone else</li>
                  <li>• Don't rush through objections — take your time</li>
                  <li>• Don't submit the same session more than once</li>
                  <li>• Don't skip verifying your access code before starting</li>
                </ul>
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 px-6 space-y-6 py-6">
          <div>
            {godModeUnlocked ? (
              <button onClick={runMasterInviterDemo}
                className="w-full bg-slate-900 text-white font-semibold rounded-lg py-3 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform">
                <Award size={16} /> Master Inviter
              </button>
            ) : (
              <div>
                {!showGodModeUnlock ? (
                  <button onClick={() => setShowGodModeUnlock(true)}
                    className="w-full text-center text-xs text-slate-400 py-2 underline">
                    Master Inviter — password required
                  </button>
                ) : (
                  <div>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <input type={showGodModePassword ? "text" : "password"} value={godModePassword}
                          onChange={(e) => { setGodModePassword(e.target.value); setGodModeUnlockState("idle"); }}
                          onKeyDown={(e) => { if (e.key === "Enter") unlockGodMode(); }}
                          placeholder="Admin password"
                          className="w-full bg-white border border-slate-300 rounded-lg pl-3 pr-10 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                        <button type="button" onClick={() => setShowGodModePassword((v) => !v)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                          {showGodModePassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                      <button onClick={unlockGodMode} disabled={godModeUnlockState === "checking"}
                        className="bg-slate-900 text-white text-xs font-medium rounded-lg px-4 disabled:opacity-40">
                        {godModeUnlockState === "checking" ? "…" : "Unlock"}
                      </button>
                    </div>
                    {godModeUnlockState === "error" && (
                      <div className="text-xs text-red-600 mt-1.5">Incorrect password.</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="border-t border-slate-100 pt-6">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2 block">Agent</label>
            {agentListState === "loading" && (
              <div className="flex items-center gap-2 text-slate-500 text-sm bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
                <Loader2 size={14} className="animate-spin" /> Loading approved agent list…
              </div>
            )}
            {agentListState === "ready" && agentList.length === 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-amber-800 text-sm">
                No approved agents configured. Contact your Admin.
              </div>
            )}
            {agentListState === "ready" && agentList.length > 0 && (
              <select value={selectedAgentCode} onChange={(e) => selectAgent(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-lg px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500">
                <option value="">Select your name…</option>
                {agentList.map((a) => (
                  <option key={a.code} value={a.code}>{a.name} ({a.code})</option>
                ))}
              </select>
            )}
            {selectedAgentCode && (
              <div className="mt-2 text-xs text-teal-700 font-medium flex items-center gap-1.5">
                <CheckCircle2 size={12} /> Verified against approved agent list
              </div>
            )}
            {selectedAgentCode && (
              <div className="mt-4">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2 block">Access code</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input type={showPassword ? "text" : "password"} value={accessPassword}
                      onChange={(e) => { setAccessPassword(e.target.value); setVerifyState("idle"); }}
                      onKeyDown={(e) => { if (e.key === "Enter") verifyAccessCode(); }}
                      placeholder="Enter your access code"
                      className="w-full bg-white border border-slate-300 rounded-lg pl-4 pr-11 py-3 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500" />
                    <button type="button" onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  <button onClick={verifyAccessCode} disabled={verifyState === "verifying" || !accessPassword.trim()}
                    className="shrink-0 bg-slate-900 text-white font-medium rounded-lg px-4 disabled:opacity-40">
                    {verifyState === "verifying" ? <Loader2 size={16} className="animate-spin" /> : "Verify"}
                  </button>
                </div>
                {verifyState === "verified" && (
                  <div className="mt-2 text-xs text-teal-700 font-medium flex items-center gap-1.5">
                    <CheckCircle2 size={12} /> Access code correct
                  </div>
                )}
                {verifyState === "invalid" && (
                  <div className="mt-2 text-xs text-red-600 font-medium">Incorrect access code. Please try again.</div>
                )}
                {verifyState === "error" && (
                  <div className="mt-2 text-xs text-amber-700 font-medium bg-amber-50 border border-amber-200 rounded-md px-2.5 py-2">
                    Couldn't verify right now — this isn't a wrong code, it's a connection/setup issue: {verifyError}
                  </div>
                )}

                {verifyState === "verified" && (
                  <div className="mt-4">
                    <button onClick={quickPractice}
                      className="w-full bg-gradient-to-r from-teal-600 to-teal-500 text-white font-semibold rounded-lg py-3 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform">
                      <Phone size={16} /> Quick Practice (random, Beginner)
                    </button>
                    {!DEMO_MODE && <p className="text-center text-xs text-slate-400 mt-1.5">Or customize your session below</p>}
                  </div>
                )}
              </div>
            )}
          </div>

          {!DEMO_MODE && (
          <>
          {rankedUnlocked ? (
            <PillGroup label="Mode" value={mode} onChange={setMode} options={["Practice", "Ranked"]} />
          ) : (
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2 block">Mode</label>
              <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 flex items-center justify-between">
                <span className="text-sm text-slate-600">Practice only, for now</span>
                {!showRankedUnlock && (
                  <button onClick={() => setShowRankedUnlock(true)} className="text-xs text-teal-700 font-medium underline">
                    Unlock Ranked
                  </button>
                )}
              </div>
              {showRankedUnlock && (
                <div className="mt-2 flex gap-2">
                  <input type="password" value={rankedUnlockPassword}
                    onChange={(e) => { setRankedUnlockPassword(e.target.value); setRankedUnlockState("idle"); }}
                    onKeyDown={(e) => { if (e.key === "Enter") unlockRankedMode(); }}
                    placeholder="Admin secret"
                    className="flex-1 bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                  <button onClick={unlockRankedMode} disabled={rankedUnlockState === "checking"}
                    className="bg-slate-900 text-white text-xs font-medium rounded-lg px-4 disabled:opacity-40">
                    {rankedUnlockState === "checking" ? "…" : "Unlock"}
                  </button>
                </div>
              )}
              {rankedUnlockState === "error" && (
                <div className="text-xs text-red-600 mt-1.5">Incorrect password.</div>
              )}
            </div>
          )}
          <PillGroup label="Language" value={language} onChange={setLanguage} options={["English", "Bahasa Malaysia", "Manglish", "Tamil", "Mandarin"]} />
          <PillGroup label="Difficulty" value={difficulty} onChange={setDifficulty} options={["Beginner", "Intermediate", "Advanced", "Expert"]} />

          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2 block">Conversation starter</label>
            <div className="flex flex-wrap gap-2 mb-3">
              {starters.map((s) => (
                <button key={s.id} onClick={() => setStarterId(s.id)}
                  className={`w-10 h-10 rounded-lg text-sm border transition-colors ${
                    starterId === s.id ? "bg-slate-900 text-white border-slate-900 font-semibold" : "border-slate-300 text-slate-600 hover:border-slate-400"
                  }`}>{s.id.replace("CS-0", "").replace("CS-", "")}</button>
              ))}
            </div>
            <div className="bg-teal-50 border border-teal-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-teal-700">Read this exactly to open the call — {starterId}</div>
                <button onClick={() => copyText(starterText(starters.find((s) => s.id === starterId), language), "setup")}
                  className="shrink-0 flex items-center gap-1 text-xs font-medium text-teal-700 bg-white border border-teal-300 rounded-md px-2 py-1 hover:bg-teal-100">
                  {copiedWhere === "setup" ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
                </button>
              </div>
              <p className="text-base text-slate-900 leading-relaxed">{starterText(starters.find((s) => s.id === starterId), language)}</p>
            </div>
          </div>
          </>
          )}
        </div>

        <div className="px-6 pb-8 pt-4 sticky bottom-0 bg-white border-t border-slate-100">
          {!DEMO_MODE && (
          <>
          <button onClick={startSession} disabled={!selectedAgentCode || verifyState !== "verified"}
            className="w-full bg-slate-900 text-white font-semibold rounded-lg py-3.5 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-30 disabled:pointer-events-none hover:bg-slate-800">
            <Phone size={17} /> Start the call <ChevronRight size={17} />
          </button>
          {(!selectedAgentCode || verifyState !== "verified") && agentListState === "ready" && agentList.length > 0 && (
            <p className="text-center text-xs text-slate-400 mt-2.5">
              {!selectedAgentCode ? "Select your name from the approved list to continue." : "Enter and verify your access code to continue."}
            </p>
          )}
          </>
          )}
          <button onClick={() => setScreen("admin")} className="w-full text-center text-xs text-slate-300 mt-4 py-1">
            Admin
          </button>
        </div>
      </div>
    );
  }

  if (screen === "admin") {
    return (
      <div className="min-h-screen bg-white text-slate-900 flex flex-col">
        <div className="px-6 pt-8 pb-6 border-b border-slate-100 flex items-center justify-between">
          <div>
            <div className="h-8 mb-3" />
            <h1 className="text-xl font-semibold text-slate-900">Admin</h1>
          </div>
          <button onClick={() => { setScreen("setup"); setAdminAuthed(false); setAdminSecretInput(""); }} className="text-sm text-slate-500">Close</button>
        </div>

        {!adminAuthed ? (
          <div className="flex-1 px-6 py-8">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2 block">Admin Secret</label>
            <div className="relative mb-3">
              <input type={showAdminPassword ? "text" : "password"} value={adminSecretInput} onChange={(e) => setAdminSecretInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") checkAdminSecret(); }}
                placeholder="Enter the admin secret"
                className="w-full bg-white border border-slate-300 rounded-lg pl-4 pr-11 py-3 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500" />
              <button type="button" onClick={() => setShowAdminPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                {showAdminPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <button onClick={checkAdminSecret} disabled={adminAuthState === "checking"}
              className="w-full bg-slate-900 text-white font-semibold rounded-lg py-3 disabled:opacity-50">
              {adminAuthState === "checking" ? "Checking…" : "Enter"}
            </button>
            {adminAuthState === "error" && (
              <div className="mt-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{adminError}</div>
            )}
          </div>
        ) : (
          <div className="flex-1 px-6 py-6 space-y-6">
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                  Dashboard {dashboardData ? `— ${dashboardData.date}` : ""}
                </h2>
                <button onClick={() => loadDashboard(adminSecretInput.trim(), dashboardRange)} className="text-xs text-teal-700 font-medium">Refresh</button>
              </div>
              <div className="flex gap-2 mb-3">
                <button onClick={() => { setDashboardRange("all"); loadDashboard(adminSecretInput.trim(), "all"); }}
                  className={`text-xs font-medium rounded-full px-3 py-1.5 border ${dashboardRange === "all" ? "bg-slate-900 text-white border-slate-900" : "border-slate-300 text-slate-600"}`}>
                  All Time
                </button>
                <button onClick={() => { setDashboardRange("today"); loadDashboard(adminSecretInput.trim(), "today"); }}
                  className={`text-xs font-medium rounded-full px-3 py-1.5 border ${dashboardRange === "today" ? "bg-slate-900 text-white border-slate-900" : "border-slate-300 text-slate-600"}`}>
                  Today
                </button>
              </div>
              {dashboardData && dashboardData.totalSessions > 0 && (
                <button onClick={downloadAllSessionsPDF}
                  className="w-full mb-3 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium rounded-lg py-2.5 flex items-center justify-center gap-2 text-sm">
                  <FileDown size={15} /> Download all sessions (PDF)
                </button>
              )}
              {dashboardLoading ? (
                <div className="text-sm text-slate-400">Loading…</div>
              ) : !dashboardData || dashboardData.totalSessions === 0 ? (
                <div className="text-sm text-slate-400 bg-slate-50 border border-slate-200 rounded-lg p-4">No sessions yet.</div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2 mb-4">
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-slate-900">{dashboardData.totalSessions}</div>
                      <div className="text-xs text-slate-500 mt-0.5">Sessions</div>
                    </div>
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-slate-900">{dashboardData.uniqueAgents}</div>
                      <div className="text-xs text-slate-500 mt-0.5">Agents active</div>
                    </div>
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-slate-900">{dashboardData.averageScore ?? "—"}</div>
                      <div className="text-xs text-slate-500 mt-0.5">Avg score</div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {dashboardData.agents.map((a) => {
                      const displayName = adminAgents.find((ag) => ag.code === a.agentCode)?.name || a.agentCode;
                      const isOpen = expandedAgentRow === a.agentCode;
                      return (
                        <div key={a.agentCode} className="border border-slate-200 rounded-lg overflow-hidden">
                          <button onClick={() => setExpandedAgentRow(isOpen ? null : a.agentCode)}
                            className="w-full flex items-center justify-between px-4 py-3 bg-white">
                            <div className="text-left">
                              <div className="text-sm font-medium text-slate-900">{displayName}</div>
                              <div className="text-xs text-slate-500">{a.attempts} attempt{a.attempts !== 1 ? "s" : ""} · {a.passCount} pass · {a.retryCount} retry</div>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="text-right">
                                <div className="text-sm font-semibold text-slate-900">{a.avgScore ?? "—"}</div>
                                <div className="text-xs text-slate-400">avg</div>
                              </div>
                              <ChevronRight size={16} className={`text-slate-400 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                            </div>
                          </button>
                          {isOpen && (
                            <div className="border-t border-slate-200 bg-slate-50 divide-y divide-slate-200">
                              {a.sessions.map((s) => {
                                const sessionOpen = expandedSessionId === s.sessionId;
                                return (
                                <div key={s.sessionId} className="px-4 py-3">
                                  <button onClick={() => setExpandedSessionId(sessionOpen ? null : s.sessionId)} className="w-full text-left">
                                    <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                                      <span>{s.time ? new Date(s.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"} · {s.mode} · {s.difficulty}</span>
                                      <span className={`font-semibold ${s.pass === "Pass" ? "text-teal-700" : "text-red-500"}`}>{s.score ?? "—"}/100 · {s.pass || "—"}</span>
                                    </div>
                                    {s.prospectName && (
                                      <div className="text-xs text-slate-400 mb-1">vs. {s.prospectName}{s.prospectLocation ? ` · ${s.prospectLocation}` : ""}</div>
                                    )}
                                    {s.improvement && (
                                      <div className="text-xs text-slate-700"><span className="font-semibold text-teal-700">Focus: </span>{s.improvement}</div>
                                    )}
                                  </button>

                                  {sessionOpen && (
                                    <div className="mt-3 space-y-3 border-t border-slate-200 pt-3">
                                      {s.categoryEvidence && (
                                        <div>
                                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Category breakdown</div>
                                          <div className="text-xs text-slate-600 whitespace-pre-line leading-relaxed">{s.categoryEvidence}</div>
                                        </div>
                                      )}
                                      {s.allMistakes && s.allMistakes.length > 0 && (
                                        <div>
                                          <div className="text-xs font-semibold uppercase tracking-wide text-red-500 mb-1.5">All mistakes</div>
                                          <ul className="space-y-1">
                                            {s.allMistakes.map((m, i) => (
                                              <li key={i} className="text-xs text-slate-700 flex gap-1.5"><span className="text-red-400">•</span>{m}</li>
                                            ))}
                                          </ul>
                                        </div>
                                      )}
                                      {s.thingsDoneWell && s.thingsDoneWell.length > 0 && (
                                        <div>
                                          <div className="text-xs font-semibold uppercase tracking-wide text-teal-700 mb-1.5">Things done well</div>
                                          <ul className="space-y-1">
                                            {s.thingsDoneWell.map((g, i) => (
                                              <li key={i} className="text-xs text-slate-700 flex gap-1.5"><span className="text-teal-500">•</span>{g}</li>
                                            ))}
                                          </ul>
                                        </div>
                                      )}
                                      {!s.categoryEvidence && s.biggestMistake && (
                                        <div className="text-xs text-slate-600"><span className="font-semibold text-red-500">Mistake: </span>{s.biggestMistake}</div>
                                      )}
                                    </div>
                                  )}
                                </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-3">Add New Agent</h2>
              <div className="space-y-2.5">
                <input value={newAgentCode} onChange={(e) => setNewAgentCode(e.target.value)} placeholder="Agent Code (e.g. AG123)"
                  className="w-full bg-white border border-slate-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                <input value={newAgentName} onChange={(e) => setNewAgentName(e.target.value)} placeholder="Full Name"
                  className="w-full bg-white border border-slate-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                <input value={newAgentAccessCode} onChange={(e) => setNewAgentAccessCode(e.target.value)} placeholder="Access Code (their password)"
                  className="w-full bg-white border border-slate-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                <button onClick={addNewAgent} disabled={adminActionState === "saving"}
                  className="w-full bg-teal-600 hover:bg-teal-700 text-white font-medium rounded-lg py-2.5 disabled:opacity-50">
                  {adminActionState === "saving" ? "Saving…" : adminActionState === "done" ? "✓ Agent added" : "Add Agent"}
                </button>
                {adminError && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{adminError}</div>}
              </div>
            </div>

            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-3">Current Agents ({adminAgents.length})</h2>
              {adminLoading ? (
                <div className="text-sm text-slate-400">Loading…</div>
              ) : (
                <div className="space-y-2">
                  {adminAgents.map((a) => (
                    <div key={a.id} className="flex items-center justify-between border border-slate-200 rounded-lg px-4 py-3">
                      <div>
                        <div className="text-sm font-medium text-slate-900">{a.name} <span className="text-slate-400 font-normal">({a.code})</span></div>
                        <div className="text-xs text-slate-400">{a.status}</div>
                      </div>
                      <button onClick={() => toggleAgentStatus(a)}
                        className={`text-xs font-medium px-3 py-1.5 rounded-full ${a.status === "Active" ? "bg-red-50 text-red-600 border border-red-200" : "bg-teal-50 text-teal-700 border border-teal-200"}`}>
                        {a.status === "Active" ? "Suspend" : "Activate"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-3">
                Flagged Techniques for Review {flaggedTechniques.length > 0 && `(${flaggedTechniques.length})`}
              </h2>
              {flagsLoading ? (
                <div className="text-sm text-slate-400">Loading…</div>
              ) : flaggedTechniques.length === 0 ? (
                <div className="text-sm text-slate-400">No techniques awaiting review right now.</div>
              ) : (
                <div className="space-y-3">
                  {flaggedTechniques.map((f) => (
                    <div key={f.id} className="border border-amber-200 bg-amber-50 rounded-lg p-4">
                      <div className="text-xs text-slate-500 mb-1.5">Agent {f.agentCode} · Session {f.sessionId}</div>
                      <div className="text-sm text-slate-900 font-medium mb-1.5">{f.technique}</div>
                      {f.reason && <div className="text-sm text-slate-600 italic mb-3">{f.reason}</div>}
                      <div className="flex gap-2">
                        <button onClick={() => reviewFlag(f.id, "Approved")}
                          className="flex-1 bg-teal-600 hover:bg-teal-700 text-white text-xs font-medium rounded-lg py-2">
                          Approve — worth adding to the library
                        </button>
                        <button onClick={() => reviewFlag(f.id, "Rejected")}
                          className="flex-1 bg-white border border-slate-300 text-slate-600 text-xs font-medium rounded-lg py-2">
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (screen === "roleplay") {
    return (
      <div className="min-h-screen bg-white text-slate-900 flex flex-col">
        {isAutoPlaying && (
          <div className="bg-slate-900 text-white text-xs font-semibold text-center py-1.5 tracking-wide">
            DEMO — MASTER INVITER — scripted, not a real graded session
          </div>
        )}
        <div className="px-5 pt-5 pb-4 bg-white border-b border-slate-100">
          <div className="flex items-center justify-between mb-4">
            <div className="h-6" />
            <div className="flex items-center gap-1.5 text-slate-500 text-sm font-mono bg-slate-50 border border-slate-200 rounded-full px-3 py-1">
              <Clock size={13} /> {mm}:{ss}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-slate-900 flex items-center justify-center font-semibold text-white text-sm">
              {prospect?.name?.charAt(0)}
            </div>
            <div>
              <div className="font-semibold text-sm text-slate-900">{prospect?.name}</div>
              <div className="text-xs text-slate-500">{prospect?.occupation}{prospect?.location ? ` · ${prospect.location}` : ""}</div>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-slate-50/50">
          {showScript && (
            <div className="bg-teal-50 border border-teal-200 rounded-lg p-3.5 relative">
              <button onClick={() => setShowScript(false)} className="absolute top-2.5 right-3 text-teal-700 text-xs font-medium">Hide</button>
              <div className="text-xs font-semibold uppercase tracking-wide text-teal-700 mb-1.5 pr-10">{starterId} — your script</div>
              <p className="text-sm text-slate-900 leading-relaxed pr-2">{starterText(starters.find((s) => s.id === starterId), language)}</p>
              <button onClick={() => copyText(starterText(starters.find((s) => s.id === starterId), language), "roleplay")}
                className="mt-2 flex items-center gap-1 text-xs font-medium text-teal-700 bg-white border border-teal-300 rounded-md px-2 py-1 hover:bg-teal-100">
                {copiedWhere === "roleplay" ? <><Check size={12} /> Copied — paste it below</> : <><Copy size={12} /> Copy script</>}
              </button>
            </div>
          )}
          {!showScript && (
            <button onClick={() => setShowScript(true)} className="text-xs text-teal-700 font-medium underline block mx-auto">Show my opening script</button>
          )}
          {messages.length === 0 && (
            <div className="text-center text-slate-400 text-sm mt-6 px-8">
              Open with your conversation starter. {prospect?.name?.split(" ")[0]} is waiting for your call to connect.
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                m.role === "user" ? "bg-slate-900 text-white rounded-br-sm" : "bg-white text-slate-800 border border-slate-200 rounded-bl-sm"
              }`}>{m.text}</div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-sm px-4 py-3">
                <Loader2 size={14} className="animate-spin text-slate-400" />
              </div>
            </div>
          )}
          {autoPlayTypingAs && (
            <div className={`flex ${autoPlayTypingAs === "agent" ? "justify-end" : "justify-start"}`}>
              <div className={`rounded-2xl px-4 py-3 flex items-center gap-1.5 ${
                autoPlayTypingAs === "agent" ? "bg-slate-900 rounded-br-sm" : "bg-white border border-slate-200 rounded-bl-sm"
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full animate-bounce ${autoPlayTypingAs === "agent" ? "bg-white/60" : "bg-slate-300"}`} style={{ animationDelay: "0ms" }} />
                <span className={`w-1.5 h-1.5 rounded-full animate-bounce ${autoPlayTypingAs === "agent" ? "bg-white/60" : "bg-slate-300"}`} style={{ animationDelay: "150ms" }} />
                <span className={`w-1.5 h-1.5 rounded-full animate-bounce ${autoPlayTypingAs === "agent" ? "bg-white/60" : "bg-slate-300"}`} style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {roleplayEnded ? (
          <div className="px-5 py-6 border-t border-slate-100 text-center bg-white">
            {assessing ? (
              <div className="flex items-center justify-center gap-2 text-slate-500 text-sm"><Loader2 size={16} className="animate-spin" /> Generating your certified assessment…</div>
            ) : mode === "Demo" && assessment ? (
              <div>
                <div className="text-slate-500 text-sm mb-3">Demo complete — read back through the conversation above, then continue when you're ready.</div>
                <button onClick={() => setScreen("assessment")}
                  className="w-full bg-slate-900 text-white font-semibold rounded-lg py-3 flex items-center justify-center gap-2">
                  Next: See Score & Report <ChevronRight size={16} />
                </button>
              </div>
            ) : !assessment ? (
              <div>
                <div className="text-slate-500 text-sm mb-3">Call ended — read back through the conversation above, then continue when you're ready.</div>
                <button onClick={() => runAssessment(pendingEndReason)}
                  className="w-full bg-slate-900 text-white font-semibold rounded-lg py-3 flex items-center justify-center gap-2">
                  Next: See Score & Report <ChevronRight size={16} />
                </button>
              </div>
            ) : (
              <div className="text-slate-500 text-sm">Call ended.</div>
            )}
          </div>
        ) : (
          <div className="px-4 py-4 border-t border-slate-100 bg-white">
            {micError && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2.5 text-xs text-amber-800">
                <div className="flex items-start justify-between gap-2">
                  <span>{micError}</span>
                  <button onClick={() => setShowMicHelp((v) => !v)}
                    className="shrink-0 flex items-center gap-1 font-medium underline whitespace-nowrap">
                    <HelpCircle size={12} /> {showMicHelp ? "Hide help" : "How do I fix this?"}
                  </button>
                </div>
                {showMicHelp && (
                  <div className="mt-2.5 pt-2.5 border-t border-amber-200 space-y-3 text-amber-900">
                    <div>
                      <div className="font-semibold">On iPhone or iPad (Safari)</div>
                      <div>1. Tap the "aA" icon in the address bar → Website Settings → set Microphone to Allow, then reload this page.</div>
                      <div>2. Still stuck? Open the Settings app → Safari → Microphone → set to Ask (not Deny), then reload.</div>
                    </div>
                    <div>
                      <div className="font-semibold">On Android (Chrome)</div>
                      <div>1. Tap the lock/info icon to the left of the address bar → Permissions → Microphone → set to Allow, then reload this page.</div>
                      <div>2. Still stuck? Open Chrome's Settings → Site settings → Microphone → make sure this site isn't blocked.</div>
                    </div>
                    <div>
                      <div className="font-semibold">If it still doesn't work</div>
                      <div>Tap the mic button once more — it retries automatically. Otherwise, use the "Copy script" button above and paste it in, or use your keyboard's own built-in dictation button (the microphone icon on your phone's keyboard itself, not this app's) instead.</div>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="flex items-end gap-2">
              <button onClick={listening ? stopMic : startMic} disabled={isAutoPlaying}
                className={`shrink-0 w-12 h-12 rounded-full flex items-center justify-center transition-colors disabled:opacity-30 ${
                  listening ? "bg-red-500 animate-pulse" : "bg-slate-100 border border-slate-200"
                }`}>
                <Mic size={18} className={listening ? "text-white" : "text-teal-700"} />
              </button>
              <textarea ref={textareaRef} value={input} onChange={(e) => setInput(e.target.value)} rows={2} disabled={isAutoPlaying}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
                placeholder={isAutoPlaying ? "Demo playing automatically…" : listening ? "Listening…" : "Type or paste your line…"}
                className="flex-1 bg-white border border-slate-300 rounded-2xl px-4 py-3 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 resize-none overflow-y-auto disabled:opacity-50" style={{ maxHeight: "280px" }} />
              <button onClick={() => sendMessage(input)} disabled={sending || !input.trim() || isAutoPlaying}
                className="shrink-0 w-12 h-12 rounded-full bg-slate-900 disabled:bg-slate-200 flex items-center justify-center">
                <Send size={16} className="text-white" />
              </button>
            </div>
            <button onClick={() => endRoleplay("Agent ended the call.")}
              className="w-full mt-3 text-xs text-slate-400 flex items-center justify-center gap-1.5 py-1 hover:text-slate-600">
              <PhoneOff size={12} /> End roleplay
            </button>
          </div>
        )}
      </div>
    );
  }

  if (screen === "assessment") {
    if (!assessment || assessment.error) {
      return (
        <div className="min-h-screen bg-white text-slate-900 flex flex-col items-center justify-center px-8 text-center">
          <XCircle className="text-red-500 mb-4" size={40} />
          <p className="text-slate-600">The assessment couldn't be generated. Please try the roleplay again.</p>
          <button onClick={resetApp} className="mt-6 bg-teal-600 hover:bg-teal-700 text-white font-bold text-lg rounded-lg py-4 px-8">Start a new session</button>
        </div>
      );
    }
    const passed = assessment.pass_status === "Pass" && assessment.compliance_result === "Pass";
    const scoreRows = [
      ["Communication", assessment.communication, 25, assessment.communication_evidence, assessment.communication_improvement],
      ["Objection Handling", assessment.objection_handling, 25, assessment.objection_handling_evidence, assessment.objection_handling_improvement],
      ["Appointment Closing", assessment.appointment_closing, 20, assessment.appointment_closing_evidence, assessment.appointment_closing_improvement],
      ["Listening", assessment.listening, 10, assessment.listening_evidence, assessment.listening_improvement],
      ["Questioning", assessment.questioning, 10, assessment.questioning_evidence, assessment.questioning_improvement],
      ["Confidence & Tone", assessment.confidence_tone, 5, assessment.confidence_tone_evidence, assessment.confidence_tone_improvement],
      ["Script Intent", assessment.script_intent, 5, assessment.script_intent_evidence, assessment.script_intent_improvement],
    ];
    return (
      <div className="min-h-screen bg-white text-slate-900 pb-10">
        <div className="px-6 pt-6 pb-2 border-b border-slate-100"><div className="h-7" /></div>
        {mode === "Demo" && (
          <div className="bg-slate-900 text-white text-xs font-semibold text-center py-1.5 tracking-wide">
            DEMO — MASTER INVITER — scripted example, not a real graded session
          </div>
        )}
        <div className={`px-6 pt-8 pb-6 text-center border-b border-slate-100 ${passed ? "bg-teal-50/60" : "bg-red-50/60"}`}>
          {passed ? <CheckCircle2 className="mx-auto text-teal-600 mb-2" size={36} /> : <XCircle className="mx-auto text-red-500 mb-2" size={36} />}
          <div className="text-4xl font-bold text-slate-900">{assessment.overall}<span className="text-lg text-slate-400">/100</span></div>
          <div className={`text-sm font-semibold mt-1 ${passed ? "text-teal-700" : "text-red-600"}`}>{passed ? "PASS" : "RETRY"}</div>
          <div className="text-slate-500 text-xs mt-2">Appointment: {assessment.appointment_outcome} · AI confidence {assessment.ai_confidence}%</div>
        </div>

        <div className="px-5 mt-6">
          <div className="rounded-xl border-2 border-teal-600 bg-teal-50 p-5">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-teal-700 mb-2.5">
              <Award size={16} /> Your #1 Focus for Next Time
            </div>
            <p className="text-base text-slate-900 leading-relaxed font-medium mb-3">{assessment.highest_impact_improvement}</p>
            <div className="text-xs text-slate-500 pt-3 border-t border-teal-200">
              <span className="font-semibold text-slate-600">What happened: </span>{assessment.one_biggest_mistake}
            </div>
          </div>
        </div>

        <div className="px-5 mt-5">
          <button onClick={() => setShowFullBreakdown((v) => !v)}
            className="w-full flex items-center justify-center gap-1.5 text-sm text-slate-500 py-2">
            {showFullBreakdown ? "Hide full breakdown" : "See full score breakdown & more feedback"}
            <ChevronRight size={14} className={`transition-transform ${showFullBreakdown ? "rotate-90" : ""}`} />
          </button>
        </div>

        {showFullBreakdown && (
          <>
            <div className="px-5 mt-2">
              <div className="overflow-x-auto -mx-1 rounded-lg border border-slate-200">
                <table className="w-full text-xs border-collapse min-w-[540px]">
                  <thead>
                    <tr className="bg-slate-900 text-white">
                      <th className="text-left font-semibold px-3 py-2.5 w-28">Category</th>
                      <th className="text-left font-semibold px-3 py-2.5 w-52">Why This Score</th>
                      <th className="text-left font-semibold px-3 py-2.5 w-52">How to Improve</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scoreRows.map(([label, val, max, evidence, improvement], i) => (
                      <tr key={label} className={`border-t border-slate-100 ${i % 2 === 0 ? "bg-slate-50" : "bg-white"}`}>
                        <td className="px-3 py-3 align-top">
                          <div className="font-semibold text-slate-800">{label}</div>
                          <div className={`text-xs font-medium mt-0.5 ${val === max ? "text-teal-600" : "text-slate-500"}`}>{val}/{max}</div>
                        </td>
                        <td className="px-3 py-3 align-top text-slate-600 leading-relaxed">{evidence || "—"}</td>
                        <td className="px-3 py-3 align-top text-slate-600 leading-relaxed">{improvement || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-400 mt-1.5">Swipe left/right to see the full table →</p>
            </div>

            {assessment.all_mistakes && assessment.all_mistakes.length > 0 && (
              <div className="px-5 mt-6">
                <div className="text-xs font-semibold uppercase tracking-wide text-red-500 mb-2">Every mistake identified</div>
                <ul className="space-y-1.5">
                  {assessment.all_mistakes.map((m, i) => (
                    <li key={i} className="text-sm text-slate-700 flex gap-2"><span className="text-red-400">•</span>{m}</li>
                  ))}
                </ul>
              </div>
            )}

            {assessment.things_done_well && assessment.things_done_well.length > 0 && (
              <div className="px-5 mt-5">
                <div className="text-xs font-semibold uppercase tracking-wide text-teal-700 mb-2">Everything done well</div>
                <ul className="space-y-1.5">
                  {assessment.things_done_well.map((g, i) => (
                    <li key={i} className="text-sm text-slate-700 flex gap-2"><span className="text-teal-500">•</span>{g}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="px-5 mt-6 space-y-3">
              {assessment.strongest_sentence && <Card title="Strongest sentence" body={`"${assessment.strongest_sentence}"`} icon={<CheckCircle2 size={14} className="text-teal-600" />} />}
              {assessment.better_close && <Card title="A better close" body={assessment.better_close} icon={<Phone size={14} className="text-teal-600" />} />}
              {assessment.compliance_result === "Fail" && <Card title="Compliance issue" body={assessment.compliance_issue} icon={<XCircle size={14} className="text-red-500" />} tone="danger" />}
            </div>
          </>
        )}

        <div className="px-5 mt-8 space-y-3">
          {!passed && (
            <p className="text-center text-sm text-slate-600 max-w-xs mx-auto mb-1">
              {mode === "Practice"
                ? "This was practice — nobody's judging you. Fix the focus area above and go again."
                : "Not this time, and that's normal early on. Fix the focus area above, then retry."}
            </p>
          )}
          <button onClick={downloadSessionPDF}
            className="w-full bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium rounded-lg py-3 flex items-center justify-center gap-2">
            <FileDown size={16} /> View & save report (PDF, opens in new tab)
          </button>
          {submitState === "done" ? (
            <div className="text-center text-teal-700 text-sm py-3 font-medium">✓ Assessment recorded in Airtable.</div>
          ) : mode === "Demo" ? (
            <div className="text-center text-slate-400 text-xs py-3 bg-slate-50 border border-slate-200 rounded-lg">
              Master Inviter sessions are scripted demonstrations and can't be submitted as a real assessment.
            </div>
          ) : (
            <button onClick={submitToAirtable} disabled={submitState === "submitting"}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-lg py-3.5 flex items-center justify-center gap-2 disabled:opacity-50">
              {submitState === "submitting" ? <><Loader2 size={16} className="animate-spin" /> Submitting…</> : "Submit assessment"}
            </button>
          )}
          {submitState === "error" && (
            <div className="text-center text-red-600 text-xs">Submission failed: {submitError || "please try again."}</div>
          )}
          <button onClick={resetApp}
            className="w-full bg-teal-600 hover:bg-teal-700 text-white font-bold text-lg rounded-lg py-4">
            Start a new session
          </button>
        </div>
      </div>
    );
  }

  return null;
}

function PillGroup({ label, value, onChange, options }) {
  return (
    <div>
      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2 block">{label}</label>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <button key={opt} onClick={() => onChange(opt)}
            className={`px-3.5 py-2 rounded-full text-sm border transition-colors ${
              value === opt ? "bg-slate-900 text-white border-slate-900 font-medium" : "border-slate-300 text-slate-600 hover:border-slate-400"
            }`}>{opt}</button>
        ))}
      </div>
    </div>
  );
}

function Card({ title, body, icon, tone }) {
  return (
    <div className={`rounded-lg p-4 border ${tone === "danger" ? "bg-red-50 border-red-200" : "bg-slate-50 border-slate-200"}`}>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">{icon}{title}</div>
      <div className="text-sm text-slate-700 leading-relaxed">{body}</div>
    </div>
  );
}
