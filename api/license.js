const crypto = require("crypto");
const { methodNotAllowed, readJsonBody } = require("../lib/http");

const STRIPE_API_BASE = "https://api.stripe.com/v1";
const MERCADOPAGO_API_BASE = "https://api.mercadopago.com";
const PAYPAL_API_BASE = {
  live: "https://api-m.paypal.com",
  sandbox: "https://api-m.sandbox.paypal.com"
};
const LICENSE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DEFAULT_MAX_ACTIVATIONS = 2;
const MAX_SESSION_SCAN_PAGES = 20;

const META = {
  LICENSE_KEY: "parax_license_key",
  LICENSE_EMAIL: "parax_license_email",
  LICENSE_MAX: "parax_license_max",
  EMAIL_SENT_AT: "parax_license_email_sent_at",
  EMAIL_SENT_ID: "parax_license_email_sent_id",
  MACHINE_PREFIX: "parax_machine_",
  TOKEN_PREFIX: "parax_token_",
  ACTIVATED_AT_PREFIX: "parax_activated_at_"
};

const LICENSE_SIGNING_SECRET =
  process.env.LICENSE_SIGNING_SECRET ||
  process.env.STRIPE_SECRET_KEY ||
  "";

function normalizeString(value) {
  return String(value || "").trim();
}

function normalizeAction(value) {
  return normalizeString(value).toLowerCase();
}

function normalizeLicenseKey(value) {
  return normalizeString(value).toUpperCase();
}

function normalizeMachineId(value) {
  return normalizeString(value);
}

function normalizeToken(value) {
  return normalizeString(value);
}

function normalizePaymentId(value) {
  return normalizeString(value).replace(/[^\d]/g, "");
}

function normalizeLanguage(value) {
  const lang = normalizeString(value).toLowerCase();
  if (lang === "pt" || lang === "es" || lang === "en") {
    return lang;
  }
  return "en";
}

function getPublicBaseUrl() {
  return (
    process.env.SITE_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    "https://www.paraxpro.com"
  )
    .toString()
    .replace(/\/+$/, "");
}

function hasMercadoPagoConfigured() {
  return Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN);
}

function hasPayPalConfigured() {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

function getPayPalApiBase() {
  const mode = normalizeAction(process.env.PAYPAL_MODE || process.env.PAYPAL_ENV || "live");
  return mode === "sandbox" ? PAYPAL_API_BASE.sandbox : PAYPAL_API_BASE.live;
}

async function sendLicenseEmail(email, licenseKey, options) {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    const error = new Error("RESEND_API_KEY is not configured.");
    error.statusCode = 500;
    throw error;
  }

  const normalizedEmail = normalizeString(email).toLowerCase();
  const normalizedLicense = normalizeLicenseKey(licenseKey);
  if (!normalizedEmail) {
    const error = new Error("Customer email is required.");
    error.statusCode = 400;
    throw error;
  }
  if (!normalizedLicense) {
    const error = new Error("License key is required.");
    error.statusCode = 400;
    throw error;
  }

  const supportFromEmail =
    process.env.SUPPORT_FROM_EMAIL || "Parax Pro <onboarding@resend.dev>";
  const baseUrl = getPublicBaseUrl();
  const emailLanguage = normalizeLanguage(options && options.language);
  const activateUrl =
    baseUrl + "/email-sent.html?lang=" + encodeURIComponent(emailLanguage);
  const windowsDownloadUrl = baseUrl + "/downloads/ParaX%20Pro%20Installer.exe";
  const macDownloadUrl = baseUrl + "/downloads/ParaX%20Pro%20Mac%20Installer.zip";

  const headers = {
    Authorization: "Bearer " + resendApiKey,
    "Content-Type": "application/json"
  };

  const idempotencyKey = normalizeString(options && options.idempotencyKey);
  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: headers,
    body: JSON.stringify({
      from: supportFromEmail,
      to: [normalizedEmail],
      subject: "Your Parax Pro License Key",
      text:
        "Thanks for purchasing Parax Pro.\n\n" +
        "Your license key:\n" +
        normalizedLicense +
        "\n\n" +
        "Download links:\n" +
        "Windows: " + windowsDownloadUrl + "\n" +
        "Mac: " + macDownloadUrl + "\n\n" +
        "Mac package includes ParaX Pro.jsxbin and install instructions.\n" +
        "Mac quick start: copy ParaX Pro.jsxbin to ScriptUI Panels, restart After Effects, then open Window > ParaX Pro.\n\n" +
        "Use this key to activate your plugin.\n" +
        "Activation page: " + activateUrl,
      html:
        "<p>Thanks for purchasing <strong>Parax Pro</strong>.</p>" +
        "<p>Your license key:</p>" +
        "<p style=\"font-size:20px;font-weight:700;letter-spacing:1px;\">" + normalizedLicense + "</p>" +
        "<p><strong>Download links:</strong></p>" +
        "<p><a href=\"" + windowsDownloadUrl + "\">Download for Windows</a><br>" +
        "<a href=\"" + macDownloadUrl + "\">Download for Mac</a></p>" +
        "<p><strong>Mac package:</strong> includes <code>ParaX Pro.jsxbin</code> and step-by-step install instructions.</p>" +
        "<p><strong>Mac quick start:</strong> copy <code>ParaX Pro.jsxbin</code> to ScriptUI Panels, restart After Effects, then open Window &gt; ParaX Pro.</p>" +
        "<p>Use this key to activate your plugin.</p>" +
        "<p><a href=\"" + activateUrl + "\">Open activation page</a></p>"
    })
  });

  const payload = await response.json().catch(function () {
    return {};
  });

  if (!response.ok) {
    const message =
      (payload && Array.isArray(payload.errors) && payload.errors[0] && payload.errors[0].message) ||
      payload.message ||
      "Unable to send license email.";
    const error = new Error(message);
    error.statusCode = 502;
    throw error;
  }

  return normalizeString(payload && payload.id);
}

