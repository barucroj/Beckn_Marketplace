const express = require("express");
const pool = require("./db");
const handleDiscover = require("./handlers/discover");
const handleSelect = require("./handlers/select");
const handleInit = require("./handlers/init");
const handleConfirm = require("./handlers/confirm");
const { handlePublish, handleOnPublish } = require("./handlers/publish");

const app = express();
const PORT = process.env.PORT || 3002;

app.use(express.json({ limit: "5mb" }));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ── Health ─────────────────────────────────────────────────────────────

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", service: "bpp-ai-agent-marketplace", db: "connected" });
  } catch {
    res.status(503).json({ status: "error", service: "bpp-ai-agent-marketplace", db: "disconnected" });
  }
});

// ── Categories CRUD ────────────────────────────────────────────────────

app.get("/api/categories", async (_req, res) => {
  const { rows } = await pool.query(
    "SELECT category_id, display_name, description, is_active FROM categories ORDER BY category_id"
  );
  res.json(rows);
});

app.post("/api/categories", async (req, res) => {
  const { category_id, display_name, description } = req.body;

  if (!category_id || !display_name) {
    return res.status(400).json({ error: "category_id and display_name are required" });
  }

  try {
    await pool.query(
      `INSERT INTO categories (category_id, display_name, description)
       VALUES ($1, $2, $3)
       ON CONFLICT (category_id) DO UPDATE SET display_name = $2, description = $3`,
      [category_id, JSON.stringify(display_name), description || null]
    );
    res.status(201).json({ status: "ok", category_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Providers CRUD ─────────────────────────────────────────────────────

app.get("/api/providers", async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT provider_id, subscriber_id, bpp_uri, public_key,
            organization_details, trust_score_aggregate, created_at
     FROM ai_providers ORDER BY created_at DESC`
  );
  res.json(rows);
});

app.post("/api/providers", async (req, res) => {
  const { subscriber_id, bpp_uri, public_key, organization_details } = req.body;

  if (!subscriber_id || !bpp_uri || !public_key) {
    return res.status(400).json({ error: "subscriber_id, bpp_uri, and public_key are required" });
  }

  try {
    const { rows: [provider] } = await pool.query(
      `INSERT INTO ai_providers (subscriber_id, bpp_uri, public_key, organization_details)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (subscriber_id) DO UPDATE
         SET bpp_uri = $2, public_key = $3, organization_details = COALESCE($4, ai_providers.organization_details)
       RETURNING provider_id, subscriber_id`,
      [subscriber_id, bpp_uri, public_key, organization_details ? JSON.stringify(organization_details) : null]
    );
    res.status(201).json({ status: "ok", provider });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/providers/:id", async (req, res) => {
  const { id } = req.params;
  const { bpp_uri, public_key, organization_details } = req.body;

  try {
    const { rowCount } = await pool.query(
      `UPDATE ai_providers SET
        bpp_uri = COALESCE($1, bpp_uri),
        public_key = COALESCE($2, public_key),
        organization_details = COALESCE($3, organization_details)
       WHERE provider_id = $4`,
      [bpp_uri || null, public_key || null, organization_details ? JSON.stringify(organization_details) : null, id]
    );
    if (rowCount === 0) return res.status(404).json({ error: "Provider not found" });
    res.json({ status: "ok", provider_id: id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Agents CRUD ────────────────────────────────────────────────────────

app.get("/api/agents", async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT
       a.agent_id, a.agent_name, a.category_id,
       a.capabilities, a.pricing_model, a.access_point_url,
       a.interaction_type, a.version, a.status,
       a.input_schema, a.output_schema,
       a.created_at, a.updated_at,
       p.provider_id, p.subscriber_id AS provider_name,
       p.trust_score_aggregate AS trust_score
     FROM ai_agents a
     JOIN ai_providers p ON a.provider_id = p.provider_id
     ORDER BY a.created_at DESC`
  );
  res.json(rows);
});

app.post("/api/agents", async (req, res) => {
  const {
    provider_id, category_id, agent_name, access_point_url,
    interaction_type, version, capabilities,
    input_schema, output_schema, pricing_model,
  } = req.body;

  if (!provider_id || !category_id || !agent_name || !access_point_url || !version || !capabilities || !input_schema || !output_schema || !pricing_model) {
    return res.status(400).json({ error: "Missing required fields: provider_id, category_id, agent_name, access_point_url, version, capabilities, input_schema, output_schema, pricing_model" });
  }

  // Validate provider exists
  const { rows: providers } = await pool.query("SELECT 1 FROM ai_providers WHERE provider_id = $1", [provider_id]);
  if (providers.length === 0) {
    return res.status(400).json({ error: `Provider ${provider_id} does not exist. Create it first via POST /api/providers` });
  }

  // Validate category exists
  const { rows: categories } = await pool.query("SELECT 1 FROM categories WHERE category_id = $1", [category_id]);
  if (categories.length === 0) {
    return res.status(400).json({ error: `Category ${category_id} does not exist. Create it first via POST /api/categories` });
  }

  try {
    const { rows: [agent] } = await pool.query(
      `INSERT INTO ai_agents (
        provider_id, category_id, agent_name, access_point_url,
        interaction_type, version, capabilities,
        input_schema, output_schema, pricing_model
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING agent_id`,
      [
        provider_id, category_id, JSON.stringify(agent_name), access_point_url,
        interaction_type || "sync", version, capabilities,
        JSON.stringify(input_schema), JSON.stringify(output_schema), JSON.stringify(pricing_model),
      ]
    );
    res.status(201).json({ status: "ok", agent_id: agent.agent_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/agents/:id", async (req, res) => {
  const { id } = req.params;
  const {
    category_id, agent_name, access_point_url,
    interaction_type, version, capabilities,
    input_schema, output_schema, pricing_model, status,
  } = req.body;

  try {
    const { rowCount } = await pool.query(
      `UPDATE ai_agents SET
        category_id = COALESCE($1, category_id),
        agent_name = COALESCE($2, agent_name),
        access_point_url = COALESCE($3, access_point_url),
        interaction_type = COALESCE($4, interaction_type),
        version = COALESCE($5, version),
        capabilities = COALESCE($6, capabilities),
        input_schema = COALESCE($7, input_schema),
        output_schema = COALESCE($8, output_schema),
        pricing_model = COALESCE($9, pricing_model),
        status = COALESCE($10, status),
        updated_at = NOW()
       WHERE agent_id = $11`,
      [
        category_id || null,
        agent_name ? JSON.stringify(agent_name) : null,
        access_point_url || null,
        interaction_type || null,
        version || null,
        capabilities || null,
        input_schema ? JSON.stringify(input_schema) : null,
        output_schema ? JSON.stringify(output_schema) : null,
        pricing_model ? JSON.stringify(pricing_model) : null,
        status || null,
        id,
      ]
    );
    if (rowCount === 0) return res.status(404).json({ error: "Agent not found" });
    res.json({ status: "ok", agent_id: id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/agents/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await pool.query(
      "UPDATE ai_agents SET status = 'inactive', updated_at = NOW() WHERE agent_id = $1",
      [id]
    );
    if (rowCount === 0) return res.status(404).json({ error: "Agent not found" });
    res.json({ status: "ok", agent_id: id, message: "Agent deactivated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Publish to Fabric ──────────────────────────────────────────────────
// Only reads from DB and publishes catalog. Does NOT create/modify data.
app.post("/api/publish", handlePublish);

// ── Webhook (Beckn actions from ONIX) ──────────────────────────────────

const webhookHandlers = {
  discover: handleDiscover,
  select: handleSelect,
  init: handleInit,
  confirm: handleConfirm,
  on_publish: handleOnPublish,
};

app.post("/api/webhook", async (req, res) => {
  const { context, message } = req.body;

  if (!context?.action) {
    return res.status(400).json({
      message: { ack: { status: "NACK" } },
      error: { code: "40001", message: "Missing context.action" },
    });
  }

  const action = context.action;
  console.log(`[webhook] Received action: ${action} | txnId: ${context.transactionId}`);

  const handler = webhookHandlers[action];
  if (!handler) {
    console.log(`[webhook] Unsupported action: ${action} — returning ACK (no-op)`);
    return res.json({ message: { ack: { status: "ACK" } } });
  }

  res.json({ message: { ack: { status: "ACK" } } });

  try {
    await handler(context, message);
  } catch (err) {
    console.error(`[webhook] Error handling ${action}:`, err.message);
  }
});

// ── Transactions (read-only) ───────────────────────────────────────────

app.get("/api/transactions", async (_req, res) => {
  const { rows } = await pool.query("SELECT * FROM transactions ORDER BY created_at DESC");
  res.json(rows);
});

// ── Start server ───────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[bpp-api] AI Agent Marketplace BPP listening on port ${PORT}`);
  console.log(`[bpp-api] Endpoints:`);
  console.log(`  POST /api/categories      — create category`);
  console.log(`  GET  /api/categories      — list categories`);
  console.log(`  POST /api/providers       — create provider`);
  console.log(`  GET  /api/providers       — list providers`);
  console.log(`  PUT  /api/providers/:id   — update provider`);
  console.log(`  POST /api/agents          — create agent`);
  console.log(`  GET  /api/agents          — list agents`);
  console.log(`  PUT  /api/agents/:id      — update agent`);
  console.log(`  DELETE /api/agents/:id    — deactivate agent`);
  console.log(`  POST /api/publish         — publish catalog to Fabric`);
  console.log(`  POST /api/webhook         — Beckn webhook (ONIX)`);
});
