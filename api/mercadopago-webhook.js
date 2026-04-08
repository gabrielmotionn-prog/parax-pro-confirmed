const crypto = require("crypto");

const MP_API_BASE = "https://api.mercadopago.com";
const LICENSE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DEFAULT_MAX_ACTIVATIONS = 2;

const META = {
  LICENSE_KEY: "parax_license_key",
  LICENSE_EMAIL: "parax_license_email",
  LICENSE_MAX: "parax_license_max",
  EMAIL_SENT_AT: "parax_license_email_sent_at",
  EMAIL_SENT_ID: "parax_license_email_sent_id"
};

function normalize(value) {
  return String(value || "").trim();
}

function normalizePaymentId(value) {
  return normalize(value).replace(/[^\d]/g, "");
}

function signingSecret() {
  return (
    process.env.LICENSE_SIGNING_SECRET ||
    process.env.STRIPE_SECRET_KEY ||
    ""
  );
}

function hmacHex(value) {
  const secret = signingSecret();
  if (!secret) {
    const error = new Error("LICENSE_SIGNING_SECRET is not configured.");
    error.statusCode = 500;
    throw error;
  }
  return crypto
    .createHmac("sha256", secret)
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

async function getPayment(paymentId) {
  return mpRequest({
    method: "GET",
    path: "/v1/payments/" + encodeURIComponent(paymentId)
  });
}

async function updatePaymentMetadata(paymentId, metadataPatch) {
  const payment = await getPayment(paymentId);
  const currentMetadata = (payment && payment.metadata) || {};
  const mergedMetadata = Object.assign({}, currentMetadata, metadataPatch || {});

  return mpRequest({
    method: "PUT",
    path: "/v1/payments/" + encodeURIComponent(paymentId),
    body: { metadata: mergedMetadata }
  });
}

function isApproved(payment) {
  return normalize(payment && payment.status).toLowerCase() === "approved";
}

function extractPaymentId(req, eventPayload) {
  const fromEvent =
    normalize(eventPayload && eventPayload.data && eventPayload.data.id) ||
    normalize(eventPayload && eventPayload.resource && String(eventPayload.resource).split("/").pop());

  const fromQuery =
    normalize(req.query && req.query["data.id"]) ||
    normalize(req.query && req.query.id);

  return normalizePaymentId(fromEvent || fromQuery);
}

async function sendLicenseEmail(email, licenseKey) {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    const error = new Error("RESEND_API_KEY is not configured.");
    error.statusCode = 500;
    throw error;
  }

  const supportFromEmail =
    process.env.SUPPORT_FROM_EMAIL || "Parax Pro <onboarding@resend.dev>";

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + resendApiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: supportFromEmail,
      to: [email],
      subject: "Your Parax Pro License Key",
      text:
        "Thanks for purchasing Parax Pro.\n\n" +
        "Your license key:\n" +
        licenseKey +
        "\n\n" +
        "Use this key to activate your plugin.",
      html:
        "<p>Thanks for purchasing <strong>Parax Pro</strong>.</p>" +
        "<p>Your license key:</p>" +
        "<p style=\"font-size:20px;font-weight:700;letter-spacing:1px;\">" + licenseKey + "</p>" +
        "<p>Use this key to activate your plugin.</p>"
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

  return normalize(payload && payload.id);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const payload = req.body && typeof req.body === "object" ? req.body : {};
    const paymentId = extractPaymentId(req, payload);

    if (!paymentId) {
      return res.status(200).json({ received: true, ignored: true, reason: "payment_id_not_found" });
    }

    const payment = await getPayment(paymentId);
    if (!isApproved(payment)) {
      return res.status(200).json({ received: true, ignored: true, reason: "payment_not_approved" });
    }

    const metadata = payment.metadata || {};
    const licenseKey = normalize(metadata[META.LICENSE_KEY]) || makeMercadoPagoLicenseKey(paymentId);
    const email =
      normalize(metadata[META.LICENSE_EMAIL]) ||
      normalize(payment && payment.payer && payment.payer.email);

    let updatedMetadata = metadata;
    if (!normalize(metadata[META.LICENSE_KEY])) {
      const updated = await updatePaymentMetadata(paymentId, {
        [META.LICENSE_KEY]: licenseKey,
        [META.LICENSE_MAX]: String(DEFAULT_MAX_ACTIVATIONS),
        [META.LICENSE_EMAIL]: email
      });
      updatedMetadata = updated.metadata || metadata;
    }

    if (normalize(updatedMetadata[META.EMAIL_SENT_AT])) {
      return res.status(200).json({
        received: true,
        processed: true,
        skipped: true,
        reason: "email_already_sent"
      });
    }

    if (!email) {
      throw new Error("Payer email was not found on approved payment.");
    }

    const emailId = await sendLicenseEmail(email, licenseKey);
    await updatePaymentMetadata(paymentId, {
      [META.EMAIL_SENT_AT]: new Date().toISOString(),
      [META.EMAIL_SENT_ID]: emailId
    });

    return res.status(200).json({
      received: true,
      processed: true,
      payment_id: paymentId,
      email: email
    });
  } catch (error) {
    if (Number(error.statusCode) === 404) {
      return res.status(200).json({
        received: true,
        ignored: true,
        reason: "payment_not_found",
        detail: error.message || "Payment id was not found."
      });
    }

    return res.status(Number(error.statusCode) || 500).json({
      error: error.message || "Unable to process Mercado Pago webhook."
    });
  }
};
