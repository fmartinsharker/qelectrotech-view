import { parseProject, elementName, locationOf, relatedOf, nested, str, GENERIC_FONT } from "./qet.js";
import { renderFolio, elementBox, esc } from "./render.js";
import { NoteStore, getUser, setUser, setIdentity, setAdmin } from "./notes.js";
import { firebaseConfig, microsoftTenant, emailDomain, notesAdmin } from "./firebase-config.js";
setAdmin(notesAdmin);

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const S = {
  project: null,
  folio: null,
  rendered: null,
  svg: null,
  vb: { x: 0, y: 0, w: 100, h: 100 },
  sel: null, // { type: "element"|"conductor"|"pin", id }
  notes: null,
  back: [],
  fwd: [],
  pin: false,
  index: null,
};

const stage = $("#stage");

// ---------------------------------------------------------------- abrir ficheiros

async function openFile(file) {
  const err = $("#loadError");
  err.textContent = "";
  try {
    $("#status").textContent = "A ler…";
    const text = await file.text();
    await new Promise((r) => setTimeout(r)); // deixa o browser pintar antes do trabalho pesado
    await load(text, file.name);
  } catch (e) {
    err.textContent = e.message || String(e);
    $("#status").textContent = "";
  }
}

async function openUrl(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Não foi possível obter ${url} (${r.status})`);
    await load(await r.text(), decodeURIComponent(url.split("/").pop().split("?")[0]));
  } catch (e) {
    $("#loadError").textContent = e.message || String(e);
  }
}

/** Espera pelos tipos de letra do projecto, para a medição dos textos já os usar. */
async function loadFonts(families) {
  if (!document.fonts) return;
  const fams = [...new Set(families)].filter((f) => !GENERIC_FONT.test(f));
  const jobs = fams.flatMap((f) => [400, 700].map((w) => document.fonts.load(`${w} 12px "${f.replace(/"/g, "")}"`).catch(() => [])));
  await Promise.race([Promise.all(jobs), new Promise((r) => setTimeout(r, 3000))]);
}

// ---------------------------------------------------------------- sessão Microsoft 365 (Firebase)

const params = new URLSearchParams(location.search);
// nos emuladores locais (?emulator) não é preciso projecto Firebase
const useEmulator = params.has("emulator") && ["localhost", "127.0.0.1"].includes(location.hostname);
const fbConfig = useEmulator ? { apiKey: "demo", authDomain: "localhost", projectId: "demo-qetview", appId: "demo" } : firebaseConfig;
const DEV_USERS = { ana: ["Ana Silva", "ana.silva@harkersolutions.com"], rui: ["Rui Costa", "rui.costa@harkersolutions.com"], francisco: ["Francisco Martins", "francisco.martins@harkersolutions.com"] };

/** Com Firebase configurado a página exige login; sem configuração fica o modo local. */
async function initAuth() {
  if (!fbConfig) return;
  try {
    const { createFirebase } = await import("./firebase-backend.js");
    S.fb = await createFirebase(fbConfig, { tenant: microsoftTenant, emulator: useEmulator });
  } catch (e) {
    S.authError = `Não foi possível ligar ao Firebase (${e.message}). Verifica a ligação à internet.`;
    applyAuthUI();
    return;
  }
  await new Promise((resolve) => {
    let first = true;
    S.fb.onUser((u) => {
      if (u && emailDomain && !u.email.endsWith("@" + emailDomain)) {
        S.authError = `A conta ${u.email} não pertence a ${emailDomain}.`;
        S.fb.signOut();
        u = null;
      }
      S.auth = u;
      setIdentity(u);
      applyAuthUI();
      if (first) { first = false; resolve(); } else if (!u) location.reload(); // saiu da sessão: recomeça limpo
    });
  });
  const as = useEmulator && DEV_USERS[params.get("as")];
  if (as && (!S.auth || S.auth.email !== as[1])) await S.fb.devSignIn(...as);
}

function applyAuthUI() {
  const shared = !!fbConfig;
  const a = S.auth;
  $("#userChip").hidden = !a;
  $("#logout").hidden = !a;
  if (a) { $("#userChip").textContent = a.name; $("#userChip").title = a.email; }
  $("#userRow").hidden = shared; // com login o nome vem da conta, não se escreve
  $("#loginBox").hidden = !(shared && !a);
  $("#drop").hidden = shared && !a;
  $("#loginError").textContent = S.authError || "";
}

$("#btnLogin").addEventListener("click", async () => {
  S.authError = "";
  applyAuthUI();
  try {
    await S.fb.signIn();
  } catch (e) {
    const code = e.code || "";
    S.authError =
      code.includes("popup-blocked") ? "O browser bloqueou a janela de login. Permite pop-ups para este site e tenta de novo."
      : code.includes("popup-closed") || code.includes("cancelled") ? "Login cancelado."
      : code.includes("invalid-credential") ? "O Firebase recusou o login Microsoft (auth/invalid-credential). Costuma ser o ID da aplicação ou o client secret mal colados no Firebase (Authentication → Sign-in method → Microsoft), ou um secret expirado."
      : code.includes("operation-not-allowed") ? "O login Microsoft ainda não está activado no Firebase (Authentication → Sign-in method → Microsoft)."
      : code.includes("unauthorized-domain") ? "Este endereço não está autorizado no Firebase (Authentication → Settings → Authorized domains)."
      : `Não foi possível entrar (${e.code || e.message}).`;
    applyAuthUI();
  }
});
$("#logout").addEventListener("click", () => S.fb?.signOut());

S.authReady = initAuth();

