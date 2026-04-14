function normalize(value) {
  return String(value || "").trim();
}

function normalizeCouponCode(value) {
  return normalize(value).toUpperCase();
}

function toAmount(value, fallback) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw < 0) return Number(fallback) || 0;
  return raw;
}

function roundCurrency(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function getCouponConfig() {
  const code = normalizeCouponCode(process.env.PARAX_COUPON_CODE || "MOTIONRANGERS");
  const percentRaw = toAmount(process.env.PARAX_COUPON_PERCENT, 20);
  const percent = Math.max(0, Math.min(percentRaw, 95));
  return {
    code: code,
    percent: percent
  };
}

function applyCoupon(baseAmount, rawCouponCode) {
  const amount = roundCurrency(toAmount(baseAmount, 0));
  const providedCode = normalizeCouponCode(rawCouponCode);
  const config = getCouponConfig();

  if (!providedCode) {
    return {
      ok: true,
      coupon_provided: false,
      coupon_applied: false,
      amount_before: amount,
      amount_after: amount,
      discount_amount: 0,
      discount_percent: 0,
      coupon_code: ""
    };
  }

  if (!config.code || providedCode !== config.code) {
    return {
      ok: false,
      error: "Invalid coupon code."
    };
  }

  if (config.percent <= 0) {
    return {
      ok: true,
      coupon_provided: true,
      coupon_applied: false,
      amount_before: amount,
      amount_after: amount,
      discount_amount: 0,
      discount_percent: 0,
      coupon_code: providedCode
    };
  }

  const discount = roundCurrency((amount * config.percent) / 100);
  const discountedAmount = roundCurrency(Math.max(0.5, amount - discount));

  return {
    ok: true,
    coupon_provided: true,
    coupon_applied: true,
    amount_before: amount,
    amount_after: discountedAmount,
    discount_amount: roundCurrency(amount - discountedAmount),
    discount_percent: config.percent,
    coupon_code: providedCode
  };
}

module.exports = {
  applyCoupon,
  normalizeCouponCode
};

