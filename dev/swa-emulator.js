'use strict';
// Emulador mínimo do Azure Static Web Apps para desenvolvimento local:
//  - serve web/ (só com "sessão");
//  - /.auth/me, /.auth/login/aad, /.auth/logout com utilizadores de teste;
//  - /api/notes com a MESMA lógica da função Azure, guardando em dev/.notes.json.
// Uso: node dev/swa-emulator.js [porta] [pasta-extra-para-/testdata]
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { handle } = require('../api/src/lib/notes-handler');
const { memoryStore } = require('../api/src/lib/memory-store');

const PORT = Number(process.argv[2]) || 8767;
const EXTRA = process.argv[3] ? path.resolve(process.argv[3]) : null;
const WEB = path.join(__dirname, '..', 'web');
const store = memoryStore(path.join(__dirname, '.notes.json'));
const USERS = {
  ana: { name: 'Ana Silva', email: 'ana.silva@harkersolutions.com' },
  rui: { name: 'Rui Costa', email: 'rui.costa@harkersolutions.com' },
  francisco: { name: 'Francisco Martins', email: 'francisco.martins@harkersolutions.com' },
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.qet': 'application/xml', '.svg': 'image/svg+xml' };

const cookieUser = (req) => {
  const m = /(?:^|;\s*)qetuser=([a-z]+)/.exec(req.headers.cookie || '');
  return m && USERS[m[1]] ? m[1] : null;
};

const principalOf = (key) => {
  const u = USERS[key];
  return Buffer.from(JSON.stringify({ identityProvider: 'aad', userId: 'dev-' + key, userDetails: u.email, userRoles: ['anonymous', 'authenticated'], claims: [{ typ: 'name', val: u.name }] })).toString('base64');
};

const send = (res, status, body, headers = {}) => { res.writeHead(status, { 'Cache-Control': 'no-store', ...headers }); res.end(body); };
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json' });

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const user = cookieUser(req);

  if (url.pathname === '/.auth/me') {
    if (!user) return json(res, 200, { clientPrincipal: null });
    return json(res, 200, { clientPrincipal: JSON.parse(Buffer.from(principalOf(user), 'base64').toString()) });
  }
  if (url.pathname === '/.auth/login/aad') {
    const pick = url.searchParams.get('user');
    if (USERS[pick]) return send(res, 302, '', { Location: url.searchParams.get('post_login_redirect_uri') || '/', 'Set-Cookie': `qetuser=${pick}; Path=/; HttpOnly; SameSite=Lax` });
    return send(res, 200, `<!doctype html><meta charset=utf-8><title>Entrar (emulador)</title><h1>Entrar (emulador do Microsoft 365)</h1>${Object.entries(USERS).map(([k, u]) => `<p><a href="?user=${k}">${u.name} — ${u.email}</a></p>`).join('')}`, { 'Content-Type': 'text/html; charset=utf-8' });
  }
  if (url.pathname === '/.auth/logout') return send(res, 302, '', { Location: '/', 'Set-Cookie': 'qetuser=; Path=/; Max-Age=0' });

  if (!user) return send(res, 302, '', { Location: '/.auth/login/aad' });

  if (url.pathname.startsWith('/api/notes')) {
    let body;
    if (req.method === 'PUT') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return json(res, 400, { error: 'JSON inválido.' }); }
    }
    const id = decodeURIComponent(url.pathname.slice('/api/notes'.length).replace(/^\//, '')) || undefined;
    const r = await handle(
      { method: req.method, id, project: url.searchParams.get('project') || undefined, body,
        headers: { 'x-ms-client-principal': principalOf(user), origin: req.headers.origin, host: req.headers.host } },
      store, process.env);
    return json(res, r.status, r.body);
  }

  let rel = decodeURIComponent(url.pathname);
  let root = WEB;
  if (rel.startsWith('/testdata/') && EXTRA) { root = EXTRA; rel = rel.slice('/testdata'.length); }
  const file = path.normalize(path.join(root, rel === '/' ? 'index.html' : rel));
  if (!file.startsWith(root + path.sep) && file !== root) return send(res, 403, 'Proibido');
  fs.readFile(file, (err, data) => err ? send(res, 404, 'Não encontrado') : send(res, 200, data, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }));
}).listen(PORT, '127.0.0.1', () => console.log(`Emulador em http://localhost:${PORT}  (utilizadores: ${Object.keys(USERS).join(', ')})`));