async function load(text, name) {
  await S.authReady;
  if (fbConfig && !S.auth) throw new Error("Entra primeiro com a conta Microsoft 365.");
  const p = parseProject(text, name);
  await loadFonts(p.fonts);
  if (!p.folios.length) throw new Error("O projecto não tem folhas.");
  S.project = p;
  $("#btnMail").disabled = false;
  S.index = null;
  S.back = [];
  S.fwd = [];
  S.sel = null;
  S.notes?.stop();
  // as notas partilhadas ligam-se ao título do projecto: todas as revisões do mesmo projecto partilham notas
  const projectKey = p.title.trim() || name.replace(/\.[^.]+$/, "");
  S.notes = S.auth && S.fb ? new NoteStore(projectKey, S.fb.notes(projectKey, S.auth)) : new NoteStore(`${name.replace(/\.[^.]+$/, "")}|${p.title}`);
  S.notes.onchange = onNotesChanged;
  S.notes.onstatus = refreshNotesStatus;
  S.notes.start().then(() => { refreshNotesUI(); buildFolioList(); renderPins(); });
  $("#projTitle").textContent = [p.title, name].filter(Boolean).join(" — ");
  document.title = `${p.title || name} · QElectroTech View`;
  $("#app").classList.remove("empty");
  buildFolioList();
  refreshNotesUI();
  const h = parseHash();
  const folio = Math.min(p.folios.length, Math.max(1, parseInt(h.f) || 1));
  showFolio(folio);
  if (h.e && p.byUuid.has(h.e)) go(h.e, { push: false });
  $("#status").textContent = "";
}

// ---------------------------------------------------------------- folios

function buildFolioList() {
  const p = S.project;
  const q = norm($("#folioFilter").value);
  const withNotes = new Set();
  for (const n of S.notes.notes) {
    const f = n.kind === "folio" ? n.ref : n.kind === "pin" ? n.folio : n.kind === "element" ? p.byUuid.get(n.ref)?.folio.id : n.kind === "conductor" ? n.folio : null;
    if (f) withNotes.add(f);
  }
  $("#folioList").innerHTML = p.folios
    .filter((f) => !q || norm(`${f.index} ${f.title} ${f.folioLabel}`).includes(q))
    .map(
      (f) =>
        `<li data-folio="${f.index}" class="${S.folio === f ? "cur" : ""}"><span class="n">${esc(f.folioLabel)}</span><span class="t">${esc(f.title || "(sem título)")}</span>${withNotes.has(f.id) ? '<span class="dot" title="Tem notas"></span>' : ""}</li>`,
    )
    .join("");
}

function showFolio(index, { keepView = false } = {}) {
  const p = S.project;
  const folio = p.folios[index - 1];
  if (!folio) return;
  const prevView = keepView && S.folio === folio ? { ...S.vb } : null;
  S.folio = folio;
  S.rendered = renderFolio(p, folio, { xrefs: $("#optXref").checked });
  stage.innerHTML = S.rendered.svg;
  S.svg = stage.querySelector("svg");
  S.svg.removeAttribute("width");
  S.svg.removeAttribute("height");
  if (prevView) setView(prevView);
  else fitView();
  renderPins();
  drawSelection();
  $("#folioPos").textContent = `${folio.folioLabel} / ${p.total}`;
  $("#prev").disabled = index <= 1;
  $("#next").disabled = index >= p.total;
  $$("#folioList li").forEach((li) => li.classList.toggle("cur", +li.dataset.folio === index));
  $(`#folioList li.cur`)?.scrollIntoView({ block: "nearest" });
  const missing = folio.elements.filter((e) => !e.def).length;
  $("#status").textContent = `${folio.elements.length} elementos · ${S.rendered.conductors.length} condutores${missing ? ` · ${missing} sem definição` : ""}`;
  renderInfo();
  updateHash();
}

// ---------------------------------------------------------------- vista (zoom / pan)

function stageSize() {
  return { w: stage.clientWidth || 1, h: stage.clientHeight || 1 };
}

function setView(vb) {
  const { w: cw, h: ch } = stageSize();
  const page = S.rendered;
  const w = Math.min(Math.max(vb.w, 40), page.width * 12);
  const h = (w * ch) / cw;
  S.vb = { x: vb.x, y: vb.y, w, h };
  S.svg.setAttribute("viewBox", `${S.vb.x} ${S.vb.y} ${S.vb.w} ${S.vb.h}`);
}

function fitView() {
  const { w: cw, h: ch } = stageSize();
  const page = S.rendered;
  const pad = 16;
  const scale = Math.max(page.width / Math.max(cw - 2 * pad, 50), page.height / Math.max(ch - 2 * pad, 50));
  const w = cw * scale;
  const h = ch * scale;
  setView({ x: (page.width - w) / 2, y: (page.height - h) / 2, w });
}

function toScene(cx, cy) {
  const r = stage.getBoundingClientRect();
  return { x: S.vb.x + ((cx - r.left) / r.width) * S.vb.w, y: S.vb.y + ((cy - r.top) / r.height) * S.vb.h };
}

function zoomAt(factor, cx, cy) {
  if (!S.svg) return;
  const r = stage.getBoundingClientRect();
  if (cx === undefined) { cx = r.left + r.width / 2; cy = r.top + r.height / 2; }
  const p = toScene(cx, cy);
  const w = S.vb.w / factor;
  const k = w / S.vb.w;
  setView({ x: p.x - (p.x - S.vb.x) * k, y: p.y - (p.y - S.vb.y) * k, w });
}

/** Garante que a caixa está visível sem mexer no zoom: só desloca a vista se for preciso. */
function panIntoView(box) {
  const m = 20;
  const v = S.vb;
  const inside = box.x >= v.x + m && box.y >= v.y + m && box.x + box.w <= v.x + v.w - m && box.y + box.h <= v.y + v.h - m;
  if (inside) return;
  setView({ x: box.x + box.w / 2 - v.w / 2, y: box.y + box.h / 2 - v.h / 2, w: v.w });
}

stage.addEventListener("wheel", (e) => {
  if (!S.svg) return;
  e.preventDefault();
  const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
  zoomAt(f, e.clientX, e.clientY);
}, { passive: false });

