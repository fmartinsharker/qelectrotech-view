'use strict';
// Armazenamento em Azure Cosmos DB (NoSQL). O plano gratuito ("free tier") inclui 1000 RU/s e 25 GB
// para sempre; este uso consome uma fracção mínima. Partição por projecto, um documento por nota.

const FIELDS = ['id', 'kind', 'ref', 'text', 'folio', 'x', 'y', 'created', 'createdBy', 'createdByEmail', 'updated', 'updatedBy', 'updatedByEmail'];

/** Documento Cosmos -> nota (descarta as propriedades de sistema _rid, _etag, _ts…). */
const fromItem = (item) => {
  const n = {};
  for (const k of FIELDS) if (item[k] !== undefined && item[k] !== null) n[k] = item[k];
  return n;
};

const toItem = (project, note) => ({ ...fromItem(note), project });

async function cosmosStore(connectionString, databaseId = 'qetnotes', containerId = 'notes') {
  const { CosmosClient } = require('@azure/cosmos');
  const client = new CosmosClient(connectionString);
  // se já existirem (criados no portal com 400 RU/s) isto não altera nada
  const { database } = await client.databases.createIfNotExists({ id: databaseId });
  const { container } = await database.containers.createIfNotExists({ id: containerId, partitionKey: { paths: ['/project'] } });
  return {
    async list(project) {
      const { resources } = await container.items
        .query({ query: 'SELECT * FROM c WHERE c.project = @p', parameters: [{ name: '@p', value: project }] }, { partitionKey: project })
        .fetchAll();
      return resources.map(fromItem).sort((a, b) => a.created - b.created);
    },
    async get(project, id) {
      const { resource } = await container.item(id, project).read(); // 404 -> resource indefinido
      return resource ? fromItem(resource) : null;
    },
    async put(project, note) { await container.items.upsert(toItem(project, note)); },
    async remove(project, id) {
      try { await container.item(id, project).delete(); } catch (e) { if (e.code !== 404) throw e; }
    },
  };
}

module.exports = { cosmosStore, fromItem, toItem };
