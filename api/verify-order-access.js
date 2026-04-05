function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
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
  if (!stripeSecretKey) {
    return res.status(500).json({ error: "Stripe is not configured." });
  }

  const body = readBody(req);
  const sessionId = String(body.sessionId || "").trim();
  const orderToken = String(body.orderToken || "").trim();

  if (!sessionId || !orderToken) {
    return res.status(400).json({ error: "Missing session_id or order_token." });
  }

  try {
    const response = await fetch("https://api.stripe.com/v1/checkout/sessions/" + encodeURIComponent(sessionId), {
      method: "GET",
      headers: {
        Authorization: "Bearer " + stripeSecretKey
      }
    });

    const session = await response.json().catch(function () {
      return {};
    });

    if (!response.ok) {
      let message = "Unable to verify your purchase.";
      if (session && session.error && session.error.message) {
        message = session.error.message;
      }
      return res.status(502).json({ error: message });
    }

    if (String(session.payment_status || "") !== "paid") {
      return res.status(403).json({ error: "Payment not completed yet." });
    }

    const metadata = session.metadata || {};
    const expectedToken = String(metadata.order_token || "");
    if (!expectedToken || expectedToken !== orderToken) {
      return res.status(403).json({ error: "Invalid order token." });
    }

    const purchaserEmail = normalizeEmail(
      metadata.purchaser_email ||
      (session.customer_details && session.customer_details.email) ||
      session.customer_email
    );

    if (!purchaserEmail) {
      return res.status(500).json({ error: "Purchaser email not found in order." });
    }

    return res.status(200).json({
      ok: true,
      purchaserEmail: purchaserEmail
    });
  } catch (error) {
    return res.status(500).json({ error: "Unable to verify your purchase." });
  }
};
