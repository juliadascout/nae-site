/* Your account: sign in, make an account, your details, and the links in
   account emails - choosing a new password, confirming an address.

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

  /* A link from one of our emails: #reset=... or #verify=... The script at
     the top of the page takes it off the address bar before anything else
     runs - analytics included - and leaves it in NAE_LINK (build.py,
     LINK_GUARD). Read from there, once. The part after # is never sent to
     any server. */
  function takeLink() {
    var raw = window.NAE_LINK || "";
    window.NAE_LINK = "";
    if (!raw && /^#(reset|verify)=/.test(location.hash)) {   // a page built without the guard
      raw = location.hash.slice(1);
      try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    }
    var m = /^(reset|verify)=([A-Za-z0-9_-]{20,100})$/.exec(raw);
    return m ? { kind: m[1], token: m[2] } : null;
  }
  var fromLink = takeLink();

  /* Whether the accounts system can send email just now. "Forgotten your
     password?" offers a link only when one can actually be sent. */
  var canEmail = false;

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

  /* A message at the top of whichever panel is showing. */
  function note(text, kind) {
    var p = root.querySelector("[data-panel]:not([hidden])");
    if (p) say(p, text, kind);
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
    $("[data-verify]").hidden = !!user.emailVerified || !canEmail;
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
      return;
    }
    var again = e.target.closest("[data-resend]");
    if (again) {
      again.disabled = true;
      call("verify/resend", {}).then(function (r) {
        again.disabled = false;
        if (r.ok) say("verify", "Sent. The link is in your inbox; if it is not there in a few minutes, look in junk.", "done");
        else say("verify", r.body.error || "Could not send it just now.");
      });
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
        say("me", "Welcome. Your account is ready.", "done");
      });
      return;
    }

    if (kind === "forgot") {
      var fe = val("fo-email").trim();
      if (!fe) return say(panel, "Enter the email address on your account.");
      busy(form, true);
      call("forgot", { email: fe }).then(function (r) {
        busy(form, false);
        if (!r.ok) return say(panel, r.body.error || "Could not send the email.");
        /* The same words whether or not there is an account with that
           address, because the accounts system gives the same answer. */
        say(panel, "If there is an account with that address, a link to choose a new password is on its way. " +
          "It works for an hour. If it is not in your inbox in a few minutes, look in junk.", "done");
      });
      return;
    }

    if (kind === "reset") {
      var rn = val("re-next");
      if (rn.length < 12) return say(panel, tooShort);
      if (rn !== val("re-again")) return say(panel, noMatch);
      if (!fromLink || fromLink.kind !== "reset") return say(panel, "Open the link from the email again.");
      busy(form, true);
      call("reset", { token: fromLink.token, next: rn }).then(function (r) {
        busy(form, false);
        if (!r.ok) return say(panel, r.body.error || "Could not save it.");
        fromLink = null;
        set("re-next", ""); set("re-again", "");
        refresh().then(function () { note("Your new password is saved, and you are signed in.", "done"); });
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

  /* Where to start: a link from an email, the forgot form, or whatever the
     session says. */
  function start() {
    if (fromLink && fromLink.kind === "reset") return show("reset");
    if (fromLink && fromLink.kind === "verify") {
      var token = fromLink.token;
      fromLink = null;
      return call("verify", { token: token }).then(function (v) {
        return refresh().then(function () {
          if (v.ok) note("Thank you: your email address is confirmed.", "done");
          else note(v.body.error || "That link did not work.");
        });
      });
    }
    if (location.hash === "#forgot" && canEmail) return show("forgot");
    return refresh();
  }

  call("status").then(function (r) {
    canEmail = !!(r.ok && r.body.email);
    root.querySelectorAll("[data-forgot-link]").forEach(function (n) { n.hidden = !canEmail; });
    root.querySelectorAll("[data-forgot-call]").forEach(function (n) { n.hidden = canEmail; });
    start();
  });

  /* A link opened in a tab that already shows this page changes only the
     part after #, which does not reload the page; the guard takes it and
     says so. */
  window.addEventListener("nae-link", function () {
    var link = takeLink();
    if (link) { fromLink = link; start(); }
  });
  window.addEventListener("hashchange", function () {
    if (location.hash === "#forgot" && canEmail) show("forgot");
  });
})();
