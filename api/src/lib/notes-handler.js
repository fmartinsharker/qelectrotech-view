'use strict';
// Lógica da API de notas partilhadas, independente do Azure (recebe o "store" por argumento).
// A identidade vem SEMPRE do cabeçalho x-ms-client-principal que o Azure Static Web Apps
// preenche depois do login; nunca de dados enviados pela página.

const KINDS = new Set(['project', 'folio', 'element', 'conductor', 'pin']);
const MAX_TEXT = 20000;
const MAX_REF = 600;
const ID_RE = /^[A-Za-z0-9_-]{1,900}$/;

/** Lê o utilizador autenticado. Devolve null se não houver sessão válida. */
function parsePrincipal(header) {
  if (!header) return null;
  let p;
  try {
    p = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
  } catch {
    return null;
  }
  if (!p || typeof p.userDetails !== 'string' || !p.userDetails) return null;
  const roles = Array.isArray(p.userRoles) ? p.userRoles : [];
  if (!roles.includes('authenticated')) return null;
  const claims = Array.isArray(p.claims) ? p.claims : [];
  const nameClaim = claims.find((c) => c && (c.typ === 'name' || /\/claims\/name$/.test(c.typ || '')));
  const email = p.userDetails.trim();
  return { id: String(p.userId || email), email, roles, name: String((nameClaim && nameClaim.val) || email).slice(0, 120) };
}

function domainAllowed(email, env) {
  const list = (env.ALLOWED_DOMAINS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return true;
  return list.includes(String(email.split('@')[1] || '').toLowerCase());
}

const bad = (status, error) => ({ status, body: { error } });

/**
 * req: { method, id, project, body, headers: { 'x-ms-client-principal', origin, host } }
 * store: { list(project), get(project, id), put(project, note), remove(project, id) }
 */
async function handle(req, store, env = {}) {
  const user = parsePrincipal(req.headers && req.headers['x-ms-client-principal']);
  if (!user) return bad(401, 'Sessão não iniciada.');
  if (!domainAllowed(user.email, env)) return bad(403, 'Conta não autorizada.');
  // opcional: exigir um papel atribuído por convite no Static Web Apps (ex.: "equipa")
  if (env.REQUIRED_ROLE && !user.roles.includes(env.REQUIRED_ROLE)) return bad(403, 'Conta sem acesso ao projecto.');

  const project = typeof req.project === 'string' ? req.project : req.body && req.body.project;
  if (typeof project !== 'string' || !project.trim() || project.length > 300) return bad(400, 'Projecto em falta ou inválido.');

  const writes = req.method === 'PUT' || req.method === 'DELETE';
  if (writes && req.headers.origin && req.headers.host) {
    let originHost = '';
    try { originHost = new URL(req.headers.origin).host; } catch { /* inválido */ }
    if (originHost !== req.headers.host) return bad(403, 'Origem não permitida.');
  }

  if (req.method === 'GET') {
    const notes = await store.list(project);
    return { status: 200, body: { me: { name: user.name, email: user.email }, notes } };
  }

  if (!req.id || !ID_RE.test(req.id)) return bad(400, 'Identificador de nota inválido.');

  if (req.method === 'DELETE') {
    await store.remove(project, req.id);
    return { status: 200, body: { ok: true } };
  }

  if (req.method !== 'PUT') return bad(405, 'Método não suportado.');

  const b = req.body || {};
  if (!KINDS.has(b.kind)) return bad(400, 'Tipo de nota inválido.');
  if (typeof b.ref !== 'string' || !b.ref || b.ref.length > MAX_REF) return bad(400, 'Referência inválida.');
  if (typeof b.text !== 'string') return bad(400, 'Texto em falta.');
  if (b.text.length > MAX_TEXT) return bad(413, `A nota excede ${MAX_TEXT} caracteres.`);
  if ((b.kind === 'pin' || b.kind === 'conductor') && (typeof b.folio !== 'string' || !b.folio || b.folio.length > 200)) return bad(400, 'Folha em falta.');
  if (b.kind === 'pin' && !(Number.isFinite(b.x) && Number.isFinite(b.y))) return bad(400, 'Posição inválida.');

  const now = Date.now();
  const existing = await store.get(project, req.id);
  const note = existing
    ? { ...existing, text: b.text, updated: now, updatedBy: user.name, updatedByEmail: user.email }
    : {
        id: req.id, kind: b.kind, ref: b.ref, text: b.text,
        ...(b.folio ? { folio: b.folio } : {}),
        ...(b.kind === 'pin' ? { x: Math.round(b.x), y: Math.round(b.y) } : {}),
        created: now, createdBy: user.name, createdByEmail: user.email,
        updated: now, updatedBy: user.name, updatedByEmail: user.email,
      };
  await store.put(project, note);
  return { status: 200, body: { note } };
}

module.exports = { handle, parsePrincipal, domainAllowed, KINDS, MAX_TEXT };
