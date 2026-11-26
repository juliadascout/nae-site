/* The Worker as Cloudflare loads it.

   Everything a browser reaches is index.js, exactly as before. This adds
   Booking: the methods the apps' Worker (nae-inc worker/students.js) calls
   over a service binding to answer requests, move, cancel and staff course
   sessions (booking-admin.js). The same pattern as Notify in nae-inc.

   A named entrypoint is not on the internet. Only a Worker on this account
   with a binding to it can call these methods; there is no address anybody
   could post to. The apps check who is asking before they call, and pass an
   instructor's scope, which these methods enforce again.

   It is its own file because "cloudflare:workers" exists only inside
   Cloudflare's runtime. The tests import index.js and booking-admin.js. */

import { WorkerEntrypoint } from "cloudflare:workers";
import worker from "./index.js";
import prices from "./prices.json";
import bookingConfig from "./booking-config.json";
import * as staff from "./booking-admin.js";

const run = async (self, fn, args) => {
  try {
    return await fn({ env: self.env, config: bookingConfig, catalogue: prices, ctx: self.ctx }, args || {});
  } catch (e) {
    console.error("booking (apps):", e && e.message);
    return { error: e && e.status ? e.message : "Booking did not go through", status: (e && e.status) || 500 };
  }
};

export class Booking extends WorkerEntrypoint {
  catalogue() { return run(this, staff.catalogue, {}); }
  forStudent(args) { return run(this, staff.forStudent, args); }
  queue(args) { return run(this, staff.queue, args); }
  slots(args) { return run(this, staff.slots, args); }
  approve(args) { return run(this, staff.approve, args); }
  rebook(args) { return run(this, staff.rebook, args); }
  cancel(args) { return run(this, staff.cancel, args); }
  assign(args) { return run(this, staff.assign, args); }
  decline(args) { return run(this, staff.decline, args); }
}

export default worker;
