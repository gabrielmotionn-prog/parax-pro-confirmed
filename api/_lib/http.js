function readJsonBody(req) {
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

function methodNotAllowed(res, allow) {
  res.setHeader("Allow", allow);
  return res.status(405).json({ error: "Method not allowed." });
}

module.exports = {
  methodNotAllowed,
  readJsonBody
};

