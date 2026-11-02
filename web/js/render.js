// Desenho de um folio QElectroTech em SVG (gerado como texto).
import { kid, kids, nested, str, num, has, bool, gridOf, relatedOf, locationOf, terminalOf, GENERIC_FONT } from "./qet.js";

const FALLBACK_FONT = "'Liberation Sans', Arial, Helvetica, sans-serif";
let defaultFamily = "";

/** font-family CSS para uma fonte do modelo; sem família usa a predominante do projecto. */
function famCss(font) {
  const f = (font && font.family) || defaultFamily;
  if (!f || GENERIC_FONT.test(f)) return FALLBACK_FONT;
  const safe = f.replace(/['"\\<>&;{}]/g, "");
  return `'${safe}', ${/mono|courier|consol/i.test(safe) ? "monospace" : FALLBACK_FONT}`;
}
// o PDF exportado pelo QET usa 1 pt = 1 unidade do desenho (no ecrã seria 96/72)
const PT = 1;
const TEXT_MARGIN = 4;

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const f2 = (n) => Math.round(n * 100) / 100;

// ---------- cores e estilos ----------

const QT_COLORS = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#00ff00", blue: "#0000ff",
  gray: "#a0a0a4", lightgray: "#c0c0c0", yellow: "#ffff00", cyan: "#00ffff", magenta: "#ff00ff",
  brun: "#612c00", orange: "#ff8000", purple: "#881ca8",
};
const HTML_GROUPS = ["Pink", "Red", "Orange", "Yellow", "Brown", "Green", "Cyan", "Blue", "Purple", "White", "Gray"];

function colorValue(v) {
  if (QT_COLORS[v]) return QT_COLORS[v];
  if (v.startsWith("HTML")) {
    const rest = v.slice(4);
    for (const g of HTML_GROUPS) if (rest.startsWith(g) && rest.length > g.length) return rest.slice(g.length).toLowerCase();
  }
  return "";
}

/** Cor vinda do ficheiro -> valor seguro para atributos SVG. */
function safeColor(v, fallback = "#000000") {
  if (!v) return fallback;
  v = v.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return v.length === 9 ? `#${v.slice(3)}${v.slice(1, 3)}` : v.toLowerCase();
  if (/^[a-z]{3,30}$/i.test(v)) return colorValue(v) || v.toLowerCase();
  return fallback;
}

const DASH = { dashed: [4, 2], dotted: [1, 2], dashdotted: [4, 2, 1, 2] };

function elStyle(style, join = "bevel") {
  let color = "#000000", width = 1, dash = null, fill = "none", noStroke = false;
  for (const part of (style || "").split(";")) {
    const m = /^\s*([a-z-]+)\s*:\s*([a-zA-Z-]+)\s*$/.exec(part);
    if (!m) continue;
    const [, k, v] = m;
    if (k === "line-style") dash = DASH[v] || null;
    else if (k === "line-weight") {
      if (v === "none") noStroke = true;
      else width = { thin: 0.5, normal: 1, hight: 2, eleve: 5 }[v] ?? width;
    } else if (k === "filling") {
      if (v === "none") fill = "none";
      else if (["hor", "ver", "bdiag", "fdiag"].includes(v)) fill = "#8888";
      else fill = colorValue(v) || "none";
    } else if (k === "color") {
      if (v === "none") noStroke = true;
      else color = colorValue(v) || color;
    }
  }
  let a = `fill="${fill}"`;
  if (noStroke) a += ' stroke="none"';
  else {
    a += ` stroke="${color}" stroke-width="${width}" stroke-linecap="square" stroke-linejoin="${join}"`;
    if (dash) a += ` stroke-dasharray="${dash.map((d) => d * width).join(" ")}"`;
  }
  return { attrs: a, color: noStroke ? "none" : color, fill, width };
}

// ---------- texto ----------

let measureCtx;
function textWidth(text, font) {
  measureCtx ||= document.createElement("canvas").getContext("2d");
  measureCtx.font = `${font.italic ? "italic " : ""}${font.bold ? "bold " : ""}${font.size}px ${famCss(font)}`;
  return measureCtx.measureText(text).width;
}
const lineH = (font) => font.size * 1.17;
const ascent = (font) => font.size * 0.93;

function parseFont(desc, fallbackPt = 9) {
  const font = { size: fallbackPt * PT, bold: false, italic: false };
  if (!desc) return font;
  const p = desc.split(",");
  if (p[0]) font.family = p[0].trim();
  const pt = parseFloat(p[1]);
  const px = parseFloat(p[2]);
  if (pt > 0) font.size = pt * PT;
  else if (px > 0) font.size = px;
  const w = parseFloat(p[4]);
  if (Number.isFinite(w)) font.bold = w >= 100 ? w >= 600 : w >= 63;
  font.italic = p[5] === "1";
  return font;
}

/** <text> com várias linhas. (x, y) = canto superior esquerdo da caixa. */
function textEl(lines, font, color, x, y, extra = "", anchor = "start") {
  const base = y + ascent(font);
  const tspans = lines
    .map((l, i) => `<tspan x="${f2(x)}" ${i ? `dy="${f2(lineH(font))}"` : ""}>${esc(l) || "&#160;"}</tspan>`)
    .join("");
  return `<text y="${f2(base)}" font-family="${famCss(font)}" font-size="${f2(font.size)}" fill="${color}"${font.bold ? ' font-weight="bold"' : ""}${font.italic ? ' font-style="italic"' : ""} text-anchor="${anchor}" ${extra}>${tspans}</text>`;
}

// ---------- símbolos (definições de elementos) ----------

const symbolCache = new WeakMap();

export function symbolId(key) {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return "s" + h.toString(36);
}

function buildSymbol(def) {
  let out = "";
  const desc = kid(def, "description");
  for (const p of desc ? desc.children : []) {
    const st = elStyle(p.getAttribute("style"), p.tagName === "line" || p.tagName === "rect" ? "miter" : "bevel");
    switch (p.tagName) {
      case "line": out += lineShape(p, st); break;
      case "rect":
        if (has(p, "x") && has(p, "width"))
          out += `<rect x="${num(p, "x")}" y="${num(p, "y")}" width="${num(p, "width")}" height="${num(p, "height")}"${has(p, "rx") ? ` rx="${num(p, "rx")}" ry="${num(p, "ry")}"` : ""} ${st.attrs}/>`;
        break;
      case "ellipse":
        if (has(p, "x") && has(p, "width")) {
          const w = num(p, "width"), h = num(p, "height");
          out += `<ellipse cx="${num(p, "x") + w / 2}" cy="${num(p, "y") + h / 2}" rx="${w / 2}" ry="${h / 2}" ${st.attrs}/>`;
        }
        break;
      case "circle":
        if (has(p, "diameter")) {
          const d = num(p, "diameter");
          out += `<circle cx="${num(p, "x") + d / 2}" cy="${num(p, "y") + d / 2}" r="${d / 2}" ${st.attrs}/>`;
        }
        break;
      case "arc":
        if (["x", "y", "width", "height", "start", "angle"].every((a) => has(p, a))) out += arcShape(p, st);
        break;
      case "polygon": {
        const pts = [];
        for (let i = 1; has(p, "x" + i) && has(p, "y" + i); i++) pts.push(`${num(p, "x" + i)},${num(p, "y" + i)}`);
        if (pts.length > 1) {
          const closed = p.getAttribute("closed") !== "false";
          out += `<${closed ? "polygon" : "polyline"} points="${pts.join(" ")}" ${closed ? st.attrs : st.attrs.replace(/fill="[^"]*"/, 'fill="none"')}/>`;
        }
        break;
      }
      case "text": {
        const font = has(p, "size") ? { size: num(p, "size") * PT, bold: false, italic: false } : p.getAttribute("font") ? parseFont(p.getAttribute("font")) : parseFont();
        const rot = num(p, "rotation");
        const lines = str(p, "text").split(/\r?\n/);
        const color = safeColor(p.getAttribute("color"));
        const x = num(p, "x"), y = num(p, "y");
        // x/y = linha de base da primeira linha
        out += textEl(lines, font, color, 0, -ascent(font), `transform="translate(${x} ${y})${rot ? ` rotate(${rot})` : ""}" style="pointer-events:none"`);
        break;
      }
    }
  }
  return out;
}

function lineShape(p, st) {
  if (!["x1", "y1", "x2", "y2"].every((a) => has(p, a))) return "";
  let a = { x: num(p, "x1"), y: num(p, "y1") };
  let b = { x: num(p, "x2"), y: num(p, "y2") };
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  let extra = "";
  const mark = (end, other, kind, L) => {
    if (!["simple", "triangle", "circle", "diamond"].includes(kind)) return end;
    const ux = ((end.x - other.x) / len) * L, uy = ((end.y - other.y) / len) * L;
    const vx = -uy, vy = ux;
    const o = { x: end.x - ux, y: end.y - uy };
    const back = { x: o.x - ux, y: o.y - uy };
    const s = `stroke="${st.color}" stroke-width="${st.width}" stroke-linejoin="miter"`;
    if (kind === "circle") { extra += `<circle cx="${f2(o.x)}" cy="${f2(o.y)}" r="${L}" fill="${st.color}" ${s}/>`; return back; }
    if (kind === "diamond") { extra += `<polygon points="${f2(back.x)},${f2(back.y)} ${f2(o.x + vx)},${f2(o.y + vy)} ${f2(end.x)},${f2(end.y)} ${f2(o.x - vx)},${f2(o.y - vy)}" fill="${st.color}" ${s}/>`; return back; }
    if (kind === "triangle") { extra += `<polygon points="${f2(o.x + vx)},${f2(o.y + vy)} ${f2(end.x)},${f2(end.y)} ${f2(o.x - vx)},${f2(o.y - vy)}" fill="${st.color}" ${s}/>`; return o; }
    extra += `<polyline points="${f2(o.x - vx)},${f2(o.y - vy)} ${f2(end.x)},${f2(end.y)} ${f2(o.x + vx)},${f2(o.y + vy)}" fill="none" ${s}/>`;
    return end;
  };
  const a0 = a, b0 = b;
  a = mark(a0, b0, p.getAttribute("end1"), has(p, "length1") ? num(p, "length1") : 1.5);
  b = mark(b0, a0, p.getAttribute("end2"), has(p, "length2") ? num(p, "length2") : 1.5);
  return `<line x1="${f2(a.x)}" y1="${f2(a.y)}" x2="${f2(b.x)}" y2="${f2(b.y)}" ${st.attrs.replace(/fill="[^"]*"/, 'fill="none"')}/>${extra}`;
}

function arcShape(p, st) {
  const x = num(p, "x"), y = num(p, "y"), w = num(p, "width"), h = num(p, "height");
  const start = num(p, "start"), span = num(p, "angle");
  const cx = x + w / 2, cy = y + h / 2, rx = w / 2, ry = h / 2;
  if (Math.abs(span) >= 360) return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" ${st.attrs}/>`;
  const pt = (deg) => [cx + rx * Math.cos((deg * Math.PI) / 180), cy - ry * Math.sin((deg * Math.PI) / 180)];
  const [x1, y1] = pt(start);
  const [x2, y2] = pt(start + span);
  return `<path d="M${f2(x1)} ${f2(y1)}A${rx} ${ry} 0 ${Math.abs(span) > 180 ? 1 : 0} ${span > 0 ? 0 : 1} ${f2(x2)} ${f2(y2)}" ${st.attrs}/>`;
}

/** Caixa do elemento nas suas coordenadas locais (antes de posicionar e rodar). */
function localBox(d) {
  const w = Math.ceil(num(d, "width", 40) / 10) * 10;
  const h = Math.ceil(num(d, "height", 40) / 10) * 10;
  return { x: -Math.min(num(d, "hotspot_x", 20), w), y: -Math.min(num(d, "hotspot_y", 20), h), w, h };
}

/** Área de clique invisível do tamanho do elemento. */
function hitRect(d) {
  const b = localBox(d);
  return `<rect class="hitbox" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="transparent" stroke="none"/>`;
}

/** Caixa aproximada do elemento no folio. */
export function elementBox(el) {
  const { x: bx, y: by, w, h } = localBox(el.def);
  const c = [[bx, by], [bx + w, by], [bx + w, by + h], [bx, by + h]].map(([x, y]) => [[x, y], [-y, x], [-x, -y], [y, -x]][el.ori]);
  const xs = c.map((p) => p[0] + el.x), ys = c.map((p) => p[1] + el.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

// ---------- condutores ----------

function autoPath(p1, o1, p2, o2) {
  const ext = (p, o) => [{ x: p.x, y: p.y - 10 }, { x: p.x + 10, y: p.y }, { x: p.x, y: p.y + 10 }, { x: p.x - 10, y: p.y }][o];
  const a = ext(p1, o1), b = ext(p2, o2);
  const v1 = o1 % 2 === 0, v2 = o2 % 2 === 0;
  const pts = [p1, a];
  if (v1 && v2) { const my = Math.round((a.y + b.y) / 20) * 10; pts.push({ x: a.x, y: my }, { x: b.x, y: my }); }
  else if (!v1 && !v2) { const mx = Math.round((a.x + b.x) / 20) * 10; pts.push({ x: mx, y: a.y }, { x: mx, y: b.y }); }
  else if (v1) pts.push({ x: a.x, y: b.y });
  else pts.push({ x: b.x, y: a.y });
  pts.push(b, p2);
  return pts;
}

function savedPath(p1, p2, c) {
  const segs = kids(c, "segment").filter((s) => has(s, "length"));
  if (!segs.length) return null;
  let w = 0, h = 0;
  for (const s of segs) (s.getAttribute("orientation") === "horizontal" ? (w += num(s, "length")) : (h += num(s, "length")));
  if (Math.abs(p2.x - p1.x - w) > 1 || Math.abs(p2.y - p1.y - h) > 1) return null;
  const pts = [p1];
  for (const s of segs) {
    const l = pts[pts.length - 1];
    pts.push(s.getAttribute("orientation") === "horizontal" ? { x: l.x + num(s, "length"), y: l.y } : { x: l.x, y: l.y + num(s, "length") });
  }
  return pts;
}

const pathLen = (pts) => pts.slice(1).reduce((s, p, i) => s + Math.abs(p.x - pts[i].x) + Math.abs(p.y - pts[i].y), 0);

/** Direcções (N,E,S,W) que saem de um ponto, para detectar junções em T. */
function dirsAt(pts, p) {
  const out = new Set();
  const dir = (a, b) => (a.x === b.x ? (b.y < a.y ? "N" : "S") : b.x < a.x ? "W" : "E");
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (a.x === b.x && a.y === b.y) continue;
    if (a.x === p.x && a.y === p.y) out.add(dir(a, b));
    else if (b.x === p.x && b.y === p.y) out.add(dir(b, a));
    else if (a.x === b.x && p.x === a.x && p.y > Math.min(a.y, b.y) && p.y < Math.max(a.y, b.y)) { out.add("N"); out.add("S"); }
    else if (a.y === b.y && p.y === a.y && p.x > Math.min(a.x, b.x) && p.x < Math.max(a.x, b.x)) { out.add("W"); out.add("E"); }
  }
  return out;
}

function textAnchor(pts) {
  const segs = pts.slice(1).map((b, i) => ({ a: pts[i], b })).filter((s) => s.a.x !== s.b.x || s.a.y !== s.b.y);
  if (!segs.length) return { p: pts[0], vertical: false };
  const len = pathLen(pts);
  if (segs.every((s) => s.a.x === s.b.x)) {
    const p = { ...segs[0].a };
    p.y += p.y > segs[segs.length - 1].b.y ? -len / 2 : len / 2;
    return { p, vertical: true };
  }
  if (segs.every((s) => s.a.y === s.b.y)) {
    const p = { ...segs[0].a };
    p.x += p.x > segs[segs.length - 1].b.x ? -len / 2 : len / 2;
    return { p, vertical: false };
  }
  let best = segs[0];
  const sl = (s) => Math.abs(s.b.x - s.a.x) + Math.abs(s.b.y - s.a.y);
  for (const s of segs) if (sl(s) > sl(best)) best = s;
  return { p: { x: (best.a.x + best.b.x) / 2, y: (best.a.y + best.b.y) / 2 }, vertical: best.a.x === best.b.x };
}

function conductorText(c, pts, text) {
  const font = parseFont(null, num(c, "numsize", 9) || 9);
  const color = safeColor(c.getAttribute("text_color"));
  const w = textWidth(text, font) + 2 * TEXT_MARGIN;
  const h = lineH(font) + 2 * TEXT_MARGIN;
  const { p, vertical } = textAnchor(pts);
  const rot = has(c, "rotation") ? num(c, "rotation") : vertical ? num(c, "vertirotatetext", 270) : num(c, "horizrotatetext");
  let pos;
  if (has(c, "userx")) pos = { x: num(c, "userx"), y: num(c, "usery") };
  else {
    pos = { ...p };
    const ha = str(c, "horizontal-alignment", "AlignBottom");
    const va = str(c, "vertical-alignment", "AlignRight");
    if (rot === 0) { pos.x -= w / 2; pos.y += ha === "AlignTop" ? -h : 1; }
    else if (rot === 270) { pos.y += w / 2; pos.x += va === "AlignLeft" ? -h : 1; }
  }
  return textEl([text], font, color, TEXT_MARGIN, TEXT_MARGIN, `transform="translate(${f2(pos.x)} ${f2(pos.y)})${rot ? ` rotate(${rot})` : ""}" class="ctext"`);
}

// ---------- texto dinâmico dos elementos ----------

function dynamicValue(t, el, ctx) {
  const from = str(t, "text_from", "UserText");
  const infos = ctx.infos;
  if (from === "ElementInfo") {
    const name = kid(t, "info_name")?.textContent || "";
    return name === "label" ? ctx.label : infos[name] || "";
  }
  if (from === "CompositeText")
    return (kid(t, "composite_text")?.textContent || "").replace(/%\{([^}]+)\}/g, (_, k) => (k === "label" ? ctx.label : infos[k] || ""));
  return kid(t, "text")?.textContent || "";
}

/** Valores a mostrar nos textos, tendo em conta ligações (escravo mostra o mestre, report mostra o par). */
function textContext(project, el) {
  const rel = relatedOf(project, el);
  if (el.linkType === "slave" && rel[0]) return { infos: rel[0].infos, label: rel[0].label };
  if ((el.linkType === "next_report" || el.linkType === "previous_report") && rel[0]) {
    const o = rel[0];
    const label = project.reportLabel
      .replace("%f", o.folio.index)
      .replace("%F", o.folio.folioLabel)
      .replace("%l", o.cell ? o.cell.row : "")
      .replace("%c", o.cell ? o.cell.col : "");
    return { infos: el.infos, label };
  }
  return { infos: el.infos, label: el.label };
}

function elementTexts(project, el) {
  const ctx = textContext(project, el);
  let out = "";
  for (const t of nested(el.node, "dynamic_texts", "dynamic_elmt_text")) {
    const value = dynamicValue(t, el, ctx);
    if (!value) continue;
    const font = t.getAttribute("font") ? parseFont(t.getAttribute("font")) : parseFont(`${str(t, "font_family", "Sans")},${str(t, "font_size", "9")}`);
    const color = safeColor(kid(t, "color")?.textContent);
    const lines = value.split(/\r?\n/);
    const rot = num(t, "rotation");
    const tw = num(t, "text_width", -1);
    const w = Math.max(...lines.map((l) => textWidth(l, font)));
    const boxW = tw > 0 ? Math.max(tw - 2 * TEXT_MARGIN, w) : w;
    const tr = `translate(${num(t, "x")} ${num(t, "y")})${rot ? ` rotate(${rot})` : ""}`;
    let g = tw > 0 ? textEl(lines, font, color, TEXT_MARGIN + boxW / 2, TEXT_MARGIN, "", "middle") : textEl(lines, font, color, TEXT_MARGIN, TEXT_MARGIN);
    if (bool(t, "frame")) g = `<rect width="${f2(boxW + 2 * TEXT_MARGIN)}" height="${f2(lines.length * lineH(font) + 2 * TEXT_MARGIN)}" fill="none" stroke="#000" stroke-width="1"/>` + g;
    out += `<g class="dt" transform="${tr}">${g}</g>`;
  }
  return out;
}

// ---------- texto livre, formas, imagens ----------

function richLines(html, fallbackFont) {
  if (!/<(html|p|body|span|br)\b/i.test(html)) return { lines: html.split(/\r?\n/), font: fallbackFont };
  const d = new DOMParser().parseFromString(html, "text/html");
  const ps = Array.from(d.body.querySelectorAll("p"));
  const lines = (ps.length ? ps.map((p) => p.textContent) : d.body.textContent.split(/\r?\n/)).map((l) => l.replace(/ /g, " "));
  const m = /font-size:\s*([\d.]+)pt/i.exec(html);
  const font = m ? { ...fallbackFont, size: parseFloat(m[1]) * PT } : fallbackFont;
  return { lines, font };
}

/** Largura/altura de PNG, JPEG ou GIF a partir do base64 (sem descodificar a imagem toda). */
function imageSize(b64, mime) {
  try {
    if (mime === "image/png") {
      const b = atob(b64.slice(0, 48));
      const dv = (o) => ((b.charCodeAt(o) << 24) | (b.charCodeAt(o + 1) << 16) | (b.charCodeAt(o + 2) << 8) | b.charCodeAt(o + 3)) >>> 0;
      return { w: dv(16), h: dv(20) };
    }
    if (mime === "image/gif") {
      const b = atob(b64.slice(0, 24));
      return { w: b.charCodeAt(6) | (b.charCodeAt(7) << 8), h: b.charCodeAt(8) | (b.charCodeAt(9) << 8) };
    }
    // JPEG: procura o marcador SOF
    const b = atob(b64.slice(0, Math.min(b64.length, 400000) & ~3));
    let i = 2;
    while (i < b.length - 9) {
      if (b.charCodeAt(i) !== 0xff) { i++; continue; }
      const m = b.charCodeAt(i + 1);
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m))
        return { h: (b.charCodeAt(i + 5) << 8) | b.charCodeAt(i + 6), w: (b.charCodeAt(i + 7) << 8) | b.charCodeAt(i + 8) };
      i += 2 + ((b.charCodeAt(i + 2) << 8) | b.charCodeAt(i + 3));
    }
  } catch { /* sem dimensões: o browser usa as da imagem */ }
  return null;
}

