// POST /api/verify
// Body: { agentCode, password }
// Returns: { valid: true/false }
// The list of valid codes is never sent to the browser — only a true/false answer.

const BASE_ID = "appAHmJKtNi508bIw";
const TABLE_AGENTS = "tblV0xfgpFQxyRVSS";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const token = process.env.AIRTABLE_TOKEN;
  if (!token) {
    res.status(500).json({ error: "Server is missing AIRTABLE_TOKEN." });
    return;
  }

  const { agentCode, password } = req.body || {};
  if (!agentCode || !password) {
    res.status(400).json({ valid: false, error: "Missing agentCode or password." });
    return;
  }

  try {
    const filterFormula = encodeURIComponent(`{Agent Code} = "${agentCode}"`);
    const resp = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${TABLE_AGENTS}?filterByFormula=${filterFormula}&fields[]=Access Code&fields[]=Status`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await resp.json();
    if (!resp.ok) {
      res.status(500).json({ valid: false, error: "Could not verify right now." });
      return;
    }
    const record = (data.records || [])[0];
    if (!record) {
      res.status(200).json({ valid: false });
      return;
    }
    const isActive = record.fields["Status"] === "Active";
    const codeMatches = record.fields["Access Code"] === password;
    res.status(200).json({ valid: Boolean(isActive && codeMatches) });
  } catch (err) {
    res.status(500).json({ valid: false, error: "Server error verifying access code." });
  }
}
