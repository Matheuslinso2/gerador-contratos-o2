import "server-only";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

// "Foto do card" em PDF (Matheus, 01/11/2026): cópia legível do card do Bitrix como estava quando foi guardado
// (campos, histórico de etapas, comentários). Vale principalmente para cards recusados/perdidos, que podem sumir do funil.
// Vem de erp_origens (cards ligados a documento) ou de bitrix_cards_arquivo (cards que chegaram já perdidos/recusados).

const L = 595.28;
const A = 841.89;
const M = 48;
const limpar = (s: string) => s.replace(/[^\x20-\x7E -ÿ–—•’‘“”…€\n]/g, "?");

export type FotoCard = {
  titulo: string;
  funil: string;
  etapa: string | null;
  situacao: string | null;
  motivo: string | null;
  imobiliaria: string | null;
  cardId: number;
  criadoEm: string | null;
  atualizadoEm: string | null;
  capturadoEm: string | null;
  url: string | null;
  campos: Record<string, unknown>;
  historico: { quando?: string; etapa?: string; semantica?: string }[];
  comentarios: { quando?: string; autor?: number | string | null; texto?: string }[];
  origemDaFoto: string;
};

const dataHora = (v: string | null | undefined) => (v ? new Date(v).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "—");

function valorTexto(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(valorTexto).filter(Boolean).join(", ");
  try {
    return JSON.stringify(v).slice(0, 300);
  } catch {
    return "";
  }
}

export async function gerarPdfFotoCard(c: FotoCard, geradoPor: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const fonte = await pdf.embedFont(StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.004, 0.098, 0.18);
  const coral = rgb(0.973, 0.329, 0.051);
  const cinza = rgb(0.45, 0.45, 0.45);
  const texto = rgb(0.12, 0.12, 0.12);
  const util = L - M * 2;
  let pg: PDFPage = pdf.addPage([L, A]);
  let y = A - M;
  const nova = () => {
    pg = pdf.addPage([L, A]);
    y = A - M;
  };
  const linhas = (t: string, f: PDFFont, tam: number, larg: number) => {
    const out: string[] = [];
    for (const par of limpar(t).split("\n")) {
      let atual = "";
      for (const p of par.split(" ")) {
        const cand = atual ? atual + " " + p : p;
        if (f.widthOfTextAtSize(cand, tam) > larg && atual) {
          out.push(atual);
          atual = p;
        } else atual = cand;
      }
      out.push(atual);
    }
    return out;
  };
  const bloco = (t: string, f: PDFFont, tam: number, cor = texto, x = M, larg = util) => {
    for (const l of linhas(t, f, tam, larg)) {
      if (y < M + 24) nova();
      pg.drawText(l, { x, y, size: tam, font: f, color: cor });
      y -= tam * 1.4;
    }
  };
  const secao = (t: string) => {
    if (y < M + 60) nova();
    y -= 10;
    pg.drawText(t, { x: M, y, size: 11, font: negrito, color: coral });
    y -= 6;
    pg.drawLine({ start: { x: M, y }, end: { x: L - M, y }, thickness: 0.6, color: rgb(0.85, 0.85, 0.85) });
    y -= 14;
  };

  pg.drawRectangle({ x: 0, y: A - 8, width: L, height: 8, color: coral });
  pg.drawText("O2 Seguros", { x: M, y: y - 4, size: 11, font: negrito, color: coral });
  y -= 30;
  pg.drawText("Foto do card", { x: M, y, size: 20, font: negrito, color: navy });
  y -= 20;
  bloco(c.titulo || `Card ${c.cardId}`, negrito, 12, navy);
  y -= 2;
  bloco(`${c.funil} · card nº ${c.cardId}${c.imobiliaria ? ` · ${c.imobiliaria}` : ""}`, fonte, 9, cinza);
  y -= 4;

  secao("Situação");
  const resumo: [string, string][] = [
    ["Etapa atual", c.etapa ?? "—"],
    ["Situação", c.situacao ?? "—"],
    ...(c.motivo ? ([["Motivo", c.motivo]] as [string, string][]) : []),
    ["Card criado em", dataHora(c.criadoEm)],
    ["Última atualização do card", dataHora(c.atualizadoEm)],
    ["Foto guardada em", dataHora(c.capturadoEm)],
  ];
  for (const [k, v] of resumo) {
    if (y < M + 24) nova();
    pg.drawText(limpar(k), { x: M, y, size: 9, font: negrito, color: cinza });
    bloco(v, fonte, 9.5, texto, M + 150, util - 150);
  }

  secao("Campos do card");
  let n = 0;
  for (const [k, v] of Object.entries(c.campos)) {
    const val = valorTexto(v);
    if (!val || n >= 150) continue;
    n++;
    const linhasVal = linhas(val, fonte, 9.5, util - 190);
    if (y - linhasVal.length * 13 < M + 24) nova();
    const rot = linhas(k, negrito, 8.5, 180);
    pg.drawText(rot[0] ?? "", { x: M, y, size: 8.5, font: negrito, color: cinza });
    const yIni = y;
    for (const l of linhasVal) {
      pg.drawText(l, { x: M + 190, y, size: 9.5, font: fonte, color: texto });
      y -= 13;
    }
    if (rot.length > 1) {
      let yr = yIni - 11;
      for (const l of rot.slice(1)) {
        pg.drawText(l, { x: M, y: yr, size: 8.5, font: negrito, color: cinza });
        yr -= 11;
      }
      y = Math.min(y, yr + 2);
    }
    y -= 2;
  }

  if (c.historico.length) {
    secao("Histórico de etapas");
    for (const e of c.historico) {
      if (y < M + 24) nova();
      pg.drawText(limpar(dataHora(e.quando)), { x: M, y, size: 9, font: fonte, color: cinza });
      bloco(`${e.etapa ?? "—"}${e.semantica === "F" ? " (encerrado sem negócio)" : e.semantica === "S" ? " (concluído com sucesso)" : ""}`, fonte, 9.5, texto, M + 120, util - 120);
    }
  }

  if (c.comentarios.length) {
    secao("Comentários do card");
    for (const cm of c.comentarios) {
      if (y < M + 40) nova();
      pg.drawText(limpar(`${dataHora(cm.quando)}${cm.autor ? ` · usuário ${cm.autor}` : ""}`), { x: M, y, size: 8.5, font: negrito, color: cinza });
      y -= 12;
      bloco(String(cm.texto ?? ""), fonte, 9.5);
      y -= 4;
    }
  }

  const paginas = pdf.getPages();
  paginas.forEach((p, i) =>
    p.drawText(limpar(`Foto do card do Bitrix guardada no banco (${c.origemDaFoto}) · gerada em ${dataHora(new Date().toISOString())} por ${geradoPor} · uso interno · página ${i + 1} de ${paginas.length}`), { x: M, y: 24, size: 7, font: fonte, color: cinza })
  );
  return pdf.save();
}
