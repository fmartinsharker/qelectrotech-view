// Leitura de projectos QElectroTech (.qet) -> modelo simples em memória.
// Só lê; nunca escreve nem envia o ficheiro para lado nenhum.

export const kids = (n, tag) => (n ? Array.from(n.children).filter((c) => c.tagName === tag) : []);
export const kid = (n, tag) => kids(n, tag)[0];
export const nested = (n, a, b) => kids(kid(n, a), b);
export const str = (n, a, d = "") => (n && n.hasAttribute(a) ? n.getAttribute(a) : d);
export const num = (n, a, d = 0) => {
  const v = parseFloat(n && n.getAttribute(a));
  return Number.isFinite(v) ? v : d;
};
export const has = (n, a) => !!n && n.hasAttribute(a);
export const bool = (n, a, d = false) => {
  const v = str(n, a, "");
  return v === "" ? d : v === "true" || v === "1";
};

export function normUuid(u) {
  if (!u) return "";
  const m = /^\{?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\}?$/i.exec(u.trim());
  return m ? m[1].toLowerCase() : "";
}

/** Nomes de letra genéricos do Qt, que o browser não conhece. */
export const GENERIC_FONT = /^(sans serif|sans|sans-serif|serif|ms shell dlg 2?|system|default)$/i;

