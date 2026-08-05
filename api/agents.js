// GET /api/agents
// Returns: { agents: [{ code, name }] } — only Status = Active

const BASE_ID = "appAHmJKtNi508bIw";
const TABLE_AGENTS = "tblV0xfgpFQxyRVSS";

export default async function handler(req, res) {
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) {
    res.status(500).json({ error: "Server is missing AIRTABLE_TOKEN. Set it in your hosting provider's environment variables." });
    return;
  }

  try {
    const filterFormula = encodeURIComponent(`{Status} = "Active"`);
    const resp = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${TABLE_AGENTS}?filterByFormula=${filterFormula}&fields[]=Agent Code&fields[]=Agent Name`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const rawText = await resp.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch (e) {
      res.status(502).json({ error: "Airtable returned non-JSON (HTTP " + resp.status + ")" });
      return;
    }
    if (!resp.ok) {
      res.status(resp.status).json({ error: data?.error?.message || "Airtable error" });
      return;
    }
    const agents = (data.records || []).map((r) => ({
      code: r.fields["Agent Code"],
      name: r.fields["Agent Name"],
    })).filter((a) => a.code && a.name);
    res.status(200).json({ agents });
  } catch (err) {
    res.status(500).json({ error: "Server error calling Airtable: " + err.message });
  }
}
