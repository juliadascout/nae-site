/* "My courses" on the account page: what this person has bought.

   The account belongs to the accounts system (nae-inc), so who is asking is
   that system's answer to /api/auth/me, asked over the service binding with
   this request's own session cookie. The sales are this site's own records
   (enrolments.js), matched on the buyer's email.

   Only for an address the account has confirmed - by the emailed link, the
   sign-in code, or Google. Anybody can make an account with any address; a
   purchase is only shown to whoever has proved the address it was paid from
   is theirs.

   Not shown: payments that failed, and the PayPal rows, which are sandbox
   test sales from before Stripe (migrations/0003_stripe.sql). */

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

/* What a stage means to the person who paid. Anything not listed shows as
   "In review" rather than an internal word. */
const STATUS = {
  "paid": "Paid",
  "payment pending": "Payment processing",
  "refunded": "Refunded",
  "partially refunded": "Partly refunded",
  "disputed": "In review",
  "dispute lost": "Refunded",
};

export async function myCourses(request, env, catalogue) {
  if (!env.ACCOUNTS) return json({ error: "Accounts are not available just now" }, 503);
  let who;
  try {
    const res = await env.ACCOUNTS.fetch(new Request("https://accounts.internal/api/auth/me", {
      headers: { Cookie: request.headers.get("Cookie") || "" },
    }));
    if (res.status === 401) return json({ error: "Not signed in" }, 401);
    if (!res.ok) return json({ error: "Accounts are not available just now" }, 503);
    who = (await res.json()).user;
  } catch (e) {
    console.error("my courses: accounts unreachable -", e.message);
    return json({ error: "Accounts are not available just now" }, 503);
  }
  if (!who || !who.email) return json({ error: "Not signed in" }, 401);
  if (!who.emailVerified) return json({ courses: [], confirmEmail: true });
  if (!env.ENROLMENTS) return json({ courses: [] });

  let rows;
  try {
    ({ results: rows } = await env.ENROLMENTS.prepare(
      `SELECT course_id, course_name, with_kit, location_id, currency, total, stage, created_at
         FROM enrolments
        WHERE lower(payer_email) = ? AND provider <> 'paypal' AND stage <> 'payment failed'
        ORDER BY created_at DESC LIMIT 50`,
    ).bind(String(who.email).toLowerCase()).all());
  } catch (e) {
    console.error("my courses: enrolments not read -", e.message);
    return json({ error: "Your courses could not be loaded just now" }, 503);
  }

  const studios = (catalogue && catalogue.studios) || {};
  const courses = (catalogue && catalogue.courses) || {};
  return json({
    courses: (rows || []).map((r) => {
      const c = courses[r.course_id];
      return {
        courseId: r.course_id,
        name: r.course_name || (c && c.name) || r.course_id,
        url: c && c.slug ? `/courses/${c.slug}/` : null,
        withKit: !!r.with_kit,
        studio: (studios[r.location_id] && studios[r.location_id].name) || null,
        total: r.total,
        currency: r.currency || "CAD",
        status: STATUS[r.stage] || "In review",
        paidAt: r.created_at,
      };
    }),
  });
}
