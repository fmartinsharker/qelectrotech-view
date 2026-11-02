// Notas do utilizador.
// - Modo partilhado (Azure Static Web Apps + login Microsoft 365): as notas ficam no servidor,
//   o autor e as datas são escritos pelo servidor a partir da sessão.
// - Modo local (sem servidor): ficam no browser (localStorage) e podem ser exportadas/importadas.
// O ficheiro .qet nunca é alterado: as notas ligam-se a folhas/elementos pelo UUID.

const PREFIX = "qetview:notes:v1:";
const USER_KEY = "qetview:user";
let memoryUser = "";
let identity = null; // { name, email } quando há sessão Microsoft 365

export function setIdentity(i) { identity = i; }
export function getIdentity() { return identity; }

/** Nome de quem escreve. Com login vem da sessão; sem login é o que a pessoa escreveu. */
export function getUser() {
  if (identity) return identity.name;
  try { return localStorage.getItem(USER_KEY) || memoryUser; } catch { return memoryUser; }
}
export function setUser(name) {
  memoryUser = name.trim();
  try { localStorage.setItem(USER_KEY, memoryUser); } catch { /* sem armazenamento: fica só em memória */ }
}

const b64url = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Identificador estável: duas pessoas a anotar o mesmo elemento escrevem na mesma nota. */
export const noteId = (kind, ref) => `${kind}_${b64url(ref)}`;

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 8));

/** Cliente da API /api/notes. */
export class RemoteBackend {
  constructor(project) { this.project = project; }

