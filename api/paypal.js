const { methodNotAllowed, readJsonBody } = require("../lib/http");
const { applyCoupon } = require("../lib/coupon");

const PAYPAL_API_BASE = {
  live: "https://api-m.paypal.com",
  sandbox: "https://api-m.sandbox.paypal.com"
};

function normalize(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return normalize(value).toLowerCase();
}

function normalizeLanguage(value) {
  const lang = normalize(value).toLowerCase();
  if (lang === "pt" || lang === "es" || lang === "en") return lang;
  return "en";
}

function normalizeCurrency(value) {
  const currency = normalize(value).toUpperCase();
  return currency || "USD";
}

function toAmount(value, fallback) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw < 0) return Number(fallback) || 0;
  return raw;
}

function formatAmount(value) {
  return Number(toAmount(value, 0)).toFixed(2);
}

function getPayPalMode() {
  const mode = normalize(process.env.PAYPAL_MODE || process.env.PAYPAL_ENV || "live").toLowerCase();
  return mode === "sandbox" ? "sandbox" : "live";
}

function getPayPalApiBase() {
  return PAYPAL_API_BASE[getPayPalMode()];
}

function getPayPalCredentials() {
  const clientId = normalize(process.env.PAYPAL_CLIENT_ID);
  const clientSecret = normalize(process.env.PAYPAL_CLIENT_SECRET);
  if (!clientId || !clientSecret) {
    const error = new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are required.");
    error.statusCode = 500;
    throw error;
  }
  return {
    clientId: clientId,
    clientSecret: clientSecret
  };
}

function hasEnvValue(name) {
  return normalize(process.env[name]) !== "";
}

function getBaseUrl(req) {
  const explicit =
    normalize(process.env.SITE_BASE_URL) ||
    normalize(process.env.PUBLIC_BASE_URL);
  if (explicit) return explicit.replace(/\/+$/, "");
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  const proto = req.headers["x-forwarded-proto"] || "https";
  return (host ? proto + "://" + host : "https://www.paraxpro.com").replace(/\/+$/, "");
}

function buildIntegrationState(req) {
  return {
    mode: getPayPalMode(),
    api_base: getPayPalApiBase(),
    base_url: req ? getBaseUrl(req) : "",
    has_client_id: hasEnvValue("PAYPAL_CLIENT_ID"),
    has_client_secret: hasEnvValue("PAYPAL_CLIENT_SECRET"),
    has_webhook_id: hasEnvValue("PAYPAL_WEBHOOK_ID")
  };
}

function extractFirstIssue(payload) {
  return normalize(
    payload &&
    Array.isArray(payload.details) &&
    payload.details[0] &&
    payload.details[0].issue
  );
}

function extractPayPalDebugId(response, payload) {
  const headerDebugId =
    response &&
    response.headers &&
    typeof response.headers.get === "function"
      ? normalize(response.headers.get("paypal-debug-id"))
      : "";
  if (headerDebugId) return headerDebugId;
  return normalize(payload && payload.debug_id);
}

function getFriendlyCreateOrderMessage(error) {
  const payload = (error && error.paypalPayload) || {};
  const message =
    normalize(error && error.message) ||
    normalize(payload.message) ||
    normalize(payload.error_description) ||
    "PayPal checkout is temporarily unavailable.";
  return message;
}

function buildCreateOrderErrorPayload(req, error, requestId) {
  const payload = (error && error.paypalPayload) || {};
  return {
    error: getFriendlyCreateOrderMessage(error),
    integration_state: buildIntegrationState(req),
    error_code: normalize(error && error.errorCode) || normalize(payload.name || payload.error) || null,
    issue: normalize(error && error.issue) || extractFirstIssue(payload) || null,
    debug_id: normalize(error && error.debugId) || normalize(payload.debug_id) || null,
    request_id: normalize(requestId) || null
  };
}

function logPayPalError(context, requestId, error, extra) {
  const payload = (error && error.paypalPayload) || {};
  const logPayload = {
    system: "paypal",
    context: normalize(context) || "unknown",
    request_id: normalize(requestId) || null,
    status_code: Number(error && error.statusCode) || null,
    error_code: normalize(error && error.errorCode) || normalize(payload.name || payload.error) || null,
    issue: normalize(error && error.issue) || extractFirstIssue(payload) || null,
    debug_id: normalize(error && error.debugId) || normalize(payload.debug_id) || null,
    message: normalize(error && error.message) || "PayPal request failed.",
    integration_state: (extra && extra.integration_state) || null,
    extra: extra || {},
    paypal_payload: payload
  };
  console.error("[paypal:error]", JSON.stringify(logPayload));
}

