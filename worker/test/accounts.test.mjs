/* The website passes account requests to the accounts system and nothing else.
   A fake binding stands in for the nae-inc Worker and records what reached it. */
import { ACCOUNT_PATHS, toAccounts } from '../accounts.js';

let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}${d ? '  [' + d + ']' : ''}`)); };

const seen = [];
const env = {
  ACCOUNTS: {
    async fetch(req) {
      seen.push({ url: req.url, method: req.method, headers: Object.fromEntries(req.headers), body: req.method === 'GET' ? null : await req.text() });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'Set-Cookie': 'nae_session=abc; Path=/; HttpOnly; Secure; SameSite=Lax' },
      });
    },
  },
};

const req = (path, init = {}) => new Request('https://naeinc.ca' + path, init);

for (const p of ['/api/auth/status', '/api/auth/signup', '/api/auth/login', '/api/auth/logout', '/api/auth/me',
                 '/api/auth/password', '/api/auth/profile',
                 '/api/auth/forgot', '/api/auth/reset', '/api/auth/verify', '/api/auth/verify/resend']) {
  check(`${p} goes to the accounts system`, ACCOUNT_PATHS.has(p));
}
for (const p of ['/api/admin/users', '/api/auth/bootstrap', '/api/data/tracker', '/api/me', '/api/auth/../admin/users',
                 '/api/auth/verify/../../admin/users']) {
  check(`${p} does not`, !ACCOUNT_PATHS.has(p));
}

let res = await toAccounts(req('/api/auth/signup', {
  method: 'POST',
  headers: {
    'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.4', Cookie: 'nae_session=old',
    'Cf-Access-Jwt-Assertion': 'pasted.token.here', 'Cf-Access-Authenticated-User-Email': 'owner@example.com',
  },
  body: JSON.stringify({ email: 'a@example.com', password: 'a-long-enough-password', name: 'A' }),
}), env, '/api/auth/signup');
const got = seen.at(-1);
check('the path is passed on', new URL(got.url).pathname === '/api/auth/signup', got.url);
check('the method and body are passed on', got.method === 'POST' && JSON.parse(got.body).email === 'a@example.com');
check('the content type is passed on (sign-up refuses anything else)', got.headers['content-type'] === 'application/json');
check("the visitor's address is passed on (sign-up limits count it)", got.headers['cf-connecting-ip'] === '203.0.113.4');
check('the session cookie is passed on', got.headers.cookie === 'nae_session=old');
check('an Access token is not passed on', !('cf-access-jwt-assertion' in got.headers));
check('an Access email header is not passed on', !('cf-access-authenticated-user-email' in got.headers));
check('the answer comes back with its cookie', res.status === 200 && /nae_session=abc/.test(res.headers.get('Set-Cookie') || ''));

res = await toAccounts(req('/beauty-school/api/auth/me'), env, '/api/auth/me');
check('under a subfolder, the path without it is what is passed on', new URL(seen.at(-1).url).pathname === '/api/auth/me' && seen.at(-1).method === 'GET');

res = await toAccounts(req('/api/auth/me'), {}, '/api/auth/me');
check('without the binding, it says accounts are unavailable', res.status === 503);

res = await toAccounts(req('/api/auth/me'), { ACCOUNTS: { fetch: async () => { throw new Error('down'); } } }, '/api/auth/me');
check('if the accounts system cannot be reached, the same', res.status === 503);

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