/**
 * Imagem do folio. No QET a posição é a do canto da imagem sem escala e a escala
 * (e a rotação) são feitas em torno do centro dela.
 */
function imageEl(n) {
  const b64 = (n.textContent || "").replace(/\s+/g, "");
  if (!b64) return "";
  const mime = b64.startsWith("iVBOR") ? "image/png" : b64.startsWith("/9j/") ? "image/jpeg" : b64.startsWith("R0lG") ? "image/gif" : "";
  if (!mime) return ""; // outros formatos (p.ex. SVG embebido) não são carregados
  const sz = imageSize(b64, mime);
  const scale = num(n, "size", 1);
  const rot = num(n, "rotation");
  const x = num(n, "x"), y = num(n, "y");
  const src = `data:${mime};base64,${b64}`;
  if (!sz) return `<image href="${src}" transform="translate(${x} ${y}) rotate(${rot}) scale(${scale})"/>`;
  return `<image href="${src}" width="${sz.w}" height="${sz.h}" transform="translate(${x + sz.w / 2} ${y + sz.h / 2}) rotate(${rot}) scale(${scale}) translate(${-sz.w / 2} ${-sz.h / 2})"/>`;
}

const PEN_DASH = { DashLine: "4 2", DotLine: "1 2", DashDotLine: "4 2 1 2", DashDotDotLine: "4 2 1 2 1 2" };