function getMercadoPagoToken() {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) {
    const error = new Error("Mercado Pago is not configured on the server.");
    error.statusCode = 500;
    throw error;
  }
  return token;
}

function hmacHex(value) {
  if (!LICENSE_SIGNING_SECRET) {
    const error = new Error("LICENSE_SIGNING_SECRET is not configured.");
    error.statusCode = 500;
    throw error;
  }
  return crypto
    .createHmac("sha256", LICENSE_SIGNING_SECRET)
    .update(String(value || ""), "utf8")
    .digest("hex")
    .toUpperCase();
}

function makeMercadoPagoLicenseKey(paymentId) {
  const normalizedPaymentId = normalizePaymentId(paymentId);
  if (!normalizedPaymentId) return "";
  const encoded = Number(normalizedPaymentId).toString(36).toUpperCase();
  const sig = hmacHex("mp:" + normalizedPaymentId).slice(0, 8);
  return "PRX-MP" + encoded + "-" + sig;
}

function parseMercadoPagoLicenseKey(key) {
  const normalized = normalizeLicenseKey(key);
  const match = /^PRX-MP([A-Z0-9]+)-([A-Z0-9]{8})$/.exec(normalized);
  if (!match) return null;

  const encoded = match[1];
  const providedSig = match[2];
  const decoded = parseInt(encoded, 36);
  if (!Number.isFinite(decoded) || decoded <= 0) return null;
  const paymentId = String(decoded);
  const expectedSig = hmacHex("mp:" + paymentId).slice(0, 8);
  if (providedSig !== expectedSig) return null;

  return {
    key: normalized,
    paymentId: paymentId
  };
}

function createMercadoPagoActivationToken(paymentId, machineId) {
  const normalizedPaymentId = normalizePaymentId(paymentId);
  const normalizedMachineId = normalizeMachineId(machineId);
  if (!normalizedPaymentId || !normalizedMachineId) return "";
  const signature = hmacHex("mptok:" + normalizedPaymentId + ":" + normalizedMachineId).slice(0, 24);
  return "prx_mptok2__" + normalizedPaymentId + "__" + signature;
}

function parseMercadoPagoActivationToken(token) {
  const value = normalizeToken(token);

  // Stateless token format (current)
  const stateless = /^prx_mptok2__(\d+)__([A-F0-9]{24})$/i.exec(value);
  if (stateless) {
    return {
      version: 2,
      paymentId: stateless[1],
      signature: String(stateless[2] || "").toUpperCase()
    };
  }

  // Legacy token format (metadata-backed)
  const legacy = /^prx_mptok__(\d+)__[a-f0-9]+$/i.exec(value);
  if (legacy) {
    return {
      version: 1,
      paymentId: legacy[1]
    };
  }

  return null;
}

function randomKeyChunk(size) {
  let chunk = "";
  const bytes = crypto.randomBytes(size);
  for (let i = 0; i < size; i += 1) {
    chunk += LICENSE_ALPHABET[bytes[i] % LICENSE_ALPHABET.length];
  }
  return chunk;
}

function createLicenseKey() {
  return (
    "PRX-" +
    randomKeyChunk(4) +
    "-" +
    randomKeyChunk(4) +
    "-" +
    randomKeyChunk(4) +
    "-" +
    randomKeyChunk(4)
  );
}

function createActivationToken(sessionId) {
  const safeSessionId = normalizeString(sessionId).replace(/[^a-zA-Z0-9_]/g, "");
  const rand = crypto.randomBytes(10).toString("hex");
  return "prx_tok__" + safeSessionId + "__" + rand;
}

function extractSessionIdFromToken(token) {
  const value = normalizeToken(token);
  const match = /^prx_tok__([a-zA-Z0-9_]+)__[a-f0-9]+$/.exec(value);
  return match ? match[1] : "";
}

function getMaxActivations(metadata) {
  const raw = Number(metadata && metadata[META.LICENSE_MAX]);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  return DEFAULT_MAX_ACTIVATIONS;
}

function getActivationSlots(metadata, maxActivations) {
  const slots = [];
  for (let i = 1; i <= maxActivations; i += 1) {
    slots.push({
      index: i,
      machineId: normalizeString(metadata[META.MACHINE_PREFIX + i]),
      token: normalizeString(metadata[META.TOKEN_PREFIX + i]),
      activatedAt: normalizeString(metadata[META.ACTIVATED_AT_PREFIX + i])
    });
  }
  return slots;
}

function buildLicensePayload(session, metadata) {
  const maxActivations = getMaxActivations(metadata);
  const slots = getActivationSlots(metadata, maxActivations);
  const activations = slots.filter(function (slot) {
    return Boolean(slot.machineId);
  }).map(function (slot) {
    return slot.machineId;
  });

  const email =
    normalizeString(metadata[META.LICENSE_EMAIL]) ||
    normalizeString(
      session &&
        session.customer_details &&
        session.customer_details.email
    ) ||
    normalizeString(session && session.customer_email) ||
    null;

  return {
    license_key: normalizeLicenseKey(metadata[META.LICENSE_KEY]),
    email: email || null,
    activations: activations,
    max_activations: maxActivations,
    remaining_activations: Math.max(maxActivations - activations.length, 0),
    session_id: normalizeString(session && session.id) || null
  };
}

