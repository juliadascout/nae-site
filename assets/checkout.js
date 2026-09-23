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

  /* The funnel, reported as it happens.

     view_item already fires from events.js. Everything after it was missing,
     so the property could show visits to a course page and nothing at all
     about whether anyone tried to buy, got as far as the button, or paid -
     which is the only part that answers "is this working".

     Guarded: if the tag is blocked or absent, these are silent and the page
     behaves identically. */
  function track(name, params) {
    if (typeof window.gtag === "function") window.gtag("event", name, params || {});
  }

  var lastQuote = null;   // the server's numbers, reused so reports match invoices
  function ecommerce(extra) {
    var q = lastQuote;
    if (!q) return extra || {};
    var payload = {
      currency: q.currency,
      value: Number(q.total),
      items: q.items.map(function (i, n) {
        return { item_id: courseId + (n ? "-kit" : ""), item_name: i.name, price: Number(i.value), quantity: 1 };
      }),
    };
    for (var k in (extra || {})) payload[k] = extra[k];
    return payload;
  }

  var courseId = mount.getAttribute("data-course");
  var kitCost = Number(mount.getAttribute("data-kit") || 0);
  var studios = (mount.getAttribute("data-studios") || "")
    .split("|").filter(Boolean)
    .map(function (pair) {
      var i = pair.indexOf(":");
      return { id: pair.slice(0, i), name: pair.slice(i + 1) };
    });
  var studioSelect = null;
  function chosenLocation() {
    if (studioSelect) return studioSelect.value || null;
    return studios.length === 1 ? studios[0].id : null;
  }
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
        track(box.checked ? "add_to_cart" : "remove_from_cart", {
          currency: "CAD", value: kitCost,
          items: [{ item_id: courseId + "-kit", item_name: "Kit", price: kitCost, quantity: 1 }],
        });
        quote();
        if (buttons) { buttons.innerHTML = ""; paint(); }
      });
    }

    /* Where they are going. One studio needs no question - it is stated and
       recorded. More than one is a choice somebody has to make before paying,
       because "which location" is not a thing to sort out afterwards. */
    if (studios.length === 1) {
      panel.appendChild(el("p", "co-where", "Training at " + studios[0].name + "."));
    } else if (studios.length > 1) {
      var lab = el("label", "co-where");
      lab.appendChild(el("span", null, "Which studio?"));
      studioSelect = document.createElement("select");
      studioSelect.id = "co-studio";
      studios.forEach(function (st) {
        var o = document.createElement("option");
        o.value = st.id; o.textContent = st.name;
        studioSelect.appendChild(o);
      });
      lab.appendChild(studioSelect);
      panel.appendChild(lab);
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
        var first = !lastQuote;
        lastQuote = q;
        /* begin_checkout waits for the server's numbers. Fired on the click it
           carried no value and no items, which is most of what the event is
           for. Once only - a kit toggle is add_to_cart, not a second start. */
        if (first) track("begin_checkout", ecommerce());
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
          body: JSON.stringify({ courseId: courseId, withKit: wantKit, locationId: chosenLocation() })
        })
          .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
          .then(function (res) {
            if (!res.ok) {
              /* Show what the server said and log why. PayPal's onError fires
                 with its own error and loses this one, so the actual reason
                 has to be put on screen here or it is never seen. */
              var why = res.j.detail || res.j.error || "Could not start the payment";
              track("checkout_error", { step: "create_order", reason: String(why).slice(0, 100) });
              say(res.j.error || "Could not start the payment", "error");
              if (window.console) console.error("checkout:", why);
              throw new Error(why);
            }
            return res.j.id;
          });
      },

      onApprove: function (data) {
        say("Completing your payment…");
        return fetch("/api/checkout/capture", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orderId: data.orderID, locationId: chosenLocation() })
        })
          .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
          .then(function (res) {
            if (!res.ok) throw new Error(res.j.error || "Could not complete the payment");
            var amt = res.j.amount ? res.j.amount.value + " " + res.j.amount.currency_code : "";
            /* The conversion. transaction_id is PayPal's capture id, so a row
               in the property and a row in the enrolments table name the same
               payment and can be reconciled. */
            track("purchase", ecommerce({
              transaction_id: res.j.captureId || res.j.orderId,
              value: res.j.amount ? Number(res.j.amount.value) : undefined,
              currency: res.j.amount ? res.j.amount.currency_code : undefined,
            }));
            buttons.hidden = true;
            say("Paid" + (amt ? " — " + amt : "") + ". We will be in touch to book your dates.", "done");
          })
          .catch(function (e) {
            track("checkout_error", { step: "capture", reason: String(e.message).slice(0, 100) });
            say(e.message, "error");
          });
      },

      onError: function (err) {
        /* Only speak if createOrder has not already said something more useful:
           this fires after it, and a generic apology overwriting the real
           reason is exactly what made this hard to diagnose. */
        var n = panel && panel.querySelector(".co-msg");
        if (!n || n.getAttribute("data-kind") !== "error") {
          say("Something went wrong with the payment. Nothing has been charged.", "error");
        }
        if (window.console && err) console.error("checkout (paypal):", err);
      },

      onCancel: function () {
        track("checkout_cancel", {});
        say("Payment cancelled. Nothing has been charged.");
      }
    }).render(buttons);
  }
})();
