const pool = require("../db");
const { buildResponseContext, sendCallback, findAgent } = require("../beckn");

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

async function callLLM(agent, userInput) {
  console.log(`[llm] Agent "${agent.name}" (${agent.category}) processing input...`);

  // TODO: Replace with real LLM API call
  return `[MOCK RESPONSE from ${agent.name} using ${agent.category}]\n\n`
    + `Simulated response for: "${userInput.substring(0, 100)}..."\n\n`
    + `Agent: ${agent.name}\nCategory: ${agent.category}\nModel: ${agent.category}`;
}

module.exports = handleConfirm;
