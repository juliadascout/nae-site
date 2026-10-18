/* The question form on the Contact page.

   Sends the question to the Worker (worker/enquiries.js), which keeps it and
   has every administrator emailed; replying to that email answers the person
   who asked. Without this file the form does nothing, and the page says to
   call or email instead. */
(function () {
  /* Where the site sits on its domain, read from this file's own address, as
     checkout.js does. Taken now: document.currentScript only exists while the
     file first runs. */
  var BASE = (function () {
    var src = document.currentScript && document.currentScript.src;
    try { return src ? new URL(src).pathname.replace(/\/ask\.js$/, "") : ""; }
    catch (e) { return ""; }
  })();

  var root = document.getElementById("ask");
  var form = root && root.querySelector('[data-form="ask"]');
  if (!form) return;
  var msg = root.querySelector("[data-msg]");
  var button = form.querySelector('button[type="submit"]');
  var $ = function (id) { return document.getElementById(id); };
  var opened = Date.now();

  /* From a course page the link carries the course; choose it. */
  try {
    var wanted = (new URL(location.href).searchParams.get("course") || "").replace(/[^a-z0-9-]/gi, "");
    var select = $("ask-course");
    if (wanted && select && select.querySelector('option[value="' + wanted + '"]')) select.value = wanted;
  } catch (e) { /* no course chosen; nothing lost */ }

  function say(text, kind) {
    msg.textContent = text;
    msg.setAttribute("data-kind", kind || "error");
    msg.setAttribute("role", (kind || "error") === "error" ? "alert" : "status");
    msg.hidden = !text;
  }

  function track(name, params) {
    if (typeof window.gtag === "function") window.gtag("event", name, params || {});
  }

  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var q = {
      name: $("ask-name").value.trim(),
      email: $("ask-email").value.trim(),
      phone: $("ask-phone").value.trim(),
      courseId: $("ask-course").value,
      message: $("ask-message").value.trim(),
      website: $("ask-website").value,
      elapsed: Date.now() - opened,
    };
    if (!q.name) return say("Please tell us your name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q.email)) return say("Please check your email address: we answer there.");
    if (!q.message) return say("Please write your question.");

    button.disabled = true;
    say("Sending…", "info");
    fetch(BASE + "/api/enquiry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(q),
    })
      .then(function (r) {
        return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; },
                             function () { return { ok: false, status: r.status, j: {} }; });
      })
      .then(function (res) {
        button.disabled = false;
        if (!res.ok) {
          say(res.j.error || ("Something went wrong on our side (error " + res.status + "). " +
              "Call or email us instead."));
          return;
        }
        form.hidden = true;
        say("Thank you. Your question has been sent, and we will answer at " + q.email + ".", "done");
        /* Counted, never identified: no name, address or message goes to analytics. */
        track("generate_lead", { form: "question", course_id: q.courseId || undefined });
      })
      .catch(function () {
        button.disabled = false;
        say("We could not send your question just now. Call or email us instead.");
      });
  });
})();
