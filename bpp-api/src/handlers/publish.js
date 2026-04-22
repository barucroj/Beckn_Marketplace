const pool = require("../db");
const { sendCallback } = require("../beckn");

// ── Build catalog from DB and publish to Fabric ─────────────────────────

async function publishCatalogToFabric() {
  const { rows: agents } = await pool.query(`
    SELECT
      a.agent_id, a.agent_name, a.category_id,
      array_to_string(a.capabilities, ', ') AS description,
      a.pricing_model,
      p.provider_id, p.subscriber_id AS provider_subscriber_id,
      p.trust_score_aggregate
    FROM ai_agents a
    JOIN ai_providers p ON a.provider_id = p.provider_id
    WHERE a.status = 'active'
  `);

  if (agents.length === 0) {
    throw new Error("No active agents in database to publish");
  }

  const resources = agents.map((a) => ({
    id: String(a.agent_id),
    descriptor: {
      name: a.agent_name?.en || a.agent_name,
      shortDesc: a.description,
    },
    provider: {
      id: String(a.provider_id),
      descriptor: { name: a.provider_subscriber_id },
    },
    rating: {
      ratingValue: parseFloat(a.trust_score_aggregate) || 0,
      bestRating: 5,
      worstRating: 1,
    },
  }));

  const offers = agents.map((a) => {
    const pricing = a.pricing_model || {};
    return {
      id: `offer-${a.agent_id}`,
      descriptor: {
        name: `${a.agent_name?.en || a.agent_name} — Single Execution`,
        shortDesc: `Pay-per-request — $${pricing.value || 0}/${pricing.type || "request"}`,
      },
      resourceIds: [String(a.agent_id)],
      provider: {
        id: String(a.provider_id),
        descriptor: { name: a.provider_subscriber_id },
      },
    };
  });

  const firstProvider = {
    id: String(agents[0].provider_id),
    descriptor: { name: agents[0].provider_subscriber_id },
  };

  const catalog = {
    id: "CAT-AI-AGENTS-001",
    descriptor: {
      name: "AI Agent Catalog",
      shortDesc: "AI agents published from the marketplace database",
    },
    provider: firstProvider,
    resources,
    offers,
    publishDirectives: { catalogType: "regular" },
  };

  const context = {
    networkId: "beckn.one/testnet",
    action: "catalog/publish",
    version: "2.0.0",
    bapId: "bap.example.com",
    bapUri: "http://onix-bap:8081/bap/receiver",
    bppId: "bpp.example.com",
    bppUri: "http://onix-bpp:8082/bpp/receiver",
    transactionId: crypto.randomUUID(),
    messageId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ttl: "PT30S",
  };

  await sendCallback("publish", context, { catalogs: [catalog] });
  return { agentsPublished: agents.length, catalogId: catalog.id };
}

// ── POST /api/publish — read-only, publishes current DB state to Fabric ─

async function handlePublish(_req, res) {
  try {
    const result = await publishCatalogToFabric();
    console.log(`[publish] Catalog published to Fabric (${result.agentsPublished} agents)`);
    res.json({
      status: "ok",
      fabric: { catalogPublished: true, agentsInCatalog: result.agentsPublished, catalogId: result.catalogId },
    });
  } catch (err) {
    console.error("[publish] Fabric publish failed:", err.message);
    res.status(500).json({ error: err.message });
  }
}

// ── Webhook: on_publish callback from Fabric ────────────────────────────

function handleOnPublish(context, message) {
  console.log("[on_publish] Catalog publish confirmed by Fabric");
  if (message?.error) {
    console.error("[on_publish] Error from Fabric:", message.error);
  }
}

module.exports = { handlePublish, handleOnPublish };
