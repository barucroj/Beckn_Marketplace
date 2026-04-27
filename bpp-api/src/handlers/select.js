const pool = require("../db");
const { buildResponseContext, sendCallback, findAgent } = require("../beckn");

async function handleSelect(context, message) {
  const resourceId =
    message?.contract?.commitments?.[0]?.resources?.[0]?.id ||
    message?.contract?.commitments?.[0]?.descriptor?.code ||
    null;

  const agent = await findAgent(pool, resourceId);

  if (!agent) {
    const responseContext = buildResponseContext(context, "on_select");
    await sendCallback("on_select", responseContext, {
      error: { code: "40401", message: `Agent not found: ${resourceId}` },
    });
    return;
  }

  const price = parseFloat(agent.price_amount) || 0;
  const responseContext = buildResponseContext(context, "on_select");
  await sendCallback("on_select", responseContext, {
    contract: {
      id: `contract-${context.transactionId}`,
      participants: message.contract.participants || [],
      commitments: [
        {
          id: "commitment-001",
          descriptor: {
            name: agent.name,
            code: agent.category,
            shortDesc: agent.description,
          },
          status: { code: "DRAFT" },
          resources: [
            {
              id: agent.id,
              descriptor: {
                name: agent.name,
                code: agent.category,
                shortDesc: agent.description,
              },
              quantity: { unitQuantity: 1, unitCode: "EXECUTION" },
            },
          ],
          offer: {
            id: `offer-${agent.id}`,
            resourceIds: [agent.id],
          },
        },
      ],
      consideration: [
        {
          id: "consideration-001",
          price: { currency: agent.price_currency, value: String(price) },
          status: { code: "DRAFT" },
          breakup: [
            {
              title: "Agent Execution Fee",
              price: { currency: agent.price_currency, value: String(price) },
            },
          ],
        },
      ],
    },
  });
}

module.exports = handleSelect;
