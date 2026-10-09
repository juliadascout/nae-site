/* Your account: sign in, make an account, your details.

   One account for the website and the apps. Everything here goes to
   /api/auth/*, which the Worker passes to the accounts system (nae-inc); this
   file decides nothing about who may do what, it only shows the answer. The
   session is an HttpOnly cookie that script on this page cannot read.

   No framework, and nothing loaded from anywhere else: this is how somebody
   gets in, so it has to work when a CDN does not. */
(function () {
  /* Where the site sits on its domain - "" at the root, "/beauty-school" in a
     subfolder - read from this file's own address, as checkout.js does. */
  var BASE = (function () {
    var src = document.currentScript && document.currentScript.src;
    try { return src ? new URL(src).pathname.replace(/\/account\.js$/, "") : ""; }
    catch (e) { return ""; }
  })();

  var root = document.getElementById("acct");
  if (!root) return;

  function track(name, params) {
    if (typeof window.gtag === "function") window.gtag("event", name, params || {});
  }

  function $(sel) { return root.querySelector(sel); }
  function val(id) { var n = document.getElementById(id); return n ? n.value : ""; }
  function set(id, v) { var n = document.getElementById(id); if (n) n.value = v; }

  function show(name) {
    root.querySelectorAll("[data-panel]").forEach(function (p) {
      p.hidden = p.getAttribute("data-panel") !== name;
    });
    root.querySelectorAll("[data-msg]").forEach(function (m) { m.hidden = true; });
    var first = $('[data-panel="' + name + '"] input:not([type=hidden])');
    if (first && name !== "me") first.focus();
  }

  function say(where, text, kind) {
    var m = typeof where === "string" ? $('[data-msg="' + where + '"]') : where.querySelector("[data-msg]");
    if (!m) return;
    m.textContent = text;
    m.setAttribute("data-kind", kind || "error");
    m.setAttribute("role", kind === "done" ? "status" : "alert");
    m.hidden = !text;
  }

  function busy(form, on) {
    var b = form.querySelector('button[type="submit"]');
    if (!b) return;
    b.disabled = !!on;
    if (on) { b.dataset.was = b.textContent; b.textContent = "Working…"; }
    else if (b.dataset.was) b.textContent = b.dataset.was;
  }

  function call(path, body, method) {
    return fetch(BASE + "/api/auth/" + path, {
      method: method || (body ? "POST" : "GET"),
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
    }).then(function (r) {
      return r.json().catch(function () { return {}; })
        .then(function (j) { return { ok: r.ok, status: r.status, body: j || {} }; });
    }).catch(function () {
      return { ok: false, status: 0, body: { error: "Could not reach us just now. Check your connection and try again." } };
    });
  }

  /* The temporary password somebody was handed, kept in memory between
     signing in with it and replacing it, so they are not asked to type it
     twice. Never stored anywhere. */
  var temporary = "";

  function signedIn(user, apps) {
    if (user.mustChange) {
      show("change");
      var cur = document.getElementById("ch-current");
      if (cur) cur.closest("label").hidden = !!temporary;
      return;
    }
    $("[data-hello]").textContent = user.name ? "Hello, " + user.name.split(" ")[0] : "Hello";
    $("[data-email]").textContent = "Signed in as " + user.email;
    set("me-name", user.name || "");
    set("me-phone", user.phone || "");
    var box = $("[data-apps]");
    if (apps) { $("[data-apps-link]").href = apps; box.hidden = false; }
    else box.hidden = true;
    show("me");
  }

  function refresh() {
    return call("me").then(function (r) {
      if (r.ok && r.body.user) return signedIn(r.body.user, r.body.apps);
      show(location.hash === "#new" ? "signup" : "signin");
    });
  }

  root.addEventListener("click", function (e) {
    var t = e.target.closest("[data-show]");
    if (t) { e.preventDefault(); show(t.getAttribute("data-show")); return; }
    if (e.target.closest("[data-signout]")) {
      call("logout", {}).then(function () { temporary = ""; show("signin"); });
    }
  });

  var tooShort = "Use at least 12 characters.";
  var noMatch = "Those two passwords do not match.";

  root.addEventListener("submit", function (e) {
    var form = e.target.closest("form[data-form]");
    if (!form) return;
    e.preventDefault();
    var kind = form.getAttribute("data-form");
    var panel = form.closest("[data-panel]");

    if (kind === "signin") {
      var email = val("si-email").trim(), pw = val("si-password");
      if (!email || !pw) return say(panel, "Enter your email and password.");
      busy(form, true);
      call("login", { email: email, password: pw }).then(function (r) {
        busy(form, false);
        if (!r.ok) return say(panel, r.body.error || "Could not sign you in.");
        track("login", { method: "email" });
        set("si-password", "");
        if (r.body.user && r.body.user.mustChange) temporary = pw;
        refresh();
      });
      return;
    }

    if (kind === "signup") {
      var p1 = val("su-password");
      if (!val("su-name").trim()) return say(panel, "Add your name.");
      if (!val("su-email").trim()) return say(panel, "Add your email.");
      if (p1.length < 12) return say(panel, tooShort);
      if (p1 !== val("su-again")) return say(panel, noMatch);
      busy(form, true);
      call("signup", {
        name: val("su-name"), email: val("su-email"), phone: val("su-phone"), password: p1,
      }).then(function (r) {
        busy(form, false);
        if (!r.ok) return say(panel, r.body.error || "Could not make your account.");
        track("sign_up", { method: "email" });
        set("su-password", ""); set("su-again", "");
        signedIn(r.body.user, null);
      });
      return;
    }

    if (kind === "change") {
      var next = val("ch-next");
      if (next.length < 12) return say(panel, tooShort);
      if (next !== val("ch-again")) return say(panel, noMatch);
      var current = temporary || val("ch-current");
      if (!current) return say(panel, "Enter the temporary password you were given.");
      busy(form, true);
      call("password", { current: current, next: next }).then(function (r) {
        busy(form, false);
        if (!r.ok) return say(panel, r.body.error || "Could not change it.");
        temporary = "";
        set("ch-next", ""); set("ch-again", ""); set("ch-current", "");
        refresh();
      });
      return;
    }

    if (kind === "details") {
      busy(form, true);
      call("profile", { name: val("me-name"), phone: val("me-phone") }, "PATCH").then(function (r) {
        busy(form, false);
        if (!r.ok) return say("details", r.body.error || "Could not save.");
        if (r.body.user && r.body.user.name) $("[data-hello]").textContent = "Hello, " + r.body.user.name.split(" ")[0];
        say("details", "Saved.", "done");
      });
      return;
    }

    if (kind === "password") {
      var n2 = val("pw-next");
      if (n2.length < 12) return say("password", tooShort);
      if (n2 !== val("pw-again")) return say("password", noMatch);
      busy(form, true);
      call("password", { current: val("pw-current"), next: n2 }).then(function (r) {
        busy(form, false);
        if (!r.ok) return say("password", r.body.error || "Could not change it.");
        form.reset();
        say("password", "Changed. You have been signed out everywhere else.", "done");
      });
    }
  });

  refresh();
})();
