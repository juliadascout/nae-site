/* Accounts on the website.

   One account system for the website and the apps, and it lives with the
   apps (nae-inc, worker/accounts.js). This Worker does not keep a copy and
   cannot read the accounts database: it passes these few requests to nae-inc
   over a service binding - a direct call inside Cloudflare, not a request
   across the internet - and hands the answer back, cookie and all, so the
   session belongs to this site's address.

   Only what a website visitor needs goes through. Managing people, and every
   piece of the apps' data, stays behind the apps' own sign-in. */

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const fail = (status, message, detail) => {
  if (detail) console.error("accounts:", message, "—", detail);
  return json({ error: message }, status);
};

export const ACCOUNT_PATHS = new Set([
  "/api/auth/signup",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/me",
  "/api/auth/password",
  "/api/auth/profile",
]);

export async function toAccounts(request, env, path) {
  if (!env.ACCOUNTS) return fail(503, "Accounts are not available just now");
  const headers = new Headers(request.headers);
  /* The website's door is a password session and nothing else. A Cloudflare
     Access token belongs to the apps' address; one pasted into a request here
     is not passed on. */
  headers.delete("Cf-Access-Jwt-Assertion");
  headers.delete("Cf-Access-Authenticated-User-Email");
  /* The host is not looked at on the other side - a service binding goes to
     that Worker whatever it says - but the path is. */
  const forwarded = new Request(new URL(path, "https://accounts.internal").toString(), {
    method: request.method,
    headers,
    /* Read whole: these are a few hundred bytes of JSON, and a buffer goes
       anywhere a stream might not. */
    body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(),
  });
  try {
    return await env.ACCOUNTS.fetch(forwarded);
  } catch (e) {
    return fail(503, "Accounts are not available just now", e.message);
  }
}