function shouldTryMinimalCreateOrder(error) {
  const statusCode = Number(error && error.statusCode) || 0;
  if (statusCode === 400 || statusCode === 403 || statusCode === 422) {
    return true;
  }
  return false;
}

function buildCustomId(options) {
  const email = normalizeEmail(options && options.email);
  const language = normalizeLanguage(options && options.language);
  let customId = "parax|l:" + language;
  if (email) {
    customId += "|e:" + encodeURIComponent(email);
  }
  if (customId.length > 120) {
    customId = "parax|l:" + language;
  }
  return customId;
}

function parseCustomId(value) {
  const raw = normalize(value);
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
        output.email = normalizeEmail(decodeURIComponent(part.slice(2)));
      } catch (error) {
        output.email = normalizeEmail(part.slice(2));
      }
      continue;
    }
    if (part.indexOf("l:") === 0) {
      output.language = normalizeLanguage(part.slice(2));
    }
  }
  return output;
}

function createRequestId(prefix) {
  const a = Date.now().toString(36).toUpperCase();
  const b = Math.random().toString(36).slice(2, 10).toUpperCase();
  return normalize(prefix || "PARAX") + "-" + a + "-" + b;
}

async function getPayPalAccessToken() {
  const credentials = getPayPalCredentials();
  const auth = Buffer.from(credentials.clientId + ":" + credentials.clientSecret).toString("base64");
  const response = await fetch(getPayPalApiBase() + "/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + auth,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: "grant_type=client_credentials"
  });

  const payload = await response.json().catch(function () {
    return {};
  });

  if (!response.ok || !payload.access_token) {
    const error = new Error(payload.error_description || payload.error || "Unable to authenticate with PayPal.");
    error.statusCode = response.status || 502;
    throw error;
  }

  return String(payload.access_token);
}

async function paypalRequest(params) {
  const method = normalize(params && params.method).toUpperCase() || "GET";
  const path = normalize(params && params.path);
  const token = normalize(params && params.token);
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
  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (error) {
      payload = {};
    }
  }

  if (!response.ok) {
    const issue = extractFirstIssue(payload);
    const debugId = extractPayPalDebugId(response, payload);
    const errorCode = normalize(payload.name || payload.error);
    const message =
      (payload && payload.message) ||
      issue ||
      "PayPal request failed.";
    const error = new Error(message);
    error.statusCode = response.status || 502;
    error.errorCode = errorCode || null;
    error.issue = issue || null;
    error.debugId = debugId || null;
    error.paypalPayload = payload;
    throw error;
  }

  return payload;
}

function extractApprovalUrl(order) {
  const links = Array.isArray(order && order.links) ? order.links : [];
  for (let i = 0; i < links.length; i += 1) {
    const link = links[i];
    if (normalize(link && link.rel).toLowerCase() === "approve") {
      return normalize(link && link.href);
    }
  }
  return "";
}

function extractPrimaryPurchaseUnit(order) {
  return Array.isArray(order && order.purchase_units) ? order.purchase_units[0] || null : null;
}

function extractCaptureFromOrder(order) {
  const unit = extractPrimaryPurchaseUnit(order);
  const captures =
    unit &&
    unit.payments &&
    Array.isArray(unit.payments.captures)
      ? unit.payments.captures
      : [];
  return captures[0] || null;
}

function normalizeCaptureId(value) {
  return normalize(value).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function isWebhookRequest(req) {
  return Boolean(req.headers["paypal-transmission-id"] && req.headers["paypal-transmission-time"]);
}

function getWebhookHeaders(req) {
  return {
    transmissionId: normalize(req.headers["paypal-transmission-id"]),
    transmissionTime: normalize(req.headers["paypal-transmission-time"]),
    transmissionSig: normalize(req.headers["paypal-transmission-sig"]),
    certUrl: normalize(req.headers["paypal-cert-url"]),
    authAlgo: normalize(req.headers["paypal-auth-algo"])
  };
}

async function verifyWebhookSignature(event) {
  const webhookId = normalize(process.env.PAYPAL_WEBHOOK_ID);
  if (!webhookId) {
    const error = new Error("PAYPAL_WEBHOOK_ID is not configured.");
    error.statusCode = 500;
    throw error;
  }

  const headers = getWebhookHeaders(event.req);
  const token = await getPayPalAccessToken();
  const verification = await paypalRequest({
    method: "POST",
    path: "/v1/notifications/verify-webhook-signature",
    token: token,
    body: {
      transmission_id: headers.transmissionId,
      transmission_time: headers.transmissionTime,
      cert_url: headers.certUrl,
      auth_algo: headers.authAlgo,
      transmission_sig: headers.transmissionSig,
      webhook_id: webhookId,
      webhook_event: event.payload
    }
  });

  const status = normalize(verification && verification.verification_status).toUpperCase();
  if (status !== "SUCCESS") {
    const error = new Error("Invalid PayPal webhook signature.");
    error.statusCode = 401;
    throw error;
  }
}

async function triggerLicenseGeneration(captureId, req) {
  const normalizedCaptureId = normalizeCaptureId(captureId);
  if (!normalizedCaptureId) return null;
  const baseUrl = getBaseUrl(req);
  const response = await fetch(baseUrl + "/api/license", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      action: "generate",
      payment_id: normalizedCaptureId
    })
  });

  const payload = await response.json().catch(function () {
    return {};
  });
  return {
    ok: response.ok,
    status: response.status,
    payload: payload
  };
}

