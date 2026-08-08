// GET  /api/admin-agents          -> list ALL agents (including suspended), requires admin secret
// POST /api/admin-agents          -> create a new agent, requires admin secret
// PATCH /api/admin-agents         -> update an agent's status/access code, requires admin secret
//
// The admin secret is checked against process.env.ADMIN_SECRET — a separate, more sensitive
// credential than individual agent access codes. Set this in Vercel's environment variables.

const BASE_ID = "appAHmJKtNi508bIw";
const TABLE_AGENTS = "tblV0xfgpFQxyRVSS";

function checkAdminSecret(req) {
  const provided = req.headers["x-admin-secret"] || (req.body && req.body.adminSecret);
  return provided && process.env.ADMIN_SECRET && provided === process.env.ADMIN_SECRET;
}

async function airtableFetch(path, token, options = {}) {
  const resp = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
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
  if (!process.env.ADMIN_SECRET) {
    res.status(500).json({ error: "Server is missing ADMIN_SECRET. Set it in Vercel environment variables first." });
    return;
  }
  if (!checkAdminSecret(req)) {
    res.status(401).json({ error: "Invalid admin credentials." });
    return;
  }

  try {
    if (req.method === "GET") {
      const data = await airtableFetch(`${TABLE_AGENTS}?fields[]=Agent Code&fields[]=Agent Name&fields[]=Status&fields[]=Access Code&fields[]=Role`, token);
      const agents = (data.records || []).map((r) => ({
        id: r.id,
        code: r.fields["Agent Code"] || "",
        name: r.fields["Agent Name"] || "",
        status: r.fields["Status"] || "",
        accessCode: r.fields["Access Code"] || "",
        role: r.fields["Role"] || "Agent",
      }));
      res.status(200).json({ agents });
      return;
    }

    if (req.method === "POST") {
      const { code, name, accessCode, role } = req.body || {};
      if (!code || !name || !accessCode) {
        res.status(400).json({ error: "Missing code, name, or accessCode." });
        return;
      }
      const created = await airtableFetch(TABLE_AGENTS, token, {
        method: "POST",
        body: JSON.stringify({
          records: [
            {
              fields: {
                "Agent Code": code,
                "Agent Name": name,
                "Access Code": accessCode,
                "Role": role || "Agent",
                "Status": "Active",
                "Experience Category": "New Agent",
              },
            },
          ],
        }),
      });
      res.status(200).json({ success: true, id: created.records[0].id });
      return;
    }

    if (req.method === "PATCH") {
      const { id, status, accessCode } = req.body || {};
      if (!id) {
        res.status(400).json({ error: "Missing id." });
        return;
      }
      const fields = {};
      if (status) fields["Status"] = status;
      if (accessCode) fields["Access Code"] = accessCode;
      await airtableFetch(TABLE_AGENTS, token, {
        method: "PATCH",
        body: JSON.stringify({ records: [{ id, fields }] }),
      });
      res.status(200).json({ success: true });
      return;
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