  async #json(r) {
    if (r.status === 401 || r.status === 403) throw Object.assign(new Error("Sessão inválida"), { auth: true });
    if (!r.ok) throw new Error(`Erro ${r.status}`);
    return r.json();
  }

  list() {
    return fetch(`/api/notes?project=${encodeURIComponent(this.project)}`, { cache: "no-store" }).then((r) => this.#json(r));
  }

  put(n) {
    const body = { project: this.project, kind: n.kind, ref: n.ref, text: n.text };
    if (n.folio) body.folio = n.folio;
    if (n.kind === "pin") { body.x = n.x; body.y = n.y; }
    return fetch(`/api/notes/${encodeURIComponent(n.id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => this.#json(r));
  }

  del(id) {
    return fetch(`/api/notes/${encodeURIComponent(id)}?project=${encodeURIComponent(this.project)}`, { method: "DELETE" }).then((r) => this.#json(r));
  }
}

const FLUSH_MS = 700;
const POLL_MS = 15000;

export class NoteStore {
  /** key: chave local (localStorage); remote: RemoteBackend ou null */
  constructor(key, remote = null) {
    this.key = PREFIX + key;
    this.remote = remote;
    this.notes = [];
    this.onchange = () => {};
    this.onstatus = () => {};
    this.persistent = true;
    this.status = remote ? "idle" : "local";
    this.lastSync = 0;
    this.dirty = new Map(); // id -> versão da última edição por enviar
    this.deleted = new Set();
    this.ver = 0;
    this.timer = null;
    this.poller = null;
    this.flushing = false;
    if (!remote) {
      try {
        const raw = localStorage.getItem(this.key);
        if (raw) this.notes = JSON.parse(raw).notes || [];
      } catch {
        this.persistent = false;
      }
    }
  }

  get shared() { return !!this.remote; }

  // ---------- persistência ----------

  save() {
    try {
      localStorage.setItem(this.key, JSON.stringify({ notes: this.notes }));
      this.persistent = true;
    } catch {
      this.persistent = false;
    }
    this.onchange();
  }

  /** Regista uma alteração (note) ou um apagamento (removedId). */
  commit(note, removedId) {
    if (!this.remote) return this.save();
    if (removedId) { this.dirty.delete(removedId); this.deleted.add(removedId); }
    else this.dirty.set(note.id, ++this.ver);
    this.setStatus("saving");
    this.schedule(FLUSH_MS);
    this.onchange();
  }

  schedule(ms) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, ms);
  }

  setStatus(s) {
    this.status = s;
    this.onstatus(s);
  }

  async flush() {
    if (!this.remote || this.flushing) return;
    this.flushing = true;
    try {
      for (const id of [...this.deleted]) { await this.remote.del(id); this.deleted.delete(id); }
      for (const [id, v] of [...this.dirty]) {
        const n = this.byId(id);
        if (!n) { this.dirty.delete(id); continue; }
        const { note } = await this.remote.put(n);
        // o servidor é quem decide autor e datas; o texto local só é substituído se não houver edição mais recente
        const mine = this.byId(id);
        if (mine) {
          if (this.dirty.get(id) === v) Object.assign(mine, note);
          else Object.assign(mine, { created: note.created, createdBy: note.createdBy, createdByEmail: note.createdByEmail });
        }
        if (this.dirty.get(id) === v) this.dirty.delete(id);
      }
      this.lastSync = Date.now();
      this.setStatus(this.dirty.size || this.deleted.size ? "saving" : "saved");
      this.onchange();
    } catch (e) {
      this.setStatus(e.auth ? "auth" : "error");
      if (!e.auth) this.schedule(5000);
    } finally {
      this.flushing = false;
    }
    if ((this.dirty.size || this.deleted.size) && this.status === "saving" && !this.timer) this.schedule(FLUSH_MS);
  }

  // ---------- sincronização (modo partilhado) ----------

  async start() {
    if (!this.remote) return;
    await this.pull();
    this.poller = setInterval(() => { if (!document.hidden) this.pull(); }, POLL_MS);
    this.onvisible = () => { if (!document.hidden) this.pull(); };
    document.addEventListener("visibilitychange", this.onvisible);
  }

  stop() {
    clearInterval(this.poller);
    clearTimeout(this.timer);
    if (this.onvisible) document.removeEventListener("visibilitychange", this.onvisible);
  }

  async pull() {
    if (!this.remote || this.flushing) return;
    const t0 = Date.now();
    try {
      const { notes } = await this.remote.list();
      let changed = false;
      const seen = new Set();
      for (const rn of notes) {
        seen.add(rn.id);
        if (this.dirty.has(rn.id) || this.deleted.has(rn.id)) continue; // há alterações locais por enviar
        const ln = this.byId(rn.id);
        if (!ln) { this.notes.push(rn); changed = true; }
        else if ((rn.updated || 0) !== (ln.updated || 0) || rn.text !== ln.text) { Object.assign(ln, rn); changed = true; }
      }
      // apagadas por outra pessoa (ignora as criadas há instantes, que o servidor ainda pode não ter listado)
      const before = this.notes.length;
      this.notes = this.notes.filter((n) => seen.has(n.id) || this.dirty.has(n.id) || (n.updated || n.created || 0) > t0 - 8000);
      if (this.notes.length !== before) changed = true;
      this.lastSync = Date.now();
      this.setStatus(this.dirty.size ? "saving" : "saved");
      if (changed) this.onchange();
    } catch (e) {
      this.setStatus(e.auth ? "auth" : "error");
    }
  }

  // ---------- operações ----------

  /** kind: project | folio | element | conductor | pin */
  find(kind, ref) {
    return this.notes.find((n) => n.kind === kind && n.ref === ref);
  }

  byId(id) {
    return this.notes.find((n) => n.id === id);
  }

  /** Cria ou actualiza; texto vazio apaga (excepto pins, que se apagam explicitamente). */
  set(kind, ref, text, extra = {}) {
    let n = this.find(kind, ref);
    if (!n) {
      if (!text.trim()) return null;
      n = { id: noteId(kind, ref), kind, ref, ...extra, text: "", created: Date.now(), createdBy: getUser() };
      this.notes.push(n);
    }
    n.text = text;
    n.updated = Date.now();
    n.updatedBy = getUser();
    if (!text.trim() && kind !== "pin") {
      this.notes = this.notes.filter((x) => x !== n);
      this.commit(null, n.id);
      return null;
    }
    this.commit(n);
    return n;
  }

  addPin(folio, x, y) {
    const id = uid();
    const n = { id, kind: "pin", ref: id, folio, x: Math.round(x), y: Math.round(y), text: "", created: Date.now(), createdBy: getUser(), updated: Date.now(), updatedBy: getUser() };
    this.notes.push(n);
    this.commit(n);
    return n;
  }

  setText(id, text) {
    const n = this.byId(id);
    if (!n) return;
    n.text = text;
    n.updated = Date.now();
    n.updatedBy = getUser();
    this.commit(n);
  }

  remove(id) {
    this.notes = this.notes.filter((n) => n.id !== id);
    this.commit(null, id);
  }

  pinsOf(folio) {
    return this.notes.filter((n) => n.kind === "pin" && n.folio === folio);
  }

  export() {
    return JSON.stringify({ app: "qelectrotec-viewer", version: 1, exported: new Date().toISOString(), notes: this.notes }, null, 2);
  }

  /** Junta notas importadas; em conflito fica a mais recente. No modo partilhado são enviadas ao servidor. */
  import(text) {
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.notes)) throw new Error("Ficheiro de notas inválido.");
    let added = 0;
    for (const n of data.notes) {
      if (!n || typeof n.text !== "string" || !n.kind || !n.ref) continue;
      const id = n.kind === "pin" ? n.id || uid() : noteId(n.kind, n.ref);
      const mine = this.byId(id) || this.find(n.kind, n.ref);
      if (!mine) { const c = { ...n, id }; this.notes.push(c); if (this.remote) this.dirty.set(id, ++this.ver); added++; }
      else if ((n.updated || 0) > (mine.updated || 0)) { Object.assign(mine, n, { id: mine.id }); if (this.remote) this.dirty.set(mine.id, ++this.ver); }
    }
    if (this.remote) { this.setStatus("saving"); this.schedule(FLUSH_MS); this.onchange(); }
    else this.save();
    return added;
  }
}
