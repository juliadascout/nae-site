/* Black Friday 2026: five dated workshops at a fixed price, at Richmond Hill
   or St. Catharines (content/black-friday.json; the build copies the offers
   into prices.json, so the price is decided here, never by the page).

   An offer is checked out like a course (stripe.js createSession) with three
   differences: the price is the offer's, no promotion code can be added
   (BF20 is "not applicable on the above packages", Vagisha 24 Nov), and the
   session carries the workshop, so a paid one books the student into it
   (booking.js recordWorkshop) and the confirmation says when it is.

   After the sale ends (prices.blackFriday.ends) no offer can be bought and
   /black-friday/ sends people to the courses page (index.js). */

const TAX_PERCENT = 13;
const money = (n) => (Math.round(n * 100) / 100).toFixed(2);

export const BF_PATH = "/black-friday/";

export function saleOpen(catalogue, now = Date.now()) {
  const bf = catalogue && catalogue.blackFriday;
  return !!(bf && bf.ends && now < Date.parse(bf.ends));
}

export function findOffer(catalogue, id) {
  const bf = catalogue && catalogue.blackFriday;
  return (bf && (bf.offers || []).find((o) => o.id === id)) || null;
}

/* "Tuesday, December 8, 10:00 am to 2:00 pm" from Ontario wall-clock parts. */
const clock = (hm) => { const h = +hm.slice(0, 2); return `${h % 12 || 12}:${hm.slice(3, 5)} ${h < 12 ? "am" : "pm"}`; };
export function whenText(o) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" })
    .format(new Date(`${o.date}T12:00:00Z`));
  return `${day}, ${clock(o.start)} to ${clock(o.end)}`;
}

/* The quote for an offer, in the shape index.js quote() returns, plus what
   the session and the webhook need. ignoreEnd: the webhook checks a sale made
   before the deadline, which may arrive after it. */
export function offerQuote(catalogue, id, locationId, withKit, { now = Date.now(), ignoreEnd = false } = {}) {
  const o = findOffer(catalogue, id);
  if (!o) return { error: "Unknown offer" };
  if (!ignoreEnd && !saleOpen(catalogue, now)) return { error: "The Black Friday sale has ended", status: 410 };
  const c = (catalogue.courses || {})[o.courseId];
  if (!c) return { error: "Unknown course" };
  if (!(o.locations || []).includes(locationId)) return { error: "Choose Richmond Hill or St. Catharines" };
  const studio = ((catalogue.studios || {})[locationId] || {}).name || "";
  const label = `${o.title} workshop: ${whenText(o)}, ${studio}`;
  const items = [{
    name: `Black Friday: ${label}`.slice(0, 127), quantity: "1", category: "DIGITAL_GOODS",
    unit_amount: { currency_code: catalogue.currency, value: money(o.price) },
  }];
  if (withKit && o.kit !== false && c.hasKit && c.kitCost > 0) {
    items.push({
      name: `${c.name} — kit`.slice(0, 127), quantity: "1", category: "PHYSICAL_GOODS",
      unit_amount: { currency_code: catalogue.currency, value: money(c.kitCost) },
    });
  }
  const subtotal = items.reduce((s, i) => s + Number(i.unit_amount.value), 0);
  const tax = Math.round(subtotal * TAX_PERCENT) / 100;
  return {
    course: c, offer: o, courseId: o.courseId, locationId, label, studio,
    startsAt: `${o.date}T${o.start}`, endsAt: `${o.date}T${o.end}`,
    items,
    amount: {
      currency_code: catalogue.currency,
      value: money(subtotal + tax),
      breakdown: {
        item_total: { currency_code: catalogue.currency, value: money(subtotal) },
        tax_total: { currency_code: catalogue.currency, value: money(tax) },
      },
    },
  };
}
