const axios = require("axios");

const ONIX_BPP_CALLER = process.env.ONIX_BPP_CALLER || "http://onix-bpp:8082/bpp/caller";

/**
 * Build a Beckn on_* response context from the incoming request context.
 */
function buildResponseContext(incomingContext, onAction) {
  return {
    networkId: incomingContext.networkId,
    action: onAction,
    version: incomingContext.version || "2.0.0",
    bapId: incomingContext.bapId,
    bapUri: incomingContext.bapUri,
    bppId: incomingContext.bppId,
    bppUri: incomingContext.bppUri,
    transactionId: incomingContext.transactionId,
    messageId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ttl: "PT30S",
  };
}

/**
 * Send a callback (on_*) through the ONIX BPP caller adapter.
 */
async function sendCallback(onAction, context, message) {
  const url = `${ONIX_BPP_CALLER}/${onAction}`;
  const payload = { context, message };

  console.log(`[beckn] POST ${url}`);
  console.log(`[beckn] payload:`, JSON.stringify(payload, null, 2));

  try {
    const res = await axios.post(url, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 10000,
    });
    console.log(`[beckn] ${onAction} callback sent — status ${res.status}`);
    return res.data;
  } catch (err) {
    console.error(`[beckn] ${onAction} callback failed:`, err.message);
    throw err;
  }
}

/**
 * UUID v4 regex for checking if a string is a valid UUID.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Find an agent by UUID or by descriptor code (e.g. "agent-summarizer-01").
 * Returns the first matching active agent, or null.
 */
async function findAgent(pool, resourceId, extraColumns = "") {
  if (!resourceId) return null;

  const select = `
    SELECT
      a.agent_id            AS id,
      a.agent_name->>'en'   AS name,
      a.category_id         AS category,
      array_to_string(a.capabilities, ', ') AS description,
      a.pricing_model->>'value'    AS price_amount,
      COALESCE(a.pricing_model->>'currency', 'USD') AS price_currency,
      a.access_point_url,
      a.interaction_type,
      p.provider_id,
      p.subscriber_id       AS provider_name,
      p.trust_score_aggregate AS trust_score
    FROM ai_agents a
    JOIN ai_providers p ON a.provider_id = p.provider_id`;

  if (UUID_RE.test(resourceId)) {
    const { rows } = await pool.query(`${select} WHERE a.agent_id = $1`, [resourceId]);
    return rows[0] || null;
  }

  // Fallback: search by descriptor code / category+name pattern
  const search = `%${resourceId}%`;
  const { rows } = await pool.query(
    `${select} WHERE a.status = 'active'
       AND (a.agent_name->>'en' ILIKE $1 OR a.category_id ILIKE $1)
     LIMIT 1`,
    [search]
  );
  return rows[0] || null;
}

module.exports = { buildResponseContext, sendCallback, findAgent };
