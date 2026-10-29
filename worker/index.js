import prices from "./prices.json";
import { ACCOUNT_PATHS, toAccounts } from "./accounts.js";
import { ENQUIRY_PATH, handleEnquiry } from "./enquiries.js";
import { checkoutReady, stripeMode, createSession, sessionStatus, handleWebhook, health } from "./stripe.js";

/* The site is static. This Worker serves it, and adds the endpoints a
   checkout needs, because a checkout cannot be done safely from the page alone:
   the amount has to be decided somewhere the buyer cannot reach.

   Payment is Stripe Checkout (stripe.js). PayPal was replaced on 29 Oct 2026:
   Google Calendar's paid bookings take Stripe only, and one processor is one
   set of payouts and refunds to reconcile.

   Everything that is not /api/ falls through to the static assets exactly as
   before, so the Worker is invisible until checkout is switched on. */

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

/* Client-facing errors say what the caller can act on and nothing else. The
   detail goes to the log, where it is useful and not public. */
const fail = (status, message, detail) => {
  if (detail) console.error("checkout:", message, "—", detail);
  return json({ error: message }, status);
};

/* Ontario HST at 13%, which is what this charges. It was confirmed on
   18 Sept that HST applies to course fees; NAE's accountant should confirm
   that before any live payment. If the answer differs, this one number is
   the change. */
const TAX_PERCENT = 13;

const money = (n) => (Math.round(n * 100) / 100).toFixed(2);

/* Price the order here, from the build-time catalogue. The request names a
   course and says whether the kit is wanted; it never names an amount. */
function quote(courseId, withKit) {
  const c = prices.courses[courseId];
  if (!c) return { error: "Unknown course" };

  /* The guideline's wording is "less than $2,000", so a fee of exactly the cap
     is over it, not on it (second review, 1 Oct 2026; this reverses an earlier
     reading that $2,000 itself was allowed). A course priced at or over the cap
     is not taken online unless it carries capAck - booking a call still works.
     The build applies the same test and leaves "Buy now" off those pages, so
     the page never offers what this would refuse. Better a refused payment
     than a wrong one. */
  if (c.price >= prices.cap && !c.capAck) {
    return { error: "This course cannot be paid for online" };
  }

  const items = [
    {
      name: c.name.slice(0, 127),
      quantity: "1",
      /* The category says which line is the course and which the kit
         (stripe.js labels the confirmation's lines from it). */
      category: "DIGITAL_GOODS",
      unit_amount: { currency_code: prices.currency, value: money(c.price) },
    },
  ];

  /* The site says kits are optional and never part of the course fee, and the
     business discounts tuition and kits differently. So the kit is its own
     line, never folded into the course amount. */
  if (withKit && c.hasKit && c.kitCost > 0) {
    items.push({
      name: `${c.name} — kit`.slice(0, 127),
      quantity: "1",
      category: "PHYSICAL_GOODS",
      unit_amount: { currency_code: prices.currency, value: money(c.kitCost) },
    });
  }

  const subtotal = items.reduce((s, i) => s + Number(i.unit_amount.value), 0);

  /* See TAX_PERCENT: the rate is one number so a different answer is a
     one-line change rather than a re-plumb. */
  const tax = Math.round(subtotal * TAX_PERCENT) / 100;

  return {
    course: c,
    items,
    amount: {
      currency_code: prices.currency,
      value: money(subtotal + tax),
      breakdown: {
        item_total: { currency_code: prices.currency, value: money(subtotal) },
        tax_total: { currency_code: prices.currency, value: money(tax) },
      },
    },
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    /* The site can be built for a subfolder (NAE_BASE in the build). Give the
       Worker the same value as SITE_BASE and the API answers under it too;
       unset, routing is exactly as before. */
    const base = (env.SITE_BASE || "").replace(/\/+$/, "");
    const path = base && url.pathname.startsWith(base + "/") ? url.pathname.slice(base.length) : url.pathname;

    if (path.startsWith("/api/")) {
      if (ACCOUNT_PATHS.has(path)) return toAccounts(request, env, path);
      /* A question from the Contact page (enquiries.js). */
      if (path === ENQUIRY_PATH && request.method === "POST") {
        return handleEnquiry(request, env, ctx, prices);
      }
      if (path === "/api/checkout/config" && request.method === "GET") {
        return json({ currency: prices.currency, mode: stripeMode(env), enabled: checkoutReady(env) });
      }
      /* Is checkout configured, and does Stripe accept the key and the tax
         rate? A checkout that fails gives the buyer a generic apology by
         design, so this is how a wrong secret is told from a bad request. */
      if (path === "/api/checkout/health" && request.method === "GET") {
        return json(await health(env));
      }

      /* What will I be charged? Answered by the same quote() the session uses,
         so the total on the page and the total charged cannot disagree. */
      if (path === "/api/checkout/quote" && request.method === "GET") {
        const q = quote(url.searchParams.get("courseId") || "",
                        url.searchParams.get("kit") === "1");
        if (q.error) return fail(400, q.error);
        return json({
          currency: q.amount.currency_code,
          items: q.items.map((i) => ({ name: i.name, value: i.unit_amount.value })),
          subtotal: q.amount.breakdown.item_total.value,
          taxPercent: TAX_PERCENT,
          tax: q.amount.breakdown.tax_total.value,
          total: q.amount.value,
        });
      }
      if (path === "/api/checkout/session" && request.method === "POST") {
        if (!checkoutReady(env)) return fail(503, "Checkout is not open yet");
        try {
          const r = await createSession(request, env, quote, url.origin + base);
          return r.error ? fail(r.status, r.error) : json({ url: r.url });
        } catch (e) {
          return fail(502, "Could not start the payment", e.message);
        }
      }
      if (path === "/api/checkout/session" && request.method === "GET") {
        try {
          const r = await sessionStatus(env, url.searchParams.get("id") || "");
          if (r.error) return fail(r.status, r.error);
          const { status, ...body } = r;
          return json(body);
        } catch (e) {
          return fail(502, "Could not check the payment", e.message);
        }
      }
      /* Stripe's signed notice that a session is paid, a debit cleared or
         failed, a payment was refunded or disputed. The only thing that
         records a sale. */
      if (path === "/api/stripe/webhook" && request.method === "POST") {
        /* An unexpected failure answers 500, so Stripe retries the event
           (for up to three days) rather than it being lost. */
        try {
          const r = await handleWebhook(request, env, ctx, {
            catalogue: prices, quote, taxLabel: `HST (${TAX_PERCENT}%)`,
          });
          return json(r.body, r.status);
        } catch (e) {
          return fail(500, "Webhook not processed", e.message);
        }
      }
      return fail(404, "No such endpoint");
    }

    return env.ASSETS.fetch(request);
  },
};