const pointers = new Map();
let drag = null;
stage.addEventListener("pointerdown", (e) => {
  if (!S.svg || (e.button && e.button !== 0)) return;
  stage.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  drag = { moved: 0, x: e.clientX, y: e.clientY, pinch: pointers.size > 1 ? pinchDist() : 0, multi: pointers.size > 1 };
  stage.classList.add("drag");
  stage.focus({ preventScroll: true });
});
stage.addEventListener("pointermove", (e) => {
  if (!pointers.has(e.pointerId) || !drag) return;
  const prev = pointers.get(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size >= 2) {
    drag.multi = true;
    const d = pinchDist();
    if (drag.pinch) {
      const m = pinchMid();
      zoomAt(d / drag.pinch, m.x, m.y);
    }
    drag.pinch = d;
    return;
  }
  const r = stage.getBoundingClientRect();
  const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
  drag.moved += Math.abs(dx) + Math.abs(dy);
  if (drag.moved < 5) return;
  setView({ x: S.vb.x - (dx * S.vb.w) / r.width, y: S.vb.y - (dy * S.vb.w) / r.width, w: S.vb.w });
});
const pinchDist = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
const pinchMid = () => { const [a, b] = [...pointers.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
const endPointer = (e) => {
  pointers.delete(e.pointerId);
  if (pointers.size) return;
  stage.classList.remove("drag");
  if (drag && !drag.multi && drag.moved < 5 && e.type === "pointerup") onStageClick(e);
  drag = null;
};
stage.addEventListener("pointerup", endPointer);
stage.addEventListener("pointercancel", endPointer);

new ResizeObserver(() => {
  if (!S.svg) return;
  const { w: cw, h: ch } = stageSize();
  const cx = S.vb.x + S.vb.w / 2, cy = S.vb.y + S.vb.h / 2;
  const w = S.vb.w, h = (w * ch) / cw;
  setView({ x: cx - w / 2, y: cy - h / 2, w });
}).observe(stage);

// ---------------------------------------------------------------- cliques no desenho

function onStageClick(e) {
  const t = document.elementFromPoint(e.clientX, e.clientY);
  if (S.pin) {
    const p = toScene(e.clientX, e.clientY);
    ensureUser();
    const n = S.notes.addPin(S.folio.id, p.x, p.y);
    setPinMode(false);
    select({ type: "pin", id: n.id });
    $("#infoBody textarea")?.focus();
    return;
  }
  const el = t && t.closest ? t : null;
  const xr = el?.closest(".xr");
  if (xr) return go(xr.dataset.go);
  const pin = el?.closest(".pin");
  if (pin) return select({ type: "pin", id: pin.dataset.id });
  const mark = el?.closest(".mark");
  if (mark) return select({ type: "element", id: mark.dataset.u });
  const g = el?.closest(".el");
  if (g?.dataset.go) return go(g.dataset.go); // report: salta para o par
  if (g) return select({ type: "element", id: g.dataset.u });
  const cd = el?.closest(".cd");
  if (cd) return select({ type: "conductor", id: +cd.dataset.i });
  select(null);
}

// ---------------------------------------------------------------- selecção e realce

function select(sel, { open = true } = {}) {
  S.sel = sel;
  drawSelection();
  renderPins();
  renderInfo();
  if (sel && open) $("#app").classList.add("show-info");
  updateHash();
}

function domBox(uuid) {
  const g = S.svg?.querySelector(`.el[data-u="${CSS.escape(uuid)}"]`);
  if (!g) return null;
  const b = g.getBBox();
  const m = g.transform.baseVal.consolidate()?.matrix;
  if (!m) return { x: b.x, y: b.y, w: b.width, h: b.height };
  const pts = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]].map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

const rectSvg = (b, cls, pad = 3) => `<rect class="${cls}" x="${b.x - pad}" y="${b.y - pad}" width="${b.w + 2 * pad}" height="${b.h + 2 * pad}" rx="3"/>`;

function drawSelection() {
  const hl = S.svg?.querySelector(".hl");
  if (!hl) return;
  let h = "";
  const sel = S.sel;
  if (sel?.type === "element") {
    const el = S.project.byUuid.get(sel.id);
    if (el) {
      for (const o of relatedOf(S.project, el)) {
        if (o.folio !== S.folio) continue;
        const b = domBox(o.uuid);
        if (b) h += rectSvg(b, "rel");
      }
      if (el.folio === S.folio) {
        const b = domBox(el.uuid);
        if (b) h += rectSvg(b, "sel");
      }
    }
  } else if (sel?.type === "conductor") {
    const c = S.rendered.conductors[sel.id];
    if (c) h += `<polyline class="sel" stroke-width="7" points="${c.pts.map((p) => `${p.x},${p.y}`).join(" ")}"/>`;
  }
  hl.innerHTML = h;
}

function flash(box) {
  const hl = S.svg?.querySelector(".hl");
  if (!hl || !box) return;
  hl.insertAdjacentHTML("beforeend", rectSvg(box, "flash", 6));
}

// ---------------------------------------------------------------- navegação (saltos + histórico)

function snapshot() {
  return { folio: S.folio.index, sel: S.sel, vb: { ...S.vb } };
}

function restore(s) {
  if (S.folio.index !== s.folio) showFolio(s.folio);
  S.sel = s.sel;
  setView(s.vb);
  drawSelection();
  renderPins();
  renderInfo();
  updateHash();
  updateHistButtons();
}

function pushHistory() {
  S.back.push(snapshot());
  if (S.back.length > 100) S.back.shift();
  S.fwd = [];
  updateHistButtons();
}

function updateHistButtons() {
  $("#histBack").disabled = !S.back.length;
  $("#histFwd").disabled = !S.fwd.length;
}

/** Salta para um elemento (muda de folha se for preciso), seleccionando-o e centrando-o. */
function go(uuid, { push = true } = {}) {
  const el = S.project.byUuid.get(uuid);
  if (!el) return;
  if (push) pushHistory();
  if (S.folio !== el.folio) showFolio(el.folio.index);
  select({ type: "element", id: uuid }, { open: true });
  const box = domBox(uuid) || elementBox(el);
  panIntoView(box);
  flash(box);
}

function goFolio(index, { push = true } = {}) {
  if (push) pushHistory();
  S.sel = null;
  showFolio(index);
}

// ---------------------------------------------------------------- painel de detalhes

const KIND_LABEL = { master: "Mestre", slave: "Escravo", simple: "Simples", terminal: "Terminal", next_report: "Report seguinte", previous_report: "Report anterior" };
const INFO_LABEL = {
  label: "Etiqueta", formula: "Fórmula", comment: "Comentário", function: "Função", description: "Descrição", designation: "Referência",
  manufacturer: "Fabricante", manufacturer_reference: "Ref. fabricante", machine_manufacturer_reference: "Ref. máquina", supplier: "Fornecedor",
  quantity: "Quantidade", unity: "Unidade", plant: "Instalação", location: "Localização",
};
const infoLabel = (k) => INFO_LABEL[k] || k.replace(/_/g, " ");

function elLabel(el) {
  return el.label || (relatedOf(S.project, el).find((o) => o.linkType === "master")?.label ?? "") || elementName(el);
}

function xrefItem(o, extra = "") {
  const st = o.kinds.state ? `${o.kinds.state}` : "";
  const sub = [elementName(o), st, extra].filter(Boolean).join(" · ");
  return `<li data-go="${esc(o.uuid)}" tabindex="0" role="link"><span class="loc">${esc(locationOf(S.project, o))}</span><span class="what"><b>${esc(elLabel(o))}</b><small>${esc(sub)}</small></span></li>`;
}

const fmtWhen = (t) => new Date(t).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" });

/** "Criada por Ana em 02/11/2026, 10:15 · editada por Rui em …" */
function noteMeta(n) {
  let s = `Criada${n.createdBy ? ` por ${n.createdBy}` : ""} em ${fmtWhen(n.created)}`;
  if (n.updated && (n.updated - n.created > 60000 || (n.updatedBy || "") !== (n.createdBy || "")))
    s += ` · editada${n.updatedBy ? ` por ${n.updatedBy}` : ""} em ${fmtWhen(n.updated)}`;
  return s;
}

/** Pede o nome uma vez, quando alguém vai escrever a primeira nota. */
function ensureUser() {
  let u = getUser();
  if (!u && !S.askedUser && !S.auth) {
    S.askedUser = true;
    u = (prompt("Como te chamas? O nome fica registado em cada nota que escreveres (podes mudá-lo no separador Notas).") || "").trim();
    if (u) { setUser(u); $("#userName").value = u; }
  }
  return u;
}

function noteEditor(kind, ref, caption, extra = {}) {
  const n = S.notes.find(kind, ref) || S.notes.byId(ref);
  return `<div class="note-sec"><label>${esc(caption)}</label><div class="note-box"><textarea class="note-ta" data-kind="${kind}" data-ref="${esc(ref)}" data-extra="${esc(JSON.stringify(extra))}" placeholder="Escreve uma nota…" aria-label="${esc(caption)}">${esc(n?.text || "")}</textarea>${n?.created ? `<div class="meta"><span>${esc(noteMeta(n))}</span></div>` : ""}</div></div>`;
}

function renderInfo() {
  const body = $("#infoBody");
  const p = S.project;
  if (!p) return;
  const sel = S.sel;
  let h = "";
  if (sel?.type === "element") h = elementInfo(p.byUuid.get(sel.id));
  else if (sel?.type === "conductor") h = conductorInfo(sel.id);
  else if (sel?.type === "pin") h = pinInfo(sel.id);
  else h = folioInfo();
  body.innerHTML = h;
}

function folioInfo() {
  const p = S.project, f = S.folio;
  const d = str(f.node, "date");
  const date = /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d === "null" ? "" : d;
  const rows = [
    ["Título", f.title], ["Autor", str(f.node, "author")], ["Data", date],
    ["Revisão", str(f.node, "indexrev")], ["Instalação", str(f.node, "plant")], ["Localização", str(f.node, "locmach")],
    ["Elementos", f.elements.length], ["Condutores", S.rendered.conductors.length],
  ].filter(([, v]) => v !== "" && v != null);
  return (
    `<h2>Folha ${esc(f.folioLabel)}</h2><p class="sub">${esc(f.title)}</p>` +
    `<dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` +
    noteEditor("folio", f.id, "Nota desta folha") +
    noteEditor("project", "project", `Nota do projecto${p.title ? ` “${p.title}”` : ""}`) +
    `<p class="hint" style="margin-top:16px">Clica num elemento para ver os detalhes e as referências cruzadas. Usa «＋ Nota no desenho» para deixar uma nota num ponto da folha.</p>`
  );
}

function elementInfo(el) {
  if (!el) return folioInfo();
  const p = S.project;
  const rel = relatedOf(p, el);
  const pillCls = el.linkType === "master" ? "master" : el.linkType === "slave" ? "slave" : /report/.test(el.linkType) ? "report" : "";
  let h = `<h2>${esc(elLabel(el) || "(sem etiqueta)")}</h2><p class="sub">${esc(elementName(el))}</p>`;
  h += `<p><span class="pill ${pillCls}">${esc(KIND_LABEL[el.linkType] || el.linkType)}</span><span class="pill">Folha ${esc(el.folio.folioLabel)}${el.cell ? ` · ${el.cell.row}${el.cell.col}` : ""}</span>${el.kinds.type ? `<span class="pill">${esc(el.kinds.type)}${el.kinds.state ? " " + esc(el.kinds.state) : ""}</span>` : ""}</p>`;

  if (rel.length || el.linkType === "master") {
    const title = el.linkType === "master" ? `Contactos / escravos (${rel.length})` : el.linkType === "slave" ? "Mestre" : /report/.test(el.linkType) ? "Report ligado" : "Referências cruzadas";
    h += `<h3>${title}</h3>`;
    if (!rel.length) h += `<p class="hint">Sem elementos ligados.</p>`;
    else if (el.linkType === "slave") {
      const masters = rel.filter((o) => o.linkType === "master");
      h += `<ul class="xrefs">${(masters.length ? masters : rel).map((o) => xrefItem(o)).join("")}</ul>`;
      const sibs = masters[0] ? relatedOf(p, masters[0]).filter((o) => o !== el) : [];
      if (sibs.length) h += `<h3>Outros contactos do mesmo mestre (${sibs.length})</h3><ul class="xrefs">${sibs.map((o) => xrefItem(o)).join("")}</ul>`;
    } else h += `<ul class="xrefs">${rel.map((o) => xrefItem(o)).join("")}</ul>`;
  }

  const infos = Object.entries(el.infos).filter(([k, v]) => v && k !== "label");
  if (infos.length || el.prefix) {
    h += `<h3>Informações</h3><dl class="kv">${el.prefix ? `<dt>Prefixo</dt><dd>${esc(el.prefix)}</dd>` : ""}${infos.map(([k, v]) => `<dt>${esc(infoLabel(k))}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;
  }
  if (!el.def) h += `<p class="hint">Este elemento não tem definição embebida no projecto, por isso não é desenhado.</p>`;
  h += noteEditor("element", el.uuid, "Nota deste elemento");
  return h;
}

function conductorInfo(i) {
  const c = S.rendered.conductors[i];
  if (!c) return folioInfo();
  const p = S.project;
  const ref = `${S.folio.id}|${c.from}|${c.to}|${c.num}`;
  const end = (u, t) => {
    const o = p.byUuid.get(u);
    return o ? `<dd><a href="#" data-go="${esc(u)}">${esc(elLabel(o) || elementName(o))}</a>${t ? ` <span class="hint">terminal ${esc(t)}</span>` : ""}</dd>` : "<dd>–</dd>";
  };
  const rows = [["Nº do fio", c.num], ["Função", c.fn], ["Cabo", c.cable], ["Cor", c.color], ["Secção", c.section]].filter(([, v]) => v && v !== "_");
  return (
    `<h2>Condutor ${esc(c.num && c.num !== "_" ? c.num : "")}</h2><p class="sub">Folha ${esc(S.folio.folioLabel)}</p>` +
    `<dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}<dt>De</dt>${end(c.from, c.fromName)}<dt>Para</dt>${end(c.to, c.toName)}</dl>` +
    noteEditor("conductor", ref, "Nota deste condutor", { folio: S.folio.id })
  );
}

function pinInfo(id) {
  const n = S.notes.byId(id);
  if (!n) return folioInfo();
  const k = S.notes.pinsOf(S.folio.id).indexOf(n) + 1;
  return (
    `<h2>Nota ${k} no desenho</h2><p class="sub">Folha ${esc(S.folio.folioLabel)} · posição ${n.x}, ${n.y}</p>` +
    noteEditor("pin", id, "Texto da nota") +
    (S.notes.canDelete()
      ? `<p><button id="delPin">Apagar esta nota</button></p>`
      : `<p class="hint">Só o administrador pode apagar notas.</p>`)
  );
}

$("#infoBody").addEventListener("input", (e) => {
  const ta = e.target.closest(".note-ta");
  if (!ta) return;
  const { kind, ref } = ta.dataset;
  if (kind === "pin") S.notes.setText(ref, ta.value);
  else S.notes.set(kind, ref, ta.value, JSON.parse(ta.dataset.extra || "{}"));
  // actualiza a linha "criada por … em …" sem refazer o painel (não perde o cursor)
  const n = S.notes.find(kind, ref) || S.notes.byId(ref);
  const box = ta.closest(".note-box");
  let meta = box.querySelector(".meta");
  if (n && !meta) { meta = document.createElement("div"); meta.className = "meta"; box.append(meta); }
  if (meta) meta.innerHTML = n ? `<span>${esc(noteMeta(n))}</span>` : "";
});
$("#infoBody").addEventListener("focusin", (e) => { if (e.target.closest(".note-ta")) ensureUser(); });
$("#userName").value = getUser();
$("#userName").addEventListener("change", (e) => setUser(e.target.value));
$("#infoBody").addEventListener("click", (e) => {
  const a = e.target.closest("[data-go]");
  if (a) { e.preventDefault(); go(a.dataset.go); return; }
  if (e.target.id === "delPin" && S.sel?.type === "pin") {
    if (S.notes.remove(S.sel.id)) select(null, { open: false });
  }
});
$("#infoBody").addEventListener("keydown", (e) => {
  const a = e.target.closest?.("li[data-go]");
  if (a && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); go(a.dataset.go); }
});