export const defKey =(type) => type.replace(/^embed:\/\//, "").replace(/^\/+/, "");

const letters = (n) => {
  let s = "";
  for (let i = n; i >= 0; i = Math.floor(i / 26) - 1) s = String.fromCharCode(65 + (i % 26)) + s;
  return s;
};

/** Geometria da grelha da folha (BorderTitleBlock). */
export function gridOf(d) {
  const cols = num(d, "cols", 17);
  const colW = num(d, "colsize", 60);
  const rows = num(d, "rows", 8);
  const rowH = num(d, "rowsize", 80);
  const showCols = str(d, "displaycols", "true") !== "false";
  const showRows = str(d, "displayrows", "true") !== "false";
  const headerH = 20;
  const headerW = 20;
  const margin = 5;
  const left = margin + (showRows ? headerW : 0);
  const top = margin + (showCols ? headerH : 0);
  return {
    cols, colW, rows, rowH, showCols, showRows, headerH, headerW, margin,
    left, top,
    width: cols * colW + (showRows ? 0 : headerW),
    height: rows * rowH + (showCols ? 0 : headerH),
    borderW: cols * colW + headerW,
    borderH: rows * rowH + headerH,
  };
}

/** Posição (x, y) -> coluna/linha da grelha, ex. { row: "C", col: 5 } */
export function cellOf(d, x, y) {
  const g = gridOf(d);
  if (x < g.left || x > g.left + g.width || y < g.top || y > g.top + g.height) return null;
  return {
    col: Math.min(g.cols, Math.max(1, Math.ceil((x - g.left) / g.colW))),
    row: letters(Math.min(g.rows, Math.max(1, Math.ceil((y - g.top) / g.rowH))) - 1),
  };
}

export function parseProject(text, fileName = "") {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("O ficheiro não é XML válido.");
  const root = doc.documentElement;
  if (root.tagName !== "project") throw new Error("Não é um projecto QElectroTech (elemento raiz <" + root.tagName + ">).");

  // definições embebidas dos elementos
  const defs = new Map();
  const walk = (cat, path) => {
    for (const c of cat.children) {
      if (c.tagName === "category") walk(c, [...path, str(c, "name")]);
      else if (c.tagName === "element") {
        const d = kid(c, "definition");
        if (d) defs.set([...path, str(c, "name")].join("/"), d);
      }
    }
  };
  const coll = kid(root, "collection");
  if (coll) walk(coll, []);

  // folios, pela ordem do atributo "order"
  const all = kids(root, "diagram");
  const folios = all
    .map((node, i) => ({ node, doc: i, order: Number.isFinite(parseFloat(node.getAttribute("order"))) ? parseFloat(node.getAttribute("order")) : i }))
    .sort((a, b) => a.order - b.order || a.doc - b.doc)
    .map((f, i) => ({
      index: i + 1,
      node: f.node,
      id: normUuid(f.node.getAttribute("uuid")) || "folio-" + (f.doc + 1),
      title: str(f.node, "title"),
      elements: [],
      terminals: new Map(),
    }));
  const total = folios.length;

  const project = {
    fileName,
    title: str(root, "title"),
    version: str(root, "version"),
    root,
    defs,
    folios,
    total,
    byUuid: new Map(),
    props: propsOf(kid(root, "properties")),
    reportLabel: str(kid(kid(root, "newdiagrams"), "report"), "label", "%f-%l%c"),
    titleBlocks: new Map(nested(root, "titleblocktemplates", "titleblocktemplate").map((n) => [n.getAttribute("name"), n])),
    fontFamily: "",
    fonts: [],
  };

  // tipo de letra predominante do projecto (o QET usa-o também na legenda e na moldura)
  const fam = new Map();
  for (const n of root.querySelectorAll("[font]")) {
    const f = (n.getAttribute("font") || "").split(",")[0].trim();
    if (f) fam.set(f, (fam.get(f) || 0) + 1);
  }
  const ranked = [...fam].sort((a, b) => b[1] - a[1]).map((x) => x[0]);
  project.fonts = ranked;
  project.fontFamily = ranked.find((f) => !GENERIC_FONT.test(f)) || "";

  for (const f of folios) {
    f.props = propsOf(kid(f.node, "properties"));
    f.folioLabel = folioField(f, total) || String(f.index);
    nested(f.node, "elements", "element").forEach((e, i) => {
      const el = buildElement(project, f, e, i);
      f.elements.push(el);
      project.byUuid.set(el.uuid, el);
      for (const t of el.terminals) {
        f.terminals.set(t.id, t);
        if (t.uuid) f.terminals.set(`${el.uuid}|${t.uuid}`, t);
      }
    });
  }

  // ligações nos dois sentidos (mestre <-> escravo, reports)
  for (const f of folios) {
    for (const el of f.elements) {
      for (const u of el.links) {
        const o = project.byUuid.get(u);
        if (o && !o.links.includes(el.uuid)) o.backLinks.push(el.uuid);
      }
    }
  }
  return project;
}

function orientIdx(v) {
  const i = { n: 0, e: 1, s: 2, w: 3 }[v];
  return i !== undefined ? i : ((Math.trunc(parseFloat(v)) || 0) % 4 + 4) % 4;
}

/** Terminal a que um condutor está ligado (n = 1 ou 2), nos dois formatos de ficheiro. */
export function terminalOf(folio, c, n) {
  const t = c.getAttribute("terminal" + n);
  const el = normUuid(c.getAttribute("element" + n));
  return (el && folio.terminals.get(`${el}|${normUuid(t)}`)) || folio.terminals.get(t) || null;
}

function propsOf(n) {
  const out = {};
  for (const p of kids(n, "property")) if (p.getAttribute("name")) out[p.getAttribute("name")] = p.textContent;
  return out;
}

export function folioField(f, total) {
  return str(f.node, "folio", "%id/%total")
    .replace("%autonum", String(f.index))
    .replace("%id", String(f.index))
    .replace("%total", String(total));
}

function buildElement(project, folio, e, i) {
  const type = str(e, "type");
  const key = defKey(type);
  const def = project.defs.get(key) || null;
  const ori = ((Math.trunc(num(e, "orientation")) % 4) + 4) % 4;
  const x = num(e, "x");
  const y = num(e, "y");
  const uuid = normUuid(e.getAttribute("uuid")) || `${folio.id}:el${i}`;

  const infos = {};
  for (const n of kids(kid(def, "elementInformations"), "elementInformation")) infos[n.getAttribute("name")] = n.textContent;
  for (const n of nested(e, "elementInformations", "elementInformation")) infos[n.getAttribute("name")] = n.textContent;

  const defTerms = kids(kid(def, "description"), "terminal").map((t) => ({
    x: num(t, "x"), y: num(t, "y"), o: orientIdx(t.getAttribute("orientation")), uuid: normUuid(t.getAttribute("uuid")),
  }));
  const terminals = nested(e, "terminals", "terminal").map((t) => {
    const o = orientIdx(t.getAttribute("orientation"));
    // x/y gravados são 4px para dentro do ponto de ligação
    const dx = [0, 4, 0, -4][o];
    const dy = [-4, 0, 4, 0][o];
    const lx = num(t, "x") + dx;
    const ly = num(t, "y") + dy;
    const k = ori;
    const rot = [[lx, ly], [-ly, lx], [-lx, -ly], [ly, -lx]][k];
    // projectos recentes ligam os condutores ao UUID do terminal da definição
    const dt = defTerms.find((d) => d.o === o && Math.abs(d.x - lx) < 0.5 && Math.abs(d.y - ly) < 0.5);
    return {
      id: t.getAttribute("id"),
      uuid: normUuid(t.getAttribute("uuid")) || dt?.uuid || "",
      name: str(t, "name"),
      x: x + rot[0],
      y: y + rot[1],
      o: (o + ori) % 4,
      element: uuid,
    };
  });

  const kinds = {};
  for (const k of kids(kid(def, "kindInformations"), "kindInformation")) kinds[k.getAttribute("name")] = k.textContent;

  return {
    uuid, node: e, folio, key, def, type,
    x, y, ori, z: num(e, "z", 10),
    prefix: str(e, "prefix"),
    linkType: str(def, "link_type", "simple"),
    kinds,
    infos,
    label: infos.label || "",
    terminals,
    links: nested(e, "links_uuids", "link_uuid").map((l) => normUuid(l.getAttribute("uuid"))).filter(Boolean),
    backLinks: [],
    cell: cellOf(folio.node, x, y),
  };
}

/** Nome legível da definição do elemento. */
export function elementName(el, langs = ["pt", "en", "fr"]) {
  const names = {};
  for (const n of kids(kid(el.def, "names"), "name")) names[n.getAttribute("lang")] = n.textContent;
  for (const l of [...langs, ...(navigator.languages || []).map((x) => x.slice(0, 2))]) if (names[l]) return names[l];
  const first = Object.values(names)[0];
  if (first) return first;
  return el.key.split("/").pop().replace(/\.elmt$/, "");
}

/** Localização textual, p.ex. "3-C5" (folha-linha+coluna). */
export function locationOf(project, el) {
  const f = el.folio;
  if (!el.cell) return f.folioLabel;
  return `${f.folioLabel}-${el.cell.row}${el.cell.col}`;
}

/** Elementos ligados a `el` (mestre/escravos, reports), sem duplicados. */
export function relatedOf(project, el) {
  const seen = new Set();
  const out = [];
  for (const u of [...el.links, ...el.backLinks]) {
    if (seen.has(u)) continue;
    seen.add(u);
    const o = project.byUuid.get(u);
    if (o && o !== el) out.push(o);
  }
  return out;
}
