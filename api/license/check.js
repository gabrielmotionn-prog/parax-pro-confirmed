const { methodNotAllowed, readJsonBody } = require("../_lib/http");
const {
  checkLicenseToken,
  licenseResponsePayload
} = require("../_lib/license-store");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return methodNotAllowed(res, "POST");
  }

  const body = readJsonBody(req);
  const token = String(body.token || "").trim();
  const machineId = String(body.machine_id || "").trim();

  if (!token) {
    return res.status(400).json({ valid: false, error: "token is required." });
  }

  if (!machineId) {
    return res.status(400).json({ valid: false, error: "machine_id is required." });
  }

  const result = checkLicenseToken({
    token: token,
    machineId: machineId
  });

  if (!result.valid) {
    return res.status(401).json({
      valid: false,
      error: "License validation failed.",
      reason: result.reason
    });
  }

  return res.status(200).json({
    valid: true,
    license: licenseResponsePayload(result.license)
  });
};

