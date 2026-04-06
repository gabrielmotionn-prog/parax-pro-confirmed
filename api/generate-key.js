const { methodNotAllowed, readJsonBody } = require("./_lib/http");
const {
  createLicenseFromSession,
  getLicenseBySessionId,
  licenseResponsePayload
} = require("./_lib/license-store");

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

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return methodNotAllowed(res, "POST");
  }

  const body = readJsonBody(req);
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

    const existingLicense = getLicenseBySessionId(session.id);
    const email =
      (session.customer_details && session.customer_details.email) ||
      session.customer_email ||
      null;

    const license =
      existingLicense ||
      createLicenseFromSession({
        sessionId: session.id,
        email: email,
        maxActivations: 2
      });

    return res.status(200).json({
      ok: true,
      reused: Boolean(existingLicense),
      license: licenseResponsePayload(license)
    });
  } catch (error) {
    const statusCode = Number(error.statusCode) || 500;
    return res.status(statusCode).json({
      error: error.message || "Unable to generate license key from this session."
    });
  }
};

