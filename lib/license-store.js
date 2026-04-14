const crypto = require("crypto");

const DEFAULT_MAX_ACTIVATIONS = 2;
const KEY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const state =
  globalThis.__PARAX_PRO_LICENSE_STORE__ ||
  {
    licensesByKey: new Map(),
    sessionToLicenseKey: new Map(),
    tokenToActivation: new Map()
  };

globalThis.__PARAX_PRO_LICENSE_STORE__ = state;

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
  const normalizedKey = normalizeLicenseKey(licenseKey);
  if (!normalizedKey) return null;
  return state.licensesByKey.get(normalizedKey) || null;
}

function getLicenseBySessionId(sessionId) {
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedSessionId) return null;
  const existingKey = state.sessionToLicenseKey.get(normalizedSessionId);
  if (!existingKey) return null;
  return state.licensesByKey.get(existingKey) || null;
}

function createLicenseFromSession(options) {
  const sessionId = String((options && options.sessionId) || "").trim();
  const email = String((options && options.email) || "").trim().toLowerCase() || null;
  const requestedMax = Number((options && options.maxActivations) || DEFAULT_MAX_ACTIVATIONS);
  const maxActivations = Number.isFinite(requestedMax) && requestedMax > 0
    ? Math.floor(requestedMax)
    : DEFAULT_MAX_ACTIVATIONS;

  if (!sessionId) {
    throw new Error("sessionId is required to create a license.");
  }

  const existingLicense = getLicenseBySessionId(sessionId);
  if (existingLicense) {
    return existingLicense;
  }

  const licenseKey = createUniqueLicenseKey();
  const license = {
    license_key: licenseKey,
    email: email,
    activations: [],
    activation_tokens: {},
    max_activations: maxActivations,
    session_id: sessionId,
    created_at: new Date().toISOString()
  };

  state.licensesByKey.set(licenseKey, license);
  state.sessionToLicenseKey.set(sessionId, licenseKey);

  return license;
}

function activateLicense(options) {
  const licenseKey = normalizeLicenseKey(options && options.licenseKey);
  const machineId = normalizeMachineId(options && options.machineId);
  const license = getLicenseByKey(licenseKey);

  if (!license) {
    return { ok: false, reason: "invalid_license_key" };
  }

  if (!machineId) {
    return { ok: false, reason: "invalid_machine_id" };
  }

  if (license.activation_tokens[machineId]) {
    return {
      ok: true,
      token: license.activation_tokens[machineId],
      already_activated: true,
      license: license
    };
  }

  if (license.activations.length >= license.max_activations) {
    return { ok: false, reason: "activation_limit_reached", license: license };
  }

  const token = createActivationToken();
  license.activations.push(machineId);
  license.activation_tokens[machineId] = token;

  state.tokenToActivation.set(token, {
    license_key: license.license_key,
    machine_id: machineId,
    created_at: new Date().toISOString()
  });

  return {
    ok: true,
    token: token,
    already_activated: false,
    license: license
  };
}

function checkLicenseToken(options) {
  const token = normalizeToken(options && options.token);
  const machineId = normalizeMachineId(options && options.machineId);

  if (!token) return { valid: false, reason: "missing_token" };
  if (!machineId) return { valid: false, reason: "missing_machine_id" };

  const activation = state.tokenToActivation.get(token);
  if (!activation) return { valid: false, reason: "token_not_found" };
  if (activation.machine_id !== machineId) return { valid: false, reason: "machine_mismatch" };

  const license = getLicenseByKey(activation.license_key);
  if (!license) return { valid: false, reason: "license_not_found" };
  if (license.activation_tokens[machineId] !== token) {
    return { valid: false, reason: "token_revoked" };
  }

  return {
    valid: true,
    license: license
  };
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

module.exports = {
  DEFAULT_MAX_ACTIVATIONS,
  activateLicense,
  checkLicenseToken,
  createLicenseFromSession,
  getLicenseBySessionId,
  licenseResponsePayload
};

