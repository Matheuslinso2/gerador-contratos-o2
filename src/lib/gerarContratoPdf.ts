import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import type { ContratoParaDocx } from "./gerarContratoDocx";

// Gera uma versão em PDF do mesmo contrato (mais simples que o Word, sem frescura
// visual) só para poder colar, ao final, as páginas ORIGINAIS do laudo de vistoria
// sem tratar/alterar nada nelas (usado no modo "arquivo_embutido"). O Word continua
// sendo o formato principal para os outros modos de laudo.

const PAGE_WIDTH = 595.28; // A4 em pontos
const PAGE_HEIGHT = 841.89;
const MARGEM = 56.7; // ~2cm
const LARGURA_UTIL = PAGE_WIDTH - MARGEM * 2;
const COR_TEXTO = rgb(0.15, 0.15, 0.15);
const COR_PRINCIPAL = rgb(0.12, 0.23, 0.34);

function quebrarParagrafos(texto: string): string[] {
  return texto
    .split(/\n\n+/)
    .map((b) => b.trim())
    .filter(Boolean);
}

class ConstrutorPdf {
  doc!: PDFDocument;
  fonte!: PDFFont;
  fonteNegrito!: PDFFont;
  pagina!: PDFPage;
  y = 0;
  tamanhoFonte = 10.5;
  alturaLinha = 14;

  static async criar() {
    const c = new ConstrutorPdf();
    c.doc = await PDFDocument.create();
    c.fonte = await c.doc.embedFont(StandardFonts.Helvetica);
    c.fonteNegrito = await c.doc.embedFont(StandardFonts.HelveticaBold);
    c.novaPagina();
    return c;
  }

  novaPagina() {
    this.pagina = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGEM;
  }

  garantirEspaco(altura: number) {
    if (this.y - altura < MARGEM) this.novaPagina();
  }

  private quebrarLinhas(texto: string, fonte: PDFFont, tamanho: number): string[] {
    const palavras = texto.split(/\s+/).filter(Boolean);
    const linhas: string[] = [];
    let atual = "";
    for (const palavra of palavras) {
      const teste = atual ? `${atual} ${palavra}` : palavra;
      if (atual && fonte.widthOfTextAtSize(teste, tamanho) > LARGURA_UTIL) {
        linhas.push(atual);
        atual = palavra;
      } else {
        atual = teste;
      }
    }
    if (atual) linhas.push(atual);
    return linhas;
  }

  paragrafo(
    texto: string,
    opts: { negrito?: boolean; tamanho?: number; antes?: number; depois?: number; centro?: boolean; cor?: ReturnType<typeof rgb> } = {}
  ) {
    if (!texto) return;
    const tamanho = opts.tamanho ?? this.tamanhoFonte;
    const fonte = opts.negrito ? this.fonteNegrito : this.fonte;
    const cor = opts.cor ?? COR_TEXTO;
    if (opts.antes) this.y -= opts.antes;
    const linhas = this.quebrarLinhas(texto, fonte, tamanho);
    for (const linha of linhas) {
      this.garantirEspaco(this.alturaLinha);
      let x = MARGEM;
      if (opts.centro) {
        const largura = fonte.widthOfTextAtSize(linha, tamanho);
        x = (PAGE_WIDTH - largura) / 2;
      }
      this.pagina.drawText(linha, { x, y: this.y, size: tamanho, font: fonte, color: cor });
      this.y -= this.alturaLinha;
    }
    if (opts.depois) this.y -= opts.depois;
  }

  linhaDado(rotulo: string, valor: string) {
    if (!valor) return;
    this.garantirEspaco(this.alturaLinha);
    this.pagina.drawText(`${rotulo}: `, {
      x: MARGEM,
      y: this.y,
      size: this.tamanhoFonte,
      font: this.fonteNegrito,
      color: COR_PRINCIPAL,
    });
    const larguraRotulo = this.fonteNegrito.widthOfTextAtSize(`${rotulo}: `, this.tamanhoFonte);
    const linhasValor = this.quebrarLinhas(valor, this.fonte, this.tamanhoFonte);
    this.pagina.drawText(linhasValor[0] ?? "", {
      x: MARGEM + larguraRotulo,
      y: this.y,
      size: this.tamanhoFonte,
      font: this.fonte,
      color: COR_TEXTO,
    });
    this.y -= this.alturaLinha;
    for (const linha of linhasValor.slice(1)) {
      this.garantirEspaco(this.alturaLinha);
      this.pagina.drawText(linha, { x: MARGEM, y: this.y, size: this.tamanhoFonte, font: this.fonte, color: COR_TEXTO });
      this.y -= this.alturaLinha;
    }
  }

  tituloSecao(texto: string) {
    this.garantirEspaco(this.alturaLinha * 2 + 20);
    this.paragrafo(texto.toUpperCase(), { negrito: true, tamanho: 12.5, antes: 20, cor: COR_PRINCIPAL, depois: 6 });
  }

  blocoTexto(texto: string) {
    for (const bloco of quebrarParagrafos(texto)) {
      this.paragrafo(bloco, { depois: 6 });
    }
  }
}

const fmtMoeda = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtData = (iso: string) => {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
};

async function embutirLogo(doc: PDFDocument, logoUrl: string | null) {
  if (!logoUrl) return null;
  try {
    const res = await fetch(logoUrl);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const ext = logoUrl.split(".").pop()?.toLowerCase();
    if (ext === "jpg" || ext === "jpeg") return await doc.embedJpg(bytes);
    return await doc.embedPng(bytes);
  } catch {
    return null;
  }
}