function shapeEl(n) {
  const pen = kid(n, "pen");
  const brush = kid(n, "brush");
  const ps = pen ? str(pen, "style", "DashLine") : "DashLine";
  const w = pen ? num(pen, "widthF", 1) : 1;
  let a = ps === "NoPen" ? 'stroke="none"' : `stroke="${safeColor(pen?.getAttribute("color"))}" stroke-width="${w}"${ps === "SolidLine" ? "" : ` stroke-dasharray="${(PEN_DASH[ps] || "4 2").split(" ").map((d) => d * w).join(" ")}"`}`;
  a += brush && str(brush, "style") === "SolidPattern" ? ` fill="${safeColor(brush.getAttribute("color"))}"` : ' fill="none"';
  const x1 = num(n, "x1"), y1 = num(n, "y1"), x2 = num(n, "x2"), y2 = num(n, "y2");
  const rect = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
  switch (str(n, "type")) {
    case "Line": return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${a}/>`;
    case "Rectangle": return `<rect x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}" rx="${num(n, "rx")}" ry="${num(n, "ry")}" ${a}/>`;
    case "Ellipse": return `<ellipse cx="${rect.x + rect.w / 2}" cy="${rect.y + rect.h / 2}" rx="${rect.w / 2}" ry="${rect.h / 2}" ${a}/>`;
    case "Polygon": {
      const pts = nested(n, "points", "point").map((p) => `${num(p, "x")},${num(p, "y")}`);
      const closed = !["0", "false"].includes(str(n, "closed", "0"));
      return pts.length > 1 ? `<${closed ? "polygon" : "polyline"} points="${pts.join(" ")}" ${a}/>` : "";
    }
  }
  return "";
}

