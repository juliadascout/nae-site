import { noteLead, addEvent } from "./leads.js";
import { toAccounts } from "./accounts.js";

/* Applications for a scholarship (the Lily Mather Scholarship, from
   11 Nov 2026), from the page at /scholarship/.

   Kept here, beside the questions and enrolments, rather than sent to a
   form-mailing service: an application is personal - people describe the
   barriers they face - and it belongs in NAE's own records, not a third
   party's inbox. Every administrator is emailed the whole application by the
   apps' Worker (NOTIFY, nae-inc worker/notify.js), the applicant gets a
   receipt, the person goes on the Leads board, and staff can download every
   application as a spreadsheet there (nae-inc /api/leads/scholarship.csv).

   An account, with the fewest steps: the form's one optional field is a
   password. Given one, the account is made in the same request (the same
   sign-up the account page uses, through the ACCOUNTS binding) and the
   browser comes back signed in. Already signed in, or already holding an
   account, nothing more is asked. Without one, the application still goes.

   Robots: as for questions, a hidden field filled in, or a form sent within
   seconds of the page opening, is thanked and dropped. */

export const SCHOLARSHIP_PATH = "/api/scholarship";

export const SCHOLARSHIP = {
  id: "lily-mather-2026",
  name: "the Lily Mather Scholarship",
  /* End of 30 November 2026 in Ontario (EST, UTC-5): Kalleigh moved the
     deadline to Nov 30 on 11 Nov 2026. */
  closesAt: "2026-12-01T05:00:00.000Z",
  closesText: "November 30, 2026",
};

export const QUESTIONS = [
  ["q1", "1. Tell us about yourself and your beauty career dream.", true],
  ["q2", "2. How would you use the $5,000 training scholarship?", true],
  ["q3", "3. How could this opportunity change your life?", true],
  ["q4", "4. What would your next steps be after training?", true],
  ["q5", "5. Is there anything else you would like us to know?", false],
];
export const EXPERIENCE = ["New to beauty", "Some beauty training", "Working in beauty now", "Run my own beauty business"];
export const HEARD = ["Instagram", "Facebook", "TikTok", "Google search", "A friend or family member",
  "A current or past NAE student", "Cosmetic Brands of North America", "Other"];

const PER_HOUR = 3;        // applications from one network address
const IP_HOURS = 24;       // then the address is cleared from the row
const MIN_MS = 8000;       // nobody reads this form and fills it in faster
const MAX_BODY = 40000;    // bytes: five answers of up to 4,000 characters, and the rest
const ANSWER_MAX = 4000;

const ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const PHONE = /^[0-9+().\s-]{7,30}(?:\s*(?:x|ext\.?)\s*\d{1,6})?$/i;

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
const refuse = (status, error, field) => json(field ? { error, field } : { error }, status);

const line = (v, max) => (typeof v === "string"
  ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max)
  : "");
const para = (v, max) => (typeof v === "string"
  ? v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max)
  : "");
const ago = (ms) => new Date(Date.now() - ms).toISOString();

export function isOpen(now = Date.now()) {
  return now < Date.parse(SCHOLARSHIP.closesAt);
}

/* Who is signed in on this browser, if anybody: asked of the accounts system
   with the browser's own cookie, so nobody can claim an account by typing
   its address. */
async function signedIn(request, env) {
  if (!env.ACCOUNTS || !/(?:^|;\s*)[^=]+=/.test(request.headers.get("cookie") || "")) return null;
  try {
    const r = await toAccounts(new Request(request.url, { method: "GET", headers: request.headers }), env, "/api/auth/me");
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.user && j.user.email ? String(j.user.email).toLowerCase() : null;
  } catch (e) {
    return null;
  }
}

/* The same sign-up the account page uses. Returns what happened and, when an
   account was made, the cookie that signs this browser in. */
