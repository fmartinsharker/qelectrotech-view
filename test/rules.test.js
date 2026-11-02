'use strict';
// Testes das regras de segurança contra o emulador do Firestore (npm test).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, updateDoc, getDoc, deleteDoc, serverTimestamp } = require('firebase/firestore');

const P = 'cHJvamVjdG8';
let env;

const ana = () => env.authenticatedContext('ana', { email: 'Ana.Silva@harkersolutions.com', name: 'Ana Silva' }).firestore();
const rui = () => env.authenticatedContext('rui', { email: 'rui.costa@harkersolutions.com' }).firestore();
const fora = () => env.authenticatedContext('x', { email: 'x@outra-empresa.com' }).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const ref = (db, id = 'folio_MQ') => doc(db, 'projects', P, 'notes', id);

const novo = (email = 'ana.silva@harkersolutions.com', extra = {}) => ({
  kind: 'folio', ref: '1', text: 'olá',
  created: serverTimestamp(), createdBy: 'Ana Silva', createdByEmail: email,
  updated: serverTimestamp(), updatedBy: 'Ana Silva', updatedByEmail: email, ...extra,
});

test.before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-qetview', firestore: { rules: fs.readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 } });
});
test.after(async () => env.cleanup());
test.beforeEach(async () => env.clearFirestore());

test('sem sessão ou de outro domínio: nem ler nem escrever', async () => {
  await assertFails(getDoc(ref(anon())));
  await assertFails(getDoc(ref(fora())));
  await assertFails(setDoc(ref(fora()), novo('x@outra-empresa.com')));
  await assertFails(setDoc(ref(anon()), novo()));
});

test('criar com o meu email e datas do servidor', async () => {
  await assertSucceeds(setDoc(ref(ana()), novo()));
  await assertSucceeds(getDoc(ref(rui()))); // outra pessoa da empresa lê
});

test('não se pode criar em nome de outra pessoa', async () => {
  await assertFails(setDoc(ref(ana()), novo('rui.costa@harkersolutions.com')));
});

test('datas têm de ser as do servidor', async () => {
  await assertFails(setDoc(ref(ana()), novo(undefined, { created: new Date('2020-01-01') })));
  await assertFails(setDoc(ref(ana()), novo(undefined, { updated: new Date() })));
});

test('validação: campos desconhecidos, texto grande, tipo, pin sem posição', async () => {
  await assertFails(setDoc(ref(ana()), novo(undefined, { extra: 1 })));
  await assertFails(setDoc(ref(ana()), novo(undefined, { text: 'x'.repeat(20001) })));
  await assertFails(setDoc(ref(ana()), novo(undefined, { kind: 'outro' })));
  await assertFails(setDoc(ref(ana()), novo(undefined, { kind: 'pin' })));
  await assertSucceeds(setDoc(ref(ana(), 'pin_1'), novo(undefined, { kind: 'pin', folio: 'f1', x: 10, y: 20 })));
});

test('outra pessoa edita: mantém o criador, regista o editor', async () => {
  await assertSucceeds(setDoc(ref(ana()), novo()));
  await assertSucceeds(updateDoc(ref(rui()), { text: 'v2', updated: serverTimestamp(), updatedBy: 'Rui Costa', updatedByEmail: 'rui.costa@harkersolutions.com' }));
});

test('edição: não se muda o criador, o tipo, nem se finge ser outro editor', async () => {
  await assertSucceeds(setDoc(ref(ana()), novo()));
  const base = { updated: serverTimestamp(), updatedBy: 'Rui', updatedByEmail: 'rui.costa@harkersolutions.com' };
  await assertFails(updateDoc(ref(rui()), { ...base, createdBy: 'Rui' }));
  await assertFails(updateDoc(ref(rui()), { ...base, createdByEmail: 'rui.costa@harkersolutions.com' }));
  await assertFails(updateDoc(ref(rui()), { ...base, kind: 'project' }));
  await assertFails(updateDoc(ref(rui()), { ...base, updatedByEmail: 'ana.silva@harkersolutions.com' }));
  await assertFails(updateDoc(ref(rui()), { ...base, updated: new Date('2020-01-01') }));
  await assertFails(updateDoc(ref(fora()), { ...base, updatedByEmail: 'x@outra-empresa.com' }));
});

const francisco = () => env.authenticatedContext('francisco', { email: 'Francisco.Martins@harkersolutions.com' }).firestore();

test('apagar: só o administrador, mesmo as notas de outros', async () => {
  await assertSucceeds(setDoc(ref(ana()), novo()));
  await assertFails(deleteDoc(ref(fora())));
  await assertFails(deleteDoc(ref(anon())));
  await assertFails(deleteDoc(ref(rui()))); // colega da empresa
  await assertFails(deleteDoc(ref(ana()))); // nem o próprio autor
  await assertSucceeds(getDoc(ref(ana())));
  await assertSucceeds(deleteDoc(ref(francisco())));
});

test('apagar: o administrador também cria e edita como os outros', async () => {
  await assertSucceeds(setDoc(ref(francisco()), novo('francisco.martins@harkersolutions.com')));
  await assertFails(deleteDoc(ref(rui())));
  await assertSucceeds(deleteDoc(ref(francisco())));
});

test('fora de projects/*/notes não há acesso', async () => {
  await assertFails(setDoc(doc(ana(), 'outra', 'coisa'), { a: 1 }));
  await assertFails(getDoc(doc(ana(), 'outra', 'coisa')));
});