// ---------------------------------------------------------------- notas

function renderPins() {
  const g = S.svg?.querySelector(".pins");
  if (!g) return;
  let h = "";
  const p = S.project;
  S.notes.pinsOf(S.folio.id).forEach((n, i) => {
    h += `<g class="pin${S.sel?.type === "pin" && S.sel.id === n.id ? " sel" : ""}" data-id="${n.id}" transform="translate(${n.x} ${n.y})"><title>${esc(n.text.slice(0, 300) || "(nota vazia)")}</title><circle r="9"/><text y="4" text-anchor="middle">${i + 1}</text></g>`;
  });
  for (const n of S.notes.notes) {
    if (n.kind !== "element") continue;
    const el = p.byUuid.get(n.ref);
    if (!el || el.folio !== S.folio || !el.def) continue;
    const b = elementBox(el);
    h += `<g class="mark" data-u="${esc(el.uuid)}" transform="translate(${b.x + b.w} ${b.y})" style="cursor:pointer"><title>${esc(n.text.slice(0, 300))}</title><circle r="5"/></g>`;
  }
  g.innerHTML = h;
}

function onNotesChanged() {
  renderPins();
  refreshNotesUI();
  buildFolioList();
  // alterações vindas de outras pessoas: actualiza o painel, mas nunca enquanto alguém está a escrever nele
  if (S.notes.shared && !$("#infoBody").contains(document.activeElement)) renderInfo();
}

