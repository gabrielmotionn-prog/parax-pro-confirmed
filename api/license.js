const crypto = require("crypto");
const { methodNotAllowed, readJsonBody } = require("./_lib/http");

const DEFAULT_MAX_ACTIVATIONS = 2;
const KEY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const state =
  globalThis.__PARAX_PRO_LICENSE_SINGLE_ENDPOINT__ ||
  {
    licensesByKey: new Map(),
    sessionToLicenseKey: new Map(),
    tokenToActivation: new Map()
  };

globalThis.__PARAX_PRO_LICENSE_SINGLE_ENDPOINT__ = state;

function normalizeLicenseKey(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeMachineId(value) {
  return String(value || "").trim();
}

function normalizeToken(value) {
  return String(value || "").trim();
}

function randomKeyChunk(length) {
  let chunk = "";
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i += 1) {
    chunk += KEY_ALPHABET[bytes[i] % KEY_ALPHABET.length];
  }
  return chunk;
}

function createUniqueLicenseKey() {
  let key = "";
  do {
    key =
      "PRX-" +
      randomKeyChunk(4) +
      "-" +
      randomKeyChunk(4) +
      "-" +
      randomKeyChunk(4) +
      "-" +
      randomKeyChunk(4);
  } while (state.licensesByKey.has(key));
  return key;
}

function createActivationToken() {
  return "prx_tok_" + crypto.randomBytes(24).toString("hex");
}

function getLicenseByKey(licenseKey) {
  const key = normalizeLicenseKey(licenseKey);
  if (!key) return null;
  return state.licensesByKey.get(key) || null;
}

function getLicenseBySessionId(sessionId) {
  const id = String(sessionId || "").trim();
  if (!id) return null;
  const key = state.sessionToLicenseKey.get(id);
  if (!key) return null;
  return state.licensesByKey.get(key) || null;
}

function licenseResponsePayload(license) {
  if (!license) return null;
  return {
    license_key: license.license_key,
    email: license.email,
    activations: license.activations.slice(),
    max_activations: license.max_activations,
    remaining_activations: Math.max(license.max_activations - license.activations.length, 0),
    session_id: license.session_id
  };
}

async function fetchStripeCheckoutSession(sessionId, stripeSecretKey) {
  const encodedSessionId = encodeURIComponent(sessionId);
  const url =
    "https://api.stripe.com/v1/checkout/sessions/" +
    encodedSessionId +
    "?expand[]=customer_details";

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: "Bearer " + stripeSecretKey
    }
  });

  const payload = await response.json().catch(function () {
    return {};
  });

  if (!response.ok) {
    let message = "Unable to verify Stripe checkout session.";
    if (payload && payload.error && payload.error.message) {
      message = payload.error.message;
    } else if (payload && payload.message) {
      message = payload.message;
    }
    const error = new Error(message);
    error.statusCode = response.status;
    throw error;
  }

  return payload;
}

async function handleGenerate(body, res) {
  const sessionId = String(body.session_id || "").trim();
  if (!sessionId) {
    return res.status(400).json({ error: "session_id is required." });
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    return res.status(500).json({ error: "Stripe is not configured on the server." });
  }

  try {
    const session = await fetchStripeCheckoutSession(sessionId, stripeSecretKey);
    const paymentStatus = String(session.payment_status || "").toLowerCase();
    const checkoutStatus = String(session.status || "").toLowerCase();

    if (paymentStatus !== "paid" && checkoutStatus !== "complete") {
      return res.status(402).json({
        error: "Payment not completed for this checkout session.",
        payment_status: session.payment_status || null,
        status: session.status || null
      });
    }

    let license = getLicenseBySessionId(session.id);
    const reused = Boolean(license);

    if (!license) {
      const email =
        (session.customer_details && session.customer_details.email) ||
        session.customer_email ||
        null;

      const licenseKey = createUniqueLicenseKey();
      license = {
        license_key: licenseKey,
        email: String(email || "").trim().toLowerCase() || null,
        activations: [],
        activation_tokens: {},
        max_activations: DEFAULT_MAX_ACTIVATIONS,
        session_id: session.id,
        created_at: new Date().toISOString()
      };
      state.licensesByKey.set(licenseKey, license);
      state.sessionToLicenseKey.set(session.id, licenseKey);
    }

    return res.status(200).json({
      ok: true,
      action: "generate",
      reused: reused,
      license: licenseResponsePayload(license)
    });
  } catch (error) {
    const statusCode = Number(error.statusCode) || 500;
    return res.status(statusCode).json({
      error: error.message || "Unable to generate license key."
    });
  }
}

function handleActivate(body, res) {
  const licenseKey = normalizeLicenseKey(body.license_key);
  const machineId = normalizeMachineId(body.machine_id);

  if (!licenseKey) {
    return res.status(400).json({ error: "license_key is required." });
  }
  if (!machineId) {
    return res.status(400).json({ error: "machine_id is required." });
  }

  const license = getLicenseByKey(licenseKey);
  if (!license) {
    return res.status(404).json({ error: "Invalid license key." });
  }

  if (license.activation_tokens[machineId]) {
    return res.status(200).json({
      ok: true,
      action: "activate",
      token: license.activation_tokens[machineId],
      already_activated: true,
      license: licenseResponsePayload(license)
    });
  }

  if (license.activations.length >= license.max_activations) {
    return res.status(409).json({
      error: "Activation limit reached for this license.",
      license: licenseResponsePayload(license)
    });
  }

  const token = createActivationToken();
  license.activations.push(machineId);
  license.activation_tokens[machineId] = token;
  state.tokenToActivation.set(token, {
    license_key: license.license_key,
    machine_id: machineId,
    created_at: new Date().toISOString()
  });

  return res.status(200).json({
    ok: true,
    action: "activate",
    token: token,
    already_activated: false,
    license: licenseResponsePayload(license)
  });
}

function handleCheck(body, res) {
  const token = normalizeToken(body.token);
  const machineId = normalizeMachineId(body.machine_id);

  if (!token) {
    return res.status(400).json({ valid: false, error: "token is required." });
  }
  if (!machineId) {
    return res.status(400).json({ valid: false, error: "machine_id is required." });
  }

  const activation = state.tokenToActivation.get(token);
  if (!activation) {
    return res.status(401).json({
      valid: false,
      error: "License validation failed.",
      reason: "token_not_found"
    });
  }

  if (activation.machine_id !== machineId) {
    return res.status(401).json({
      valid: false,
      error: "License validation failed.",
      reason: "machine_mismatch"
    });
  }

  const license = getLicenseByKey(activation.license_key);
  if (!license) {
    return res.status(401).json({
      valid: false,
      error: "License validation failed.",
      reason: "license_not_found"
    });
  }

  if (license.activation_tokens[machineId] !== token) {
    return res.status(401).json({
      valid: false,
      error: "License validation failed.",
      reason: "token_revoked"
    });
  }

  return res.status(200).json({
    valid: true,
    action: "check",
    license: licenseResponsePayload(license)
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return methodNotAllowed(res, "POST");
  }

  const body = readJsonBody(req);
  const action = String(body.action || "").trim().toLowerCase();

  if (action === "generate") {
    return handleGenerate(body, res);
  }
  if (action === "activate") {
    return handleActivate(body, res);
  }
  if (action === "check") {
    return handleCheck(body, res);
  }

  return res.status(400).json({
    error: "Invalid action. Use: generate, activate, or check."
  });
};