function pickPriceBase(currency) {
  if (currency === "BRL") {
    return Number(process.env.PARAX_PRICE_BRL || 79);
  }
  return Number(process.env.PARAX_PRICE_USD || 19);
}

async function handleCreateOrder(req, res, body) {
  const checkoutLanguage = normalizeLanguage(body.language);
  const checkoutEmail = normalizeEmail(body.email);
  const currency = normalizeCurrency(process.env.PARAX_PRICE_CURRENCY || "USD");
  const baseAmount = pickPriceBase(currency);
  const pricing = applyCoupon(baseAmount, body.coupon_code, { currency: currency.toLowerCase() });
  if (!pricing.ok) {
    return res.status(400).json({ error: pricing.error || "Invalid coupon code." });
  }

  const title = normalize(process.env.PARAX_PRODUCT_TITLE) || "Parax Pro - Lifetime License";
  const baseUrl = getBaseUrl(req);
  const returnUrl = baseUrl + "/paypal-success.html?source=paypal&lang=" + encodeURIComponent(checkoutLanguage);
  const cancelUrl = baseUrl + "/index.html?payment=cancelled";
  const customId = buildCustomId({
    email: checkoutEmail,
    language: checkoutLanguage
  });

  const purchaseUnit = {
    amount: {
      currency_code: currency,
      value: formatAmount(pricing.amount_after)
    },
    description: title,
    custom_id: customId
  };

  const integrationState = buildIntegrationState(req);
  const requestId = createRequestId("PARAX-CREATE-ORDER");
  try {
    const token = await getPayPalAccessToken();

    let order = null;
    let orderCreationMode = "experience_context";
    let primaryError = null;

    try {
      order = await paypalRequest({
        method: "POST",
        path: "/v2/checkout/orders",
        token: token,
        headers: {
          "PayPal-Request-Id": createRequestId("PARAX-ORDER")
        },
        body: {
          intent: "CAPTURE",
          purchase_units: [purchaseUnit],
          payment_source: {
            paypal: {
              experience_context: {
                brand_name: "Parax Pro",
                shipping_preference: "NO_SHIPPING",
                user_action: "PAY_NOW",
                return_url: returnUrl,
                cancel_url: cancelUrl
              }
            }
          }
        }
      });
    } catch (error) {
      primaryError = error;
      logPayPalError("create_order_primary", requestId, error, {
        integration_state: integrationState,
        currency: currency,
        amount_after: pricing.amount_after,
        coupon_applied: pricing.coupon_applied
      });

      if (!shouldTryMinimalCreateOrder(error)) {
        return res.status(Number(error.statusCode) || 502).json(
          buildCreateOrderErrorPayload(req, error, requestId)
        );
      }
    }

    if (!order) {
      try {
        order = await paypalRequest({
          method: "POST",
          path: "/v2/checkout/orders",
          token: token,
          headers: {
            "PayPal-Request-Id": createRequestId("PARAX-ORDER-MIN")
          },
          body: {
            intent: "CAPTURE",
            purchase_units: [purchaseUnit]
          }
        });
        orderCreationMode = "minimal_payload";
      } catch (fallbackError) {
        logPayPalError("create_order_fallback", requestId, fallbackError, {
          integration_state: integrationState,
          currency: currency,
          amount_after: pricing.amount_after,
          coupon_applied: pricing.coupon_applied,
          had_primary_error: Boolean(primaryError)
        });
        return res.status(Number(fallbackError.statusCode) || 502).json(
          buildCreateOrderErrorPayload(req, fallbackError, requestId)
        );
      }
    }

    const approvalUrl = extractApprovalUrl(order);
    if (!approvalUrl) {
      return res.status(502).json({ error: "PayPal did not return an approval URL." });
    }

    return res.status(200).json({
      ok: true,
      approval_url: approvalUrl,
      order_id: order.id || null,
      amount: pricing.amount_after,
      amount_before: pricing.amount_before,
      discount_amount: pricing.discount_amount,
      coupon_applied: pricing.coupon_applied,
      coupon_code: pricing.coupon_applied ? pricing.coupon_code : "",
      discount_percent: pricing.coupon_applied ? pricing.discount_percent : 0,
      currency: currency,
      language: checkoutLanguage,
      integration_state: {
        order_creation_mode: orderCreationMode
      }
    });
  } catch (error) {
    logPayPalError("create_order_preflight", requestId, error, {
      integration_state: integrationState,
      currency: currency,
      amount_after: pricing.amount_after,
      coupon_applied: pricing.coupon_applied
    });
    return res.status(Number(error.statusCode) || 502).json(
      buildCreateOrderErrorPayload(req, error, requestId)
    );
  }
}

