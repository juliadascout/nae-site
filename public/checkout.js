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
  /* Where the site sits on its domain: "" at the root, "/beauty-school" in a
     subfolder. Read from this file's own address, which the build sets, so it is
     decided in one place. Taken now: document.currentScript only exists while
     the file first runs. */
  var BASE = (function () {
    var src = document.currentScript && document.currentScript.src;
    try { return src ? new URL(src).pathname.replace(/\/checkout\.js$/, "") : ""; }
    catch (e) { return ""; }
  })();

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
  var panel, summary, buttons, payButton;

  /* "1,017.00": the server's amount, only punctuated, never recomputed. */
  function cad(v) {
    var n = Number(v);
    return isFinite(n) ? n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v);
  }

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

  fetch(BASE + "/api/checkout/config")
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (cfg) {
      if (!cfg || !cfg.enabled) return;   // stays hidden
      mount.hidden = false;
      arm(cfg);
    })
    .catch(function () { /* no checkout, no noise */ });

  /* Booking a call stays the first action in this card. Paying is a deliberate
     second choice behind a toggle. Nothing from Stripe loads on this page at
     all: paying sends the buyer to Stripe's own checkout page and back. */
  function arm(cfg) {
    var toggle = el("button", "btn btn-p btn-blk co-toggle", "Buy now \u2014 pay online");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "false");

    panel = el("div", "co-panel");
    panel.hidden = true;

    mount.appendChild(toggle);
    mount.appendChild(panel);

    /* On phones the bar pinned to the foot of the screen is what people see,
       so Buy now goes there too, beside Book a call. It opens the same panel. */
    var bar = document.querySelector(".mbar");
    if (bar && !bar.querySelector(".mbar-buy")) {
      var quick = el("button", "btn btn-g mbar-buy", "Buy now");
      quick.type = "button";
      quick.addEventListener("click", function () {
        if (panel.hidden) toggle.click();
        mount.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      bar.appendChild(quick);
    }

    var built = false;
    toggle.addEventListener("click", function () {
      var open = panel.hidden;
      panel.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      toggle.textContent = open ? "Close" : "Buy now \u2014 pay online";
      if (open && !built) { built = true; build(cfg); }
    });
  }

  /* Our own content first - the kit choice, the price and the policy - so the
     buyer sees what they are agreeing to whether or not a third-party script
     ever arrives. */
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

    /* People arrive here from naeinc.ca's Register buttons. Name the school at
       the moment they pay, so the new address and Stripe's page are not a
       surprise. */
    panel.appendChild(el("p", "co-policy",
      "You're enrolling with National Association of Estheticians Inc., the same school as naeinc.ca. Payment continues on Stripe's secure checkout page."));

    var policy = el("p", "co-policy");
    policy.appendChild(document.createTextNode("Paying accepts our "));
    var a = document.createElement("a");
    a.href = BASE + "/about-national-association-of-estheticians-beauty-school/#refunds";
    a.textContent = "refund and cancellation policy";
    policy.appendChild(a);
    policy.appendChild(document.createTextNode("."));
    panel.appendChild(policy);

    buttons = panel.appendChild(el("div", "co-buttons"));
    payButton = el("button", "btn btn-p btn-blk co-pay", "Continue to payment");
    payButton.type = "button";
    payButton.disabled = true;   // until the server has priced it
    payButton.addEventListener("click", pay);
    buttons.appendChild(payButton);

    quote();
  }

  function quote() {
    if (!summary) return;
    summary.textContent = "";
    fetch(BASE + "/api/checkout/quote?courseId=" + encodeURIComponent(courseId) + "&kit=" + (wantKit ? "1" : "0"))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (q) {
        if (!q) return;
        var first = !lastQuote;
        lastQuote = q;
        /* begin_checkout waits for the server's numbers. Fired on the click it
           carried no value and no items, which is most of what the event is
           for. Once only - a kit toggle is add_to_cart, not a second start. */
        if (first) track("begin_checkout", ecommerce());
        var rows = q.items.map(function (i) { return [i.name, "$" + cad(i.value)]; });
        rows.push(["HST (" + q.taxPercent + "%)", "$" + cad(q.tax)]);
        rows.forEach(function (r) {
          var line = el("div", "co-row");
          line.appendChild(el("span", null, r[0]));
          line.appendChild(el("span", "tnum", r[1]));
          summary.appendChild(line);
        });
        var tot = el("div", "co-row co-total");
        tot.appendChild(el("span", null, "Total"));
        tot.appendChild(el("span", "tnum", "$" + cad(q.total) + " " + q.currency));
        summary.appendChild(tot);
        if (payButton) {
          payButton.textContent = "Pay $" + cad(q.total) + " " + q.currency;
          payButton.disabled = false;
        }
      })
      .catch(function () { /* the button stays off until there is a price */ });
  }

  /* The session is made by the Worker from its own price list; this only
     says which course, whether the kit, which studio, and where to come back
     to. The buyer pays on Stripe's page, and the sale is recorded when Stripe
     tells the Worker it is paid - not when the buyer comes back here. */
  function pay() {
    payButton.disabled = true;
    say("Opening secure checkout…");
    track("add_payment_info", ecommerce({ payment_type: "stripe_checkout" }));
    fetch(BASE + "/api/checkout/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ courseId: courseId, withKit: wantKit, locationId: chosenLocation(),
                             returnPath: location.pathname })
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok || !res.j.url) throw new Error(res.j.error || "Could not start the payment");
        location.assign(res.j.url);
      })
      .catch(function (e) {
        track("checkout_error", { step: "create_session", reason: String(e.message).slice(0, 100) });
        say((e.message || "Could not start the payment") + " — nothing has been charged. You can also book a call and we will invoice you.", "error");
        payButton.disabled = false;
      });
  }

  /* Back from Stripe. ?paid=<session> after paying, ?checkout=cancelled after
     the back arrow. Either way the address is cleaned, so a reload or a shared
     link does not say it again. The purchase event fires once per session id,
     so a reload cannot count a sale twice. */
  (function cameBack() {
    var params = new URLSearchParams(location.search);
    var sid = params.get("paid");
    var cancelled = params.get("checkout") === "cancelled";
    if (!sid && !cancelled) return;
    try { history.replaceState(null, "", location.pathname + location.hash); } catch (e) { /* old browser */ }
    mount.hidden = false;
    /* Its own line at the top of the card, not the panel's: the panel is
       closed when the buyer lands back here, and a message inside it would
       not be seen. */
    var line = el("p", "co-msg");
    mount.insertBefore(line, mount.firstChild);
    function tell(msg, kind) {
      line.textContent = msg;
      line.setAttribute("data-kind", kind || "info");
      line.setAttribute("role", kind === "error" ? "alert" : "status");
    }
    if (cancelled) {
      track("checkout_cancel", {});
      tell("Payment cancelled. Nothing has been charged.");
      return;
    }
    tell("Checking your payment…");
    fetch(BASE + "/api/checkout/session?id=" + encodeURIComponent(sid))
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error("unreadable")); })
      .then(function (s) {
        var amt = s.total ? "$" + cad(s.total) + " " + s.currency : "";
        if (s.paid) {
          var key = "nae-purchase-" + sid;
          var seen = false;
          try { seen = sessionStorage.getItem(key) === "1"; sessionStorage.setItem(key, "1"); } catch (e) { /* private mode */ }
          if (!seen) {
            /* The conversion. transaction_id is Stripe's payment id, the same
               reference the enrolments table and the confirmation email carry. */
            track("purchase", {
              transaction_id: s.reference, value: Number(s.total), currency: s.currency,
              items: (s.items || []).map(function (i, n) {
                return { item_id: s.courseId + (n ? "-kit" : ""), item_name: i.label, price: Number(i.value), quantity: 1 };
              }),
            });
          }
          tell("Paid" + (amt ? " — " + amt : "") + ". Your confirmation is on its way by email; if it isn't in your inbox within 10 minutes, check your junk folder. We will be in touch to book your dates.", "done");
        } else if (s.pending) {
          tell("Thank you — your bank payment is processing. It can take a few business days to clear; we will email your confirmation when it does.", "done");
        } else {
          tell("We could not confirm a payment for this checkout. If you were charged, reply to any email from us or call us and we will sort it out.", "error");
        }
      })
      .catch(function () {
        tell("We could not check your payment just now. If you completed it, your confirmation email is on its way.", "error");
      });
  })();
})();
