const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  const body = readBody(req);
  const email = String(body.email || "").trim().toLowerCase();
  const message = String(body.message || "").trim();

  if (!EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ error: "Please provide a valid email." });
  }

  if (message.length < 5) {
    return res.status(400).json({ error: "Please describe your issue in more detail." });
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  const supportToEmail = process.env.SUPPORT_TO_EMAIL || "parax.support@gmail.com";
  const supportFromEmail = process.env.SUPPORT_FROM_EMAIL || "Parax Pro <onboarding@resend.dev>";

  if (!resendApiKey) {
    return res.status(500).json({ error: "Email service is not configured." });
  }

  const text = [
    "New support request from Parax Pro website",
    "",
    "From: " + email,
    "",
    "Message:",
    message
  ].join("\n");

  const html =
    "<p><strong>New support request from Parax Pro website</strong></p>" +
    "<p><strong>From:</strong> " + email + "</p>" +
    "<p><strong>Message:</strong></p>" +
    "<p>" + message.replace(/\n/g, "<br>") + "</p>";

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + resendApiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: supportFromEmail,
        to: [supportToEmail],
        reply_to: email,
        subject: "Parax Pro Support Request",
        text: text,
        html: html
      })
    });

    const result = await response.json().catch(function () {
      return {};
    });

    if (!response.ok) {
      let errorMessage = "Unable to send your message right now.";
      if (result && Array.isArray(result.errors) && result.errors[0] && result.errors[0].message) {
        errorMessage = result.errors[0].message;
      } else if (result && result.message) {
        errorMessage = result.message;
      }
      return res.status(502).json({ error: errorMessage });
    }

    return res.status(200).json({ ok: true, id: result.id || null });
  } catch (error) {
    return res.status(500).json({ error: "Unable to send your message right now." });
  }
};
