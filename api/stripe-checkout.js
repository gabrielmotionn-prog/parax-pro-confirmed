const { methodNotAllowed, readJsonBody } = require("../lib/http");
const { applyCoupon } = require("../lib/coupon");

const STRIPE_API_BASE = "https://api.stripe.com/v1";

function normalize(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return normalize(value).toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
}

function toAmount(value, fallback) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw < 0) return Number(fallback) || 0;
  return raw;
}

function roundCurrency(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function getStripeMinimumUnitAmount(currency) {
  const key = "STRIPE_MIN_UNIT_AMOUNT_" + String(currency || "").toUpperCase();
  const envValue = process.env[key];
  if (envValue !== undefined && envValue !== null && String(envValue).trim() !== "") {
    return Math.max(1, Math.round(toAmount(envValue, 1)));
  }
  if (String(currency || "").toLowerCase() === "usd") {
    return 50;
  }
  return 1;
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

function toFormBody(body) {
  const params = new URLSearchParams();
  Object.keys(body || {}).forEach(function (key) {
    const value = body[key];
    if (value === undefined || value === null || value === "") return;
    params.append(key, String(value));
  });
  return params.toString();
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
  const body = params.body || null;
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

  const response = await fetch(STRIPE_API_BASE + path, fetchOptions);
  const payload = await response.json().catch(function () {
    return {};
  });

  if (!response.ok) {
    const message = (payload && payload.error && payload.error.message) || "Stripe request failed.";
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
    const baseAmount = Number(process.env.PARAX_PRICE_USD || 19);
    const currency = normalize(process.env.PARAX_PRICE_CURRENCY || "usd").toLowerCase();
    const pricing = applyCoupon(baseAmount, body.coupon_code, { currency: currency });
    if (!pricing.ok) {
      return res.status(400).json({ error: pricing.error || "Invalid coupon code." });
    }

    const title = normalize(process.env.PARAX_PRODUCT_TITLE) || "Parax Pro - Lifetime License";
    const minUnitAmount = getStripeMinimumUnitAmount(currency);
    const rawUnitAmount = Math.max(1, Math.round(Number(pricing.amount_after || 0) * 100));
    const unitAmount = Math.max(minUnitAmount, rawUnitAmount);
    const chargedAmount = roundCurrency(unitAmount / 100);
    const amountBefore = roundCurrency(pricing.amount_before);
    const chargedDiscountAmount = roundCurrency(Math.max(0, amountBefore - chargedAmount));
    const chargedDiscountPercent = amountBefore > 0
      ? roundCurrency((chargedDiscountAmount / amountBefore) * 100)
      : 0;
    const stripeMinimumApplied = unitAmount !== rawUnitAmount;
    const baseUrl = getBaseUrl(req);

    const checkoutSession = await stripeRequest({
      method: "POST",
      path: "/checkout/sessions",
      body: {
        mode: "payment",
        success_url: baseUrl + "/email-sent.html?source=stripe&session_id={CHECKOUT_SESSION_ID}",
        cancel_url: baseUrl + "/index.html?payment=cancelled",
        "line_items[0][quantity]": 1,
        "line_items[0][price_data][currency]": currency,
        "line_items[0][price_data][unit_amount]": unitAmount,
        "line_items[0][price_data][product_data][name]": title,
        "metadata[source]": "parax-site",
        "metadata[flow]": "stripe-checkout",
        "metadata[coupon_code]": pricing.coupon_applied ? pricing.coupon_code : "",
        "metadata[coupon_percent]": pricing.coupon_applied ? chargedDiscountPercent : "",
        "metadata[amount_before]": amountBefore,
        "metadata[discount_amount]": chargedDiscountAmount,
        "metadata[amount_after]": chargedAmount,
        "metadata[stripe_minimum_applied]": stripeMinimumApplied ? "1" : "",
        customer_email: isValidEmail(payerEmail) ? payerEmail : ""
      }
    });

    const checkoutUrl = normalize(checkoutSession.url);
    if (!checkoutUrl) {
      return res.status(502).json({ error: "Stripe did not return a checkout URL." });
    }

    return res.status(200).json({
      ok: true,
      checkout_url: checkoutUrl,
      session_id: checkoutSession.id || null,
      amount: chargedAmount,
      amount_before: amountBefore,
      discount_amount: chargedDiscountAmount,
      coupon_applied: pricing.coupon_applied,
      coupon_code: pricing.coupon_applied ? pricing.coupon_code : "",
      discount_percent: pricing.coupon_applied ? chargedDiscountPercent : 0,
      amount_requested: pricing.amount_after,
      stripe_minimum_applied: stripeMinimumApplied
    });
  } catch (error) {
    return res.status(Number(error.statusCode) || 500).json({
      error: error.message || "Unable to create Stripe checkout."
    });
  }
};
