/* The CRM's lead record (migration 0004): one person, however they came in.

   Everything that brings somebody in calls noteLead(): a question from the
   Contact page, a paid checkout, later a booked call. It finds the person by
   email, creates them if new, moves them forward if this is further along
   than where they are, and writes what happened on their timeline.

   Automatic moves only go forward - a question from somebody already enrolled
   does not make them "new" again - except that a lead marked lost who comes
   back is a live lead again. A person on the lead board can move anybody
   anywhere; that is not done here.

   LIKE THE ENROLMENT RECORD, THIS MUST NOT FAIL ITS CALLER. A lead that could
   not be written is a line in the log, never a question that failed to send
   or a payment that reports an error. */

const ORDER = { new: 0, contacted: 1, booked: 2, enrolled: 3 };

/* CASL s.10(10): an inquiry implies consent for 6 months, a purchase for 2
   years. Counted from when it was given. */
const IMPLIED_MONTHS = { implied_inquiry: 6, implied_purchase: 24 };

const clean = (v, max) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

function addMonths(iso, months) {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString();
}

/* Where a lead should be after this happened: forward only, lost reopens. */
export function nextStage(current, wanted) {
  if (!current) return wanted;
  if (current === "lost") return wanted;
  return (ORDER[wanted] ?? 0) > (ORDER[current] ?? 0) ? wanted : current;
}

/* noteLead(env, {
     email, name, phone, courseId, locationId,
     source,          // enquiry | checkout | booking | manual | import
     stage,           // where this puts them: new | booked | enrolled ...
     event: { kind, detail },
     consent,         // implied_inquiry | implied_purchase | null
   }) -> { id, created, stage } or null */
export async function noteLead(env, f) {
  const db = env.ENROLMENTS;
  const email = clean(f && f.email, 254).toLowerCase();
  if (!db || !email || !email.includes("@")) return null;
  const now = new Date().toISOString();
  try {
    const found = await db.prepare("SELECT id, stage, name, phone FROM leads WHERE email = ?").bind(email).first();
    let id, created = false, stage;
    if (!found) {
      id = crypto.randomUUID();
      stage = f.stage || "new";
      /* INSERT OR IGNORE: two arrivals for one new person at the same moment
         both try to create them; the second finds the first's row below. */
      const r = await db.prepare(
        `INSERT OR IGNORE INTO leads (id, created_at, updated_at, email, name, phone, course_id, location_id, source, stage, stage_since)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, now, now, email, clean(f.name, 120) || null, clean(f.phone, 40) || null,
             f.courseId || null, f.locationId || null, f.source || "manual", stage, now).run();
      created = ((r && r.meta && r.meta.changes) ?? (r && r.changes) ?? 0) === 1;
      if (!created) return noteLead(env, f);
    } else {
      id = found.id;
      stage = nextStage(found.stage, f.stage || "new");
      const moved = stage !== found.stage;
      await db.prepare(
        `UPDATE leads SET updated_at = ?,
                name = COALESCE(name, ?), phone = COALESCE(phone, ?),
                course_id = COALESCE(?, course_id), location_id = COALESCE(?, location_id),
                stage = ?, stage_since = CASE WHEN ? THEN ? ELSE stage_since END,
                lost_reason = CASE WHEN ? THEN NULL ELSE lost_reason END
          WHERE id = ?`,
      ).bind(now, clean(f.name, 120) || null, clean(f.phone, 40) || null,
             f.courseId || null, f.locationId || null,
             stage, moved ? 1 : 0, now, moved ? 1 : 0, id).run();
      if (moved) await addEvent(env, id, "stage", `${found.stage} → ${stage}`);
    }
    if (f.event) await addEvent(env, id, f.event.kind, f.event.detail);
    if (f.consent && IMPLIED_MONTHS[f.consent]) {
      await db.prepare(
        `INSERT INTO consents (id, lead_id, email, kind, given_at, expires_at, source)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(crypto.randomUUID(), id, email, f.consent, now, addMonths(now, IMPLIED_MONTHS[f.consent]), f.source || null).run();
    }
    return { id, created, stage };
  } catch (e) {
    console.error("lead not recorded:", f && f.source, e.message);
    return null;
  }
}

export async function addEvent(env, leadId, kind, detail, actor = "system") {
  if (!env.ENROLMENTS || !leadId) return;
  try {
    await env.ENROLMENTS.prepare(
      "INSERT INTO lead_events (id, lead_id, at, kind, detail, actor) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(crypto.randomUUID(), leadId, new Date().toISOString(), String(kind).slice(0, 40),
           detail == null ? null : String(detail).slice(0, 1000), actor).run();
  } catch (e) {
    console.error("lead event not recorded:", leadId, kind, e.message);
  }
}
