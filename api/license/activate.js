const { methodNotAllowed, readJsonBody } = require("../_lib/http");
const {
  activateLicense,
  licenseResponsePayload
} = require("../_lib/license-store");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return methodNotAllowed(res, "POST");
  }

  const body = readJsonBody(req);
  const licenseKey = String(body.license_key || "").trim().toUpperCase();
  const machineId = String(body.machine_id || "").trim();

  if (!licenseKey) {
    return res.status(400).json({ error: "license_key is required." });
  }

  if (!machineId) {
    return res.status(400).json({ error: "machine_id is required." });
  }

  const activation = activateLicense({
    licenseKey: licenseKey,
    machineId: machineId
  });

  if (!activation.ok) {
    if (activation.reason === "activation_limit_reached") {
      return res.status(409).json({
        error: "Activation limit reached for this license.",
        license: licenseResponsePayload(activation.license)
      });
    }

    if (activation.reason === "invalid_license_key") {
      return res.status(404).json({ error: "Invalid license key." });
    }

    return res.status(400).json({ error: "Unable to activate this license." });
  }

  return res.status(200).json({
    ok: true,
    token: activation.token,
    already_activated: activation.already_activated,
    license: licenseResponsePayload(activation.license)
  });
};