function isSessionPaid(session) {
  const paymentStatus = normalizeAction(session && session.payment_status);
  const status = normalizeAction(session && session.status);
  return paymentStatus === "paid" || status === "complete";
}

function toFormBody(data) {
  const form = new URLSearchParams();
  Object.keys(data || {}).forEach(function (key) {
    const value = data[key];
    if (value === undefined || value === null) return;

    if (key === "metadata" && typeof value === "object") {
      Object.keys(value).forEach(function (metaKey) {
        const metaValue = value[metaKey];
        if (metaValue === undefined || metaValue === null) return;
        form.append("metadata[" + metaKey + "]", String(metaValue));
      });
      return;
    }

    form.append(key, String(value));
  });
  return form.toString();
}

async function stripeRequest(params) {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    const error = new Error("Stripe is not configured on the server.");
    error.statusCode = 500;
    throw error;
  }

  const method = params.method || "GET";
  const path = params.path || "/";
  const query = params.query || null;
  const body = params.body || null;

  const queryString = query
    ? "?" +
      Object.keys(query)
        .filter(function (key) {
          return query[key] !== undefined && query[key] !== null && query[key] !== "";
        })
        .map(function (key) {
          return encodeURIComponent(key) + "=" + encodeURIComponent(String(query[key]));
        })
        .join("&")
    : "";

  const url = STRIPE_API_BASE + path + queryString;

  const headers = {
    Authorization: "Bearer " + stripeSecretKey
  };

  const fetchOptions = {
    method: method,
    headers: headers
  };

  if (method !== "GET" && body) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    fetchOptions.body = toFormBody(body);
  }

  const response = await fetch(url, fetchOptions);
  const payload = await response.json().catch(function () {
    return {};
  });

  if (!response.ok) {
    const stripeMessage =
      payload &&
      payload.error &&
      payload.error.message;
    const message = stripeMessage || "Stripe request failed.";
    const error = new Error(message);
    error.statusCode = response.status;
    error.stripePayload = payload;
    throw error;
  }

  return payload;
}

async function getCheckoutSession(sessionId) {
  return stripeRequest({
    method: "GET",
    path: "/checkout/sessions/" + encodeURIComponent(sessionId),
    query: { "expand[]": "customer_details" }
  });
}

async function updateCheckoutSessionMetadata(sessionId, metadataPatch) {
  return stripeRequest({
    method: "POST",
    path: "/checkout/sessions/" + encodeURIComponent(sessionId),
    body: { metadata: metadataPatch }
  });
}

async function mercadoPagoRequest(params) {
  const token = getMercadoPagoToken();
  const method = (params.method || "GET").toUpperCase();
  const path = params.path || "/";
  const body = params.body || null;
  const query = params.query || null;

  const queryString = query
    ? "?" +
      Object.keys(query)
        .filter(function (key) {
          return query[key] !== undefined && query[key] !== null && query[key] !== "";
        })
        .map(function (key) {
          return encodeURIComponent(key) + "=" + encodeURIComponent(String(query[key]));
        })
        .join("&")
    : "";

  const url = MERCADOPAGO_API_BASE + path + queryString;
  const headers = {
    Authorization: "Bearer " + token
  };
  if (method !== "GET") {
    headers["X-Idempotency-Key"] =
      normalizeString(params.idempotencyKey) ||
      ("parax-license-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10));
  }
  const fetchOptions = {
    method: method,
    headers: headers
  };

  if (method !== "GET" && body) {
    headers["Content-Type"] = "application/json";
    fetchOptions.body = JSON.stringify(body);
  }

  const response = await fetch(url, fetchOptions);
  const payload = await response.json().catch(function () {
    return {};
  });

  if (!response.ok) {
    const message =
      (payload && payload.message) ||
      (payload && payload.error) ||
      "Mercado Pago request failed.";
    const error = new Error(message);
    error.statusCode = response.status;
    throw error;
  }

  return payload;
}

async function getMercadoPagoPayment(paymentId) {
  return mercadoPagoRequest({
    method: "GET",
    path: "/v1/payments/" + encodeURIComponent(paymentId)
  });
}

async function updateMercadoPagoPaymentMetadata(paymentId, metadataPatch) {
  const payment = await getMercadoPagoPayment(paymentId);
  const currentMetadata = (payment && payment.metadata) || {};
  const mergedMetadata = Object.assign({}, currentMetadata, metadataPatch || {});

  return mercadoPagoRequest({
    method: "PUT",
    path: "/v1/payments/" + encodeURIComponent(paymentId),
    body: { metadata: mergedMetadata }
  });
}

function normalizePayPalCaptureId(value) {
  return normalizeString(value).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function parsePayPalCustomId(customId) {
  const raw = normalizeString(customId);
  const output = {
    email: "",
    language: "en"
  };
  if (!raw) return output;
  const parts = raw.split("|");
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (part.indexOf("e:") === 0) {
      try {
        output.email = normalizeString(decodeURIComponent(part.slice(2))).toLowerCase();
      } catch (error) {
        output.email = normalizeString(part.slice(2)).toLowerCase();
      }
      continue;
    }
    if (part.indexOf("l:") === 0) {
      output.language = normalizeLanguage(part.slice(2));
    }
  }
  return output;
}

function extractPayPalPayerEmail(capture) {
  return (
    normalizeString(
      capture &&
        capture.payer &&
        capture.payer.email_address
    ).toLowerCase() ||
    normalizeString(
      capture &&
        capture.payment_source &&
        capture.payment_source.paypal &&
        capture.payment_source.paypal.email_address
    ).toLowerCase()
  );
}

async function getPayPalAccessToken() {
  if (!hasPayPalConfigured()) {
    const error = new Error("PayPal is not configured on the server.");
    error.statusCode = 500;
    throw error;
  }

  const credentials = Buffer.from(
    normalizeString(process.env.PAYPAL_CLIENT_ID) +
      ":" +
      normalizeString(process.env.PAYPAL_CLIENT_SECRET)
  ).toString("base64");

  const response = await fetch(getPayPalApiBase() + "/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + credentials,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: "grant_type=client_credentials"
  });

  const payload = await response.json().catch(function () {
    return {};
  });

  if (!response.ok || !payload.access_token) {
    const message =
      normalizeString(payload && payload.error_description) ||
      normalizeString(payload && payload.error) ||
      "Unable to authenticate with PayPal.";
    const error = new Error(message);
    error.statusCode = response.status || 502;
    throw error;
  }

  return String(payload.access_token);
}

