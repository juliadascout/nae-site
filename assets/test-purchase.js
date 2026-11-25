/* Staff test purchases (/account/test-purchase/, worker/simulate.js). */
(function () {
  var root = document.getElementById("tp");
  var form = root && root.querySelector('[data-form="tp"]');
  if (!form) return;
  var msg = root.querySelector("[data-msg]");
  var done = root.querySelector("[data-done]");
  var $ = function (id) { return document.getElementById("tp-" + id); };
  function say(text, kind) {
    msg.textContent = text; msg.hidden = !text;
    msg.setAttribute("data-kind", kind || "error");
    msg.setAttribute("role", (kind || "error") === "error" ? "alert" : "status");
  }
  function send(body) {
    return fetch("/api/admin/test-purchase", {
      method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, j: j }; }, function () { return { ok: false, j: {} }; });
    });
  }
  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var offer = $("offer") ? $("offer").value : "";
    if (!offer && !$("course").value) return say("Choose a course or a Black Friday workshop.");
    if (offer && !$("studio").value) return say("Choose the studio for the workshop.");
    var b = form.querySelector("button"); b.disabled = true; say("Working…", "info");
    send({ email: $("email").value.trim(), name: $("name").value.trim(), courseId: $("course").value, offer: offer || undefined,
           locationId: $("studio").value, withKit: $("kit").checked })
      .then(function (res) {
        b.disabled = false;
        if (!res.ok) return say(res.j.error || "That did not work.");
        say("Done: a test purchase of $" + res.j.total + " " + res.j.currency + " was recorded and the emails are on their way.", "done");
        var a = root.querySelector("[data-landing]");
        if (res.j.landing) { a.href = res.j.landing; a.target = "_blank"; a.rel = "noopener"; }
        done.hidden = false;
      })
      .catch(function () { b.disabled = false; say("Could not reach the website just now."); });
  });
  root.querySelector("[data-clear]").addEventListener("click", function () {
    if (!confirm("Remove every test purchase?")) return;
    send({ clear: true }).then(function (res) {
      say(res.ok ? "Removed " + res.j.removed + " test purchase(s)." : (res.j.error || "That did not work."), res.ok ? "done" : "error");
    });
  });
})();