// ---------- moldura e legenda ----------

const fmtDate = (d) => (/^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d === "null" ? "" : d);

/** Variáveis disponíveis nos campos da legenda (%title, %{obra}, %folio…). */
function folioVars(project, folio) {
  const d = folio.node;
  return {
    ...project.props,
    ...folio.props,
    title: folio.title,
    author: str(d, "author"),
    date: fmtDate(str(d, "date")),
    indexrev: str(d, "indexrev"),
    plant: str(d, "plant"),
    locmach: str(d, "locmach"),
    filename: str(d, "filename"),
    folio: folio.folioLabel,
    "folio-id": String(folio.index),
    "folio-total": String(project.total),
    id: String(folio.index),
    total: String(project.total),
    projecttitle: project.title,
    auto_page_num: str(d, "auto_page_num"),
  };
}

const fillVars = (s, vars) =>
  s.replace(/%\{([^}]+)\}|%([A-Za-z][\w-]*)/g, (m, a, b) => {
    const k = a || b;
    return k in vars ? vars[k] ?? "" : a ? "" : m;
  });

/** "160;r100%;150;" -> larguras. N = px, N% = do total, rN% = do que sobra. */
function trackSizes(spec, total) {
  const toks = spec.split(";").map((s) => s.trim()).filter(Boolean);
  const out = toks.map(() => 0);
  let used = 0;
  toks.forEach((t, i) => {
    if (/^\d+(\.\d+)?(px)?$/.test(t)) out[i] = parseFloat(t);
    else if (/^\d+(\.\d+)?%$/.test(t)) out[i] = (total * parseFloat(t)) / 100;
    else return;
    used += out[i];
  });
  const rest = Math.max(0, total - used);
  toks.forEach((t, i) => { if (/^r\d/.test(t)) out[i] = (rest * parseFloat(t.slice(1))) / 100; });
  return out;
}

