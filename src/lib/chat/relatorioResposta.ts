import "server-only";

import { randomUUID } from "node:crypto";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { createServiceClient } from "@/lib/supabase/service";

// PDF "padrão relatório" de QUALQUER resposta do Robô O2 (Matheus, 01/11/2026: o resultado da consulta do robô
// deve poder virar um relatório em PDF, não só a lista de apólices). O PDF contém exatamente a pergunta e a resposta
// que o robô deu, com data/hora e quem gerou: nenhum número novo é criado aqui.

const LARGURA = 595.28;
const ALTURA = 841.89;
const MARGEM = 56;
const VALIDADE_LINK_SEG = 6 * 60 * 60;

const limpar = (s: string) => s.replace(/[^\x20-\x7E -ÿ–—•’‘“”…€\n]/g, "?");

type Trecho = { texto: string; negrito: boolean };

// "*negrito*" do chat -> trechos com fonte em negrito.
function trechos(linha: string): Trecho[] {
  return linha
    .split(/(\*[^*\n]+\*)/g)
    .filter(Boolean)
    .map((p) => (/^\*[^*\n]+\*$/.test(p) ? { texto: p.slice(1, -1), negrito: true } : { texto: p, negrito: false }));
}

export async function gerarPdfDaResposta(p: { pergunta: string; resposta: string; email: string; logica?: string | null; fontes?: string[] }): Promise<{ url: string } | { erro: string }> {
  const pergunta = limpar(p.pergunta).slice(0, 600);
  const resposta = limpar(p.resposta).slice(0, 8000);
  if (!resposta.trim()) return { erro: "Resposta vazia." };

  const pdf = await PDFDocument.create();
  const fonte = await pdf.embedFont(StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.004, 0.098, 0.18);
  const coral = rgb(0.973, 0.329, 0.051);
  const cinza = rgb(0.45, 0.45, 0.45);
  const util = LARGURA - MARGEM * 2;
  let pagina = pdf.addPage([LARGURA, ALTURA]);
  let y = ALTURA - MARGEM;

  const nova = () => {
    pagina = pdf.addPage([LARGURA, ALTURA]);
    y = ALTURA - MARGEM;
  };
  const f = (n: boolean): PDFFont => (n ? negrito : fonte);

  // Escreve um parágrafo (com *negrito*), quebrando linhas por palavra.
  const paragrafo = (texto: string, tam: number, recuo = 0, corTexto = rgb(0.12, 0.12, 0.12)) => {
    const entrelinha = tam * 1.45;
    let x = MARGEM + recuo;
    const largura = util - recuo;
    let linhaAtual = 0;
    for (const t of trechos(texto)) {
      for (const palavra of t.texto.split(/(\s+)/).filter((w) => w !== "")) {
        const w = f(t.negrito).widthOfTextAtSize(palavra, tam);
        if (x - (MARGEM + recuo) + w > largura && !/^\s+$/.test(palavra)) {
          x = MARGEM + recuo;
          y -= entrelinha;
          linhaAtual++;
          if (y < MARGEM + 20) nova();
        }
        if (/^\s+$/.test(palavra) && x === MARGEM + recuo) continue;
        pagina.drawText(palavra, { x, y, size: tam, font: f(t.negrito), color: corTexto });
        x += w;
      }
    }
    y -= entrelinha;
    return linhaAtual;
  };

  pagina.drawRectangle({ x: 0, y: ALTURA - 8, width: LARGURA, height: 8, color: coral });
  pagina.drawText("O2 Seguros", { x: MARGEM, y, size: 11, font: negrito, color: coral });
  y -= 26;
  pagina.drawText("Relatório do Robô O2", { x: MARGEM, y, size: 20, font: negrito, color: navy });
  y -= 18;
  pagina.drawText(limpar(`Gerado em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} por ${p.email}`), { x: MARGEM, y, size: 9, font: fonte, color: cinza });
  y -= 14;
  // Lógica do filtro: frase pequena, em cinza (menor destaque que o título), como pedido pelo Matheus.
  const frase = limpar(p.logica?.trim() ? `Filtro aplicado: ${p.logica.trim().slice(0, 700)}` : p.fontes?.length ? `Consultas feitas: ${p.fontes.slice(0, 8).join(" | ").slice(0, 700)}` : "");
  if (frase) {
    let linha = "";
    for (const palavra of frase.split(" ")) {
      const cand = linha ? linha + " " + palavra : palavra;
      if (fonte.widthOfTextAtSize(cand, 8) > util && linha) {
        pagina.drawText(linha, { x: MARGEM, y, size: 8, font: fonte, color: cinza });
        y -= 10;
        linha = palavra;
      } else linha = cand;
    }
    if (linha) {
      pagina.drawText(linha, { x: MARGEM, y, size: 8, font: fonte, color: cinza });
      y -= 10;
    }
  }
  y -= 18;

  pagina.drawText("Pergunta", { x: MARGEM, y, size: 10, font: negrito, color: coral });
  y -= 16;
  paragrafo(pergunta, 11, 0, navy);
  y -= 14;
  pagina.drawLine({ start: { x: MARGEM, y: y + 6 }, end: { x: LARGURA - MARGEM, y: y + 6 }, thickness: 0.6, color: rgb(0.85, 0.85, 0.85) });
  y -= 14;
  pagina.drawText("Resposta", { x: MARGEM, y, size: 10, font: negrito, color: coral });
  y -= 18;

  for (const bruta of resposta.split("\n")) {
    const linha = bruta.trimEnd();
    if (!linha.trim()) {
      y -= 8;
      continue;
    }
    if (y < MARGEM + 30) nova();
    const item = /^\s*[-•]\s+(.*)$/.exec(linha);
    if (item) {
      pagina.drawText("•", { x: MARGEM + 4, y, size: 11, font: fonte, color: coral });
      paragrafo(item[1], 11, 18);
    } else paragrafo(linha, 11);
    y -= 3;
  }

  const paginas = pdf.getPages();
  paginas.forEach((pg, i) => {
    pg.drawText(limpar(`Resposta gerada pelo Robô O2 com dados do Workspace e do ERP · uso interno da O2 Seguros · página ${i + 1} de ${paginas.length}`), { x: MARGEM, y: 28, size: 7.5, font: fonte, color: cinza });
  });

  const sb = createServiceClient();
  const caminho = `${new Date().toISOString().slice(0, 7)}/${randomUUID()}.pdf`;
  const { error } = await sb.storage.from("relatorios-robo").upload(caminho, await pdf.save(), { contentType: "application/pdf" });
  if (error) return { erro: `Não consegui guardar o PDF: ${error.message}` };
  const { data, error: erroUrl } = await sb.storage.from("relatorios-robo").createSignedUrl(caminho, VALIDADE_LINK_SEG, { download: `relatorio-robo-o2-${new Date().toISOString().slice(0, 10)}.pdf` });
  if (erroUrl || !data) return { erro: "Não consegui gerar o link do PDF." };
  return { url: data.signedUrl };
}
