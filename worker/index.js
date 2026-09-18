import prices from "./prices.json";

/* The site is static. This Worker serves it, and adds the two endpoints a
   checkout needs, because a checkout cannot be done safely from the page alone:
   the amount has to be decided somewhere the buyer cannot reach.

   Everything that is not /api/ falls through to the static assets exactly as
   before, so the Worker is invisible until checkout is switched on. */

const PP_HOST = {
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com",
};

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

function ppBase(env) {
  const mode = env.PAYPAL_ENV === "live" ? "live" : "sandbox";
  return { base: PP_HOST[mode], mode };
}

/* An access token lasts hours; minting one per request would add a round trip
   to every order. Cached per isolate, refreshed a minute early. */
let tokenCache = { value: null, expires: 0, mode: null };

async function accessToken(env) {
  const { base, mode } = ppBase(env);
  const now = Date.now();
  if (tokenCache.value && tokenCache.mode === mode && now < tokenCache.expires) {
    return tokenCache.value;
  }
  const id = env.PAYPAL_CLIENT_ID;
  const secret = env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error("PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET is not set");

  const r = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${id}:${secret}`),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(`PayPal rejected the credentials (${r.status} from ${mode}). ${detail.slice(0, 300)}`);
  }
  const j = await r.json();
  tokenCache = {
    value: j.access_token,
    mode,
    expires: now + Math.max(0, (j.expires_in || 0) - 60) * 1000,
  };
  return tokenCache.value;
}

async function pp(env, path, method, body) {
  const { base } = ppBase(env);
  const r = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken(env)}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch (e) { /* keep the text */ }
  return { ok: r.ok, status: r.status, body: parsed, raw: text };
}

/* Ontario HST. Confirmed 18 Sept: it applies to course fees. The August
   "save the tax" promotion is why an earlier invoice shows none - the company
   still remitted it, it just was not shown on the invoice. */
const TAX_PERCENT = 13;

const money = (n) => (Math.round(n * 100) / 100).toFixed(2);

/* Price the order here, from the build-time catalogue. The request names a
   course and says whether the kit is wanted; it never names an amount. */
function quote(courseId, withKit) {
  const c = prices.courses[courseId];
  if (!c) return { error: "Unknown course" };

  /* The cap is the highest permitted fee, not the first forbidden one: three
     courses are priced at exactly $2,000 deliberately. A course deliberately
     priced above it carries capAck and stays sellable - the build warns about
     it rather than refusing, and this has to agree or the warning would be a
     lie. Without that acknowledgement, a price above the cap is refused:
     better a refused payment than a wrong one. */
  if (c.price > prices.cap && !c.capAck) {
    return { error: "This course cannot be paid for online" };
  }

  const items = [
    {
      name: c.name.slice(0, 127),
      quantity: "1",
      /* PayPal has no "service" category; DIGITAL_GOODS is the one that does
         not demand a shipping address for something nobody ships. */
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

  /* Whether HST applies to course fees is not settled - the PayPal item
     catalogue says 13%, an issued invoice charged nothing. The line exists at
     zero so answering it is a one-number change rather than a re-plumb. */
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

async function handleOrder(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return fail(400, "Expected JSON"); }

  const courseId = String(body.courseId || "");
  const withKit = body.withKit === true;

  const q = quote(courseId, withKit);
  if (q.error) return fail(400, q.error);

  const res = await pp(env, "/v2/checkout/orders", "POST", {
    intent: "CAPTURE",
    purchase_units: [
      {
        reference_id: courseId,
        description: `${q.course.name}${withKit ? " with kit" : ""}`.slice(0, 127),
        custom_id: `${courseId}${withKit ? "+kit" : ""}`.slice(0, 127),
        items: q.items,
        amount: q.amount,
      },
    ],
    application_context: {
      shipping_preference: "NO_SHIPPING",
      user_action: "PAY_NOW",
      brand_name: "National Association of Estheticians Inc.",
    },
  });

  if (!res.ok) return fail(502, "Could not start the payment", res.raw);
  return json({ id: res.body.id });
}

async function handleCapture(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return fail(400, "Expected JSON"); }

  const orderId = String(body.orderId || "");
  if (!/^[A-Za-z0-9-]{5,64}$/.test(orderId)) return fail(400, "Missing order id");

  const res = await pp(env, `/v2/checkout/orders/${orderId}/capture`, "POST", {});
  if (!res.ok) return fail(502, "Could not complete the payment", res.raw);

  /* Re-read the amount from PayPal rather than trusting what the page thought
     it was buying. This is the number that actually moved. */
  const pu = (res.body.purchase_units || [])[0] || {};
  const cap = ((pu.payments || {}).captures || [])[0] || {};
  return json({
    status: res.body.status,
    orderId: res.body.id,
    captureId: cap.id || null,
    amount: cap.amount || null,
    reference: pu.reference_id || null,
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      if (url.pathname === "/api/checkout/config" && request.method === "GET") {
        const { mode } = ppBase(env);
        return json({
          clientId: env.PAYPAL_CLIENT_ID || null,
          currency: prices.currency,
          mode,
          enabled: env.CHECKOUT_ENABLED === "true",
        });
      }
      /* Does this Worker actually hold a working pair of credentials? A
         checkout that fails gives the buyer a generic apology by design, so
         without this the only way to tell a wrong secret from a bad payload is
         to read the Cloudflare log. Says nothing secret: the client id is
         public and only its tail is shown, to confirm which app is in use. */
      if (url.pathname === "/api/checkout/health" && request.method === "GET") {
        const { mode } = ppBase(env);
        const id = env.PAYPAL_CLIENT_ID || "";
        /* Enough to compare against the dashboard character by character
           without publishing anything private. The client id is public by
           design; the secret is only ever reported as present or absent, and
           its length and shape, which is what tells a wrong paste from a
           mismatched pair. */
        const sec = env.PAYPAL_CLIENT_SECRET || "";
        const out = {
          mode,
          enabled: env.CHECKOUT_ENABLED === "true",
          clientIdSet: !!id,
          clientIdHead: id ? id.slice(0, 10) + "…" : null,
          clientIdTail: id ? "…" + id.slice(-6) : null,
          clientIdLength: id.length,
          secretSet: !!sec,
          secretLength: sec.length,
          secretHead: sec ? sec.slice(0, 2) + "…" : null,
          secretLooksTrimmed: sec === sec.trim(),
        };
        if (!out.clientIdSet || !out.secretSet) {
          return json({ ...out, ok: false, reason: "client id or secret missing" }, 200);
        }
        try {
          await accessToken(env);
          return json({ ...out, ok: true, reason: "credentials accepted" });
        } catch (e) {
          return json({ ...out, ok: false, reason: e.message }, 200);
        }
      }

      /* What will I be charged? Answered by the same quote() the order uses,
         so the total on the page and the total on the invoice cannot disagree. */
      if (url.pathname === "/api/checkout/quote" && request.method === "GET") {
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
      if (url.pathname === "/api/checkout/order" && request.method === "POST") {
        if (env.CHECKOUT_ENABLED !== "true") return fail(503, "Checkout is not open yet");
        try { return await handleOrder(request, env); }
        catch (e) {
          /* The buyer gets an apology; whoever is debugging gets the cause.
             Both come back, because a generic 500 with the reason only in a
             log nobody is tailing is how "something went wrong" stays
             unsolved. Nothing here is secret - it is PayPal's own complaint. */
          console.error("checkout: order failed —", e.message);
          return json({ error: "Could not start the payment", detail: e.message }, 500);
        }
      }
      if (url.pathname === "/api/checkout/capture" && request.method === "POST") {
        if (env.CHECKOUT_ENABLED !== "true") return fail(503, "Checkout is not open yet");
        try { return await handleCapture(request, env); }
        catch (e) { return fail(500, "Could not complete the payment", e.message); }
      }
      return fail(404, "No such endpoint");
    }

    return env.ASSETS.fetch(request);
  },
};
