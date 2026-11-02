'use strict';
// Armazenamento em Azure Table Storage: uma partição por projecto, uma linha por nota.
const crypto = require('node:crypto');

const partitionOf = (project) => crypto.createHash('sha256').update(project).digest('hex').slice(0, 40);

const toEntity = (project, n) => ({
  partitionKey: partitionOf(project),
  rowKey: n.id,
  project, kind: n.kind, ref: n.ref, text: n.text,
  folio: n.folio || '',
  x: Number.isFinite(n.x) ? n.x : null,
  y: Number.isFinite(n.y) ? n.y : null,
  created: n.created, createdBy: n.createdBy, createdByEmail: n.createdByEmail,
  updated: n.updated, updatedBy: n.updatedBy, updatedByEmail: n.updatedByEmail,
});

const fromEntity = (e) => ({
  id: e.rowKey, kind: e.kind, ref: e.ref, text: e.text,
  ...(e.folio ? { folio: e.folio } : {}),
  ...(e.kind === 'pin' ? { x: e.x, y: e.y } : {}),
  created: e.created, createdBy: e.createdBy, createdByEmail: e.createdByEmail,
  updated: e.updated, updatedBy: e.updatedBy, updatedByEmail: e.updatedByEmail,
});

async function tableStore(connectionString, tableName = 'notes') {
  const { TableClient } = require('@azure/data-tables');
  const client = TableClient.fromConnectionString(connectionString, tableName);
  await client.createTable().catch(() => { /* já existe */ });
  return {
    async list(project) {
      const out = [];
      // a chave da partição é hexadecimal: não há injecção possível no filtro
      for await (const e of client.listEntities({ queryOptions: { filter: `PartitionKey eq '${partitionOf(project)}'` } })) out.push(fromEntity(e));
      return out.sort((a, b) => a.created - b.created);
    },
    async get(project, id) {
      try { return fromEntity(await client.getEntity(partitionOf(project), id)); } catch (e) { if (e.statusCode === 404) return null; throw e; }
    },
    async put(project, note) { await client.upsertEntity(toEntity(project, note), 'Replace'); },
    async remove(project, id) {
      try { await client.deleteEntity(partitionOf(project), id); } catch (e) { if (e.statusCode !== 404) throw e; }
    },
  };
}

module.exports = { tableStore, partitionOf, toEntity, fromEntity };