async function paypalRequest(params) {
  const token = normalizeString(params && params.token) || (await getPayPalAccessToken());
  const method = normalizeString(params && params.method).toUpperCase() || "GET";
  const path = normalizeString(params && params.path) || "/";
  const headers = Object.assign(
    {
      Authorization: "Bearer " + token,
      Accept: "application/json"
    },
    (params && params.headers) || {}
  );

  const fetchOptions = {
    method: method,
    headers: headers
  };

  if (method !== "GET" && params && params.body) {
    headers["Content-Type"] = "application/json";
    fetchOptions.body = JSON.stringify(params.body);
  }

  const response = await fetch(getPayPalApiBase() + path, fetchOptions);
  const payload = await response.json().catch(function () {
    return {};
  });

  if (!response.ok) {
    const details =
      payload &&
      Array.isArray(payload.details) &&
      payload.details[0] &&
      payload.details[0].issue;
    const message =
      normalizeString(payload && payload.message) ||
      normalizeString(details) ||
      "PayPal request failed.";
    const error = new Error(message);
    error.statusCode = response.status || 502;
    error.paypalPayload = payload;
    throw error;
  }

  return payload;
}

async function getPayPalCapture(captureId) {
  return paypalRequest({
    method: "GET",
    path: "/v2/payments/captures/" + encodeURIComponent(captureId)
  });
}

function payPalCaptureIsCompleted(capture) {
  return normalizeAction(capture && capture.status) === "completed";
}

function makePayPalLicenseKey(captureId) {
  const normalizedCaptureId = normalizePayPalCaptureId(captureId);
  if (!normalizedCaptureId) return "";
  const signature = hmacHex("pp:" + normalizedCaptureId).slice(0, 8);
  return "PRX-PP" + normalizedCaptureId + "-" + signature;
}

function parsePayPalLicenseKey(key) {
  const normalized = normalizeLicenseKey(key);
  const match = /^PRX-PP([A-Z0-9]{8,40})-([A-Z0-9]{8})$/.exec(normalized);
  if (!match) return null;

  const captureId = match[1];
  const providedSig = match[2];
  const expectedSig = hmacHex("pp:" + captureId).slice(0, 8);
  if (providedSig !== expectedSig) return null;

  return {
    key: normalized,
    captureId: captureId
  };
}

function createPayPalActivationToken(captureId, machineId) {
  const normalizedCaptureId = normalizePayPalCaptureId(captureId);
  const normalizedMachineId = normalizeMachineId(machineId);
  if (!normalizedCaptureId || !normalizedMachineId) return "";
  const signature = hmacHex("pptok:" + normalizedCaptureId + ":" + normalizedMachineId).slice(0, 24);
  return "prx_pptok2__" + normalizedCaptureId + "__" + signature;
}

function parsePayPalActivationToken(token) {
  const value = normalizeToken(token);
  const match = /^prx_pptok2__([A-Z0-9]{8,40})__([A-F0-9]{24})$/i.exec(value);
  if (!match) return null;
  return {
    version: 2,
    captureId: normalizePayPalCaptureId(match[1]),
    signature: String(match[2] || "").toUpperCase()
  };
}

function buildPayPalLicensePayload(capture, options) {
  const captureId =
    normalizePayPalCaptureId(capture && capture.id) ||
    normalizePayPalCaptureId(options && options.captureId);
  const custom = parsePayPalCustomId(capture && capture.custom_id);
  const email =
    normalizeString(options && options.email).toLowerCase() ||
    custom.email ||
    extractPayPalPayerEmail(capture) ||
    null;
  const licenseKey =
    normalizeLicenseKey(options && options.licenseKey) ||
    makePayPalLicenseKey(captureId);
  const machineId = normalizeMachineId(options && options.machineId);
  const activations = machineId ? [machineId] : [];

  return {
    license_key: licenseKey,
    email: email || null,
    activations: activations,
    max_activations: DEFAULT_MAX_ACTIVATIONS,
    remaining_activations: Math.max(DEFAULT_MAX_ACTIVATIONS - activations.length, 0),
    session_id: captureId || null
  };
}

function mercadoPagoPaymentIsApproved(payment) {
  return normalizeAction(payment && payment.status) === "approved";
}

