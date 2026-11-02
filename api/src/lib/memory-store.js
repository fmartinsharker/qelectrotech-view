'use strict';
// Armazenamento em memória (testes e emulador local). Opcionalmente grava num ficheiro JSON.
const fs = require('node:fs');

function memoryStore(file) {
  const data = new Map(); // project -> Map(id -> note)
  if (file && fs.existsSync(file)) {
    try {
      for (const [p, notes] of Object.entries(JSON.parse(fs.readFileSync(file, 'utf8')))) data.set(p, new Map(notes.map((n) => [n.id, n])));
    } catch { /* ficheiro corrompido: começa vazio */ }
  }
  const persist = () => {
    if (file) fs.writeFileSync(file, JSON.stringify(Object.fromEntries([...data].map(([p, m]) => [p, [...m.values()]])), null, 2));
  };
  const of = (project) => data.get(project) || data.set(project, new Map()).get(project);
  return {
    async list(project) { return [...of(project).values()].sort((a, b) => a.created - b.created); },
    async get(project, id) { return of(project).get(id) || null; },
    async put(project, note) { of(project).set(note.id, structuredClone(note)); persist(); },
    async remove(project, id) { of(project).delete(id); persist(); },
  };
}

module.exports = { memoryStore };
