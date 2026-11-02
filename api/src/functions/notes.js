'use strict';
const { app } = require('@azure/functions');
const { handle } = require('../lib/notes-handler');
const { cosmosStore } = require('../lib/cosmos-store');

let storePromise;
const getStore = () => {
  if (!process.env.COSMOS_CONNECTION) throw new Error('A definição COSMOS_CONNECTION (ligação ao Cosmos DB) não está configurada.');
  return (storePromise ||= cosmosStore(process.env.COSMOS_CONNECTION));
};

app.http('notes', {
  methods: ['GET', 'PUT', 'DELETE'],
  authLevel: 'anonymous', // o acesso é controlado pelo Static Web Apps (staticwebapp.config.json)
  route: 'notes/{id?}',
  handler: async (request, context) => {
    try {
      let body;
      if (request.method === 'PUT') {
        try { body = await request.json(); } catch { return { status: 400, jsonBody: { error: 'JSON inválido.' }, headers: { 'Cache-Control': 'no-store' } }; }
      }
      const res = await handle(
        {
          method: request.method,
          id: request.params.id,
          project: request.query.get('project') || undefined,
          body,
          headers: {
            'x-ms-client-principal': request.headers.get('x-ms-client-principal'),
            origin: request.headers.get('origin'),
            host: request.headers.get('x-forwarded-host') || request.headers.get('host'),
          },
        },
        await getStore(),
        process.env,
      );
      return { status: res.status, jsonBody: res.body, headers: { 'Cache-Control': 'no-store' } };
    } catch (err) {
      context.error(err);
      return { status: 500, jsonBody: { error: 'Erro no servidor de notas.' }, headers: { 'Cache-Control': 'no-store' } };
    }
  },
});
