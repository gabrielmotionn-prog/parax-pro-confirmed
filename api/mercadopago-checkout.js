const { readJsonBody } = require("./_lib/http");

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

async function mpRequest(params) {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) {
    const error = new Error("MERCADOPAGO_ACCESS_TOKEN is not configured.");
    error.statusCode = 500;
    throw error;
  }

  const response = await fetch(MP_API_BASE + params.path, {
    method: params.method || "GET",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json"
    },
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

function getBaseUrl(req) {
  const explicit =
    normalize(process.env.SITE_BASE_URL) ||
    normalize(process.env.PUBLIC_BASE_URL);
  if (explicit) return explicit.replace(/\/+$/, "");
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  const proto = req.headers["x-forwarded-proto"] || "https";
  return (host ? proto + "://" + host : "https://parax-pro-confirmed.vercel.app").replace(/\/+$/, "");
}

function createExternalRef() {
  const a = Date.now().toString(36).toUpperCase();
  const b = Math.random().toString(36).slice(2, 8).toUpperCase();
  return "PARAXPIX-" + a + "-" + b;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const body = readJsonBody(req);
    const payerEmail = normalizeEmail(body.email);
    const baseUrl = getBaseUrl(req);

    const amount = Number(process.env.PARAX_PRICE_BRL || 79);
    const title = normalize(process.env.PARAX_PRODUCT_TITLE) || "Parax Pro - Lifetime License";

    const preferenceBody = {
      items: [
        {
          title: title,
          quantity: 1,
          currency_id: "BRL",
          unit_price: amount
        }
      ],
      external_reference: createExternalRef(),
      auto_return: "approved",
      back_urls: {
        success: baseUrl + "/confirmed.html?source=mercadopago&status=approved",
        failure: baseUrl + "/index.html?payment=failed",
        pending: baseUrl + "/confirmed.html?source=mercadopago&status=pending"
      },
      notification_url: baseUrl + "/api/mercadopago-webhook",
      metadata: {
        source: "parax-site",
        flow: "pix"
      }
    };

    if (isValidEmail(payerEmail)) {
      preferenceBody.payer = { email: payerEmail };
      preferenceBody.metadata.payer_email = payerEmail;
    }

    const preference = await mpRequest({
      method: "POST",
      path: "/checkout/preferences",
      body: preferenceBody
    });

    const checkoutUrl =
      normalize(preference.init_point) || normalize(preference.sandbox_init_point);

    if (!checkoutUrl) {
      return res.status(502).json({ error: "Mercado Pago did not return a checkout URL." });
    }

    return res.status(200).json({
      ok: true,
      checkout_url: checkoutUrl,
      preference_id: preference.id || null
    });
  } catch (error) {
    return res.status(Number(error.statusCode) || 500).json({
      error: error.message || "Unable to create Mercado Pago checkout."
    });
  }
};