function buildMercadoPagoLicensePayload(payment, metadata) {
  const maxActivations = getMaxActivations(metadata);
  const slots = getActivationSlots(metadata, maxActivations);
  const activations = slots
    .filter(function (slot) {
      return Boolean(slot.machineId);
    })
    .map(function (slot) {
      return slot.machineId;
    });

  const paymentId = normalizePaymentId(payment && payment.id);
  const fallbackKey = paymentId ? makeMercadoPagoLicenseKey(paymentId) : "";
  const licenseKey = normalizeLicenseKey(metadata[META.LICENSE_KEY]) || fallbackKey;
  const email =
    normalizeString(metadata[META.LICENSE_EMAIL]) ||
    normalizeString(metadata && metadata.payer_email) ||
    normalizeString(payment && payment.payer && payment.payer.email) ||
    null;

  return {
    license_key: licenseKey,
    email: email || null,
    activations: activations,
    max_activations: maxActivations,
    remaining_activations: Math.max(maxActivations - activations.length, 0),
    session_id: paymentId || null
  };
}

async function findSessionByLicenseKey(licenseKey) {
  let startingAfter = "";

  for (let page = 0; page < MAX_SESSION_SCAN_PAGES; page += 1) {
    const pageData = await stripeRequest({
      method: "GET",
      path: "/checkout/sessions",
      query: {
        limit: 100,
        starting_after: startingAfter || undefined
      }
    });

    const sessions = Array.isArray(pageData.data) ? pageData.data : [];
    for (let i = 0; i < sessions.length; i += 1) {
      const session = sessions[i];
      const metadata = session && session.metadata ? session.metadata : {};
      if (
        normalizeLicenseKey(metadata[META.LICENSE_KEY]) === normalizeLicenseKey(licenseKey)
      ) {
        return session;
      }
    }

    if (!pageData.has_more || sessions.length === 0) {
      break;
    }

    startingAfter = sessions[sessions.length - 1].id;
  }

  return null;
}

async function findSessionByToken(token) {
  let startingAfter = "";

  for (let page = 0; page < MAX_SESSION_SCAN_PAGES; page += 1) {
    const pageData = await stripeRequest({
      method: "GET",
      path: "/checkout/sessions",
      query: {
        limit: 100,
        starting_after: startingAfter || undefined
      }
    });

    const sessions = Array.isArray(pageData.data) ? pageData.data : [];
    for (let i = 0; i < sessions.length; i += 1) {
      const session = sessions[i];
      const metadata = session && session.metadata ? session.metadata : {};
      const maxActivations = getMaxActivations(metadata);
      for (let slotIndex = 1; slotIndex <= maxActivations; slotIndex += 1) {
        if (normalizeToken(metadata[META.TOKEN_PREFIX + slotIndex]) === normalizeToken(token)) {
          return session;
        }
      }
    }

    if (!pageData.has_more || sessions.length === 0) {
      break;
    }

    startingAfter = sessions[sessions.length - 1].id;
  }

  return null;
}

async function handleGenerateStripe(sessionId) {
  const session = await getCheckoutSession(sessionId);
  if (!isSessionPaid(session)) {
    return {
      statusCode: 402,
      payload: {
        error: "Payment not completed for this checkout session.",
        payment_status: session.payment_status || null,
        status: session.status || null
      }
    };
  }

  const metadata = session.metadata || {};
  let licenseKey = normalizeLicenseKey(metadata[META.LICENSE_KEY]);
  const reused = Boolean(licenseKey);

  if (!licenseKey) {
    licenseKey = createLicenseKey();
    const email =
      normalizeString(
        session &&
          session.customer_details &&
          session.customer_details.email
      ) ||
      normalizeString(session && session.customer_email) ||
      "";

    const updatedSession = await updateCheckoutSessionMetadata(session.id, {
      [META.LICENSE_KEY]: licenseKey,
      [META.LICENSE_MAX]: String(DEFAULT_MAX_ACTIVATIONS),
      [META.LICENSE_EMAIL]: email
    });

    session.metadata = updatedSession.metadata || {};
  }

  const activeMetadata = session.metadata || {};
  const customerEmail =
    normalizeString(activeMetadata[META.LICENSE_EMAIL]) ||
    normalizeString(session && session.customer_email) ||
    normalizeString(
      session &&
        session.customer_details &&
        session.customer_details.email
    );
  const alreadySentAt = normalizeString(activeMetadata[META.EMAIL_SENT_AT]);
  let emailDelivery = alreadySentAt ? "already_sent" : "skipped";

  if (customerEmail && !alreadySentAt) {
    try {
      const emailId = await sendLicenseEmail(customerEmail, licenseKey, {
        idempotencyKey: "parax-license-email-stripe-" + normalizeString(session.id),
        language: normalizeLanguage(activeMetadata.parax_lang)
      });
      const updatedSession = await updateCheckoutSessionMetadata(session.id, {
        [META.EMAIL_SENT_AT]: new Date().toISOString(),
        [META.EMAIL_SENT_ID]: emailId,
        [META.LICENSE_EMAIL]: customerEmail
      });
      session.metadata = updatedSession.metadata || activeMetadata;
      emailDelivery = "sent";
    } catch (error) {
      emailDelivery = "failed";
    }
  }

  const payload = buildLicensePayload(session, session.metadata || activeMetadata);
  return {
    statusCode: 200,
    payload: {
      ok: true,
      reused: reused,
      email_delivery: emailDelivery,
      license: payload
    }
  };
}

