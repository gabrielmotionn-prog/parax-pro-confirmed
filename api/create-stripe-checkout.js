const crypto = require("crypto");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function getBaseUrl(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const forwardedHost = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  if (forwardedHost) {
    return forwardedProto + "://" + forwardedHost;
  }
  return process.env.PUBLIC_SITE_URL || "https://example.com";
}

function readBody(req) {
  if (!req || typeof req.body === "undefined") return {};

  if (typeof req.body === "object" && req.body !== null) {
    return req.body;
  }

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch (error) {
      return {};
    }
  }

  return {};
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const stripePriceId = process.env.STRIPE_PRICE_ID;

  if (!stripeSecretKey) {
    return res.status(500).json({ error: "Stripe is not configured." });
  }

  const body = readBody(req);
  const email = normalizeEmail(body.email);
  if (!EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ error: "Invalid customer email." });
  }

  const baseUrl = getBaseUrl(req);
  const orderToken = crypto.randomBytes(24).toString("hex");

  const form = new URLSearchParams();
  form.append("mode", "payment");
  if (stripePriceId) {
    form.append("line_items[0][price]", stripePriceId);
  } else {
    form.append("line_items[0][price_data][currency]", "usd");
    form.append("line_items[0][price_data][unit_amount]", "1500");
    form.append("line_items[0][price_data][product_data][name]", "Parax Pro - Lifetime License");
  }
  form.append("line_items[0][quantity]", "1");
  form.append("customer_email", email);
  form.append("metadata[order_token]", orderToken);
  form.append("metadata[purchaser_email]", email);
  form.append("success_url", baseUrl + "/confirmed.html?session_id={CHECKOUT_SESSION_ID}&order_token=" + orderToken);
  form.append("cancel_url", baseUrl + "/index.html?payment=cancelled");

  try {
    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + stripeSecretKey,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: form.toString()
    });

    const result = await response.json().catch(function () {
      return {};
    });

    if (!response.ok) {
      let message = "Unable to create Stripe checkout session.";
      if (result && result.error && result.error.message) {
        message = result.error.message;
      }
      return res.status(502).json({ error: message });
    }

    if (!result.url) {
      return res.status(502).json({ error: "Stripe checkout URL was not returned." });
    }

    return res.status(200).json({
      ok: true,
      url: result.url,
      sessionId: result.id || null
    });
  } catch (error) {
    return res.status(500).json({ error: "Unable to create Stripe checkout session." });
  }
};
