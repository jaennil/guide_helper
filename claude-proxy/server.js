// Must be unset before importing the SDK so nested Claude Code sessions are allowed
delete process.env.CLAUDECODE;
delete process.env.CLAUDE_CODE_ENTRYPOINT;

import express from "express";
import { query, AbortError } from "@anthropic-ai/claude-agent-sdk";

const app = express();
const PORT = process.env.PORT || 3099;

app.use(express.json());

// GET /api/ai?query=...
// POST /api/ai  { "query": "..." }
app.all("/api/ai", async (req, res) => {
  const userQuery = req.query.query || req.body?.query;

  if (!userQuery) {
    return res.status(400).json({ error: 'Missing "query" parameter' });
  }

  console.log(`[claude-proxy] query: ${userQuery}`);

  try {
    let result = null;

    for await (const message of query({
      prompt: String(userQuery),
      options: {
        maxTurns: 5,
      },
    })) {
      console.log(`[claude-proxy] message type: ${message.type}`);
      if (message.type === "result") {
        result = message;
      }
    }

    if (!result) {
      return res.status(500).json({ error: "No result from Claude Code" });
    }

    console.log(`[claude-proxy] done, cost: $${result.total_cost_usd?.toFixed(4) ?? "?"}`);

    return res.json({
      result: result.result,
      cost_usd: result.total_cost_usd,
      duration_ms: result.duration_ms,
      turns: result.num_turns,
    });
  } catch (err) {
    if (err instanceof AbortError) {
      return res.status(499).json({ error: "Request aborted" });
    }
    console.error("[claude-proxy] error:", err);
    return res.status(500).json({ error: String(err.message ?? err) });
  }
});

// Health check
app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.listen(PORT, () => {
  console.log(`[claude-proxy] listening on http://localhost:${PORT}`);
  console.log(`[claude-proxy] usage: GET http://localhost:${PORT}/api/ai?query=your+question`);
});
