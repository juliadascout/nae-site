import { stripe, checkoutReady } from "./stripe.js";

/* $50 off for making an account (Kalleigh, 14 Nov: "can they get an auto $50
   discount for creating a profile?").

   GET /api/account/welcome -> { code, amount, minimum, expiresAt } or { code: null }

   A website account (role "member") whose email address is confirmed gets
   one Stripe promotion code of its own, made the first time it asks and the
   same code every time after. Its terms follow the codes Jules made in
   Stripe: one use, first-time customers only, $200 minimum order, and it
   lasts 90 days. Nobody can get two: the code is kept by email address in
   the enrolments database (welcome_codes), and a second request finds it.
   It cannot be used on a Black Friday workshop, which takes no codes.

   The coupon itself ($50 off once, CAD) is made in Stripe once, with a fixed
   id, so every code points at the same coupon. */

export const WELCOME_PATH = "/api/account/welcome";
export const WELCOME = { coupon: "nae-welcome-50", amountCents: 5000, minimumCents: 20000, days: 90 };

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

async function whoIs(request, env) {
  if (!env.ACCOUNTS) return null;
  try {
    const r = await env.ACCOUNTS.fetch(new Request("https://accounts.internal/api/auth/me", {
      headers: { Cookie: request.headers.get("Cookie") || "" },
    }));
    if (!r.ok) return null;
    return (await r.json()).user || null;
  } catch (e) {
    return null;
  }
}

async function ensureCoupon(env) {
  try {
    await stripe(env, "GET", `/coupons/${WELCOME.coupon}`);
  } catch (e) {
    if (!/No such coupon|resource_missing/i.test(e.message)) throw e;
    await stripe(env, "POST", "/coupons", {
      id: WELCOME.coupon, name: "Welcome $50", amount_off: WELCOME.amountCents, currency: "cad", duration: "once",
    });
  }
}

function newCode() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // no 0/O or 1/I to misread
  const r = crypto.getRandomValues(new Uint8Array(6));
  return "WELCOME-" + Array.from(r, (b) => abc[b % abc.length]).join("");
}

const shape = (row) => ({
  code: row.code, amount: WELCOME.amountCents / 100, minimum: WELCOME.minimumCents / 100, expiresAt: row.expires_at,
});

export async function handleWelcome(request, env) {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const who = await whoIs(request, env);
  if (!who || !who.email) return json({ error: "Sign in first" }, 401);
  if (who.role !== "member") return json({ code: null, reason: "Welcome codes are for students' accounts." });
  if (!who.emailVerified) return json({ code: null, reason: "Confirm your email address to get your welcome code." });
  const db = env.ENROLMENTS;
  if (!db || !checkoutReady(env)) return json({ code: null, reason: "Not available just now." });
  const email = String(who.email).toLowerCase();

  await db.prepare(
    `CREATE TABLE IF NOT EXISTS welcome_codes (
       email TEXT PRIMARY KEY, code TEXT NOT NULL, promo_id TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL)`,
  ).run();
  const have = await db.prepare("SELECT * FROM welcome_codes WHERE email = ?").bind(email).first();
  if (have) return json(shape(have));

  try {
    await ensureCoupon(env);
    const expires = Math.floor(Date.now() / 1000) + WELCOME.days * 86400;
    const code = newCode();
    const promo = await stripe(env, "POST", "/promotion_codes", {
      promotion: { type: "coupon", coupon: WELCOME.coupon },
      code, max_redemptions: 1, expires_at: expires,
      restrictions: { first_time_transaction: true, minimum_amount: WELCOME.minimumCents, minimum_amount_currency: "cad" },
      metadata: { purpose: "welcome", email },
    });
    const row = { email, code: promo.code || code, promo_id: promo.id || null,
      created_at: new Date().toISOString(), expires_at: new Date(expires * 1000).toISOString() };
    const ins = await db.prepare(
      "INSERT OR IGNORE INTO welcome_codes (email, code, promo_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(row.email, row.code, row.promo_id, row.created_at, row.expires_at).run();
    const changed = (ins && ins.meta && ins.meta.changes) ?? (ins && ins.changes) ?? 1;
    if (!changed) {
      /* Two tabs at once: the other one's code is the person's. This one is
         switched off so it can never be a second $50. */
      if (row.promo_id) await stripe(env, "POST", `/promotion_codes/${row.promo_id}`, { active: false }).catch(() => {});
      return json(shape(await db.prepare("SELECT * FROM welcome_codes WHERE email = ?").bind(email).first()));
    }
    return json(shape(row));
  } catch (e) {
    console.error("welcome code not made:", email, e.message);
    return json({ code: null, reason: "Not available just now." });
  }
}
