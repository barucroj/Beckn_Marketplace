const pool = require("../db");
const { buildResponseContext, sendCallback, findAgent } = require("../beckn");

async function handleInit(context, message) {
  const resourceId =
    message?.contract?.commitments?.[0]?.resources?.[0]?.id ||
    message?.contract?.commitments?.[0]?.descriptor?.code ||
    null;

  const agent = await findAgent(pool, resourceId);

  if (!agent) {
    const responseContext = buildResponseContext(context, "on_init");
    await sendCallback("on_init", responseContext, {
      error: { code: "40401", message: `Agent not found: ${resourceId}` },
    });
    return;
  }

  // Insert transaction into the user's transactions table
  const messageId = context.messageId || crypto.randomUUID();
  await pool.query(
    `INSERT INTO transactions (context_transaction_id, message_id, agent_id, status)
     VALUES ($1::uuid, $2::uuid, $3, 'pending')`,
    [context.transactionId, messageId, agent.id]
  );

  const price = parseFloat(agent.price_amount) || 0;
  const responseContext = buildResponseContext(context, "on_init");
  await sendCallback("on_init", responseContext, {
    contract: {
      id: `contract-${context.transactionId}`,
      commitments: [
        {
          id: "commitment-001",
          descriptor: { name: agent.name, code: agent.category },
          status: { code: "DRAFT" },
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
      performance: [{ id: "perf-001" }],
      settlements: [
        {
          id: "settlement-001",
          status: "DRAFT",
        },
      ],
    },
  });
}

module.exports = handleInit;
