const { methodNotAllowed, readJsonBody } = require("../lib/http");
const { applyCoupon } = require("../lib/coupon");

const MP_API_BASE = "https://api.mercadopago.com";

function normalize(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return normalize(value).toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
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

function createExternalRef() {
  const a = Date.now().toString(36).toUpperCase();
  const b = Math.random().toString(36).slice(2, 8).toUpperCase();
  return "PARAXPIX-" + a + "-" + b;
}

function makeExpirationIso(minutesFromNow) {
  const minutes = Number(minutesFromNow || 30);
  const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : 30;
  return new Date(Date.now() + safeMinutes * 60 * 1000).toISOString();
}

async function mpRequest(params) {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) {
    const error = new Error("MERCADOPAGO_ACCESS_TOKEN is not configured.");
    error.statusCode = 500;
    throw error;
  }

  const headers = {
    Authorization: "Bearer " + token,
    "Content-Type": "application/json"
  };

  if ((params.method || "GET").toUpperCase() === "POST") {
    headers["X-Idempotency-Key"] =
      normalize(params.idempotencyKey) ||
      ("parax-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10));
  }

  const response = await fetch(MP_API_BASE + params.path, {
    method: params.method || "GET",
    headers: headers,
    body: params.body ? JSON.stringify(params.body) : undefined
  });

  const payload = await response.json().catch(function () {
    return {};
  });

  if (!response.ok) {
    const message = payload.message || payload.error || "Mercado Pago request failed.";
    const error = new Error(message);
    error.statusCode = response.status;
    throw error;
  }

  return payload;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return methodNotAllowed(res, "POST");
  }

  try {
    const body = readJsonBody(req);
    const payerEmail = normalizeEmail(body.email);
    if (!isValidEmail(payerEmail)) {
      return res.status(400).json({ error: "A valid buyer email is required for PIX checkout." });
    }

    const baseUrl = getBaseUrl(req);
    const baseAmount = Number(process.env.PARAX_PRICE_BRL || 79);
    const pricing = applyCoupon(baseAmount, body.coupon_code);
    if (!pricing.ok) {
      return res.status(400).json({ error: pricing.error || "Invalid coupon code." });
    }
    const amount = pricing.amount_after;
    const title = normalize(process.env.PARAX_PRODUCT_TITLE) || "Parax Pro - Lifetime License";
    const expiration = makeExpirationIso(process.env.PARAX_PIX_EXPIRES_MINUTES || 30);
    const metadata = {
      source: "parax-site",
      flow: "pix-direct",
      payer_email: payerEmail
    };

    if (pricing.coupon_applied) {
      metadata.coupon_code = pricing.coupon_code;
      metadata.coupon_percent = String(pricing.discount_percent);
      metadata.amount_before = String(pricing.amount_before);
      metadata.discount_amount = String(pricing.discount_amount);
    }

    const payment = await mpRequest({
      method: "POST",
      path: "/v1/payments",
      idempotencyKey: "pix-" + createExternalRef(),
      body: {
        transaction_amount: amount,
        description: title,
        payment_method_id: "pix",
        date_of_expiration: expiration,
        external_reference: createExternalRef(),
        notification_url: baseUrl + "/api/mercadopago-webhook",
        payer: {
          email: payerEmail
        },
        metadata: metadata
      }
    });

    const txData =
      (payment &&
        payment.point_of_interaction &&
        payment.point_of_interaction.transaction_data) ||
      {};

    const qrCode = normalize(txData.qr_code);
    const qrCodeBase64 = normalize(txData.qr_code_base64);
    const ticketUrl = normalize(txData.ticket_url);

    if (!qrCode || !qrCodeBase64) {
      return res.status(502).json({ error: "Mercado Pago did not return a PIX QR code." });
    }

    return res.status(200).json({
      ok: true,
      payment_id: payment.id || null,
      status: payment.status || null,
      amount: amount,
      amount_before: pricing.amount_before,
      discount_amount: pricing.discount_amount,
      coupon_applied: pricing.coupon_applied,
      coupon_code: pricing.coupon_applied ? pricing.coupon_code : "",
      discount_percent: pricing.coupon_applied ? pricing.discount_percent : 0,
      currency: "BRL",
      description: title,
      expires_at: payment.date_of_expiration || expiration,
      qr_code: qrCode,
      qr_code_base64: qrCodeBase64,
      ticket_url: ticketUrl || null
    });
  } catch (error) {
    return res.status(Number(error.statusCode) || 500).json({
      error: error.message || "Unable to create PIX QR code."
    });
  }
};