async function handleGenerateMercadoPago(paymentId) {
  const normalizedPaymentId = normalizePaymentId(paymentId);
  if (!normalizedPaymentId) {
    return {
      statusCode: 400,
      payload: {
        error: "payment_id is required."
      }
    };
  }

  const payment = await getMercadoPagoPayment(normalizedPaymentId);
  if (!mercadoPagoPaymentIsApproved(payment)) {
    return {
      statusCode: 402,
      payload: {
        error: "Payment not completed for this PIX payment.",
        payment_status: normalizeAction(payment && payment.status) || null
      }
    };
  }

  const metadata = (payment && payment.metadata) || {};
  const existingKey = normalizeLicenseKey(metadata[META.LICENSE_KEY]);
  const email =
    normalizeString(metadata[META.LICENSE_EMAIL]) ||
    normalizeString(metadata.payer_email) ||
    normalizeString(payment && payment.payer && payment.payer.email) ||
    "";
  const licenseKey = existingKey || makeMercadoPagoLicenseKey(normalizedPaymentId);
  const effectiveMetadata = Object.assign({}, metadata, {
    [META.LICENSE_KEY]: licenseKey,
    [META.LICENSE_MAX]: normalizeString(metadata[META.LICENSE_MAX]) || String(DEFAULT_MAX_ACTIVATIONS),
    [META.LICENSE_EMAIL]: email
  });
  let emailDelivery = normalizeString(metadata[META.EMAIL_SENT_AT]) ? "already_sent" : "skipped";

  if (email && !normalizeString(metadata[META.EMAIL_SENT_AT])) {
    try {
      const emailId = await sendLicenseEmail(email, licenseKey, {
        idempotencyKey: "parax-license-email-mp-" + normalizedPaymentId,
        language: normalizeLanguage(metadata.parax_lang)
      });
      if (emailId) {
        emailDelivery = "sent";
      } else {
        emailDelivery = "sent";
      }
    } catch (error) {
      emailDelivery = "failed";
    }
  }

  return {
    statusCode: 200,
    payload: {
      ok: true,
      reused: Boolean(existingKey),
      source: "mercadopago",
      payment_id: normalizedPaymentId,
      email_delivery: emailDelivery,
      license: buildMercadoPagoLicensePayload(payment, effectiveMetadata)
    }
  };
}

async function handleGeneratePayPal(paymentId) {
  const captureId = normalizePayPalCaptureId(paymentId);
  if (!captureId) {
    return {
      statusCode: 400,
      payload: {
        error: "Invalid PayPal capture id."
      }
    };
  }

  const capture = await getPayPalCapture(captureId);
  if (!payPalCaptureIsCompleted(capture)) {
    return {
      statusCode: 402,
      payload: {
        error: "Payment not completed for this PayPal capture.",
        payment_status: normalizeAction(capture && capture.status) || null
      }
    };
  }

  const custom = parsePayPalCustomId(capture && capture.custom_id);
  const email = custom.email || extractPayPalPayerEmail(capture) || "";
  const licenseKey = makePayPalLicenseKey(captureId);
  const language = normalizeLanguage(custom.language);
  let emailDelivery = "skipped";

  if (email) {
    try {
      await sendLicenseEmail(email, licenseKey, {
        idempotencyKey: "parax-license-email-paypal-" + captureId,
        language: language
      });
      emailDelivery = "sent";
    } catch (error) {
      emailDelivery = "failed";
    }
  }

  return {
    statusCode: 200,
    payload: {
      ok: true,
      reused: true,
      source: "paypal",
      payment_id: captureId,
      email_delivery: emailDelivery,
      license: buildPayPalLicensePayload(capture, {
        captureId: captureId,
        email: email,
        licenseKey: licenseKey
      })
    }
  };
}