export async function gerarContratoPdf(c: ContratoParaDocx): Promise<PDFDocument> {
  const b = await ConstrutorPdf.criar();
  const logo = await embutirLogo(b.doc, c.imobiliaria.logo_url);

  if (logo) {
    const largura = 130;
    const altura = (logo.height / logo.width) * largura;
    b.garantirEspaco(altura + 10);
    b.pagina.drawImage(logo, { x: (PAGE_WIDTH - largura) / 2, y: b.y - altura, width: largura, height: altura });
    b.y -= altura + 12;
  }

  b.paragrafo("CONTRATO DE LOCAÇÃO", { negrito: true, tamanho: 16, centro: true, cor: COR_PRINCIPAL, depois: 4 });
  b.paragrafo(
    `${c.imobiliaria.nome} — CNPJ ${c.imobiliaria.cnpj}${c.imobiliaria.creci ? ` — CRECI ${c.imobiliaria.creci}` : ""}`,
    { tamanho: 9.5, centro: true, depois: 2 }
  );
  if (c.imobiliaria.endereco) {
    b.paragrafo(c.imobiliaria.endereco, { tamanho: 9, centro: true, depois: 10 });
  }

  b.tituloSecao("Dados da Locação");
  b.linhaDado("Locador(es)", c.locador + (c.locadorProcurador ? " (representado por procurador/administradora)" : ""));
  b.linhaDado("Locatário(s)", c.locatario);
  if (c.ocupantesAdicionais) b.linhaDado("Ocupantes adicionais autorizados", c.ocupantesAdicionais);
  b.linhaDado("Imóvel", c.enderecoImovel);
  b.linhaDado("Finalidade", c.finalidade === "residencial" ? "Residencial" : "Não residencial");
  b.linhaDado("Valor do aluguel", fmtMoeda(c.valorAluguel));
  b.linhaDado("Índice de reajuste", c.imobiliaria.indice_reajuste);
  b.linhaDado("Data de início", fmtData(c.dataInicio));
  b.linhaDado("Prazo", `${c.prazoMeses} meses`);
  if (c.laudoModo === "link" && c.laudoVistoriaUrl) {
    b.linhaDado("Laudo de vistoria inicial", c.laudoVistoriaUrl);
  } else if (c.laudoModo === "arquivo_separado" && c.laudoArquivoNome) {
    b.linhaDado(
      "Laudo de vistoria inicial",
      `Documento anexo, entregue separadamente (${c.laudoArquivoNome}), parte integrante deste contrato`
    );
  } else if (c.laudoModo === "arquivo_embutido" && c.laudoArquivoNome) {
    b.linhaDado("Laudo de vistoria inicial", "Apresentado nas páginas seguintes deste contrato, das quais é parte integrante");
  }

  let numero = 1;

  b.tituloSecao(`${numero++}. Disposições Gerais`);
  b.blocoTexto(c.imobiliaria.texto_base_contrato);

  b.tituloSecao(`${numero++}. Da Garantia Locatícia — ${c.tipoGarantiaNome}`);
  b.paragrafo(`Seguradora: ${c.seguradoraNome} — Produto: ${c.produtoNome}`, { negrito: true, depois: 6 });
  b.blocoTexto(c.clausulaBase);
  for (const cob of c.coberturas) {
    b.paragrafo(`Cobertura adicional: ${cob.nome}`, { negrito: true, antes: 6, depois: 4 });
    b.blocoTexto(cob.texto);
  }

  if (c.seguroIncendio) {
    b.tituloSecao(`${numero++}. Do Seguro Incêndio (item obrigatório, protege o patrimônio do locador)`);
    b.paragrafo(`Seguradora: ${c.seguroIncendio.seguradoraNome} — Produto: ${c.seguroIncendio.produtoNome}`, {
      negrito: true,
      depois: 6,
    });
    b.blocoTexto(c.seguroIncendio.clausulaBase);
    for (const cob of c.seguroIncendio.coberturas) {
      b.paragrafo(`Cobertura adicional: ${cob.nome}`, { negrito: true, antes: 6, depois: 4 });
      b.blocoTexto(cob.texto);
    }
  }

  if (c.imobiliaria.plataforma_assinatura) {
    b.tituloSecao(`${numero++}. Da Assinatura Eletrônica`);
    b.blocoTexto(
      `As partes reconhecem como válida a assinatura eletrônica deste contrato realizada através da plataforma ${c.imobiliaria.plataforma_assinatura}.`
    );
  }

  b.paragrafo(
    `E por estarem de acordo com todas as cláusulas e condições deste instrumento, as partes assinam o presente contrato em ${fmtData(c.dataInicio)}.`,
    { antes: 16, depois: 20 }
  );

  const assinatura = (rotulo: string, nome?: string) => {
    b.garantirEspaco(60);
    b.paragrafo("_______________________________________", { centro: true, antes: 24, depois: 2 });
    b.paragrafo(rotulo, { negrito: true, centro: true, depois: nome ? 1 : 0 });
    if (nome) b.paragrafo(nome, { tamanho: 9, centro: true });
  };
  assinatura("LOCADOR(ES)");
  assinatura("LOCATÁRIO(S)", c.locatario);
  assinatura("TESTEMUNHA 1");
  assinatura("TESTEMUNHA 2");

  return b.doc;
}

// Cola, ao final do PDF do contrato, as páginas ORIGINAIS do laudo (sem reprocessar
// o conteúdo delas de forma alguma — só copia as páginas para dentro do mesmo arquivo).
export async function mesclarLaudoNoPdf(contratoDoc: PDFDocument, laudoBytes: Uint8Array): Promise<Uint8Array> {
  const laudoDoc = await PDFDocument.load(laudoBytes);
  const paginasCopiadas = await contratoDoc.copyPages(laudoDoc, laudoDoc.getPageIndices());
  for (const pagina of paginasCopiadas) contratoDoc.addPage(pagina);
  return contratoDoc.save();
}
