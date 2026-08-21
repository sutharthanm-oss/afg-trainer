// GET /api/agents
// Returns: { agents: [{ code, name }] } — only Status = Active

const BASE_ID = "appAHmJKtNi508bIw";
const TABLE_AGENTS = "tblV0xfgpFQxyRVSS";

export default async function handler(req, res) {
  // Explicitly forbid caching anywhere in the chain — Vercel's edge network, any proxy,
  // and the browser itself. Without this, a GET endpoint like this can occasionally serve
  // a stale cached response even after the underlying Airtable data has genuinely changed,
  // which is indistinguishable from a real bug to whoever's looking at the app.
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  const token = process.env.AIRTABLE_TOKEN;
  if (!token) {
    res.status(500).json({ error: "Server is missing AIRTABLE_TOKEN." });
    return;
  }
  try {
    const filterFormula = encodeURIComponent(`{Status} = "Active"`);
    const fields = ["Agent Code", "Agent Name"].map((f) => `fields[]=${encodeURIComponent(f)}`).join("&");
    const resp = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${TABLE_AGENTS}?filterByFormula=${filterFormula}&${fields}`,
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
    const agents = (data.records || []).map((r) => ({
      code: r.fields["Agent Code"] || "",
      name: r.fields["Agent Name"] || "",
    })).filter((a) => a.code && a.name);
    res.status(200).json({ agents });
  } catch (err) {
    res.status(500).json({ error: "Server error calling Airtable: " + err.message });
  }
}
