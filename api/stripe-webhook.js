const crypto = require("crypto");

const STRIPE_API_BASE = "https://api.stripe.com/v1";
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

function normalizeKey(value) {
  return normalize(value).toUpperCase();
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
    const message =
      (payload && payload.error && payload.error.message) ||
      payload.message ||
      "Stripe request failed.";
    const error = new Error(message);
    error.statusCode = response.status;
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

function randomKeyChunk(size) {
  const bytes = crypto.randomBytes(size);
  let output = "";
  for (let i = 0; i < size; i += 1) {
    output += LICENSE_ALPHABET[bytes[i] % LICENSE_ALPHABET.length];
  }
  return output;
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

function sessionIsPaid(session) {
  const paymentStatus = normalize(session && session.payment_status).toLowerCase();
  const status = normalize(session && session.status).toLowerCase();
  return paymentStatus === "paid" || status === "complete";
}

function safeCompare(a, b) {
  const aBuf = Buffer.from(String(a || ""), "utf8");
  const bBuf = Buffer.from(String(b || ""), "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function parseStripeSignature(value) {
  const raw = String(value || "");
  const parts = raw.split(",");
  const out = { t: "", v1: [] };
  for (let i = 0; i < parts.length; i += 1) {
    const item = parts[i].trim();
    const idx = item.indexOf("=");
    if (idx <= 0) continue;
    const key = item.slice(0, idx);
    const val = item.slice(idx + 1);
    if (key === "t") out.t = val;
    if (key === "v1") out.v1.push(val);
  }
  return out;
}

async function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body, "utf8");

  if (req.body && typeof req.body === "object") {
    // Fallback when runtime pre-parsed body.
    return Buffer.from(JSON.stringify(req.body), "utf8");
  }

  return new Promise(function (resolve, reject) {
    const chunks = [];
    req.on("data", function (chunk) {
      chunks.push(Buffer.from(chunk));
    });
    req.on("end", function () {
      resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

function verifyStripeSignature(rawBody, signatureHeader) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    const error = new Error("STRIPE_WEBHOOK_SECRET is not configured.");
    error.statusCode = 500;
    throw error;
  }

  const parsed = parseStripeSignature(signatureHeader);
  if (!parsed.t || !parsed.v1.length) {
    const error = new Error("Missing Stripe signature.");
    error.statusCode = 400;
    throw error;
  }

  const signedPayload = parsed.t + "." + rawBody.toString("utf8");
  const expected = crypto
    .createHmac("sha256", webhookSecret)
    .update(signedPayload, "utf8")
    .digest("hex");

  const valid = parsed.v1.some(function (sig) {
    return safeCompare(sig, expected);
  });

  if (!valid) {
    const error = new Error("Invalid Stripe signature.");
    error.statusCode = 400;
    throw error;
  }

  // replay protection
  const timestamp = Number(parsed.t);
  if (Number.isFinite(timestamp)) {
    const age = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
    if (age > 60 * 10) {
      const error = new Error("Stripe signature timestamp is too old.");
      error.statusCode = 400;
      throw error;
    }
  }
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

  const baseUrl =
    (process.env.SITE_BASE_URL || process.env.PUBLIC_BASE_URL || "https://www.paraxpro.com")
      .toString()
      .replace(/\/+$/, "");
  const activateUrl = baseUrl + "/email-sent.html";

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
        "Activate your plugin with this key.\n" +
        "Activation page: " + activateUrl,
      html:
        "<p>Thanks for purchasing <strong>Parax Pro</strong>.</p>" +
        "<p>Your license key:</p>" +
        "<p style=\"font-size:20px;font-weight:700;letter-spacing:1px;\">" + licenseKey + "</p>" +
        "<p>Activate your plugin with this key.</p>" +
        "<p><a href=\"" + activateUrl + "\">Open activation page</a></p>"
    })
  });

  const result = await response.json().catch(function () {
    return {};
  });

  if (!response.ok) {
    const message =
      (result && Array.isArray(result.errors) && result.errors[0] && result.errors[0].message) ||
      result.message ||
      "Unable to send license email.";
    const error = new Error(message);
    error.statusCode = 502;
    throw error;
  }

  return result && result.id ? String(result.id) : "";
}

async function ensureLicenseAndEmail(sessionId) {
  let session = await getCheckoutSession(sessionId);
  if (!sessionIsPaid(session)) {
    return { ok: true, skipped: true, reason: "payment_not_completed" };
  }

  const metadata = session.metadata || {};
  let licenseKey = normalizeKey(metadata[META.LICENSE_KEY]);

  if (!licenseKey) {
    licenseKey = createLicenseKey();
    const email =
      normalize(
        session &&
          session.customer_details &&
          session.customer_details.email
      ) ||
      normalize(session && session.customer_email);

    session = await updateCheckoutSessionMetadata(session.id, {
      [META.LICENSE_KEY]: licenseKey,
      [META.LICENSE_MAX]: String(DEFAULT_MAX_ACTIVATIONS),
      [META.LICENSE_EMAIL]: email
    });
  }

  const latestMeta = session.metadata || {};
  const sentAt = normalize(latestMeta[META.EMAIL_SENT_AT]);
  if (sentAt) {
    return { ok: true, skipped: true, reason: "email_already_sent", license_key: licenseKey };
  }

  const email =
    normalize(latestMeta[META.LICENSE_EMAIL]) ||
    normalize(session && session.customer_email) ||
    normalize(
      session &&
        session.customer_details &&
        session.customer_details.email
    );

  if (!email) {
    throw new Error("Customer email not available on checkout session.");
  }

  const emailId = await sendLicenseEmail(email, licenseKey);
  await updateCheckoutSessionMetadata(session.id, {
    [META.EMAIL_SENT_AT]: new Date().toISOString(),
    [META.EMAIL_SENT_ID]: emailId
  });

  return { ok: true, skipped: false, license_key: licenseKey, email: email };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const rawBody = await readRawBody(req);
    const signature = req.headers["stripe-signature"] || req.headers["Stripe-Signature"];
    verifyStripeSignature(rawBody, signature);

    const event = JSON.parse(rawBody.toString("utf8"));
    const type = normalize(event && event.type);
    const session = event && event.data && event.data.object;

    if (!session || normalize(session.object) !== "checkout.session") {
      return res.status(200).json({ received: true, ignored: true, reason: "not_checkout_session" });
    }

    if (type !== "checkout.session.completed" && type !== "checkout.session.async_payment_succeeded") {
      return res.status(200).json({ received: true, ignored: true, reason: "event_not_used" });
    }

    const result = await ensureLicenseAndEmail(session.id);
    return res.status(200).json({
      received: true,
      processed: true,
      result: result
    });
  } catch (error) {
    return res.status(Number(error.statusCode) || 500).json({
      error: error.message || "Webhook processing failed."
    });
  }
};