function noteTarget(n) {
  const p = S.project;
  if (n.kind === "project") return { label: "Projecto", go: () => { goFolio(1); } };
  if (n.kind === "folio") {
    const f = p.folios.find((x) => x.id === n.ref);
    return { label: f ? `Folha ${f.folioLabel} — ${f.title}` : "Folha (já não existe)", go: () => f && goFolio(f.index) };
  }
  if (n.kind === "element") {
    const el = p.byUuid.get(n.ref);
    return { label: el ? `${elLabel(el) || elementName(el)} (${locationOf(p, el)})` : "Elemento (já não existe)", go: () => el && go(n.ref) };
  }
  const f = p.folios.find((x) => x.id === (n.folio || n.ref.split("|")[0]));
  if (n.kind === "pin") {
    return {
      label: f ? `Folha ${f.folioLabel} · ponto ${n.x}, ${n.y}` : "Folha (já não existe)",
      go: () => {
        if (!f) return;
        pushHistory();
        if (S.folio !== f) showFolio(f.index);
        select({ type: "pin", id: n.id });
        panIntoView({ x: n.x - 20, y: n.y - 20, w: 40, h: 40 });
      },
    };
  }
  const idx = f ? f.index : 0;
  return { label: f ? `Condutor ${n.ref.split("|")[3] || ""} — folha ${f.folioLabel}` : "Condutor", go: () => idx && goFolio(idx) };
}

const STATUS_TEXT = {
  idle: "A ligar ao servidor de notas…",
  saving: "A guardar…",
  error: "Sem ligação ao servidor. As alterações ficam pendentes e voltam a ser enviadas.",
  auth: "A sessão expirou. Recarrega a página para entrar de novo.",
};