async function handleActivate(licenseKey, machineId) {
  const normalizedKey = normalizeLicenseKey(licenseKey);
  const normalizedMachine = normalizeMachineId(machineId);

  if (!normalizedKey) {
    return { statusCode: 400, payload: { error: "license_key is required." } };
  }
  if (!normalizedMachine) {
    return { statusCode: 400, payload: { error: "machine_id is required." } };
  }

  // 1) Stripe-backed licenses
  const sessionSummary = await findSessionByLicenseKey(normalizedKey);
  if (sessionSummary) {
    const session = await getCheckoutSession(sessionSummary.id);
    if (!isSessionPaid(session)) {
      return { statusCode: 402, payload: { error: "Payment not completed for this license." } };
    }

    const metadata = session.metadata || {};
    const maxActivations = getMaxActivations(metadata);
    const slots = getActivationSlots(metadata, maxActivations);

    for (let i = 0; i < slots.length; i += 1) {
      const slot = slots[i];
      if (slot.machineId === normalizedMachine) {
        const existingToken = slot.token || createActivationToken(session.id);
        if (!slot.token) {
          await updateCheckoutSessionMetadata(session.id, {
            [META.TOKEN_PREFIX + slot.index]: existingToken,
            [META.ACTIVATED_AT_PREFIX + slot.index]: slot.activatedAt || new Date().toISOString()
          });
          metadata[META.TOKEN_PREFIX + slot.index] = existingToken;
        }
        return {
          statusCode: 200,
          payload: {
            ok: true,
            token: existingToken,
            already_activated: true,
            license: buildLicensePayload(session, metadata)
          }
        };
      }
    }

    const usedSlots = slots.filter(function (slot) {
      return Boolean(slot.machineId);
    });
    if (usedSlots.length >= maxActivations) {
      return {
        statusCode: 409,
        payload: {
          error: "Activation limit reached for this license.",
          license: buildLicensePayload(session, metadata)
        }
      };
    }

    const freeSlot = slots.find(function (slot) {
      return !slot.machineId;
    });

    if (!freeSlot) {
      return {
        statusCode: 409,
        payload: {
          error: "Activation limit reached for this license.",
          license: buildLicensePayload(session, metadata)
        }
      };
    }

    const newToken = createActivationToken(session.id);
    const activatedAt = new Date().toISOString();
    const patch = {};
    patch[META.MACHINE_PREFIX + freeSlot.index] = normalizedMachine;
    patch[META.TOKEN_PREFIX + freeSlot.index] = newToken;
    patch[META.ACTIVATED_AT_PREFIX + freeSlot.index] = activatedAt;

    const updatedSession = await updateCheckoutSessionMetadata(session.id, patch);
    const updatedMetadata = updatedSession.metadata || metadata;

    return {
      statusCode: 200,
      payload: {
        ok: true,
        token: newToken,
        already_activated: false,
        license: buildLicensePayload(updatedSession, updatedMetadata)
      }
    };
  }

  // 2) Mercado Pago backed licenses
  if (hasMercadoPagoConfigured()) {
    const parsedMp = parseMercadoPagoLicenseKey(normalizedKey);
    if (parsedMp) {
      const payment = await getMercadoPagoPayment(parsedMp.paymentId);
      if (!mercadoPagoPaymentIsApproved(payment)) {
        return { statusCode: 402, payload: { error: "Payment not completed for this license." } };
      }

      const metadata = (payment && payment.metadata) || {};
      const currentKey = normalizeLicenseKey(metadata[META.LICENSE_KEY]);
      if (currentKey && currentKey !== normalizedKey) {
        return { statusCode: 404, payload: { error: "Invalid license key." } };
      }

      const token = createMercadoPagoActivationToken(parsedMp.paymentId, normalizedMachine);
      if (!token) {
        return { statusCode: 500, payload: { error: "Unable to create activation token." } };
      }
      const responseMetadata = Object.assign({}, metadata, {
        [META.LICENSE_KEY]: currentKey || normalizedKey,
        [META.LICENSE_MAX]: normalizeString(metadata[META.LICENSE_MAX]) || String(DEFAULT_MAX_ACTIVATIONS),
        [META.LICENSE_EMAIL]:
          normalizeString(metadata[META.LICENSE_EMAIL]) ||
          normalizeString(payment && payment.payer && payment.payer.email) ||
          "",
        [META.MACHINE_PREFIX + "1"]: normalizedMachine,
        [META.TOKEN_PREFIX + "1"]: token,
        [META.ACTIVATED_AT_PREFIX + "1"]: new Date().toISOString()
      });

      return {
        statusCode: 200,
        payload: {
          ok: true,
          token: token,
          already_activated: true,
          license: buildMercadoPagoLicensePayload(payment, responseMetadata)
        }
      };
    }
  }

  // 3) PayPal-backed licenses
  if (hasPayPalConfigured()) {
    const parsedPaypal = parsePayPalLicenseKey(normalizedKey);
    if (parsedPaypal) {
      const capture = await getPayPalCapture(parsedPaypal.captureId);
      if (!payPalCaptureIsCompleted(capture)) {
        return { statusCode: 402, payload: { error: "Payment not completed for this license." } };
      }

      const token = createPayPalActivationToken(parsedPaypal.captureId, normalizedMachine);
      if (!token) {
        return { statusCode: 500, payload: { error: "Unable to create activation token." } };
      }

      return {
        statusCode: 200,
        payload: {
          ok: true,
          token: token,
          already_activated: true,
          license: buildPayPalLicensePayload(capture, {
            captureId: parsedPaypal.captureId,
            licenseKey: normalizedKey,
            machineId: normalizedMachine
          })
        }
      };
    }
  }

  return { statusCode: 404, payload: { error: "Invalid license key." } };
}

