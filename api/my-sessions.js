// GET /api/my-sessions?agentCode=XXX
// Returns: { sessions: [{ sessionId, date, score, pass, mode, difficulty, outcome }] }
// Most recent 8 valid sessions for this agent, newest first.

const BASE_ID = "appAHmJKtNi508bIw";
const TABLE_TRAINING_SESSIONS = "tblAQaxG82bN14ppM";

export default async function handler(req, res) {
  // Explicitly forbid caching anywhere in the chain (CDN, proxy, browser) — a stale
  // cached response is otherwise indistinguishable from a real data bug to whoever's
  // looking at the app.
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  const token = process.env.AIRTABLE_TOKEN;
  if (!token) {
    res.status(500).json({ error: "Server is missing AIRTABLE_TOKEN." });
    return;
  }
  const agentCode = (req.query && req.query.agentCode) || "";
  if (!agentCode) {
    res.status(400).json({ error: "Missing agentCode." });
    return;
  }
  try {
    const filterFormula = encodeURIComponent(`AND({Agent Code Submitted} = "${agentCode}", {Valid Session} = TRUE())`);
    const fields = ["Session ID", "Session Date-Time", "Overall Score", "Pass Status", "Mode", "Difficulty", "Appointment Outcome"]
      .map((f) => `fields[]=${encodeURIComponent(f)}`).join("&");
    const resp = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${TABLE_TRAINING_SESSIONS}?filterByFormula=${filterFormula}&${fields}&sort[0][field]=Session%20Date-Time&sort[0][direction]=desc&maxRecords=8`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const rawText = await resp.text();
    let data;
    try { data = JSON.parse(rawText); } catch (e) {
      res.status(502).json({ error: "Airtable returned non-JSON (HTTP " + resp.status + ")" });
      return;
    }
    if (!resp.ok) {
      res.status(resp.status).json({ error: data?.error?.message || "Airtable error" });
      return;
    }
    const sessions = (data.records || []).map((r) => ({
      sessionId: r.fields["Session ID"] || "",
      date: r.fields["Session Date-Time"] || "",
      score: r.fields["Overall Score"] ?? null,
      pass: r.fields["Pass Status"] || "",
      mode: r.fields["Mode"] || "",
      difficulty: r.fields["Difficulty"] || "",
      outcome: r.fields["Appointment Outcome"] || "",
    }));
    res.status(200).json({ sessions });
  } catch (err) {
    res.status(500).json({ error: "Server error calling Airtable: " + err.message });
  }
}
