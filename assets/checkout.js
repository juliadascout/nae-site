/* Checkout, on a course page.

   The page knows a course id and whether the kit is wanted. It never knows an
   amount - the Worker prices the order from the catalogue, so editing anything
   here changes nothing about what is charged.

   Renders nothing at all unless the Worker says checkout is open, so this file
   is inert on a site that has not switched it on. */
(function () {
  var mount = document.getElementById("checkout");
  if (!mount) return;

  var courseId = mount.getAttribute("data-course");
  var kitCost = Number(mount.getAttribute("data-kit") || 0);

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }

  function say(msg, kind) {
    var n = mount.querySelector(".co-msg") || mount.appendChild(el("p", "co-msg"));
    n.textContent = msg;
    n.setAttribute("data-kind", kind || "info");
    n.setAttribute("role", kind === "error" ? "alert" : "status");
  }

  fetch("/api/checkout/config")
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (cfg) {
      if (!cfg || !cfg.enabled || !cfg.clientId) return;   // stays hidden
      mount.hidden = false;
      loadSdk(cfg);
    })
    .catch(function () { /* no checkout, no noise */ });

  function loadSdk(cfg) {
    var s = document.createElement("script");
    s.src = "https://www.paypal.com/sdk/js?client-id=" + encodeURIComponent(cfg.clientId) +
            "&currency=" + encodeURIComponent(cfg.currency) + "&intent=capture";
    s.onload = function () { render(cfg); };
    s.onerror = function () { say("Payment is unavailable right now. Please book a call instead.", "error"); };
    document.head.appendChild(s);
  }

  function render(cfg) {
    var wantKit = false;

    if (kitCost > 0) {
      var row = el("label", "co-kit");
      var box = el("input");
      box.type = "checkbox";
      box.id = "co-kit-toggle";
      row.appendChild(box);
      row.appendChild(el("span", null, "Add the optional kit (+$" + kitCost.toLocaleString() + ")"));
      mount.insertBefore(row, mount.firstChild);
      box.addEventListener("change", function () {
        wantKit = box.checked;
        buttons.innerHTML = "";
        paint();
      });
    }

    if (cfg.mode !== "live") {
      var t = el("p", "co-test", "Test mode — no real payment is taken.");
      mount.insertBefore(t, mount.firstChild);
    }

    var buttons = mount.appendChild(el("div", "co-buttons"));
    paint();

    function paint() {
      if (!window.paypal) return;
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
  }
})();
