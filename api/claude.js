// POST /api/roleplay
// Body: { messages: [...], system: "...", maxTokens: 400 }
// Returns: { text: "<claude's raw text reply>" }

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY. Set it in your hosting provider's environment variables." });
    return;
  }

  const { messages, system, maxTokens } = req.body || {};
  if (!messages || !system) {
    res.status(400).json({ error: "Missing messages or system in request body." });
    return;
  }

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: maxTokens || 400,
        system,
        messages,
      }),
    });

    const rawText = await resp.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch (e) {
      res.status(502).json({ error: "Anthropic API returned non-JSON (HTTP " + resp.status + ")", raw: rawText.slice(0, 500) });
      return;
    }

    if (!resp.ok) {
      res.status(resp.status).json({ error: data?.error?.message || "Anthropic API error", raw: data });
      return;
    }

    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    res.status(200).json({ text });
  } catch (err) {
    res.status(500).json({ error: "Server error calling Anthropic API: " + err.message });
  }
}