function refreshNotesStatus() {
  const n = S.notes;
  if (!n) return;
  let t;
  if (n.shared) {
    const base = "Notas partilhadas com a equipa (Microsoft 365).";
    const hhmm = new Date(n.lastSync).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
    t = n.status === "saved" ? `${base} Sincronizado às ${hhmm}.` : `${base} ${STATUS_TEXT[n.status] || ""}`;
  } else {
    t = n.persistent ? "As notas ficam guardadas só neste browser, ligadas aos UUID do projecto. Exporta-as para guardar uma cópia ou levá-las para outro computador." : "Atenção: o browser não deixa guardar dados locais (modo privado?). Exporta as notas antes de fechar.";
  }
  $("#notesWarn").textContent = t;
  $("#notesWarn").classList.toggle("error", n.shared && (n.status === "error" || n.status === "auth"));
}

const KIND_NAME = { project: "projecto", folio: "folha", element: "elemento", conductor: "condutor", pin: "desenho" };

function refreshNotesUI() {
  if (!S.notes) return;
  const p = S.project;
  const fi = (n) => {
    if (n.kind === "project") return 0;
    if (n.kind === "folio") return p.folios.find((f) => f.id === n.ref)?.index ?? 9999;
    if (n.kind === "element") return p.byUuid.get(n.ref)?.folio.index ?? 9999;
    return p.folios.find((f) => f.id === (n.folio || n.ref.split("|")[0]))?.index ?? 9999;
  };
  const list = [...S.notes.notes].sort((a, b) => fi(a) - fi(b) || (a.created || 0) - (b.created || 0));
  $("#noteCount").textContent = list.length || "";
  $("#noteList").innerHTML = list.length
    ? list.map((n) => `<li data-note="${n.id}"><span class="kind">${KIND_NAME[n.kind]}</span><span class="t"><b>${esc(noteTarget(n).label)}</b><span class="sub">${esc(n.text.slice(0, 140) || "(vazia)")}</span><span class="sub">${esc(`${n.createdBy ? n.createdBy + " · " : ""}${fmtWhen(n.updated || n.created)}`)}</span></span></li>`).join("")
    : '<li class="hint" style="cursor:default">Ainda não há notas. Selecciona um elemento ou usa «＋ Nota no desenho».</li>';
  refreshNotesStatus();
}

$("#noteList").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-note]");
  if (!li) return;
  const n = S.notes.byId(li.dataset.note);
  if (!n) return;
  if (n.kind === "project" || n.kind === "folio") {
    noteTarget(n).go();
    renderInfo();
  } else noteTarget(n).go();
  $("#app").classList.remove("show-side");
});

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const baseName = () => (S.project.fileName || "projecto").replace(/\.[^.]+$/, "");

$("#btnExportNotes").addEventListener("click", () => S.project && download(`${baseName()}.notas.json`, S.notes.export(), "application/json"));
/** Notas agrupadas por folha (e as do projecto no início), prontas a escrever em Markdown ou texto. */
function noteSections(onlyFolio) {
  const p = S.project;
  const sorted = [...S.notes.notes].sort((a, b) => (a.created || 0) - (b.created || 0));
  const out = [];
  const item = (n) => ({ label: noteTarget(n).label, text: n.text, meta: noteMeta(n) });
  if (!onlyFolio) {
    const general = sorted.filter((n) => n.kind === "project").map(item);
    if (general.length) out.push({ heading: "Projecto", items: general });
  }
  for (const f of p.folios) {
    if (onlyFolio && f !== onlyFolio) continue;
    const mine = sorted.filter((n) => n.kind !== "project" && (n.kind === "folio" ? n.ref === f.id : n.kind === "element" ? p.byUuid.get(n.ref)?.folio === f : (n.folio || n.ref.split("|")[0]) === f.id));
    if (mine.length) out.push({ heading: `Folha ${f.folioLabel} — ${f.title}`, items: mine.map(item) });
  }
  return out;
}

const notesMarkdown = (title, sections) =>
  `# Notas — ${title}\n\n` + sections.map((s) => `## ${s.heading}\n\n` + s.items.map((i) => `- **${i.label}**: ${i.text.replace(/\n/g, "\n  ")}  \n  _${i.meta}_\n`).join("") + "\n").join("");

const notesPlainText = (sections) =>
  sections.map((s) => `${s.heading.toUpperCase()}\n` + s.items.map((i) => `• ${i.label}: ${i.text}\n  (${i.meta})\n`).join("")).join("\n");

$("#btnExportMd").addEventListener("click", () => {
  if (!S.project) return;
  download(`${baseName()}.notas.md`, notesMarkdown(S.project.title || baseName(), noteSections(null)), "text/markdown");
});

/**
 * Partilhar por email sem servidor: no tablet abre o menu de partilha do sistema com o ficheiro anexado;
 * no computador abre o programa de email com o texto (limitado) e descarrega o ficheiro completo para anexar.
 */
$("#btnShareMail").addEventListener("click", async () => {
  if (!S.project) return;
  const onlyFolio = $("#shareScope").value === "folio" ? S.folio : null;
  const sections = noteSections(onlyFolio);
  if (!sections.length) { $("#status").textContent = onlyFolio ? "Esta folha não tem notas para partilhar." : "Ainda não há notas para partilhar."; return; }
  const title = S.project.title || baseName();
  const subject = `Notas — ${title}${onlyFolio ? ` — folha ${onlyFolio.folioLabel}` : ""}`;
  const header = `Projecto: ${title}\nPartilhado por: ${getUser() || "—"}\nData: ${new Date().toLocaleString("pt-PT")}\n\n`;
  const fileName = `${baseName()}.notas${onlyFolio ? `-folha-${onlyFolio.folioLabel}` : ""}.md`;
  const md = notesMarkdown(title, sections);
  const file = new File([md], fileName, { type: "text/markdown" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ title: subject, text: header, files: [file] });
      return;
    } catch (e) {
      if (e.name === "AbortError") return; // a pessoa fechou o menu
    }
  }
  const MAX = 1500; // os programas de email cortam endereços mailto: muito longos
  let body = header + notesPlainText(sections);
  if (body.length > MAX) body = body.slice(0, MAX) + "\n\n[…] A lista completa está no ficheiro anexo.";
  download(fileName, md, "text/markdown");
  const a = Object.assign(document.createElement("a"), { href: `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` });
  document.body.append(a);
  a.click();
  a.remove();
  $("#status").textContent = `Ficheiro ${fileName} descarregado: anexa-o ao email.`;
});
$("#btnImportNotes").addEventListener("click", () => S.project && $("#notesFile").click());
$("#notesFile").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  try {
    const added = S.notes.import(await f.text());
    $("#status").textContent = `${added} nota(s) importada(s)`;
    renderInfo();
  } catch (err) {
    alert(err.message);
  }
});