const sum = (a, from, n) => a.slice(from, from + n).reduce((s, v) => s + v, 0);

function logoSrc(tpl, name) {
  const lg = kids(kid(tpl, "logos"), "logo").find((l) => l.getAttribute("name") === name);
  if (!lg) return "";
  const svg = Array.from(lg.children).find((c) => c.localName === "svg");
  if (svg) {
    // vai para <image> como data URI: o browser não executa scripts nem carrega recursos externos
    const vb = (svg.getAttribute("viewBox") || "").split(/[\s,]+/).map(Number);
    const ser = new XMLSerializer().serializeToString(svg);
    return { href: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(ser), ratio: vb.length === 4 && vb[3] ? vb[2] / vb[3] : 0 };
  }
  const b64 = (lg.textContent || "").replace(/\s+/g, "");
  const mime = b64.startsWith("iVBOR") ? "image/png" : b64.startsWith("/9j/") ? "image/jpeg" : "";
  if (!mime) return "";
  const sz = imageSize(b64, mime);
  return { href: `data:${mime};base64,${b64}`, ratio: sz ? sz.w / sz.h : 0 };
}

/** Legenda definida num modelo (titleblocktemplate). Devolve o desenho e a altura. */
function renderTemplate(project, folio, tpl, x0, y0, W) {
  const grid = kid(tpl, "grid");
  if (!grid) return null;
  const cw = trackSizes(str(grid, "cols"), W);
  const rh = trackSizes(str(grid, "rows"), 0);
  const H = sum(rh, 0, rh.length);
  const vars = folioVars(project, folio);
  const items = [...kids(grid, "logo"), ...kids(grid, "field")];
  const covered = new Set();
  let s = `<g class="titleblock" fill="none" stroke="#000" stroke-width="1">`;
  const box = (col, row, cs, rs) => ({ x: x0 + sum(cw, 0, col), y: y0 + sum(rh, 0, row), w: sum(cw, col, cs), h: sum(rh, row, rs) });
  for (const it of items) {
    const col = Math.trunc(num(it, "col")), row = Math.trunc(num(it, "row"));
    const cs = 1 + Math.trunc(num(it, "colspan")), rs = 1 + Math.trunc(num(it, "rowspan"));
    for (let r = row; r < row + rs; r++) for (let c = col; c < col + cs; c++) covered.add(r + ":" + c);
    const b = box(col, row, cs, rs);
    s += `<rect x="${f2(b.x)}" y="${f2(b.y)}" width="${f2(b.w)}" height="${f2(b.h)}"/>`;
    if (it.tagName === "logo") {
      const lg = logoSrc(tpl, str(it, "resource"));
      if (lg) s += `<image href="${lg.href}" x="${f2(b.x + 3)}" y="${f2(b.y + 3)}" width="${f2(b.w - 6)}" height="${f2(b.h - 6)}" preserveAspectRatio="xMidYMid meet" stroke="none"/>`;
      continue;
    }
    const tr = kids(kid(it, "value"), "translation");
    const langs = [(navigator.language || "en").slice(0, 2), "en"];
    const raw = (langs.map((l) => tr.find((t) => t.getAttribute("lang") === l)).find(Boolean) || tr[0])?.textContent || "";
    const text = fillVars(raw, vars);
    if (!text.trim()) continue;
    let font = { size: (num(it, "fontsize", 9) || 9) * PT, bold: false, italic: false };
    const lines = text.split(/\r?\n/);
    const avail = b.w - 8;
    const tw = Math.max(...lines.map((l) => textWidth(l, font)));
    if (bool(it, "hadjust", false) && tw > avail && avail > 0) font = { ...font, size: Math.max(font.size * 0.5, (font.size * avail) / tw) };
    const align = str(it, "align", "left");
    const valign = str(it, "valign", "center");
    const th = lines.length * lineH(font);
    const ty = valign === "top" ? b.y + 3 : valign === "bottom" ? b.y + b.h - th - 3 : b.y + (b.h - th) / 2;
    const [tx, anchor] = align === "right" ? [b.x + b.w - 4, "end"] : align === "center" || align === "hcenter" ? [b.x + b.w / 2, "middle"] : [b.x + 4, "start"];
    s += textEl(lines, font, "#000", tx, ty, 'stroke="none"', anchor);
  }
  // células vazias também têm contorno
  for (let r = 0; r < rh.length; r++)
    for (let c = 0; c < cw.length; c++)
      if (!covered.has(r + ":" + c)) { const b = box(c, r, 1, 1); s += `<rect x="${f2(b.x)}" y="${f2(b.y)}" width="${f2(b.w)}" height="${f2(b.h)}"/>`; }
  s += `<rect x="${f2(x0)}" y="${f2(y0)}" width="${f2(W)}" height="${f2(H)}"/></g>`;
  return { svg: s, height: H };
}