async function handleCheck(token, machineId) {
  const normalizedToken = normalizeToken(token);
  const normalizedMachine = normalizeMachineId(machineId);

  if (!normalizedToken) {
    return { statusCode: 400, payload: { valid: false, error: "token is required." } };
  }
  if (!normalizedMachine) {
    return { statusCode: 400, payload: { valid: false, error: "machine_id is required." } };
  }

  // Mercado Pago tokens
  const mpToken = parseMercadoPagoActivationToken(normalizedToken);
  if (mpToken && hasMercadoPagoConfigured()) {
    const payment = await getMercadoPagoPayment(mpToken.paymentId);
    if (!mercadoPagoPaymentIsApproved(payment)) {
      return {
        statusCode: 401,
        payload: {
          valid: false,
          error: "License validation failed.",
          reason: "payment_not_approved"
        }
      };
    }

    const metadata = (payment && payment.metadata) || {};
    if (mpToken.version === 2) {
      const expectedToken = createMercadoPagoActivationToken(mpToken.paymentId, normalizedMachine);
      if (!expectedToken || normalizeToken(expectedToken).toUpperCase() !== normalizeToken(normalizedToken).toUpperCase()) {
        return {
          statusCode: 401,
          payload: {
            valid: false,
            error: "License validation failed.",
            reason: "machine_mismatch"
          }
        };
      }

      const responseMetadata = Object.assign({}, metadata, {
        [META.LICENSE_KEY]:
          normalizeLicenseKey(metadata[META.LICENSE_KEY]) || makeMercadoPagoLicenseKey(mpToken.paymentId),
        [META.LICENSE_MAX]: normalizeString(metadata[META.LICENSE_MAX]) || String(DEFAULT_MAX_ACTIVATIONS),
        [META.LICENSE_EMAIL]:
          normalizeString(metadata[META.LICENSE_EMAIL]) ||
          normalizeString(payment && payment.payer && payment.payer.email) ||
          "",
        [META.MACHINE_PREFIX + "1"]: normalizedMachine,
        [META.TOKEN_PREFIX + "1"]: normalizedToken
      });

      return {
        statusCode: 200,
        payload: {
          valid: true,
          license: buildMercadoPagoLicensePayload(payment, responseMetadata)
        }
      };
    }

    // Legacy Mercado Pago token fallback (metadata-backed)
    const maxActivations = getMaxActivations(metadata);
    const slots = getActivationSlots(metadata, maxActivations);
    const matchedSlot = slots.find(function (slot) {
      return normalizeToken(slot.token) === normalizedToken;
    });

    if (!matchedSlot) {
      return {
        statusCode: 401,
        payload: {
          valid: false,
          error: "License validation failed.",
          reason: "token_not_found"
        }
      };
    }

    if (normalizeMachineId(matchedSlot.machineId) !== normalizedMachine) {
      return {
        statusCode: 401,
        payload: {
          valid: false,
          error: "License validation failed.",
          reason: "machine_mismatch"
        }
      };
    }

    return {
      statusCode: 200,
      payload: {
        valid: true,
        license: buildMercadoPagoLicensePayload(payment, metadata)
      }
    };
  }

  // PayPal tokens
  const paypalToken = parsePayPalActivationToken(normalizedToken);
  if (paypalToken && hasPayPalConfigured()) {
    const expectedToken = createPayPalActivationToken(paypalToken.captureId, normalizedMachine);
    if (!expectedToken || normalizeToken(expectedToken).toUpperCase() !== normalizeToken(normalizedToken).toUpperCase()) {
      return {
        statusCode: 401,
        payload: {
          valid: false,
          error: "License validation failed.",
          reason: "machine_mismatch"
        }
      };
    }

    const capture = await getPayPalCapture(paypalToken.captureId);
    if (!payPalCaptureIsCompleted(capture)) {
      return {
        statusCode: 401,
        payload: {
          valid: false,
          error: "License validation failed.",
          reason: "payment_not_completed"
        }
      };
    }

    return {
      statusCode: 200,
      payload: {
        valid: true,
        license: buildPayPalLicensePayload(capture, {
          captureId: paypalToken.captureId,
          machineId: normalizedMachine
        })
      }
    };
  }

  let session = null;
  const tokenSessionId = extractSessionIdFromToken(normalizedToken);
  if (tokenSessionId) {
    try {
      session = await getCheckoutSession(tokenSessionId);
    } catch (error) {
      session = null;
    }
  }

  if (!session) {
    session = await findSessionByToken(normalizedToken);
  }

  if (!session) {
    return {
      statusCode: 401,
      payload: {
        valid: false,
        error: "License validation failed.",
        reason: "token_not_found"
      }
    };
  }

  const fullSession = session.payment_status ? session : await getCheckoutSession(session.id);
  const metadata = fullSession.metadata || {};
  const maxActivations = getMaxActivations(metadata);
  const slots = getActivationSlots(metadata, maxActivations);
  const matched = slots.find(function (slot) {
    return normalizeToken(slot.token) === normalizedToken;
  });

  if (!matched) {
    return {
      statusCode: 401,
      payload: {
        valid: false,
        error: "License validation failed.",
        reason: "token_not_found"
      }
    };
  }

  if (normalizeMachineId(matched.machineId) !== normalizedMachine) {
    return {
      statusCode: 401,
      payload: {
        valid: false,
        error: "License validation failed.",
        reason: "machine_mismatch"
      }
    };
  }

  return {
    statusCode: 200,
    payload: {
      valid: true,
      license: buildLicensePayload(fullSession, metadata)
    }
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    return methodNotAllowed(res, "GET, POST");
  }

  const body = req.method === "POST" ? readJsonBody(req) : {};
  const action = normalizeAction((req.query && req.query.action) || body.action);

  if (!action) {
    return res.status(400).json({ error: "action is required." });
  }

  try {
    if (action === "generate") {
      const sessionId = normalizeString((req.query && req.query.session_id) || body.session_id);
      const paymentId = normalizeString((req.query && req.query.payment_id) || body.payment_id);

      if (paymentId) {
        if (/^\d+$/.test(paymentId)) {
          const mpResult = await handleGenerateMercadoPago(paymentId);
          return res.status(mpResult.statusCode).json(mpResult.payload);
        }

        if (hasPayPalConfigured()) {
          const paypalResult = await handleGeneratePayPal(paymentId);
          return res.status(paypalResult.statusCode).json(paypalResult.payload);
        }

        return res.status(400).json({ error: "Unsupported payment_id format." });
      }

      if (!sessionId) {
        return res.status(400).json({ error: "session_id or payment_id is required." });
      }
      const result = await handleGenerateStripe(sessionId);
      return res.status(result.statusCode).json(result.payload);
    }

    if (action === "activate") {
      const licenseKey = normalizeString((req.query && req.query.license_key) || body.license_key);
      const machineId = normalizeString((req.query && req.query.machine_id) || body.machine_id);
      const result = await handleActivate(licenseKey, machineId);
      return res.status(result.statusCode).json(result.payload);
    }

    if (action === "check") {
      const token = normalizeString((req.query && req.query.token) || body.token);
      const machineId = normalizeString((req.query && req.query.machine_id) || body.machine_id);
      const result = await handleCheck(token, machineId);
      return res.status(result.statusCode).json(result.payload);
    }

    return res.status(400).json({
      error: "Invalid action. Use one of: generate, activate, check."
    });
  } catch (error) {
    return res.status(Number(error.statusCode) || 500).json({
      error: error.message || "License API failed."
    });
  }
};
