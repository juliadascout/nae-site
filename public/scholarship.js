/* The scholarship application (/scholarship/).

   Sends the application to the Worker (worker/scholarship.js), which keeps
   it, emails every administrator and the applicant, and - when a password is
   given - makes the applicant's account and signs this browser in.

   The answers are long, so they are kept on this device as they are typed
   (localStorage, this browser only) and cleared once the application is
   sent. A password is never kept. */
(function () {
  var BASE = (function () {
    var src = document.currentScript && document.currentScript.src;
    try { return src ? new URL(src).pathname.replace(/\/scholarship\.js$/, "") : ""; }
    catch (e) { return ""; }
  })();
  var CLOSES = Date.parse("2026-12-01T05:00:00Z");   // end of Nov 30, Ontario
  var KEEP = "nae-scholarship-draft";

  var root = document.getElementById("apply");
  var form = root && root.querySelector('[data-form="scholarship"]');
  if (!form) return;
  var msg = root.querySelector("[data-msg]");
  var button = form.querySelector('button[type="submit"]');
  var $ = function (id) { return document.getElementById("sch-" + id); };
  var opened = Date.now();

  if (Date.now() >= CLOSES) {
    form.hidden = true;
    root.querySelector("[data-closed]").hidden = false;
    return;
  }

  $("date").value = new Date().toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });

  var TEXT = ["name", "email", "phone", "place", "business", "web", "studio", "experience", "heard",
              "q1", "q2", "q3", "q4", "q5", "signature"];

  /* ---- the draft, on this device only ---- */
  function save() {
    try {
      var d = {};
      TEXT.forEach(function (k) { d[k] = $(k).value; });
      d.courses = checked();
      d.marketing = $("marketing").checked;
      localStorage.setItem(KEEP, JSON.stringify(d));
    } catch (e) { /* private window or storage off: nothing kept, nothing lost */ }
  }
  function restore() {
    try {
      var d = JSON.parse(localStorage.getItem(KEEP) || "null");
      if (!d) return;
      TEXT.forEach(function (k) { if (typeof d[k] === "string" && !$(k).value) $(k).value = d[k]; });
      (d.courses || []).forEach(function (id) {
        var box = form.querySelector('input[name="sch-course"][value="' + String(id).replace(/[^a-z0-9-]/gi, "") + '"]');
        if (box) box.checked = true;
      });
      if (d.courses && d.courses.length) form.querySelector(".sch-courses").open = true;
      $("marketing").checked = d.marketing === true;
    } catch (e) { /* a broken draft is ignored */ }
  }
  function checked() {
    return Array.prototype.map.call(form.querySelectorAll('input[name="sch-course"]:checked'), function (b) { return b.value; });
  }
  restore();
  var timer;
  form.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(save, 400); });
  form.addEventListener("change", save);

  /* ---- already signed in? then no password is asked for ---- */
  fetch(BASE + "/api/auth/me", { credentials: "same-origin" })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      var u = j && j.user;
      if (!u || !u.email) return;
      if (!$("name").value && u.name) $("name").value = u.name;
      if (!$("email").value) $("email").value = u.email;
      if (!$("phone").value && u.phone) $("phone").value = u.phone;
      form.querySelector("[data-acct]").hidden = true;
      var note = form.querySelector("[data-signed]");
      note.textContent = "You are signed in as " + u.email + ". Your application will be linked to your NAE account.";
      note.hidden = false;
    })
    .catch(function () { /* not signed in */ });

  function say(text, kind) {
    msg.textContent = text;
    msg.setAttribute("data-kind", kind || "error");
    msg.setAttribute("role", (kind || "error") === "error" ? "alert" : "status");
    msg.hidden = !text;
    if (text) msg.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function flag(id) {
    Array.prototype.forEach.call(form.querySelectorAll('[aria-invalid="true"]'), function (el) { el.removeAttribute("aria-invalid"); });
    var el = id && $(id);
    if (el) { el.setAttribute("aria-invalid", "true"); try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } }
  }
  function track(name, params) {
    if (typeof window.gtag === "function") window.gtag("event", name, params || {});
  }

  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var a = { website: $("website").value, elapsed: Date.now() - opened, courses: checked(),
              declared: $("declared").checked, marketing: $("marketing").checked, password: $("password").value };
    TEXT.forEach(function (k) { a[k] = $(k).value.trim(); });

    var need = [["name", "Please tell us your full name."],
                ["email", "Please enter your email address."],
                ["place", "Please tell us your city or region and country."],
                ["q1", "Please answer question 1."], ["q2", "Please answer question 2."],
                ["q3", "Please answer question 3."], ["q4", "Please answer question 4."]];
    for (var i = 0; i < need.length; i++) {
      if (!a[need[i][0]]) { flag(need[i][0]); return say(need[i][1]); }
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email)) { flag("email"); return say("Please check your email address: we contact you there."); }
    if (!a.declared) { flag("declared"); return say("Please tick the applicant declaration."); }
    if (!a.signature) { flag("signature"); return say("Please type your name as your signature."); }
    if (a.password && a.password.length < 12) { flag("password"); return say("For your account, use a password of at least 12 characters - or leave it empty."); }
    flag(null);

    button.disabled = true;
    button.textContent = "Sending…";
    say("");
    fetch(BASE + "/api/scholarship", {
      method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(a),
    })
      .then(function (r) {
        return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; },
                             function () { return { ok: false, status: r.status, j: {} }; });
      })
      .then(function (res) {
        button.disabled = false;
        button.textContent = "Submit my application";
        if (!res.ok) {
          if (res.j.field) flag(res.j.field);
          say(res.j.error || ("Something went wrong on our side (error " + res.status + "). Your answers are still here: please try again, or email us."));
          return;
        }
        try { localStorage.removeItem(KEEP); } catch (e) { /* nothing kept */ }
        form.hidden = true;
        var acct = res.j.account;
        var text = "Thank you! Your application has been sent. We have emailed a receipt to " + a.email +
          " and will contact you there about next steps.";
        if (acct === "created") text += " Your NAE account is ready and you are signed in.";
        else if (acct === "existing") text += " It is linked to your NAE account.";
        else if (acct === "failed") text += " We could not make your account just now" +
          (res.j.accountMessage ? " (" + res.j.accountMessage + ")" : "") + ", but your application is in. You can sign up any time on the Account page.";
        say(text, "done");
        if (acct === "created" || acct === "existing") {
          var p = document.createElement("p");
          p.innerHTML = '<a class="btn btn-p" href="' + BASE + '/account/">Go to my account</a> <a class="btn" href="' + BASE + '/courses/">See the courses</a>';
          msg.parentNode.insertBefore(p, msg.nextSibling);
        }
        /* Counted, never identified: nothing a person typed goes to analytics. */
        track("generate_lead", { form: "scholarship", account: acct || "none" });
        if (acct === "created") track("sign_up", { method: "scholarship" });
      })
      .catch(function () {
        button.disabled = false;
        button.textContent = "Submit my application";
        say("We could not send your application just now. Your answers are still here: please try again in a moment.");
      });
  });
})();
