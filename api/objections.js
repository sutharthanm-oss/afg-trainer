// GET /api/objections
// Returns: { objections: [{ id, category, difficulty, main }] } — only Status = Approved
// Adding a new objection, or editing an existing one, is done directly in the
// Objection Library table in Airtable — no code change or redeploy needed.

const BASE_ID = "appAHmJKtNi508bIw";
const TABLE_OBJECTIONS = "tblvkkhOzGx0SwuN2";

export default async function handler(req, res) {
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) {
    res.status(500).json({ error: "Server is missing AIRTABLE_TOKEN." });
    return;
  }
  try {
    const filterFormula = encodeURIComponent(`{Status} = "Approved"`);
    const fields = ["Objection ID", "Category", "Difficulty", "Main Objection"]
      .map((f) => `fields[]=${encodeURIComponent(f)}`).join("&");
    const resp = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${TABLE_OBJECTIONS}?filterByFormula=${filterFormula}&${fields}&sort[0][field]=Objection%20ID&sort[0][direction]=asc`,
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
    const objections = (data.records || []).map((r) => ({
      id: r.fields["Objection ID"] || "",
      category: r.fields["Category"] || "",
      difficulty: r.fields["Difficulty"] || "",
      main: r.fields["Main Objection"] || "",
    })).filter((o) => o.id && o.main);
    res.status(200).json({ objections });
  } catch (err) {
    res.status(500).json({ error: "Server error calling Airtable: " + err.message });
  }
}
