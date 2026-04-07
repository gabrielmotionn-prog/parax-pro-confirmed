const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readBody(req) {
  if (!req || typeof req.body === "undefined") return {};
  if (typeof req.body === "object" && req.body !== null) return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch (error) {
      return {};
    }
  }
  return {};
}

function createRequestId() {
  const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
  const stamp = Date.now().toString(36).slice(-6).toUpperCase();
  return "PIX-" + stamp + "-" + rnd;
}

function sanitize(value) {
  return String(value || "").trim();
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const body = readBody(req);
  const email = sanitize(body.email).toLowerCase();
  const fullName = sanitize(body.full_name);
  const txid = sanitize(body.txid).toUpperCase();
  const amount = sanitize(body.amount);
  const note = sanitize(body.note);

  if (!EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ error: "Please provide a valid email." });
  }

  if (!txid || txid.length < 6) {
    return res.status(400).json({ error: "Please provide a valid PIX txid." });
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  const supportToEmail = process.env.SUPPORT_TO_EMAIL || "parax.support@gmail.com";
  const supportFromEmail = process.env.SUPPORT_FROM_EMAIL || "Parax Pro <onboarding@resend.dev>";

  if (!resendApiKey) {
    return res.status(500).json({ error: "Email service is not configured." });
  }

  const requestId = createRequestId();
  const createdAt = new Date().toISOString();

  const details = [
    "New PIX payment confirmation request (Parax Pro)",
    "",
    "Request ID: " + requestId,
    "Date: " + createdAt,
    "Name: " + (fullName || "-"),
    "Email: " + email,
    "PIX TXID: " + txid,
    "Amount: " + (amount || "-"),
    "Note: " + (note || "-")
  ].join("\n");

  const detailsHtml =
    "<p><strong>New PIX payment confirmation request (Parax Pro)</strong></p>" +
    "<p><strong>Request ID:</strong> " + requestId + "<br>" +
    "<strong>Date:</strong> " + createdAt + "<br>" +
    "<strong>Name:</strong> " + (fullName || "-") + "<br>" +
    "<strong>Email:</strong> " + email + "<br>" +
    "<strong>PIX TXID:</strong> " + txid + "<br>" +
    "<strong>Amount:</strong> " + (amount || "-") + "<br>" +
    "<strong>Note:</strong> " + (note || "-") + "</p>";

  try {
    const adminResp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + resendApiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: supportFromEmail,
        to: [supportToEmail],
        reply_to: email,
        subject: "[Parax Pro PIX] " + requestId,
        text: details,
        html: detailsHtml
      })
    });

    const adminData = await adminResp.json().catch(function () {
      return {};
    });

    if (!adminResp.ok) {
      let errorMessage = "Unable to submit PIX request right now.";
      if (adminData && Array.isArray(adminData.errors) && adminData.errors[0] && adminData.errors[0].message) {
        errorMessage = adminData.errors[0].message;
      } else if (adminData && adminData.message) {
        errorMessage = adminData.message;
      }
      return res.status(502).json({ error: errorMessage });
    }

    // Optional buyer confirmation email (best effort).
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + resendApiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: supportFromEmail,
          to: [email],
          subject: "PIX request received - " + requestId,
          text:
            "We received your PIX payment request.\n\n" +
            "Request ID: " + requestId + "\n" +
            "TXID: " + txid + "\n\n" +
            "After payment confirmation, we will send your Parax Pro license key by email.",
          html:
            "<p>We received your PIX payment request.</p>" +
            "<p><strong>Request ID:</strong> " + requestId + "<br>" +
            "<strong>TXID:</strong> " + txid + "</p>" +
            "<p>After payment confirmation, we will send your Parax Pro license key by email.</p>"
        })
      });
    } catch (ignored) {}

    return res.status(200).json({
      ok: true,
      request_id: requestId
    });
  } catch (error) {
    return res.status(500).json({ error: "Unable to submit PIX request right now." });
  }
};
