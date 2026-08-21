// GET /api/prospects
// Returns: { prospects: [{ id, name, age, occupation, location, personality, difficulty, hiddenConcern, hiddenMotivation }] }
// Only Status = Approved. Adding a new prospect, or editing an existing one, is
// done directly in the Prospect Library table in Airtable — no code change or redeploy needed.

const BASE_ID = "appAHmJKtNi508bIw";
const TABLE_PROSPECTS = "tblMpttghkw3QrZ0E";

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
  try {
    const filterFormula = encodeURIComponent(`{Status} = "Approved"`);
    const fields = ["Prospect ID", "Fictional Name", "Age Range", "Occupation", "Personality", "Difficulty", "Hidden Concern", "Hidden Motivation", "Market Type"]
      .map((f) => `fields[]=${encodeURIComponent(f)}`).join("&");
    const resp = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${TABLE_PROSPECTS}?filterByFormula=${filterFormula}&${fields}&sort[0][field]=Prospect%20ID&sort[0][direction]=asc`,
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
    const prospects = (data.records || []).map((r) => ({
      id: r.fields["Prospect ID"] || "",
      name: r.fields["Fictional Name"] || "",
      age: r.fields["Age Range"] || "",
      occupation: r.fields["Occupation"] || "",
      location: r.fields["Market Type"] || "",
      personality: r.fields["Personality"] || "",
      difficulty: r.fields["Difficulty"] || "",
      hiddenConcern: r.fields["Hidden Concern"] || "",
      hiddenMotivation: r.fields["Hidden Motivation"] || "",
    })).filter((p) => p.id && p.name);
    res.status(200).json({ prospects });
  } catch (err) {
    res.status(500).json({ error: "Server error calling Airtable: " + err.message });
  }
}