function isOrderAlreadyCaptured(payload) {
  const details = Array.isArray(payload && payload.details) ? payload.details : [];
  return details.some(function (item) {
    return normalize(item && item.issue).toUpperCase() === "ORDER_ALREADY_CAPTURED";
  });
}

async function handleCaptureOrder(req, res, body) {
  const orderId = normalize(body.order_id || body.token).toUpperCase();
  const requestedLanguage = normalizeLanguage(body.language);

  if (!orderId) {
    return res.status(400).json({ error: "order_id is required." });
  }

  const token = await getPayPalAccessToken();
  let order;

  try {
    order = await paypalRequest({
      method: "POST",
      path: "/v2/checkout/orders/" + encodeURIComponent(orderId) + "/capture",
      token: token,
      headers: {
        "PayPal-Request-Id": createRequestId("PARAX-CAPTURE")
      }
    });
  } catch (error) {
    if (Number(error.statusCode) === 422 && isOrderAlreadyCaptured(error.paypalPayload)) {
      order = await paypalRequest({
        method: "GET",
        path: "/v2/checkout/orders/" + encodeURIComponent(orderId),
        token: token
      });
    } else {
      throw error;
    }
  }

  const capture = extractCaptureFromOrder(order);
  const captureId = normalizeCaptureId(capture && capture.id);
  if (!captureId) {
    return res.status(502).json({ error: "PayPal capture ID was not returned." });
  }

  const purchaseUnit = extractPrimaryPurchaseUnit(order);
  const custom = parseCustomId(
    (purchaseUnit && purchaseUnit.custom_id) ||
    (capture && capture.custom_id)
  );
  const checkoutLanguage = normalizeLanguage(custom.language || requestedLanguage);

  await triggerLicenseGeneration(captureId, req).catch(function () {
    return null;
  });

  return res.status(200).json({
    ok: true,
    order_id: order.id || orderId,
    capture_id: captureId,
    status: normalize(capture && capture.status) || normalize(order && order.status) || null,
    language: checkoutLanguage
  });
}

async function handleWebhook(req, res) {
  const payload = readJsonBody(req);
  await verifyWebhookSignature({ req: req, payload: payload });

  const eventType = normalize(payload && payload.event_type).toUpperCase();
  if (eventType === "PAYMENT.CAPTURE.COMPLETED") {
    const captureId = normalizeCaptureId(payload && payload.resource && payload.resource.id);
    if (captureId) {
      await triggerLicenseGeneration(captureId, req).catch(function () {
        return null;
      });
    }
  }

  return res.status(200).json({ received: true, event_type: eventType || null });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return methodNotAllowed(res, "POST");
  }

  try {
    if (isWebhookRequest(req)) {
      return await handleWebhook(req, res);
    }

    const body = readJsonBody(req);
    const action = normalize(body.action || (req.query && req.query.action)).toLowerCase();

    if (action === "create_order") {
      return await handleCreateOrder(req, res, body);
    }

    if (action === "capture_order") {
      return await handleCaptureOrder(req, res, body);
    }

    return res.status(400).json({
      error: "Invalid action. Use one of: create_order, capture_order."
    });
  } catch (error) {
    logPayPalError("handler", createRequestId("PARAX-HANDLER"), error, {
      integration_state: buildIntegrationState(req)
    });
    return res.status(Number(error.statusCode) || 500).json({
      error: error.message || "PayPal request failed."
    });
  }
};
