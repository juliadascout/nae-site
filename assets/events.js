/* The events that make "leads" a number rather than a zero.

   The existing property reports 0 qualified and 0 converted leads every day
   against ~148 users a week, because nothing on the site ever tells it anything
   happened. Page views alone cannot answer "did that visit turn into a
   conversation", which is the only question the business actually has.

   Nothing here invents data: it reports what the visitor did, and it reads what
   the page already publishes rather than duplicating it into markup. Loaded
   only when a measurement id is configured, and every call is guarded so the
   page behaves identically if the tag is blocked. */
(function () {
  function send(name, params) {
    if (typeof window.gtag === "function") window.gtag("event", name, params || {});
  }

  /* The course page already carries a Course block for search engines. Reading
     it means the price reported here and the price on the page cannot drift. */
  function course() {
    var nodes = document.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < nodes.length; i++) {
      try {
        var d = JSON.parse(nodes[i].textContent);
        if (d && d["@type"] === "Course") {
          var offer = d.offers || {};
          return {
            item_id: (location.pathname.split("/").filter(Boolean).pop() || ""),
            item_name: d.name || "",
            price: Number(offer.price) || undefined,
            currency: offer.priceCurrency || undefined,
          };
        }
      } catch (e) { /* a malformed block is not worth breaking the page for */ }
    }
    return null;
  }

  var c = course();
  if (c) send("view_item", { items: [c], value: c.price, currency: c.currency });

  /* Booking is the site's one conversion. Mark it as a click on the way out,
     because the booking itself happens on a host we do not control and will
     never report back. */
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a) return;

    if (a.hostname && a.hostname.indexOf("setmore.com") !== -1) {
      send("book_call_click", {
        course: c ? c.item_name : null,
        placement: a.closest(".mbar") ? "mobile bar" : a.closest(".rail") ? "rail" : "page",
      });
      return;
    }

    /* A phone tap and an email are the two other ways someone starts a
       conversation, and both currently vanish entirely. */
    if (a.protocol === "tel:") send("phone_click", {});
    else if (a.protocol === "mailto:") send("email_click", {});
  }, true);
})();