// ---------------------------------------------------------------- pesquisa

const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function buildIndex() {
  const p = S.project;
  const rows = [];
  for (const f of p.folios) {
    rows.push({ kind: "folha", text: norm(`${f.title} ${f.folioLabel} ${str(f.node, "author")}`), title: `Folha ${f.folioLabel} — ${f.title}`, sub: "", folio: f.index });
    for (const el of f.elements) {
      const name = elementName(el);
      rows.push({ kind: "elemento", text: norm([el.label, name, el.prefix, ...Object.values(el.infos)].join(" ")), title: elLabel(el) || name, sub: `${name} · ${locationOf(p, el)}`, uuid: el.uuid });
    }
    nested(f.node, "conductors", "conductor").forEach((c) => {
      const num = str(c, "num");
      if (num && num !== "_") rows.push({ kind: "fio", text: norm(`${num} ${str(c, "function")} ${str(c, "cable")}`), title: `Fio ${num}`, sub: `folha ${f.folioLabel}${str(c, "function") ? " · " + str(c, "function") : ""}`, folio: f.index });
    });
  }
  return rows;
}

let searchTimer;
$("#search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 120);
});

function runSearch() {
  if (!S.project) return;
  const q = norm($("#search").value).trim();
  const out = $("#searchResults");
  if (!q) { out.innerHTML = ""; $("#searchInfo").textContent = ""; return; }
  S.index ||= buildIndex();
  const toks = q.split(/\s+/);
  const hits = S.index.filter((r) => toks.every((t) => r.text.includes(t)));
  const notes = S.notes.notes.filter((n) => toks.every((t) => norm(n.text).includes(t)));
  $("#searchInfo").textContent = `${hits.length + notes.length} resultado(s)${hits.length > 150 ? " — a mostrar os primeiros 150" : ""}`;
  out.innerHTML =
    notes.map((n) => `<li data-note="${n.id}"><span class="kind">nota</span><span class="t"><b>${esc(noteTarget(n).label)}</b><span class="sub">${esc(n.text.slice(0, 140))}</span></span></li>`).join("") +
    hits.slice(0, 150).map((r, i) => `<li data-hit="${i}"><span class="kind">${r.kind}</span><span class="t"><b>${esc(r.title)}</b>${r.sub ? `<span class="sub">${esc(r.sub)}</span>` : ""}</span></li>`).join("");
  out._hits = hits;
}

$("#searchResults").addEventListener("click", (e) => {
  const li = e.target.closest("li");
  if (!li) return;
  if (li.dataset.note) { noteTarget(S.notes.byId(li.dataset.note)).go(); }
  else {
    const r = $("#searchResults")._hits[+li.dataset.hit];
    if (r.uuid) go(r.uuid);
    else goFolio(r.folio);
  }
  $("#app").classList.remove("show-side");
});

// ---------------------------------------------------------------- interface geral

function setPinMode(on) {
  S.pin = on;
  $("#pinTool").classList.toggle("on", on);
  stage.classList.toggle("pinning", on);
  $("#status").textContent = on ? "Clica no desenho para colocar a nota (Esc cancela)" : S.folio ? `${S.folio.elements.length} elementos · ${S.rendered.conductors.length} condutores` : "";
}

