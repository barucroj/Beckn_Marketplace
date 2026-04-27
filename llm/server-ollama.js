// ── Ollama LLM Server ───────────────────────────────────────────────
// Same interface as server.js (Claude) but calls Ollama on port 11434.
// Run:  node llm/server-ollama.js
// Test: curl -X POST http://localhost:3011/api/chat \
//         -H "Content-Type: application/json" \
//         -d '{"prompt": "Hello"}'
//
// Environment variables:
//   OLLAMA_URL   – Ollama API (default: http://localhost:11434)
//   OLLAMA_MODEL – model name  (default: llama3:8b)
//   PORT         – listen port (default: 3011)
// ─────────────────────────────────────────────────────────────────────

const express = require('express');
const app = express();

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3:8b';
const PORT = process.env.PORT || 3011;

app.use(express.json());

app.post('/api/chat', async (req, res) => {
    const userPrompt = req.body.prompt;

    if (!userPrompt) {
        return res.status(400).json({ error: 'Prompt is required' });
    }

    try {
        // Ollama /api/generate with stream: false returns a single JSON response
        const response = await fetch(`${OLLAMA_URL}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: OLLAMA_MODEL,
                prompt: userPrompt,
                stream: false
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            return res.status(500).json({ error: 'Ollama error', details: errText });
        }

        const data = await response.json();

        // Match the same response shape as server.js (Claude)
        // so confirm.js can consume either without changes:
        //   { reply: { result: "..." } }
        res.json({
            reply: {
                result: data.response,
                model: data.model,
                duration_ms: Math.round((data.total_duration || 0) / 1e6)
            }
        });
    } catch (err) {
        res.status(500).json({ error: 'Ollama unreachable', details: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Ollama LLM server running on http://localhost:${PORT} (model: ${OLLAMA_MODEL})`);
});