/** Legenda simples, para folios cujo modelo não está embebido no projecto. */
function simpleTitleBlock(project, folio, x0, y0, W) {
  const TBH = 50;
  const d = folio.node;
  const cells = [
    ["Folha", folio.folioLabel, 70],
    ["Rev.", str(d, "indexrev"), 50],
    ["Data", fmtDate(str(d, "date")), 90],
    ["Autor", str(d, "author"), 130],
    ["Instalação / Local", [str(d, "plant"), str(d, "locmach")].filter(Boolean).join(" · "), 130],
  ];
  const titleW = Math.max(120, W - cells.reduce((a, c) => a + c[2], 0));
  const small = { size: 7 * PT, bold: false, italic: false };
  const big = { size: 12 * PT, bold: true, italic: false };
  const med = { size: 9 * PT, bold: false, italic: false };
  let s = `<g class="titleblock" fill="none" stroke="#000" stroke-width="1"><rect x="${x0}" y="${y0}" width="${W}" height="${TBH}"/>`;
  let x = x0;
  const cell = (label, val, w, font) => {
    const id = `c${folio.index}-${Math.round(x)}`;
    s += `<rect x="${x}" y="${y0}" width="${w}" height="${TBH}"/>` + textEl([label], small, "#666", x + 3, y0 + 2, 'stroke="none"');
    s += `<clipPath id="${id}"><rect x="${x}" y="${y0}" width="${w}" height="${TBH}"/></clipPath><g clip-path="url(#${id})">${textEl([val], font, "#000", x + 4, y0 + 18, 'stroke="none"')}</g>`;
    x += w;
  };
  cell(project.title ? `Título da folha — ${project.title}` : "Título da folha", folio.title, titleW, big);
  for (const [l, v, w] of cells) cell(l, v, w, med);
  return { svg: s + "</g>", height: TBH };
}