function setTab(name) {
  $$(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  $$(".tabpane").forEach((p) => p.classList.toggle("on", p.id === "tab-" + name));
  if (name === "search") $("#search").focus();
}

$$(".tabs button").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
$("#folioList").addEventListener("click", (e) => {
  const li = e.target.closest("li");
  if (li) { goFolio(+li.dataset.folio); $("#app").classList.remove("show-side"); }
});
$("#folioFilter").addEventListener("input", buildFolioList);
$("#prev").addEventListener("click", () => S.folio && goFolio(S.folio.index - 1, { push: false }));
$("#next").addEventListener("click", () => S.folio && goFolio(S.folio.index + 1, { push: false }));
$("#zoomIn").addEventListener("click", () => zoomAt(1.4));
$("#zoomOut").addEventListener("click", () => zoomAt(1 / 1.4));
$("#zoomFit").addEventListener("click", () => S.svg && fitView());
$("#histBack").addEventListener("click", () => {
  const s = S.back.pop();
  if (!s) return;
  S.fwd.push(snapshot());
  restore(s);
});
$("#histFwd").addEventListener("click", () => {
  const s = S.fwd.pop();
  if (!s) return;
  S.back.push(snapshot());
  restore(s);
});
$("#pinTool").addEventListener("click", () => S.folio && setPinMode(!S.pin));

// barras laterais: em ecrã largo encolhem a grelha; em ecrã estreito (tablet em vertical) abrem por cima
const wide = () => matchMedia("(min-width: 961px)").matches;
const BARS_KEY = "qetview:bars";

function syncBarButtons() {
  const app = $("#app");
  const open = (w) => (wide() ? !app.classList.contains("hide-" + w) : app.classList.contains("show-" + w));
  $("#btnSide").setAttribute("aria-pressed", open("side"));
  $("#btnInfo").setAttribute("aria-pressed", open("info"));
}

function toggleBar(which) {
  const app = $("#app");
  if (wide()) {
    app.classList.toggle("hide-" + which);
    try { localStorage.setItem(BARS_KEY, JSON.stringify({ side: app.classList.contains("hide-side"), info: app.classList.contains("hide-info") })); } catch { /* sem armazenamento */ }
  } else {
    const other = which === "side" ? "info" : "side";
    app.classList.toggle("show-" + which);
    app.classList.remove("show-" + other);
  }
  syncBarButtons();
}

function setFocus(on) {
  document.body.classList.toggle("focus", on);
  $("#btnFocus").setAttribute("aria-pressed", on);
}

$("#btnSide").addEventListener("click", () => toggleBar("side"));
$("#btnInfo").addEventListener("click", () => toggleBar("info"));
$("#btnFocus").addEventListener("click", () => setFocus(true));
$("#btnRestore").addEventListener("click", () => setFocus(false));
matchMedia("(min-width: 961px)").addEventListener("change", syncBarButtons);
try {
  const b = JSON.parse(localStorage.getItem(BARS_KEY) || "{}");
  $("#app").classList.toggle("hide-side", !!b.side);
  $("#app").classList.toggle("hide-info", !!b.info);
} catch { /* predefinição */ }
syncBarButtons();

// largura das barras: arrastar o separador (rato ou toque), setas no teclado, duplo clique repõe
const WIDTHS_KEY = "qetview:widths";
const WIDTH_DEFAULT = { side: 270, info: 330 };
const WIDTH_MIN = 180;
const widths = { ...WIDTH_DEFAULT };
try { Object.assign(widths, JSON.parse(localStorage.getItem(WIDTHS_KEY) || "{}")); } catch { /* predefinição */ }

function setWidth(which, px) {
  const app = $("#app");
  const other = wide() ? (app.classList.contains("hide-" + (which === "side" ? "info" : "side")) ? 0 : widths[which === "side" ? "info" : "side"]) : 0;
  const max = Math.max(WIDTH_MIN, Math.min(640, app.clientWidth - other - 320)); // o desenho fica com pelo menos 320px
  widths[which] = Math.round(Math.min(max, Math.max(WIDTH_MIN, px)));
  app.style.setProperty(`--${which}-w`, widths[which] + "px");
}
const saveWidths = () => { try { localStorage.setItem(WIDTHS_KEY, JSON.stringify(widths)); } catch { /* sem armazenamento */ } };

for (const which of ["side", "info"]) {
  const grip = $(which === "side" ? "#rzSide" : "#rzInfo");
  grip.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    grip.classList.add("drag");
    document.body.classList.add("resizing");
  });
  grip.addEventListener("pointermove", (e) => {
    if (!grip.hasPointerCapture(e.pointerId)) return;
    const r = $("#app").getBoundingClientRect();
    setWidth(which, which === "side" ? e.clientX - r.left : r.right - e.clientX);
  });
  const end = (e) => {
    if (!grip.hasPointerCapture(e.pointerId)) return;
    grip.releasePointerCapture(e.pointerId);
    grip.classList.remove("drag");
    document.body.classList.remove("resizing");
    saveWidths();
  };
  grip.addEventListener("pointerup", end);
  grip.addEventListener("pointercancel", end);
  grip.addEventListener("dblclick", () => { setWidth(which, WIDTH_DEFAULT[which]); saveWidths(); });
  grip.addEventListener("keydown", (e) => {
    const d = e.key === "ArrowLeft" ? -16 : e.key === "ArrowRight" ? 16 : 0;
    if (!d) return;
    e.preventDefault();
    setWidth(which, widths[which] + (which === "side" ? d : -d));
    saveWidths();
  });
  setWidth(which, widths[which]);
}

$("#optXref").addEventListener("change", () => S.folio && showFolio(S.folio.index, { keepView: true }));

for (const id of ["#btnOpen", "#btnOpen2"]) $(id).addEventListener("click", () => $("#file").click());
$("#file").addEventListener("change", (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (f) openFile(f);
});

let dragDepth = 0;
window.addEventListener("dragenter", (e) => { if (e.dataTransfer?.types?.includes("Files")) { dragDepth++; document.body.classList.add("dragging"); } });
window.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove("dragging"); } });
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("dragging");
  const f = e.dataTransfer?.files?.[0];
  if (f) openFile(f);
});

window.addEventListener("keydown", (e) => {
  const typing = /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
  if (e.key === "Escape") {
    if (document.body.classList.contains("focus")) setFocus(false);
    else if (S.pin) setPinMode(false);
    else if (typing) e.target.blur();
    else { select(null, { open: false }); $("#app").classList.remove("show-side", "show-info"); }
    return;
  }
  if (typing || e.ctrlKey || e.metaKey || !S.project) return;
  if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); $("#histBack").click(); return; }
  if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); $("#histFwd").click(); return; }
  switch (e.key) {
    case "ArrowLeft": case "PageUp": $("#prev").click(); break;
    case "ArrowRight": case "PageDown": $("#next").click(); break;
    case "+": case "=": zoomAt(1.4); break;
    case "-": zoomAt(1 / 1.4); break;
    case "0": fitView(); break;
    case "n": case "N": setPinMode(!S.pin); break;
    case "f": case "F": setFocus(!document.body.classList.contains("focus")); break;
    case "b": case "B": toggleBar("side"); break;
    case "i": case "I": toggleBar("info"); break;
    case "/": e.preventDefault(); setTab("search"); $("#app").classList.add("show-side"); break;
    default: return;
  }
});

// ---------------------------------------------------------------- hash (ligações partilháveis para o mesmo ficheiro)

function parseHash() {
  const o = {};
  for (const kv of location.hash.slice(1).split("&")) {
    const [k, v] = kv.split("=");
    if (k) o[k] = decodeURIComponent(v || "");
  }
  return o;
}

function updateHash() {
  if (!S.folio) return;
  let h = `#f=${S.folio.index}`;
  if (S.sel?.type === "element") h += `&e=${S.sel.id}`;
  try { history.replaceState(null, "", h); } catch { /* ficheiro local / iframe */ }
}

// ---------------------------------------------------------------- arranque

if (params.get("file")) openUrl(params.get("file"));
updateHistButtons();

// ---------------------------------------------------------------- ecrã de abertura / sobre

const splash = $("#splash");
function hideSplash() {
  splash.classList.add("out");
  splash.setAttribute("aria-hidden", "true");
}
function showSplash() {
  splash.classList.remove("out");
  splash.removeAttribute("aria-hidden");
  splash.focus();
}
splash.addEventListener("click", hideSplash);
splash.addEventListener("keydown", hideSplash);
$("#brand").addEventListener("click", showSplash);
$("#brand").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); showSplash(); } });
splash.focus();

// botão ✉ do cabeçalho: o mesmo que «Partilhar por email» do separador Notas
$("#btnMail").addEventListener("click", () => $("#btnShareMail").click());