async function makeAccount(request, env, f) {
  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  headers.delete("content-length");
  try {
    const r = await toAccounts(new Request(request.url, {
      method: "POST", headers,
      body: JSON.stringify({ name: f.name, email: f.email, phone: f.phone, password: f.password, agree: true, withApplication: true }),
    }), env, "/api/auth/signup");
    if (r.status === 409) return { state: "existing" };
    if (!r.ok) {
      let message = "";
      try { message = (await r.json()).error || ""; } catch (e) { /* none */ }
      console.error("scholarship: account not made -", r.status, message);
      return { state: "failed", message };
    }
    return { state: "created", cookie: r.headers.get("set-cookie") };
  } catch (e) {
    console.error("scholarship: account not made -", e.message);
    return { state: "failed" };
  }
}

/* `catalogue` is the build's prices.json: course and studio names come from
   it, so an application can only name courses and studios that exist. */
export async function handleScholarship(request, env, ctx, catalogue) {
  if (!isOpen()) return refuse(410, `Applications closed on ${SCHOLARSHIP.closesText}. Thank you for your interest.`);
  const db = env.ENROLMENTS;
  if (!db) return refuse(503, "Applications cannot be sent just now. Please email or call us instead.");

  let b;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY) return refuse(413, "That is too long to send. Please shorten your answers.");
    b = JSON.parse(raw);
  } catch (e) {
    return refuse(400, "Expected JSON");
  }
  if (!b || typeof b !== "object" || Array.isArray(b)) return refuse(400, "Expected JSON");
  if (b.website || !(Number(b.elapsed) >= MIN_MS)) return json({ ok: true, account: "none" });

  const courses = (catalogue && catalogue.courses) || {};
  const studios = (catalogue && catalogue.studios) || {};
  const f = {
    name: line(b.name, 120),
    email: line(b.email, 254).toLowerCase(),
    phone: line(b.phone, 40),
    place: line(b.place, 160),
    business: line(b.business, 160),
    web: line(b.web, 300),
    studio: b.studio === "unsure" ? "Not sure yet"
      : (typeof b.studio === "string" && Object.hasOwn(studios, b.studio) ? line(studios[b.studio].name, 80) : ""),
    courses: (Array.isArray(b.courses) ? b.courses : []).slice(0, 40)
      .filter((id) => typeof id === "string" && Object.hasOwn(courses, id)).map((id) => courses[id].name),
    locationId: typeof b.studio === "string" && Object.hasOwn(studios, b.studio) ? b.studio : null,
    courseId: (Array.isArray(b.courses) ? b.courses : []).find((id) => typeof id === "string" && Object.hasOwn(courses, id)) || null,
    experience: EXPERIENCE.includes(b.experience) ? b.experience : "",
    heard: HEARD.includes(b.heard) ? b.heard : "",
    signature: line(b.signature, 120),
    declared: b.declared === true,
    marketing: b.marketing === true,
    password: typeof b.password === "string" ? b.password : "",
  };
  for (const [id] of QUESTIONS) f[id] = para(b[id], ANSWER_MAX);

  if (!f.name) return refuse(400, "Please tell us your full name.", "name");
  if (!ADDRESS.test(f.email)) return refuse(400, "Please check your email address: we contact you there.", "email");
  if (f.phone && !PHONE.test(f.phone)) return refuse(400, "That phone number does not look right. You can leave it empty.", "phone");
  if (!f.place) return refuse(400, "Please tell us your city or region and country.", "place");
  for (const [id, label, required] of QUESTIONS) {
    if (required && !f[id]) return refuse(400, `Please answer question ${label.split(".")[0]}.`, id);
  }
  if (!f.declared) return refuse(400, "Please tick the applicant declaration.", "declared");
  if (!f.signature) return refuse(400, "Please type your name as your signature.", "signature");
  if (f.password && (f.password.length < 12 || f.password.length > 200 || !f.password.trim())) {
    return refuse(400, "For your account, use a password of at least 12 characters - or leave it empty.", "password");
  }

  const ip = request.headers.get("CF-Connecting-IP") || null;
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  try {
    if (ip) {
      const n = await db.prepare(
        "SELECT COUNT(*) AS n FROM scholarship_applications WHERE ip = ? AND created_at > ?",
      ).bind(ip, ago(3600e3)).first();
      if ((n?.n || 0) >= PER_HOUR) return refuse(429, "Too many applications from here in the last hour. Please try again later.");
    }
    await db.prepare(
      `INSERT INTO scholarship_applications (id, created_at, scholarship, name, email, phone, place, business, web,
         studio, courses, experience, heard, q1, q2, q3, q4, q5, signature, declared, marketing, account, ip,
         stage, stage_since)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'pending', ?, 'new', ?)`,
    ).bind(id, now, SCHOLARSHIP.id, f.name, f.email, f.phone || null, f.place, f.business || null, f.web || null,
           f.studio || null, JSON.stringify(f.courses), f.experience || null, f.heard || null,
           f.q1, f.q2, f.q3, f.q4, f.q5 || null, f.signature, f.marketing ? 1 : 0, ip, now).run();
    await db.prepare("UPDATE scholarship_applications SET ip = NULL WHERE ip IS NOT NULL AND created_at < ?")
      .bind(ago(IP_HOURS * 3600e3)).run();
  } catch (e) {
    console.error("scholarship application not saved:", e.message);
    return refuse(503, "Your application could not be sent just now. Please try again in a few minutes, or email us.");
  }

  /* Saved. The account, now, because the browser waits for its cookie. */
  let account = { state: "none" };
  const me = await signedIn(request, env);
  if (me && me === f.email) account = { state: "existing" };
  else if (f.password) account = await makeAccount(request, env, f);
  try {
    await db.prepare("UPDATE scholarship_applications SET account = ? WHERE id = ?").bind(account.state, id).run();
  } catch (e) { console.error("scholarship: account state not saved:", e.message); }

  /* The lead, the consent and the emails: after the answer, and nothing in
     them can make the application fail. */
  const telling = (async () => {
    const lead = await noteLead(env, {
      email: f.email, name: f.name, phone: f.phone, courseId: f.courseId, locationId: f.locationId,
      source: "scholarship", stage: "new",
      event: { kind: "scholarship", detail: `Applied for ${SCHOLARSHIP.name}` },
      consent: "implied_inquiry",
    });
    if (lead) {
      try {
        await db.prepare("UPDATE scholarship_applications SET lead_id = ? WHERE id = ?").bind(lead.id, id).run();
        /* CASL: express consent, given by ticking an unticked box, lasts until withdrawn. */
        if (f.marketing) {
          await db.prepare(
            `INSERT INTO consents (id, lead_id, email, kind, given_at, expires_at, source)
             VALUES (?, ?, ?, 'express', ?, NULL, 'scholarship')`,
          ).bind(crypto.randomUUID(), lead.id, f.email, now).run();
        }
      } catch (e) { console.error("scholarship: lead link or consent not saved:", e.message); }
      if (account.state === "created") await addEvent(env, lead.id, "account", "Made an account with their application");
    }
    if (!env.NOTIFY || typeof env.NOTIFY.scholarship !== "function") {
      console.error("scholarship saved, but nobody was emailed: no NOTIFY.scholarship");
      return;
    }
    try {
      const r = await env.NOTIFY.scholarship({
        scholarship: "The Lily Mather Scholarship", name: f.name, email: f.email, phone: f.phone, place: f.place,
        business: f.business, web: f.web, studio: f.studio, courses: f.courses, experience: f.experience, heard: f.heard,
        answers: QUESTIONS.map(([qid, label]) => [label, f[qid] || ""]),
        signature: f.signature, marketing: f.marketing, account: account.state,
        closes: SCHOLARSHIP.closesText, sentAt: now,
        site: (catalogue && catalogue.site) || "", seller: (catalogue && catalogue.seller) || null,
      });
      if (!r || !r.admins) console.error("scholarship saved, but no administrator was emailed:", JSON.stringify(r));
      if (lead && r && r.receipt === "sent") await addEvent(env, lead.id, "auto-reply", "Sent the application receipt");
    } catch (e) {
      console.error("scholarship saved, but nobody was emailed:", e.message);
    }
  })();
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(telling);
  else await telling;

  return json(
    { ok: true, account: account.state, ...(account.message ? { accountMessage: account.message } : {}) },
    200,
    account.cookie ? { "Set-Cookie": account.cookie } : {},
  );
}