function frameSvg(project, folio) {
  const d = folio.node;
  const g = gridOf(d);
  const m = g.margin;
  let s = `<g class="border" fill="none" stroke="#000" stroke-width="1">`;
  s += `<rect x="${m}" y="${m}" width="${g.borderW}" height="${g.borderH}"/>`;
  const hf = { size: 9 * PT, bold: false, italic: false };
  const center = (t, x, y, w, h) => textEl([t], hf, "#000", x + w / 2, y + (h - lineH(hf)) / 2, 'stroke="none"', "middle");
  if (g.showCols || g.showRows) s += `<rect x="${m}" y="${m}" width="${g.headerW}" height="${g.headerH}"/>`;
  if (g.showCols)
    for (let i = 0; i < g.cols; i++) {
      const x = m + g.headerW + i * g.colW;
      s += `<rect x="${x}" y="${m}" width="${g.colW}" height="${g.headerH}"/>` + center(String(i + 1), x, m, g.colW, g.headerH);
    }
  if (g.showRows)
    for (let i = 0; i < g.rows; i++) {
      const y = m + g.headerH + i * g.rowH;
      let l = "", n = i;
      do { l = String.fromCharCode(65 + (n % 26)) + l; n = Math.floor(n / 26) - 1; } while (n >= 0);
      s += `<rect x="${m}" y="${y}" width="${g.headerW}" height="${g.rowH}"/>` + center(l, m, y, g.headerW, g.rowH);
    }
  s += "</g>";
  const ty = m + g.borderH;
  const tpl = project.titleBlocks.get(str(d, "titleblocktemplate"));
  const tb = (tpl && renderTemplate(project, folio, tpl, m, ty, g.borderW)) || simpleTitleBlock(project, folio, m, ty, g.borderW);
  return { svg: s + tb.svg, width: g.borderW + 2 * m, height: g.borderH + tb.height + 2 * m };
}

// ---------- referências cruzadas desenhadas ----------

function xrefLabels(project, el, box) {
  const rel = relatedOf(project, el);
  if (!rel.length) return "";
  const font = { size: 7 * PT, bold: false, italic: false };
  const lh = lineH(font);
  const cx = box.x + box.w / 2;
  let out = "";
  const item = (text, o, x, y, anchor) => {
    out += `<text class="xr" data-go="${esc(o.uuid)}" x="${f2(x)}" y="${f2(y)}" text-anchor="${anchor}" font-family="${famCss(font)}" font-size="${f2(font.size)}"><title>Ir para ${esc(text)}</title>${esc(text)}</text>`;
  };
  if (el.linkType === "master") {
    const slaves = rel.filter((o) => o.linkType === "slave");
    slaves.forEach((o, i) => {
      const st = o.kinds.state ? o.kinds.state + " " : "";
      item(`${st}${locationOf(project, o)}`, o, cx, box.y + box.h + 9 + i * lh, "middle");
    });
  } else if (el.linkType === "slave") {
    const m = rel.find((o) => o.linkType === "master") || rel[0];
    item(`(${locationOf(project, m)})`, m, cx, box.y - 3, "middle");
  }
  // os reports não levam ligação extra: o próprio símbolo salta para o par (data-go no elemento)
  return out;
}

// ---------- folio completo ----------

