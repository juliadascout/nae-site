/* Booking course sessions (/account/book/?course=, worker/booking.js).
   The student picks one time per day until they have the course's number of
   sessions, then books them together; or asks for times that are not shown. */
(function () {
  var root = document.getElementById("book");
  if (!root) return;
  var q = function (s) { return root.querySelector(s); };
  var courseId = new URLSearchParams(location.search).get("course") || "";
  var msg = q("[data-msg]"), pick = q("[data-pick]"), daysEl = q("[data-days]");
  var studioSel = document.getElementById("bk-studio");
  var plan = null, from = null, picks = {}, studios = [];
  var WINDOW = 14;

  function say(text, kind) {
    msg.textContent = text || ""; msg.hidden = !text;
    msg.setAttribute("data-kind", kind || "error");
    msg.setAttribute("role", (kind || "error") === "error" ? "alert" : "status");
  }
  function api(path, body) {
    return fetch("/api/booking/" + path, body ? {
      method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    } : { credentials: "same-origin", cache: "no-store" }).then(function (r) {
      return r.json().then(function (j) { return { status: r.status, ok: r.ok, j: j }; },
        function () { return { status: r.status, ok: false, j: {} }; });
    });
  }
  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    for (var k in attrs || {}) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }
  /* Ontario wall-clock strings, shown as they are: no time zone maths. */
  function d(s) { var p = s.slice(0, 10).split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function iso(dt) { return dt.getFullYear() + "-" + ("0" + (dt.getMonth() + 1)).slice(-2) + "-" + ("0" + dt.getDate()).slice(-2); }
  function addDays(s, n) { var x = d(s); x.setDate(x.getDate() + n); return iso(x); }
  function dayName(s) { return d(s).toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" }); }
  function clock(s) {
    var h = +s.slice(11, 13), m = s.slice(14, 16);
    return (h % 12 || 12) + ":" + m + (h < 12 ? " am" : " pm");
  }
  function hours(n) { return n === 1 ? "1 hour" : String(n).replace(/\.5$/, "½") + " hours"; }

  function showMine(list) {
    var ul = q("[data-mine-list]"); ul.innerHTML = "";
    list.forEach(function (b) {
      var li = el("li");
      if (b.status === "requested") {
        var w = (b.wishes || []).map(function (x) { return dayName(x.date) + " at " + clock("0000-00-00T" + x.time); }).join("; ");
        li.appendChild(el("strong", null, "Requested"));
        li.appendChild(document.createTextNode(" " + w + ". We will email you once an instructor is confirmed."));
      } else {
        li.appendChild(el("strong", null, "Session " + b.session_no + ": "));
        li.appendChild(document.createTextNode(dayName(b.start) + ", " + clock(b.start) + " to " + clock(b.end) + " · " + b.studio));
      }
      ul.appendChild(li);
    });
    q("[data-mine]").hidden = !list.length;
  }

  function count() {
    var n = Object.keys(picks).length;
    q("[data-count]").textContent = "Chosen: " + n + " of " + plan.sessions + (n < plan.sessions ? ". Pick one time per day." : ". Ready to book.");
    q("[data-confirm]").disabled = n !== plan.sessions;
  }

  function loadSlots() {
    var studio = studioSel.value;
    var s = studios.filter(function (x) { return x.id === studio; })[0];
    var bookable = s && s.bookable;
    q("[data-range]").textContent = dayName(from).replace(/^\w+, /, "") + " to " + dayName(addDays(from, WINDOW - 1)).replace(/^\w+, /, "");
    root.querySelectorAll(".bk-nav, [data-count], [data-confirm]").forEach(function (n) { n.hidden = !bookable; });
    daysEl.innerHTML = ""; q("[data-none]").hidden = true;
    if (!bookable) {
      say("Times at " + (s ? s.name : "this studio") + " are arranged by request. Tell us when you would like to come below.", "info");
      return;
    }
    say("Loading times…", "info");
    api("slots?course=" + encodeURIComponent(courseId) + "&studio=" + encodeURIComponent(studio) + "&from=" + from + "&days=" + WINDOW)
      .then(function (r) {
        if (!r.ok) return say(r.j.error || "Could not load the times.");
        say("");
        var byDay = {};
        r.j.slots.forEach(function (x) { (byDay[x.start.slice(0, 10)] = byDay[x.start.slice(0, 10)] || []).push(x); });
        var keys = Object.keys(byDay).sort();
        q("[data-none]").hidden = keys.length > 0;
        keys.forEach(function (day) {
          var box = el("div", { class: "bk-day" });
          box.appendChild(el("h3", null, dayName(day)));
          var row = el("div", { class: "bk-times" });
          byDay[day].forEach(function (x) {
            var b = el("button", { type: "button", class: "bk-time", "aria-pressed": picks[day] === x.start ? "true" : "false" },
              clock(x.start) + " to " + clock(x.end));
            if (x.join) b.appendChild(el("small", null, "small group"));
            b.addEventListener("click", function () {
              if (picks[day] === x.start) delete picks[day];
              else if (picks[day] || Object.keys(picks).length < plan.sessions) picks[day] = x.start;
              else return say("You have chosen " + plan.sessions + " already. Tap one to remove it first.", "info");
              say("");
              row.querySelectorAll(".bk-time").forEach(function (o) { o.setAttribute("aria-pressed", "false"); });
              if (picks[day]) b.setAttribute("aria-pressed", "true");
              count();
            });
            row.appendChild(b);
          });
          box.appendChild(row);
          daysEl.appendChild(box);
        });
        count();
      })
      .catch(function () { say("Could not reach the website just now."); });
  }

  function start() {
    if (!courseId) return say("Open this page from My courses.");
    Promise.all([api("options?course=" + encodeURIComponent(courseId)), api("mine")]).then(function (rs) {
      var o = rs[0], m = rs[1];
      if (o.status === 401) { say(o.j.error || "Sign in to book your sessions."); q("[data-out]").hidden = false; return; }
      if (!o.ok) return say(o.j.error || "Booking is not available just now.");
      plan = o.j.course;
      q("[data-title]").textContent = "Book your sessions: " + plan.name;
      q("[data-plan]").textContent = plan.sessions + (plan.sessions === 1 ? " session" : " sessions") + " of " + hours(plan.hoursPerSession)
        + (plan.sessions > 1 ? ", on different days, within " + o.j.rules.gapDays.max + " days of each other." : ".")
        + " Times open at least " + o.j.rules.minNoticeHours + " hours ahead.";
      var mine = (m.ok ? m.j.bookings : []).filter(function (b) { return b.course_id === courseId; });
      showMine(mine);
      if (o.j.alreadyBooked) return;
      studios = o.j.studios;
      studios.forEach(function (s) { studioSel.appendChild(el("option", { value: s.id }, s.name + (s.bookable ? "" : " (by request)"))); });
      from = addDays(iso(new Date()), 1);
      pick.hidden = false;
      loadSlots();
    }).catch(function () { say("Could not reach the website just now."); });
  }

  studioSel.addEventListener("change", function () { picks = {}; loadSlots(); });
  q("[data-prev]").addEventListener("click", function () {
    var tomorrow = addDays(iso(new Date()), 1);
    from = addDays(from, -WINDOW); if (from < tomorrow) from = tomorrow; loadSlots();
  });
  q("[data-next]").addEventListener("click", function () { from = addDays(from, WINDOW); loadSlots(); });

  q("[data-confirm]").addEventListener("click", function () {
    var b = this; b.disabled = true; say("Booking…", "info");
    var starts = Object.keys(picks).sort().map(function (k) { return picks[k]; });
    api("book", { course: courseId, studio: studioSel.value, starts: starts }).then(function (r) {
      if (!r.ok) { b.disabled = false; return say(r.j.error || "That did not work."); }
      pick.hidden = true;
      /* Counted, never identified: the course and how many sessions. */
      if (typeof window.gtag === "function") window.gtag("event", "book_sessions", { course_id: courseId, sessions: starts.length });
      if (typeof window.naeMeta === "function") window.naeMeta("book_sessions", { course_id: courseId });
      say("Booked. Your sessions are listed below, and a confirmation is on its way to your email.", "done");
      return api("mine").then(function (m) { showMine((m.j.bookings || []).filter(function (x) { return x.course_id === courseId; })); });
    }).catch(function () { b.disabled = false; say("Could not reach the website just now."); });
  });

  q('[data-form="request"]').addEventListener("submit", function (ev) {
    ev.preventDefault();
    var ds = root.querySelectorAll("[data-wd]"), ts = root.querySelectorAll("[data-wt]"), wishes = [];
    for (var i = 0; i < ds.length; i++) if (ds[i].value && ts[i].value) wishes.push({ date: ds[i].value, time: ts[i].value.slice(0, 5) });
    if (!wishes.length) return say("Add a date and a start time you would like.");
    var b = ev.target.querySelector("button"); b.disabled = true; say("Sending…", "info");
    api("request", { course: courseId, studio: studioSel.value, wishes: wishes, note: document.getElementById("bk-note").value })
      .then(function (r) {
        if (!r.ok) { b.disabled = false; return say(r.j.error || "That did not work."); }
        pick.hidden = true;
        say("Thank you. We have your request and will email you once an instructor is confirmed.", "done");
        return api("mine").then(function (m) { showMine((m.j.bookings || []).filter(function (x) { return x.course_id === courseId; })); });
      })
      .catch(function () { b.disabled = false; say("Could not reach the website just now."); });
  });

  start();
})();
