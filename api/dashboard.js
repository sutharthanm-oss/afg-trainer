// GET /api/dashboard?date=YYYY-MM-DD (optional, defaults to today)
// Admin-secret protected. Returns every valid session for that day, aggregated per agent,
// including each session's biggest mistake and highest-impact improvement. Quick Practice
// sessions are included automatically — they're stored identically to any other session.

const BASE_ID = "appAHmJKtNi508bIw";
const TABLE_TRAINING_SESSIONS = "tblAQaxG82bN14ppM";
const TABLE_COACHING_REPORTS = "tblxfhYiBFcG5McId";

function checkAdminSecret(req) {
  const provided = req.headers["x-admin-secret"];
  return provided && process.env.ADMIN_SECRET && provided === process.env.ADMIN_SECRET;
}

async function airtableGet(path, token) {
  const resp = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const rawText = await resp.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch (e) {
    throw new Error(`Airtable returned non-JSON (HTTP ${resp.status}): ${rawText.slice(0, 300)}`);
  }
  if (!resp.ok) {
    throw new Error(data?.error?.message || `Airtable error (HTTP ${resp.status})`);
  }
  return data;
}

export default async function handler(req, res) {
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) {
    res.status(500).json({ error: "Server is missing AIRTABLE_TOKEN." });
    return;
  }
  if (!checkAdminSecret(req)) {
    res.status(401).json({ error: "Invalid admin credentials." });
    return;
  }

  try {
    const dateParam = (req.query && req.query.date) || "";
    const dateFormula = dateParam
      ? `IS_SAME({Session Date-Time}, DATETIME_PARSE("${dateParam}", "YYYY-MM-DD"), "day")`
      : `IS_SAME({Session Date-Time}, TODAY(), "day")`;
    const filterFormula = encodeURIComponent(`AND({Valid Session} = TRUE(), ${dateFormula})`);
    const fields = ["Session ID", "Agent Code Submitted", "Session Date-Time", "Overall Score", "Pass Status", "Mode", "Difficulty", "Appointment Outcome"]
      .map((f) => `fields[]=${encodeURIComponent(f)}`).join("&");

    const sessionsData = await airtableGet(
      `${TABLE_TRAINING_SESSIONS}?filterByFormula=${filterFormula}&${fields}&sort[0][field]=Session%20Date-Time&sort[0][direction]=desc`,
      token
    );

    const sessions = (sessionsData.records || []).map((r) => ({
      sessionId: r.fields["Session ID"] || "",
      agentCode: r.fields["Agent Code Submitted"] || "",
      time: r.fields["Session Date-Time"] || "",
      score: r.fields["Overall Score"] ?? null,
      pass: r.fields["Pass Status"] || "",
      mode: r.fields["Mode"] || "",
      difficulty: r.fields["Difficulty"] || "",
      outcome: r.fields["Appointment Outcome"] || "",
      biggestMistake: "",
      improvement: "",
    }));

    // Coaching Reports are named "CR-<sessionId>" by /api/submit.js — use that directly
    // instead of resolving linked-record IDs, which keeps this to a single extra request.
    if (sessions.length > 0) {
      const crFormula = encodeURIComponent(
        "OR(" + sessions.map((s) => `{Coaching Report ID}="CR-${s.sessionId}"`).join(",") + ")"
      );
      const crFields = ["Coaching Report ID", "One Biggest Mistake", "One Highest-Impact Improvement"]
        .map((f) => `fields[]=${encodeURIComponent(f)}`).join("&");
      const crData = await airtableGet(`${TABLE_COACHING_REPORTS}?filterByFormula=${crFormula}&${crFields}`, token);
      const bySessionId = {};
      (crData.records || []).forEach((r) => {
        const crId = r.fields["Coaching Report ID"] || "";
        const sid = crId.replace(/^CR-/, "");
        bySessionId[sid] = {
          mistake: r.fields["One Biggest Mistake"] || "",
          improvement: r.fields["One Highest-Impact Improvement"] || "",
        };
      });
      sessions.forEach((s) => {
        const match = bySessionId[s.sessionId];
        if (match) {
          s.biggestMistake = match.mistake;
          s.improvement = match.improvement;
        }
      });
    }

    // Aggregate per agent.
    const byAgent = {};
    sessions.forEach((s) => {
      if (!byAgent[s.agentCode]) {
        byAgent[s.agentCode] = { agentCode: s.agentCode, attempts: 0, scores: [], passCount: 0, retryCount: 0, sessions: [] };
      }
      const a = byAgent[s.agentCode];
      a.attempts += 1;
      if (typeof s.score === "number") a.scores.push(s.score);
      if (s.pass === "Pass") a.passCount += 1;
      else if (s.pass === "Retry") a.retryCount += 1;
      a.sessions.push(s);
    });
    const agents = Object.values(byAgent).map((a) => ({
      agentCode: a.agentCode,
      attempts: a.attempts,
      passCount: a.passCount,
      retryCount: a.retryCount,
      avgScore: a.scores.length ? Math.round(a.scores.reduce((x, y) => x + y, 0) / a.scores.length) : null,
      bestScore: a.scores.length ? Math.max(...a.scores) : null,
      sessions: a.sessions,
    })).sort((a, b) => b.attempts - a.attempts);

    const allScores = sessions.map((s) => s.score).filter((s) => typeof s === "number");

    res.status(200).json({
      date: dateParam || new Date().toISOString().slice(0, 10),
      totalSessions: sessions.length,
      uniqueAgents: agents.length,
      averageScore: allScores.length ? Math.round(allScores.reduce((x, y) => x + y, 0) / allScores.length) : null,
      agents,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