export function renderFolio(project, folio, opts = {}) {
  defaultFamily = project.fontFamily;
  const frame = frameSvg(project, folio);
  const d = folio.node;
  const used = new Map();
  const layers = []; // { z, seq, svg }
  let seq = 0;

  for (const n of nested(d, "images", "image")) layers.push({ z: num(n, "z", -1000), seq: seq++, svg: imageEl(n) });
  for (const n of nested(d, "shapes", "shape")) layers.push({ z: num(n, "z", 0), seq: seq++, svg: shapeEl(n) });
  for (const t of nested(d, "tables", "graphics_table")) {
    const w = num(t, "width"), h = num(t, "height");
    if (w > 0 && h > 0)
      layers.push({ z: 5, seq: seq++, svg: `<g><rect x="${num(t, "x")}" y="${num(t, "y")}" width="${w}" height="${h}" fill="none" stroke="#999" stroke-dasharray="4 2"/>${textEl([`(tabela: ${str(t, "name", "tabela")}) — não representada`], { size: 9 * PT }, "#999", num(t, "x") + 6, num(t, "y") + 4)}</g>` });
  }
  for (const t of nested(d, "inputs", "input")) {
    const base = t.getAttribute("font") ? parseFont(t.getAttribute("font")) : parseFont();
    const { lines, font } = richLines(str(t, "text"), base);
    const rot = num(t, "rotation");
    layers.push({
      z: num(t, "z", 10), seq: seq++,
      svg: `<g class="free-text" transform="translate(${num(t, "x")} ${num(t, "y")})${rot ? ` rotate(${rot})` : ""}">${textEl(lines, font, "#000", TEXT_MARGIN, TEXT_MARGIN)}</g>`,
    });
  }

  const xrefs = [];
  for (const el of folio.elements) {
    if (!el.def) continue;
    const id = symbolId(el.key);
    if (!used.has(id)) used.set(id, el.def);
    const tr = `translate(${el.x} ${el.y})${el.ori ? ` rotate(${90 * el.ori})` : ""}`;
    const isReport = el.linkType === "next_report" || el.linkType === "previous_report";
    const partner = isReport ? relatedOf(project, el)[0] : null;
    layers.push({
      z: el.z, seq: seq++,
      svg: `<g class="el ${esc(el.linkType)}" data-u="${esc(el.uuid)}"${partner ? ` data-go="${esc(partner.uuid)}"` : ""} transform="${tr}">${partner ? `<title>Ir para ${esc(locationOf(project, partner))}</title>` : ""}${hitRect(el.def)}<use href="#${id}"/>${elementTexts(project, el)}</g>`,
    });
    if (opts.xrefs !== false) xrefs.push(xrefLabels(project, el, elementBox(el)));
  }

  // condutores
  const conds = [];
  for (const c of nested(d, "conductors", "conductor")) {
    const t1 = terminalOf(folio, c, 1);
    const t2 = terminalOf(folio, c, 2);
    if (!t1 || !t2) continue;
    const p1 = { x: t1.x, y: t1.y }, p2 = { x: t2.x, y: t2.y };
    conds.push({ c, t1, t2, pts: savedPath(p1, p2, c) || autoPath(p1, t1.o, p2, t2.o) });
  }
  const byTerm = new Map();
  conds.forEach((k, i) => [k.t1, k.t2].forEach((t) => byTerm.set(t, [...(byTerm.get(t) || []), i])));
  let condSvg = "";
  conds.forEach((k, i) => {
    const { c, pts } = k;
    const color = safeColor(c.getAttribute("color"));
    const width = num(c, "condsize", 1) || 1;
    const dashM = /line-style:\s*(dashed|dashdotted)/.exec(str(c, "style"));
    const dash = dashM ? ` stroke-dasharray="${(DASH[dashM[1]] || [4, 2]).map((v) => v * width).join(" ")}"` : "";
    const poly = pts.map((p) => `${f2(p.x)},${f2(p.y)}`).join(" ");
    let g = `<polyline class="hit" points="${poly}" fill="none" stroke="transparent" stroke-width="8"/>`;
    g += `<polyline class="wire" points="${poly}" fill="none" stroke="${color}" stroke-width="${width}"${dash} stroke-linecap="square"/>`;
    if (bool(c, "bicolor")) {
      const ds = num(c, "dash-size", 1);
      g += `<polyline points="${poly}" fill="none" stroke="${safeColor(c.getAttribute("color2"))}" stroke-width="${width}" stroke-dasharray="${ds} ${ds * 2}"/>`;
    }
    // pontos de junção
    const related = new Set([...(byTerm.get(k.t1) || []), ...(byTerm.get(k.t2) || [])]);
    related.delete(i);
    for (let j = 1; j < pts.length - 1; j++) {
      const mine = dirsAt(pts, pts[j]);
      const all = new Set(mine);
      for (const r of related) dirsAt(conds[r].pts, pts[j]).forEach((x) => all.add(x));
      if (all.size >= 3 && related.size) g += `<circle cx="${pts[j].x}" cy="${pts[j].y}" r="${Math.max(1.5, 1.5 * width)}" fill="${color}"/>`;
    }
    const text = str(c, "num");
    if (str(c, "displaytext", "1") !== "0" && str(c, "type", "multi") !== "single" && text && text !== "_") g += conductorText(c, pts, text);
    condSvg += `<g class="cd" data-i="${i}">${g}</g>`;
  });
  layers.push({ z: 11, seq: seq++, svg: condSvg });

  layers.sort((a, b) => a.z - b.z || a.seq - b.seq);

  const symbols = [...used].map(([id, def]) => {
    if (!symbolCache.has(def)) symbolCache.set(def, buildSymbol(def));
    return `<g id="${id}">${symbolCache.get(def)}</g>`;
  });

  const W = Math.max(frame.width, 10), H = Math.max(frame.height, 10);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    `<defs>${symbols.join("")}</defs>` +
    `<rect width="${W}" height="${H}" fill="#fff"/>` +
    frame.svg +
    `<g class="scene">${layers.map((l) => l.svg).join("")}</g>` +
    `<g class="xrefs">${xrefs.join("")}</g>` +
    `<g class="pins"></g><g class="hl" pointer-events="none"></g></svg>`;

  return {
    svg, width: W, height: H,
    conductors: conds.map((k) => ({
      num: str(k.c, "num"), fn: str(k.c, "function"), cable: str(k.c, "cable"), color: str(k.c, "conductor_color"),
      section: str(k.c, "conductor_section"), from: k.t1.element, to: k.t2.element, fromName: k.t1.name, toName: k.t2.name, pts: k.pts,
    })),
  };
}
