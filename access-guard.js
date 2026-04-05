(function () {
  var USERS_KEY = "parax_pro_users_v1";
  var SESSION_KEY = "parax_pro_session_v1";
  var PURCHASE_OWNER_KEY = "parax_pro_purchase_owner_v1";
  var HOME_URL = "index.html";

  function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function fallbackHash(input) {
    var hash = 0;
    var i;
    for (i = 0; i < input.length; i += 1) {
      hash = (hash << 5) - hash + input.charCodeAt(i);
      hash |= 0;
    }
    return String(hash);
  }

  async function hashPassword(password) {
    if (window.crypto && window.crypto.subtle && window.TextEncoder) {
      var encoded = new TextEncoder().encode(password);
      var digest = await window.crypto.subtle.digest("SHA-256", encoded);
      return Array.from(new Uint8Array(digest)).map(function (value) {
        return value.toString(16).padStart(2, "0");
      }).join("");
    }
    return fallbackHash(password);
  }

  function readUsers() {
    try {
      var raw = localStorage.getItem(USERS_KEY);
      var data = JSON.parse(raw || "[]");
      return Array.isArray(data) ? data : [];
    } catch (error) {
      return [];
    }
  }

  function findUserByEmail(email) {
    var users = readUsers();
    var normalized = normalizeEmail(email);
    return users.find(function (user) {
      return normalizeEmail(user.email) === normalized;
    }) || null;
  }

  function revealProtectedContent() {
    document.body.classList.remove("guard-pending");
  }

  function redirectHome() {
    window.location.replace(HOME_URL);
  }

  function ensureStyles() {
    if (document.getElementById("guardStyles")) return;

    var style = document.createElement("style");
    style.id = "guardStyles";
    style.textContent = [
      "body.guard-pending .wrap { visibility: hidden; }",
      ".guard-overlay { position: fixed; inset: 0; z-index: 9999; display: grid; place-items: center; padding: 16px; background: rgba(2,1,7,0.78); backdrop-filter: blur(6px); }",
      ".guard-card { width: min(460px, 100%); border: 1px solid rgba(124,58,237,0.55); border-radius: 18px; background: linear-gradient(180deg, rgba(14,9,26,0.98), rgba(8,5,16,0.98)); box-shadow: 0 30px 80px rgba(3,2,9,0.75); padding: 18px; color: #f7f5ff; font-family: 'Plus Jakarta Sans', sans-serif; }",
      ".guard-tag { margin: 0 0 10px; font-size: 0.75rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #c4b5fd; }",
      ".guard-title { margin: 0 0 8px; font-family: 'Space Grotesk', sans-serif; font-size: 1.55rem; line-height: 1.1; letter-spacing: -0.02em; }",
      ".guard-desc { margin: 0 0 14px; color: #b9b1d0; line-height: 1.55; font-size: 0.92rem; }",
      ".guard-form { display: grid; gap: 10px; }",
      ".guard-field { display: grid; gap: 6px; }",
      ".guard-field label { font-size: 0.78rem; color: #d7cfff; font-weight: 600; }",
      ".guard-field input { border: 1px solid rgba(124,58,237,0.36); border-radius: 11px; background: rgba(8,5,16,0.9); color: #f8f7ff; padding: 10px 11px; font-size: 0.92rem; font-family: inherit; outline: none; }",
      ".guard-field input:focus { border-color: rgba(167,139,250,0.82); box-shadow: 0 0 0 3px rgba(167,139,250,0.18); }",
      ".guard-actions { margin-top: 2px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }",
      ".guard-btn { border-radius: 11px; border: 1px solid rgba(124,58,237,0.4); padding: 11px 12px; font-family: 'Space Grotesk', sans-serif; font-size: 0.9rem; font-weight: 700; text-decoration: none; text-align: center; color: #ddd6fe; background: rgba(31,19,57,0.5); cursor: pointer; }",
      ".guard-btn.primary { color: #fff; border-color: rgba(167,139,250,0.78); background: linear-gradient(90deg, #6d28d9, #2563eb); box-shadow: 0 10px 24px rgba(109,40,217,0.32); }",
      ".guard-btn:disabled { opacity: 0.72; cursor: not-allowed; box-shadow: none; }",
      ".guard-error { margin: 10px 0 0; min-height: 18px; color: #fecdd3; font-size: 0.82rem; font-weight: 600; }",
      "@media (max-width: 520px) { .guard-actions { grid-template-columns: 1fr; } }"
    ].join("");
    document.head.appendChild(style);
  }

  function showLoginGate(ownerEmail) {
    ensureStyles();

    var overlay = document.createElement("div");
    overlay.className = "guard-overlay";
    overlay.innerHTML = [
      '<div class="guard-card" role="dialog" aria-modal="true" aria-labelledby="guardTitle">',
      '  <p class="guard-tag">Protected Access</p>',
      '  <h2 class="guard-title" id="guardTitle">Sign in to continue</h2>',
      '  <p class="guard-desc">For security, only the account that completed this purchase can access this page.</p>',
      '  <form class="guard-form" id="guardLoginForm">',
      '    <div class="guard-field">',
      '      <label for="guardEmail">Email</label>',
      '      <input id="guardEmail" type="email" autocomplete="email" required>',
      "    </div>",
      '    <div class="guard-field">',
      '      <label for="guardPassword">Password</label>',
      '      <input id="guardPassword" type="password" autocomplete="current-password" required>',
      "    </div>",
      '    <div class="guard-actions">',
      '      <a class="guard-btn" href="' + HOME_URL + '">Back to homepage</a>',
      '      <button class="guard-btn primary" id="guardSubmitBtn" type="submit">Sign in</button>',
      "    </div>",
      '    <p class="guard-error" id="guardError"></p>',
      "  </form>",
      "</div>"
    ].join("");

    document.body.appendChild(overlay);

    var form = document.getElementById("guardLoginForm");
    var emailInput = document.getElementById("guardEmail");
    var passwordInput = document.getElementById("guardPassword");
    var errorEl = document.getElementById("guardError");
    var submitBtn = document.getElementById("guardSubmitBtn");

    function setError(message) {
      errorEl.textContent = message || "";
    }

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      setError("");

      var email = normalizeEmail(emailInput.value);
      var password = String(passwordInput.value || "");

      if (!email || !password) return;

      if (email !== ownerEmail) {
        redirectHome();
        return;
      }

      var user = findUserByEmail(email);
      if (!user) {
        setError("Account not found.");
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = "Checking...";
      try {
        var passwordHash = await hashPassword(password);
        if (passwordHash !== user.passwordHash) {
          setError("Incorrect password.");
          return;
        }

        localStorage.setItem(SESSION_KEY, email);
        overlay.remove();
        revealProtectedContent();
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Sign in";
      }
    });
  }

  function init() {
    var ownerEmail = normalizeEmail(localStorage.getItem(PURCHASE_OWNER_KEY));
    var sessionEmail = normalizeEmail(localStorage.getItem(SESSION_KEY));

    if (!ownerEmail) {
      redirectHome();
      return;
    }

    if (sessionEmail) {
      if (sessionEmail === ownerEmail) {
        revealProtectedContent();
        return;
      }
      localStorage.removeItem(SESSION_KEY);
      redirectHome();
      return;
    }

    showLoginGate(ownerEmail);
  }

  init();
})();
