/* Paying for a course, from inside the booking card.

   The page knows a course id and whether the kit is wanted. It never knows an
   amount: the Worker prices the order from the catalogue, so editing anything
   here changes nothing about what is charged. The total shown is the one the
   Worker returns, not a second sum computed in the browser - two places doing
   the same arithmetic is two places to disagree, and the number the buyer
   reads has to be the number they pay.

   Renders nothing at all unless the Worker says checkout is open, so this file
   is inert on a site that has not switched it on. */
(function () {
  var mount = document.getElementById("checkout");
  if (!mount) return;

  var courseId = mount.getAttribute("data-course");
  var kitCost = Number(mount.getAttribute("data-kit") || 0);
  var wantKit = false;
  var panel, summary, buttons;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }

  function say(msg, kind) {
    var host = panel || mount;
    var n = host.querySelector(".co-msg") || host.appendChild(el("p", "co-msg"));
    n.textContent = msg;
    n.setAttribute("data-kind", kind || "info");
    n.setAttribute("role", kind === "error" ? "alert" : "status");
  }

  fetch("/api/checkout/config")
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (cfg) {
      if (!cfg || !cfg.enabled || !cfg.clientId) return;   // stays hidden
      mount.hidden = false;
      arm(cfg);
    })
    .catch(function () { /* no checkout, no noise */ });

  /* Booking a call stays the first action in this card. Paying is a deliberate
     second choice behind a toggle, and the SDK is only fetched once somebody
     asks for it - a page nobody buys from never loads PayPal at all. */
  function arm(cfg) {
    var toggle = el("button", "btn btn-g btn-blk co-toggle", "Buy now");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "false");

    panel = el("div", "co-panel");
    panel.hidden = true;

    mount.appendChild(toggle);
    mount.appendChild(panel);

    var built = false;
    toggle.addEventListener("click", function () {
      var open = panel.hidden;
      panel.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      toggle.textContent = open ? "Close" : "Buy now";
      if (open && !built) { built = true; build(cfg); }
    });
  }

  /* Our own content first - the kit choice, the price and the policy - so the
     buyer sees what they are agreeing to whether or not a third-party script
     ever arrives. Only the buttons wait on PayPal. */
  function build(cfg) {
    if (cfg.mode !== "live") {
      panel.appendChild(el("p", "co-test", "Test mode — no real payment is taken."));
    }

    if (kitCost > 0) {
      var row = el("label", "co-kit");
      var box = el("input");
      box.type = "checkbox";
      box.id = "co-kit-toggle";
      row.appendChild(box);
      row.appendChild(el("span", null, "Add the optional kit (+$" + kitCost.toLocaleString() + ")"));
      panel.appendChild(row);
      box.addEventListener("change", function () {
        wantKit = box.checked;
        quote();
        if (buttons) { buttons.innerHTML = ""; paint(); }
      });
    }

    summary = panel.appendChild(el("div", "co-sum"));

    var policy = el("p", "co-policy");
    policy.appendChild(document.createTextNode("Paying accepts our "));
    var a = document.createElement("a");
    a.href = "/about-national-association-of-estheticians-beauty-school/#refunds";
    a.textContent = "refund and cancellation policy";
    policy.appendChild(a);
    policy.appendChild(document.createTextNode("."));
    panel.appendChild(policy);

    buttons = panel.appendChild(el("div", "co-buttons"));

    quote();
    loadSdk(cfg);
  }

  function quote() {
    if (!summary) return;
    summary.textContent = "";
    fetch("/api/checkout/quote?courseId=" + encodeURIComponent(courseId) + "&kit=" + (wantKit ? "1" : "0"))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (q) {
        if (!q) return;
        var rows = q.items.map(function (i) { return [i.name, "$" + i.value]; });
        rows.push(["HST (" + q.taxPercent + "%)", "$" + q.tax]);
        rows.forEach(function (r) {
          var line = el("div", "co-row");
          line.appendChild(el("span", null, r[0]));
          line.appendChild(el("span", "tnum", r[1]));
          summary.appendChild(line);
        });
        var tot = el("div", "co-row co-total");
        tot.appendChild(el("span", null, "Total"));
        tot.appendChild(el("span", "tnum", "$" + q.total + " " + q.currency));
        summary.appendChild(tot);
      })
      .catch(function () { /* the buttons still show the real amount */ });
  }

  function loadSdk(cfg) {
    var s = document.createElement("script");
    s.src = "https://www.paypal.com/sdk/js?client-id=" + encodeURIComponent(cfg.clientId) +
            "&currency=" + encodeURIComponent(cfg.currency) + "&intent=capture";
    s.onload = paint;
    s.onerror = function () {
      say("Card payment is unavailable right now — please book a call and we will invoice you.", "error");
    };
    document.head.appendChild(s);
  }

  function paint() {
    if (!window.paypal || !buttons) return;
    window.paypal.Buttons({
      style: { layout: "vertical", shape: "rect", label: "pay" },

      createOrder: function () {
        return fetch("/api/checkout/order", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ courseId: courseId, withKit: wantKit })
        })
          .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
          .then(function (res) {
            if (!res.ok) throw new Error(res.j.error || "Could not start the payment");
            return res.j.id;
          });
      },

      onApprove: function (data) {
        say("Completing your payment…");
        return fetch("/api/checkout/capture", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orderId: data.orderID })
        })
          .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
          .then(function (res) {
            if (!res.ok) throw new Error(res.j.error || "Could not complete the payment");
            var amt = res.j.amount ? res.j.amount.value + " " + res.j.amount.currency_code : "";
            buttons.hidden = true;
            say("Paid" + (amt ? " — " + amt : "") + ". We will be in touch to book your dates.", "done");
          })
          .catch(function (e) { say(e.message, "error"); });
      },

      onError: function () {
        say("Something went wrong with the payment. Nothing has been charged.", "error");
      },

      onCancel: function () { say("Payment cancelled. Nothing has been charged."); }
    }).render(buttons);
  }
})();
