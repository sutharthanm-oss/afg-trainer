// GET /api/starters
// Returns: { starters: [{ id, en, bm, manglish, ta, zh }] } — only Status = Approved
// Adding a new starter, or editing an existing one, is done directly in the
// Conversation Starters table in Airtable — no code change or redeploy needed.

const BASE_ID = "appAHmJKtNi508bIw";
const TABLE_STARTERS = "tblVICRO9uISmFVrV";

export default async function handler(req, res) {
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) {
    res.status(500).json({ error: "Server is missing AIRTABLE_TOKEN." });
    return;
  }
  try {
    const filterFormula = encodeURIComponent(`{Status} = "Approved"`);
    const fields = ["Starter ID", "Approved English Wording", "Bahasa Malaysia Wording", "Manglish Guidance", "Tamil Wording", "Mandarin Wording"]
      .map((f) => `fields[]=${encodeURIComponent(f)}`).join("&");
    const resp = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${TABLE_STARTERS}?filterByFormula=${filterFormula}&${fields}&sort[0][field]=Starter%20ID&sort[0][direction]=asc`,
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
    const starters = (data.records || []).map((r) => ({
      id: r.fields["Starter ID"] || "",
      en: r.fields["Approved English Wording"] || "",
      bm: r.fields["Bahasa Malaysia Wording"] || "",
      manglish: r.fields["Manglish Guidance"] || "",
      ta: r.fields["Tamil Wording"] || "",
      zh: r.fields["Mandarin Wording"] || "",
    })).filter((s) => s.id && s.en);
    res.status(200).json({ starters });
  } catch (err) {
    res.status(500).json({ error: "Server error calling Airtable: " + err.message });
  }
}
