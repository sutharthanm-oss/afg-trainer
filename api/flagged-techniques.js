// GET   /api/flagged-techniques           -> list Pending flags, requires admin secret
// PATCH /api/flagged-techniques           -> approve/reject a flag, requires admin secret

const FLAGS_BASE_ID = "appYUxhPpFYrNObIE";
const TABLE_FLAGGED_TECHNIQUES = "tblvuoEG5GEntAZ5s";

function checkAdminSecret(req) {
  const provided = req.headers["x-admin-secret"] || (req.body && req.body.adminSecret);
  return provided && process.env.ADMIN_SECRET && provided === process.env.ADMIN_SECRET;
}

async function airtableFetch(path, token, options = {}) {
  const resp = await fetch(`https://api.airtable.com/v0/${FLAGS_BASE_ID}/${path}`, {
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
  if (!checkAdminSecret(req)) {
    res.status(401).json({ error: "Invalid admin credentials." });
    return;
  }

  try {
    if (req.method === "GET") {
      const filterFormula = encodeURIComponent(`{Status} = "Pending"`);
      const data = await airtableFetch(`${TABLE_FLAGGED_TECHNIQUES}?filterByFormula=${filterFormula}&sort[0][field]=Flagged At&sort[0][direction]=desc`, token);
      const flags = (data.records || []).map((r) => ({
        id: r.id,
        flagId: r.fields["Flag ID"] || "",
        sessionId: r.fields["Session ID"] || "",
        agentCode: r.fields["Agent Code"] || "",
        technique: r.fields["Technique Description"] || "",
        reason: r.fields["Why It Worked"] || "",
        flaggedAt: r.fields["Flagged At"] || "",
      }));
      res.status(200).json({ flags });
      return;
    }

    if (req.method === "PATCH") {
      const { id, status, reviewedBy } = req.body || {};
      if (!id || !status) {
        res.status(400).json({ error: "Missing id or status." });
        return;
      }
      await airtableFetch(TABLE_FLAGGED_TECHNIQUES, token, {
        method: "PATCH",
        body: JSON.stringify({
          typecast: true,
          records: [
            {
              id,
              fields: {
                "Status": status,
                "Reviewed By": reviewedBy || "Admin",
                "Reviewed At": new Date().toISOString(),
              },
            },
          ],
        }),
      });
      res.status(200).json({ success: true });
      return;
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
