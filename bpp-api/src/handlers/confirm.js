const pool = require("../db");
const axios = require("axios");
const { buildResponseContext, sendCallback, findAgent } = require("../beckn");

// ── LLM Service endpoint ────────────────────────────────────────────
// Points to the LLM server (llm/server.js) running on port 3010.
// From inside Docker, "host.docker.internal" reaches the host machine.
// Override with LLM_SERVICE_URL env var if needed.
// ─────────────────────────────────────────────────────────────────────
const LLM_SERVICE_URL = process.env.LLM_SERVICE_URL || "http://host.docker.internal:3010/api/chat";

async function handleConfirm(context, message) {
  const resourceId =
    message?.contract?.commitments?.[0]?.resources?.[0]?.id ||
    message?.contract?.commitments?.[0]?.descriptor?.code ||
    null;

  const agent = await findAgent(pool, resourceId);

  if (!agent) {
    const responseContext = buildResponseContext(context, "on_confirm");
    await sendCallback("on_confirm", responseContext, {
      error: { code: "40401", message: `Agent not found: ${resourceId}` },
    });
    return;
  }

  const userInput =
    message?.contract?.commitments?.[0]?.resources?.[0]?.descriptor?.userInput ||
    message?.contract?.commitments?.[0]?.resources?.[0]?.descriptor?.longDesc ||
    message?.userInput ||
    message?.input ||
    "No input provided";

  // Mark transaction as pending with the request payload
  await pool.query(
    `UPDATE transactions
     SET status = 'pending', request_payload = $1::jsonb
     WHERE context_transaction_id = $2::uuid AND agent_id = $3`,
    [JSON.stringify({ input: userInput }), context.transactionId, agent.id]
  );

  // ====== LLM INTEGRATION POINT ======
  const llmOutput = await callLLM(agent, userInput);
  // ====================================

  // Mark transaction as completed with the response payload
  await pool.query(
    `UPDATE transactions
     SET status = 'completed',
         response_payload = $1::jsonb,
         completed_at = NOW()
     WHERE context_transaction_id = $2::uuid AND agent_id = $3`,
    [JSON.stringify({ output: llmOutput }), context.transactionId, agent.id]
  );

  const responseContext = buildResponseContext(context, "on_confirm");
  await sendCallback("on_confirm", responseContext, {
    contract: {
      id: `contract-${context.transactionId}`,
      commitments: [
        {
          id: "commitment-001",
          descriptor: { name: agent.name, code: agent.category },
          status: { code: "ACTIVE" },
          resources: [
            {
              id: agent.id,
              descriptor: { name: agent.name, code: agent.category },
              quantity: { unitQuantity: 1, unitCode: "EXECUTION" },
            },
          ],
          offer: {
            id: `offer-${agent.id}`,
            resourceIds: [agent.id],
          },
        },
      ],
      participants: message.contract.participants || [],
      performance: [
        {
          id: "perf-001",
          status: {
            name: "Agent Execution",
            code: "COMPLETED",
            longDesc: llmOutput,
          },
        },
      ],
      settlements: [{ id: "settlement-001", status: "COMPLETE" }],
    },
  });
}

// ── callLLM ─────────────────────────────────────────────────────────
// Sends the user prompt to the LLM service (llm/server.js → port 3010)
// and extracts the text reply. Falls back to a mock if the service is
// unreachable, so the Beckn flow never breaks during development.
// ─────────────────────────────────────────────────────────────────────
async function callLLM(agent, userInput) {
  console.log(`[llm] Agent "${agent.name}" (${agent.category}) → ${LLM_SERVICE_URL}`);

  try {
    const { data } = await axios.post(
      LLM_SERVICE_URL,
      { prompt: `You are "${agent.name}", an AI agent specialized in ${agent.category}.\n\n${userInput}` },
      { timeout: 120_000 }
    );

    // llm/server.js returns { reply: { result: "..." } } (JSON mode)
    // or { reply: "..." } (plain-text fallback)
    const result = typeof data.reply === "object" ? data.reply.result : data.reply;
    console.log(`[llm] Response received (${String(result).length} chars)`);
    return result || "[LLM returned empty response]";
  } catch (err) {
    console.error(`[llm] Service error: ${err.message}`);
    return `[LLM SERVICE UNAVAILABLE] Could not reach ${LLM_SERVICE_URL} — ${err.message}`;
  }
}

module.exports = handleConfirm;
