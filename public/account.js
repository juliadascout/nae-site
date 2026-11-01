/* Your account: sign in (with Google, or an email and password), make an
   account, the links in account emails - choosing a new password, confirming
   an address - and, once signed in, the account dashboard.

   THE DASHBOARD shows the tabs the account's role calls for, and nothing
   else: a student sees their courses; somebody who works with us sees the
   work tools their role opens; everyone has their details and a
   Sign-in & security tab, which is where the password lives - offered, not
   pushed at people the moment they arrive. Each tab is an address
   (#courses, #tools, ...), so the back button and a bookmark work.

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

  /* Back from Google: #google=<what happened>, set by the accounts system
     (nae-inc worker/google.js). Read once and taken off the address bar. */
  var GOOGLE_SAYS = {
    in: "",
    linked: "Google is connected. Next time, sign in with one tap.",
    cancelled: "Google sign-in was cancelled. Nothing was changed.",
    expired: "That Google sign-in timed out or was finished in another browser. Please try again.",
    unverified: "Google has not confirmed that email address yet, so we cannot use it. Confirm it with Google, or sign in with your email and password.",
    taken: "That Google account is already connected to a different account here.",
    off: "Signing in with Google is not available just now. Use your email and password.",
    admin: "That address is set up through the work tools. Sign in there first, then connect Google here.",
    busy: "Too many new accounts from this connection. Try again in an hour.",
    failed: "Google sign-in did not go through. Try again, or use your email and password.",
    connect: "Your account opens the work tools, so Google has to be connected from inside it first. Sign in with your email and password, then go to Security and choose Connect Google.",
    other: "A different Google account is already connected to this email's account. Use that one, or sign in with your email and password.",
    reauth: "For your security, sign in again, then connect Google straight away.",
  };
  var fromGoogle = (function () {
    var m = /^#google=([a-z]{2,12})$/.exec(location.hash);
    if (!m) return null;
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    return Object.prototype.hasOwnProperty.call(GOOGLE_SAYS, m[1]) ? m[1] : "failed";
  })();
  var canGoogle = false;

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
    /* Signed in, the page is one wide column; the sign-in notes go. */
    var two = root.closest(".two");
    if (two) two.classList.toggle("solo", name === "me");
    root.querySelectorAll("[data-msg]").forEach(function (m) { m.hidden = true; });
    /* Focus the first box - except on the dashboard, and where Google is
       offered: on a phone the keyboard would cover the Google button. */
    var first = $('[data-panel="' + name + '"] input:not([type=hidden])');
    if (first && name !== "me" && !(canGoogle && (name === "signin" || name === "signup"))) first.focus();
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
      return r.json().catch(function () { return null; })
        .then(function (j) {
          /* A refusal comes as JSON with its reason. Anything else - an error
             page from Cloudflare, a timeout - is a fault on our side, and is
             said so, with the code that tells us which fault it was. */
          if (!j && !r.ok) {
            j = { error: "Something went wrong on our side (error " + r.status + "). Try again in a minute; if it keeps happening, call or email us." };
          }
          return { ok: r.ok, status: r.status, body: j || {} };
        });
    }).catch(function () {
      return { ok: false, status: 0, body: { error: "Could not reach us just now. Check your connection and try again." } };
    });
  }

  /* The temporary password somebody was handed, kept in memory between
     signing in with it and replacing it, so they are not asked to type it
     twice. Never stored anywhere. */
  var temporary = "";

  /* A sign-in waiting on the code emailed to a new device: the ticket the
     accounts system gave this browser for it, and what was typed, so "send a
     new code" can sign in again. In memory only. */
  var awaiting = null;

  function showCode(b) {
    $("[data-code-where]").textContent = "We sent a six-digit code to " + b.sentTo + ". It works for " + b.minutes + " minutes.";
    set("cd-code", "");
    show("code");
  }

  /* ------------------------------------------------------- dashboard */

  var ROLE = { admin: "Administrator", staff: "Staff", instructor: "Instructor" };
  var me = null;            // { user, apps, google } from /api/auth/me
  var courseCount = null;   // null until loaded

  /* What each role opens in the apps. The apps decide what is actually
     allowed (nae-inc worker/auth.js, CAN); this only offers the doors that
     will open. */
  function toolsFor(role, apps) {
    if (!apps || !ROLE[role]) return [];
    var base = apps.replace(/\/?$/, "/");
    var t = [{ name: "Hours & invoices", what: "Log your hours and see your invoices", href: base }];
    if (role === "staff" || role === "admin") {
      t.push({ name: "Contacts", what: "Leads, students and follow-ups", href: base + "crm.html" });
      t.push({ name: "Inventory", what: "Stock and kits", href: base + "inventory.html" });
    }
    if (role === "admin") t.push({ name: "People", what: "Accounts, roles and access requests", href: base + "users.html" });
    return t;
  }

  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text != null) n.textContent = text;
    return n;
  }
  function tabLink(name) { return $('[data-tab="' + name + '"]'); }

  function tab(name, keepHash) {
    var link = tabLink(name);
    if (!link || link.hidden) name = "home";
    root.querySelectorAll("[data-tab]").forEach(function (a) {
      a.setAttribute("aria-selected", a.getAttribute("data-tab") === name ? "true" : "false");
    });
    root.querySelectorAll("[data-tabpanel]").forEach(function (p) {
      p.hidden = p.getAttribute("data-tabpanel") !== name;
    });
    var on = tabLink(name);
    if (on && on.scrollIntoView) { try { on.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (e) {} }
    if (!keepHash) {
      try { history.replaceState(null, "", location.pathname + location.search + (name === "home" ? "" : "#" + name)); } catch (e) {}
    }
    if (name === "courses") loadCourses();
  }

  function tiles() {
    var box = $("[data-tiles]");
    box.textContent = "";
    var role = me.user.role, staff = !!ROLE[role];
    var list = [];
    if (staff && me.apps) list.push(["#tools", "Work tools", "What your role opens"]);
    if (!staff || courseCount) list.push(["#courses", "My courses", courseCount ? courseCount + (courseCount === 1 ? " course" : " courses") : "What you have booked"]);
    if (!staff) {
      list.push([BASE + "/courses/", "Browse courses", "Find your next course"]);
      var book = $("[data-courses-empty] a[rel]");
      if (book) list.push([book.href, "Book a call", "Talk it through with us"]);
    }
    list.push(["#details", "Your details", "Name and phone"]);
    list.push(["#security", "Sign-in & security", me.google ? "Google connected" : (me.user.hasPassword ? "Password" : "Signed in with Google")]);
    list.forEach(function (t) {
      var a = el("a", { class: "dash-tile", href: t[0] });
      a.appendChild(el("strong", null, t[1]));
      a.appendChild(el("span", null, t[2]));
      box.appendChild(a);
    });
  }

  function loadCourses(force) {
    if (courseCount !== null && !force) return Promise.resolve();
    return fetch(BASE + "/api/account/courses", { credentials: "same-origin", cache: "no-store" })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j || {} }; }); })
      .catch(function () { return { ok: false, body: {} }; })
      .then(function (r) {
        var list = $("[data-courses]");
        list.textContent = "";
        if (!r.ok) {
          say("courses", r.body.error || "Your courses could not be loaded just now.");
          return;
        }
        var cs = r.body.courses || [];
        courseCount = cs.length;
        cs.forEach(function (c) {
          var li = el("li");
          var what = el("div", { class: "what" });
          var name = c.url ? el("a", { href: BASE + c.url }, c.name) : el("span", null, c.name);
          var strong = el("strong"); strong.appendChild(name); what.appendChild(strong);
          var bits = [];
          if (c.paidAt) bits.push(new Date(c.paidAt).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" }));
          if (c.studio) bits.push(c.studio);
          if (c.withKit) bits.push("with kit");
          what.appendChild(el("span", null, bits.join(" · ")));
          li.appendChild(what);
          li.appendChild(el("span", { class: "dash-status" }, c.status));
          list.appendChild(li);
        });
        $("[data-courses-empty]").hidden = cs.length > 0 || !!r.body.confirmEmail;
        if (r.body.confirmEmail) say("courses", "Confirm your email address and the courses you paid for with it will show here.", "done");
        /* Somebody who works with us sees My courses only once they have one. */
        if (ROLE[me.user.role]) tabLink("courses").hidden = !cs.length;
        tiles();
      });
  }

  function security() {
    var g = me.google;
    $("[data-google-linked]").hidden = !canGoogle && !g ? true : !g;
    $("[data-google-unlinked]").hidden = !canGoogle || !!g;
    $("[data-google-off]").hidden = canGoogle || !!g;
    if (g) $("[data-google-email]").textContent = g.email;
    $("[data-unlink]").hidden = !me.user.hasPassword;
    var has = me.user.hasPassword;
    $("[data-pw-summary]").textContent = has
      ? "You can also sign in with your email and password."
      : "You sign in with Google. Add a password if you would also like to sign in with your email.";
    $("[data-pw-open]").textContent = has ? "Change password" : "Set a password";
    $("[data-pw-current]").hidden = !has;
    $("[data-pw-save]").textContent = has ? "Save new password" : "Save password";
    $("[data-pw-note]").textContent = has
      ? "Saving it signs you out everywhere else" + (me.google ? " and disconnects Google." : ".")
      : "Saving it signs you out everywhere else.";
    closePassword();
  }
  function closePassword() {
    var f = $('[data-form="password"]');
    f.reset(); f.hidden = true;
    $("[data-pw-open]").hidden = false;
  }

  function signedIn(user, apps, google) {
    if (user.mustChange) {
      show("change");
      var cur = document.getElementById("ch-current");
      if (cur) cur.closest("label").hidden = !!temporary;
      return;
    }
    me = { user: user, apps: apps || null, google: google || null };
    $("[data-hello]").textContent = user.name ? "Hello, " + user.name.split(" ")[0] : "Hello";
    $("[data-email]").textContent = user.email;
    var chip = $("[data-role]");
    chip.textContent = ROLE[user.role] || "";
    chip.hidden = !ROLE[user.role];
    set("me-email", user.email);
    set("me-name", user.name || "");
    set("me-phone", user.phone || "");
    $("[data-verify]").hidden = !!user.emailVerified || !canEmail;

    var tools = toolsFor(user.role, apps);
    var tl = $("[data-tools]");
    tl.textContent = "";
    tools.forEach(function (t) {
      var a = el("a", { class: "dash-tile", href: t.href, target: "_blank", rel: "noopener" });
      a.appendChild(el("strong", null, t.name + " \u2197"));
      a.appendChild(el("span", null, t.what));
      tl.appendChild(a);
    });
    tabLink("tools").hidden = !tools.length;
    /* A student's courses are the point of the page; for staff the tab waits
       until there is something in it (loadCourses). */
    tabLink("courses").hidden = !!ROLE[user.role];
    security();
    courseCount = null;
    tiles();
    show("me");
    tab((location.hash || "").replace(/^#/, "") || "home", true);
    loadCourses();
  }

  function refresh() {
    return call("me").then(function (r) {
      if (r.ok && r.body.user) return signedIn(r.body.user, r.body.apps, r.body.google);
      show(location.hash === "#new" ? "signup" : "signin");
    });
  }

  root.addEventListener("click", function (e) {
    var t = e.target.closest("[data-show]");
    if (t) { e.preventDefault(); show(t.getAttribute("data-show")); return; }
    if (e.target.closest("[data-signout]")) {
      call("logout", {}).then(function () {
        temporary = ""; me = null;
        try { history.replaceState(null, "", location.pathname + location.search); } catch (x) {}
        show("signin");
      });
      return;
    }
    /* Sign in with Google: a plain navigation, so the browser carries the
       cookies to Google and back. */
    var g = e.target.closest("[data-google-go], [data-google-link]");
    if (g) {
      e.preventDefault();
      track(g.hasAttribute("data-google-link") ? "google_connect" : "login_start", { method: "google" });
      location.assign(BASE + "/api/auth/google/start" + (g.hasAttribute("data-google-link") ? "?mode=link" : ""));
      return;
    }
    if (e.target.closest("[data-pw-open]")) {
      var f = $('[data-form="password"]');
      f.hidden = false;
      e.target.closest("[data-pw-open]").hidden = true;
      var first = f.querySelector("label:not([hidden]) input, span:not([hidden]) input");
      if (first) first.focus();
      return;
    }
    if (e.target.closest("[data-pw-cancel]")) { closePassword(); return; }
    var un = e.target.closest("[data-unlink]");
    if (un) {
      un.disabled = true;
      call("google/unlink", {}).then(function (r) {
        un.disabled = false;
        if (!r.ok) return say("google", r.body.error || "Could not disconnect Google just now.");
        me.google = null; security(); tiles();
        say("google", "Google is disconnected. Sign in with your email and password from now on.", "done");
      });
      return;
    }
    /* A new code is a new sign-in with what was typed before. */
    if (e.target.closest("[data-code-again]")) {
      e.preventDefault();
      if (!awaiting) return show("signin");
      call("login", { email: awaiting.email, password: awaiting.pw }).then(function (r) {
        if (!r.ok) return say($('[data-panel="code"]'), r.body.error || "Could not send a new code.");
        if (r.body.code) { awaiting.ticket = r.body.ticket; say($('[data-panel="code"]'), "A new code is on its way.", "done"); }
      });
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
        set("si-password", "");
        if (r.body.code) {
          awaiting = { email: email, pw: pw, ticket: r.body.ticket };
          return showCode(r.body);
        }
        track("login", { method: "email" });
        if (r.body.user && r.body.user.mustChange) temporary = pw;
        refresh();
      });
      return;
    }

    if (kind === "code") {
      var digits = val("cd-code").replace(/\D/g, "");
      if (digits.length !== 6) return say(panel, "Enter the six digits from the email.");
      if (!awaiting) return show("signin");
      busy(form, true);
      call("login/code", { ticket: awaiting.ticket, code: digits }).then(function (r) {
        busy(form, false);
        if (!r.ok) return say(panel, r.body.error || "Could not sign you in.");
        track("login", { method: "email" });
        if (r.body.user && r.body.user.mustChange) temporary = awaiting.pw;
        awaiting = null;
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
        signedIn(r.body.user, null, null);
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
      var had = me && me.user.hasPassword;
      if (had && !val("pw-current")) return say("password", "Enter your current password.");
      if (n2.length < 12) return say("password", tooShort);
      if (n2 !== val("pw-again")) return say("password", noMatch);
      busy(form, true);
      call("password", { current: val("pw-current"), next: n2 }).then(function (r) {
        busy(form, false);
        if (!r.ok) return say("password", r.body.error || "Could not save it.");
        if (me) { me.user.hasPassword = true; security(); tiles(); }
        if (had && me) { me.google = null; security(); tiles(); }
        say("password", had ? "Changed. You have been signed out everywhere else, and Google is disconnected."
                            : "Saved. You can now sign in with your email and this password too.", "done");
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
    if (fromGoogle) {
      var said = GOOGLE_SAYS[fromGoogle], what = fromGoogle;
      fromGoogle = null;
      if (what === "in") track("login", { method: "google" });
      return refresh().then(function () {
        if (!said) return;
        if (me) {
          if (what === "linked" || what === "taken" || what === "reauth") { tab("security"); say("google", said, what === "linked" ? "done" : "error"); }
          else note(said, "error");
        } else say($('[data-panel="signin"]'), said, what === "cancelled" ? "done" : "error");
      });
    }
    return refresh();
  }

  call("status").then(function (r) {
    canEmail = !!(r.ok && r.body.email);
    canGoogle = !!(r.ok && r.body.google);
    root.querySelectorAll("[data-google]").forEach(function (n) { n.hidden = !canGoogle; });
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
  /* The tabs are addresses: a tile, the back button or a bookmark changes
     the part after #, and this follows it. */
  window.addEventListener("hashchange", function () {
    if (location.hash === "#forgot" && canEmail) return show("forgot");
    if (me && !$('[data-panel="me"]').hidden) tab(location.hash.replace(/^#/, "") || "home", true);
  });
})();
