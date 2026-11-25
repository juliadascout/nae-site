/* Black Friday workshops (/black-friday/, worker/blackfriday.js).

   "Reserve My Spot" sends the workshop, the studio and the kit choice to the
   checkout; the Worker decides the price and opens Stripe's page. Back from
   Stripe (?paid=...), the page says what happened, and a paid workshop is
   counted once in analytics. The booking and the email come from Stripe's
   signed webhook, never from this page. */
(function () {
  var root = document.getElementById("bf");
  if (!root) return;
  var msg = root.querySelector("[data-msg]");

  function say(text, kind) {
    msg.textContent = text || ""; msg.hidden = !text;
    msg.setAttribute("data-kind", kind || "error");
    msg.setAttribute("role", (kind || "error") === "error" ? "alert" : "status");
    if (text) msg.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  /* Google Analytics, and Meta when the site carries its pixel. */
  function track(name, params) {
    if (typeof window.gtag === "function") window.gtag("event", name, params || {});
    if (typeof window.naeMeta === "function") window.naeMeta(name, params || {});
  }
  function cad(v) { return Number(v).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  root.querySelectorAll("[data-offer]").forEach(function (card) {
    var go = card.querySelector("[data-go]");
    go.addEventListener("click", function () {
      var offer = card.getAttribute("data-offer");
      var kit = card.querySelector("[data-kit]");
      var body = { offer: offer, locationId: card.querySelector("[data-studio]").value, withKit: !!(kit && kit.checked) };
      go.disabled = true; go.textContent = "Opening checkout…"; say("");
      track("begin_checkout", { items: [{ item_id: offer, item_name: card.querySelector("h2").textContent }] });
      fetch("/api/checkout/session", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      }).then(function (r) {
        return r.json().then(function (j) { return { ok: r.ok, j: j }; }, function () { return { ok: false, j: {} }; });
      }).then(function (res) {
        if (res.ok && res.j.url) { location.assign(res.j.url); return; }
        go.disabled = false; go.textContent = "Reserve My Spot";
        say(res.j.error || "Checkout could not open. Please try again, or call us.");
      }).catch(function () {
        go.disabled = false; go.textContent = "Reserve My Spot";
        say("Could not reach the website just now. Please try again.");
      });
    });
  });

  /* Back from Stripe. The address is cleaned so a reload does not repeat it. */
  var params = new URLSearchParams(location.search);
  var sid = params.get("paid");
  if (params.get("checkout") === "cancelled") {
    history.replaceState(null, "", location.pathname);
    say("Checkout was cancelled. Your spot is not reserved yet.", "info");
    return;
  }
  if (!sid) return;
  history.replaceState(null, "", location.pathname);
  say("Checking your payment…", "info");
  fetch("/api/checkout/session?id=" + encodeURIComponent(sid), { cache: "no-store" })
    .then(function (r) { return r.json(); })
    .then(function (s) {
      var amt = s.total ? " ($" + cad(s.total) + " " + s.currency + ")" : "";
      if (s.paid) {
        if (s.simulated) {
          say("TEST PURCHASE (no money moved). A student sees: You're booked" + amt + ". Your confirmation and workshop details are on their way by email.", "done");
          return;
        }
        var key = "nae-purchase-" + sid, seen = false;
        try { seen = sessionStorage.getItem(key) === "1"; sessionStorage.setItem(key, "1"); } catch (e) { /* private mode */ }
        if (!seen) track("purchase", { transaction_id: s.reference, value: Number(s.total), currency: s.currency, items: [{ item_id: s.courseId }] });
        say("You're booked" + amt + ". Your confirmation and workshop details are on their way by email. If it isn't in your inbox within 10 minutes, check your junk folder.", "done");
      } else if (s.pending) {
        say("Your bank payment is on its way. We'll email you once it clears and your spot is confirmed.", "info");
      } else {
        say("We couldn't confirm the payment. If you were charged, call " + "289-968-2028" + " and we'll sort it out.");
      }
    })
    .catch(function () { say("We couldn't check the payment just now. Your confirmation email is the record."); });
})();
