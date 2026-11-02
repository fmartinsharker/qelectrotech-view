// Firebase (plano gratuito): login Microsoft 365 e notas partilhadas no Firestore.
// O SDK vem da CDN da Google e só é carregado se houver configuração (ver firebase-config.js).
// A segurança está nas regras do servidor (firestore.rules): autor = email do login, datas do servidor.
import { b64url } from "./notes.js";

const SDK = "13.0.0";
const CDN = `https://www.gstatic.com/firebasejs/${SDK}`;
const EDIT_GAP_MS = 2 * 60 * 1000;
const EMULATORS = { auth: "http://127.0.0.1:9099", firestoreHost: "127.0.0.1", firestorePort: 8080 };

/** Documento do Firestore -> nota usada pela página (datas em milissegundos). */
function fromDoc(id, d) {
  const ms = (t) => (t && typeof t.toMillis === "function" ? t.toMillis() : Number(t) || 0);
  const n = { id, kind: d.kind, ref: d.ref, text: d.text, created: ms(d.created), createdBy: d.createdBy, createdByEmail: d.createdByEmail, updated: ms(d.updated), updatedBy: d.updatedBy, updatedByEmail: d.updatedByEmail };
  if (d.folio) n.folio = d.folio;
  if (d.kind === "pin") { n.x = d.x; n.y = d.y; }
  return n;
}

/** Marca erros de permissão/sessão para a página mostrar «sessão expirada». */
const tagAuth = (e) => {
  if (e && (e.code === "permission-denied" || e.code === "unauthenticated")) e.auth = true;
  return e;
};

class FirestoreNotes {
  constructor(fs, db, projectKey, user) {
    this.fs = fs;
    this.db = db;
    this.user = user;
    this.col = fs.collection(db, "projects", b64url(projectKey), "notes");
    this.editsCol = fs.collection(db, "projects", b64url(projectKey), "edits");
    this.lastEdit = new Map(); // id da nota -> quando esta sessão registou a última edição
  }

  /** Histórico de edições do projecto: Map(id da nota -> [{ by, at }] por ordem). Falhas aqui não afectam as notas. */
  subscribeEdits(onEdits) {
    return this.fs.onSnapshot(
      this.editsCol,
      (snap) => {
        const byNote = new Map();
        for (const d of snap.docs) {
          const e = d.data({ serverTimestamps: "estimate" });
          const at = e.at && typeof e.at.toMillis === "function" ? e.at.toMillis() : 0;
          if (!byNote.has(e.noteId)) byNote.set(e.noteId, []);
          byNote.get(e.noteId).push({ by: e.by, byEmail: e.byEmail, at });
        }
        for (const l of byNote.values()) l.sort((a, b) => a.at - b.at);
        onEdits(byNote);
      },
      () => {},
    );
  }

  subscribe(onNotes, onError) {
    return this.fs.onSnapshot(
      this.col,
      (snap) => onNotes(snap.docs.map((d) => fromDoc(d.id, d.data({ serverTimestamps: "estimate" })))),
      (e) => onError(tagAuth(e)),
    );
  }

  /** Cria a nota se não existir, senão só actualiza o texto (o criador nunca muda). */
  async put(n) {
    const { doc, runTransaction, serverTimestamp } = this.fs;
    const ref = doc(this.col, n.id);
    const name = String(this.user.name).slice(0, 120);
    const email = this.user.email;
    try {
      await runTransaction(this.db, async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists()) {
          tx.update(ref, { text: n.text, updated: serverTimestamp(), updatedBy: name, updatedByEmail: email });
          // uma linha no histórico por edição; várias gravações seguidas (a escrever) contam como uma só
          if (!(Date.now() - (this.lastEdit.get(n.id) || 0) < EDIT_GAP_MS)) {
            tx.set(doc(this.editsCol), { noteId: n.id, by: name, byEmail: email, at: serverTimestamp() });
            this.lastEdit.set(n.id, Date.now());
          }
        } else {
          const d = { kind: n.kind, ref: n.ref, text: n.text, created: serverTimestamp(), createdBy: name, createdByEmail: email, updated: serverTimestamp(), updatedBy: name, updatedByEmail: email };
          if (n.folio) d.folio = n.folio;
          if (n.kind === "pin") { d.x = n.x; d.y = n.y; }
          tx.set(ref, d);
        }
      });
    } catch (e) {
      throw tagAuth(e);
    }
    return { note: n }; // as datas reais chegam pela subscrição
  }

  async del(id) {
    try { await this.fs.deleteDoc(this.fs.doc(this.col, id)); } catch (e) { throw tagAuth(e); }
  }
}

/**
 * cfg: configuração web do projecto Firebase. tenant: ID ou domínio do directório Microsoft (restringe o login).
 * emulator: usa os emuladores locais (desenvolvimento).
 */
export async function createFirebase(cfg, { tenant = "", emulator = false } = {}) {
  const [appMod, authMod, fs] = await Promise.all([import(`${CDN}/firebase-app.js`), import(`${CDN}/firebase-auth.js`), import(`${CDN}/firebase-firestore.js`)]);
  const app = appMod.initializeApp(cfg);
  const auth = authMod.getAuth(app);
  const db = fs.getFirestore(app);
  if (emulator) {
    authMod.connectAuthEmulator(auth, EMULATORS.auth, { disableWarnings: true });
    fs.connectFirestoreEmulator(db, EMULATORS.firestoreHost, EMULATORS.firestorePort);
  }
  const toUser = (u) => (u && u.email ? { uid: u.uid, name: u.displayName || u.email, email: u.email.toLowerCase() } : null);

  return {
    emulator,
    /** Chama cb com o utilizador (ou null) agora e sempre que a sessão mudar. */
    onUser: (cb) => authMod.onAuthStateChanged(auth, (u) => cb(toUser(u))),

    async signIn() {
      const provider = new authMod.OAuthProvider("microsoft.com");
      ["openid", "profile", "email"].forEach((s) => provider.addScope(s));
      // "organizations" = só contas de trabalho/escola; com o ID do directório fica restrito à vossa organização
      provider.setCustomParameters({ tenant: tenant || "organizations", prompt: "select_account" });
      await authMod.signInWithPopup(auth, provider);
    },

    /** Só nos emuladores: entra como um utilizador de teste sem janela de login. */
    async devSignIn(name, email) {
      if (!emulator) throw new Error("Só disponível nos emuladores.");
      const token = JSON.stringify({ sub: email, email, email_verified: true, display_name: name, name });
      await authMod.signInWithCredential(auth, authMod.GoogleAuthProvider.credential(token));
    },

    signOut: () => authMod.signOut(auth),
    notes: (projectKey, user) => new FirestoreNotes(fs, db, projectKey, user),
  };
}
