'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { handle, parsePrincipal } = require('../src/lib/notes-handler');
const { memoryStore } = require('../src/lib/memory-store');
const { toEntity, fromEntity, partitionOf } = require('../src/lib/table-store');

const principal = (email, name, roles = ['anonymous', 'authenticated']) =>
  Buffer.from(JSON.stringify({ identityProvider: 'aad', userId: 'id-' + email, userDetails: email, userRoles: roles, claims: name ? [{ typ: 'name', val: name }] : [] })).toString('base64');

const ana = { 'x-ms-client-principal': principal('ana@harkersolutions.com', 'Ana Silva') };
const rui = { 'x-ms-client-principal': principal('rui@harkersolutions.com') };
const P = 'Projecto X';

test('sem sessão: 401', async () => {
  const r = await handle({ method: 'GET', project: P, headers: {} }, memoryStore());
  assert.equal(r.status, 401);
});

test('cabeçalho falsificado ou sem papel "authenticated": 401', async () => {
  const s = memoryStore();
  assert.equal((await handle({ method: 'GET', project: P, headers: { 'x-ms-client-principal': 'lixo' } }, s)).status, 401);
  const anon = { 'x-ms-client-principal': principal('a@b.pt', null, ['anonymous']) };
  assert.equal((await handle({ method: 'GET', project: P, headers: anon }, s)).status, 401);
});

test('domínio não permitido: 403', async () => {
  const other = { 'x-ms-client-principal': principal('x@outra.com') };
  const r = await handle({ method: 'GET', project: P, headers: other }, memoryStore(), { ALLOWED_DOMAINS: 'harkersolutions.com' });
  assert.equal(r.status, 403);
  const ok = await handle({ method: 'GET', project: P, headers: ana }, memoryStore(), { ALLOWED_DOMAINS: 'harkersolutions.com, outra.com' });
  assert.equal(ok.status, 200);
});

test('criar nota: autor e datas vêm do servidor, não do pedido', async () => {
  const s = memoryStore();
  const r = await handle({ method: 'PUT', id: 'element_abc', project: P, headers: ana, body: { kind: 'element', ref: 'abc', text: 'olá', createdBy: 'Falso', created: 1 } }, s);
  assert.equal(r.status, 200);
  assert.equal(r.body.note.createdBy, 'Ana Silva');
  assert.equal(r.body.note.createdByEmail, 'ana@harkersolutions.com');
  assert.ok(r.body.note.created > 1_000_000_000_000);
});

test('outra pessoa edita: mantém quem criou, regista quem editou', async () => {
  const s = memoryStore();
  await handle({ method: 'PUT', id: 'folio_1', project: P, headers: ana, body: { kind: 'folio', ref: '1', text: 'v1' } }, s);
  const r = await handle({ method: 'PUT', id: 'folio_1', project: P, headers: rui, body: { kind: 'folio', ref: '1', text: 'v2' } }, s);
  assert.equal(r.body.note.text, 'v2');
  assert.equal(r.body.note.createdBy, 'Ana Silva');
  assert.equal(r.body.note.updatedBy, 'rui@harkersolutions.com'); // sem claim de nome usa o email
  assert.ok(r.body.note.updated >= r.body.note.created);
});

test('listar devolve as notas do projecto e quem sou', async () => {
  const s = memoryStore();
  await handle({ method: 'PUT', id: 'a', project: P, headers: ana, body: { kind: 'project', ref: 'project', text: '1' } }, s);
  await handle({ method: 'PUT', id: 'b', project: 'Outro', headers: ana, body: { kind: 'project', ref: 'project', text: '2' } }, s);
  const r = await handle({ method: 'GET', project: P, headers: rui }, s);
  assert.equal(r.body.notes.length, 1);
  assert.equal(r.body.me.email, 'rui@harkersolutions.com');
});

test('pin precisa de folha e posição', async () => {
  const s = memoryStore();
  const base = { method: 'PUT', id: 'pin1', project: P, headers: ana };
  assert.equal((await handle({ ...base, body: { kind: 'pin', ref: 'r', text: 't' } }, s)).status, 400);
  assert.equal((await handle({ ...base, body: { kind: 'pin', ref: 'r', text: 't', folio: 'f1', x: 10.4, y: 20 } }, s)).body.note.x, 10);
});

test('validação: tipo, texto grande, id e projecto', async () => {
  const s = memoryStore();
  const put = (id, body, project = P) => handle({ method: 'PUT', id, project, headers: ana, body }, s);
  assert.equal((await put('a', { kind: 'xxx', ref: 'r', text: '' })).status, 400);
  assert.equal((await put('a', { kind: 'folio', ref: 'r', text: 'x'.repeat(20001) })).status, 413);
  assert.equal((await put('a/../b', { kind: 'folio', ref: 'r', text: '' })).status, 400);
  assert.equal((await put('a', { kind: 'folio', ref: 'r', text: '' }, '')).status, 400);
});

test('apagar', async () => {
  const s = memoryStore();
  await handle({ method: 'PUT', id: 'a', project: P, headers: ana, body: { kind: 'project', ref: 'project', text: 'x' } }, s);
  assert.equal((await handle({ method: 'DELETE', id: 'a', project: P, headers: rui }, s)).status, 200);
  assert.equal((await handle({ method: 'GET', project: P, headers: rui }, s)).body.notes.length, 0);
});

test('escritas de outra origem: 403', async () => {
  const s = memoryStore();
  const r = await handle({ method: 'PUT', id: 'a', project: P, headers: { ...ana, origin: 'https://mau.example', host: 'app.exemplo.pt' }, body: { kind: 'project', ref: 'project', text: 'x' } }, s);
  assert.equal(r.status, 403);
  const ok = await handle({ method: 'PUT', id: 'a', project: P, headers: { ...ana, origin: 'https://app.exemplo.pt', host: 'app.exemplo.pt' }, body: { kind: 'project', ref: 'project', text: 'x' } }, s);
  assert.equal(ok.status, 200);
});

test('parsePrincipal lê o nome do claim', () => {
  assert.equal(parsePrincipal(ana['x-ms-client-principal']).name, 'Ana Silva');
  assert.equal(parsePrincipal(null), null);
});

test('mapeamento para Table Storage é reversível', () => {
  const n = { id: 'pin_1', kind: 'pin', ref: 'r', text: 'olá', folio: 'f1', x: 3, y: 4, created: 1_760_000_000_000, createdBy: 'A', createdByEmail: 'a@b', updated: 1_760_000_000_001, updatedBy: 'B', updatedByEmail: 'b@b' };
  const e = toEntity('Projecto', n);
  assert.equal(e.partitionKey, partitionOf('Projecto'));
  assert.deepEqual(fromEntity({ ...e }), n);
});
