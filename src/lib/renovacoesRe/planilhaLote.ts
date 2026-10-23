import * as XLSX from "xlsx";
import { escolherImobiliaria, lerObservacao, type ItemRenovacao } from "@/lib/renovacoesRe/exportItens";
import { separarEndereco, type DocumentoPdf } from "@/lib/renovacoesRe/pdfItensGarantias";

// Planilha de lote por imobiliária (Imobiliário) — modelo "RENOVAÇÃO SPECIAL
// 11.2026" que o Matheus indicou como base (23/10/2026). Um arquivo por card do
// funil Renovações: imobiliária + seguradora. Fontes de cada coluna:
//  - lista, apólice, vigência, segurado, CPF, prêmio e comissão: Corp
//    ("Simplificado com Produtor", Excel — inclui IMOB e 2IMO);
//  - endereço/ocupação/plano/LMI da Yelum: "Exporta itens pacote" da Kamila
//    (só IMOB por enquanto); na falta, PDF "Apresentando Itens e Garantias";
//  - LMI de incêndio/aluguel/danos elétricos: histórico do lote do ano anterior
//    (quando houver) — o Corp não traz LMI do imobiliário.
// O que a equipe preenche na cotação (VALOR 2026, ORÇAMENTO, RP, AGRAVO…) fica
// em branco.

export const COLUNAS_SPECIAL = [
  "STATUS", "FIM DE VIGÊNCIA", "APÓLICE", "NOME DO LOCADOR", "CPF / CNPJ", "CEP", "ENDEREÇO", "Nº",
  "COMPLEMENTO", "BAIRRO", "OCUPAÇÃO", "LMI DE INCÊNDIO", "LMI DE ALUGUEL", "DANOS ELÉTRICOS", "PLANO",
  "PARCELAS (X)", "PARCELAS", "VALOR 2025", "VALOR 2026", "ORÇAMENTO", "CM", "RP", "AGRAVO", "OBS",
] as const;
type LinhaSpecial = Record<(typeof COLUNAS_SPECIAL)[number], string | number>;

export type ApoliceCorp = {
  nossoNumero: string;
  apolice: string;
  seguradoraCodigo: string;
  ramoCodigo: string; // IMOB, 2IMO, RESI, EMPR…
  inicioVigencia: string | null;
  fimVigencia: string | null;
  cliente: string;
  documento: string;
  premioTotal: number;
  percentualComissao: number;
  produtores: string[];
  imobiliaria: string | null;
  canais: string[];
};

export type HistoricoItem = {
  documento: string;
  numero: string;
  complemento: string;
  valorAluguel: number | null;
  cep: string;
  apolice: string;
  ocupacao: string;
  lmiIncendio: number | null;
  lmiAluguel: number | null;
  danosEletricos: number | null;
  vendaval: number | null;
  plano: string;
  arquivo: string;
};

const texto = (v: unknown) => String(v ?? "").trim();
const numero = (v: unknown) => (typeof v === "number" ? v : Number(texto(v).replace(/[R$\s]/g, "").replace(/\./g, "").replace(",", ".")) || 0);
const digitos = (s: string) => s.replace(/\D/g, "");
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
const norm = (s: string) => semAcento(s).replace(/\b(APTO|APT|AP|APARTAMENTO)\b\.?/g, "AP").replace(/[^A-Z0-9]/g, "");
const dataBr = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
const dataExcel = (v: unknown) =>
  typeof v === "number" && v > 0 ? new Date(Date.UTC(1899, 11, 30) + v * 864e5).toISOString().slice(0, 10) : null;

const SEGURADORAS: Record<string, string> = {
  TOKI: "TOKIO", YELU: "YELUM", PORT: "PORTO", ALLI: "ALLIANZ", ALF: "ALFA", ALFA: "ALFA", BRAD: "BRADESCO",
  ZURI: "ZURICH", MAPF: "MAPFRE", SULA: "SULAMERICA", AZUL: "AZUL", POTT: "POTTENCIAL", TOO: "TOO",
};
export const nomeSeguradora = (codigo: string) => {
  const c = semAcento(codigo);
  if (/TOKIO/.test(c)) return "TOKIO";
  if (/YELUM|LIBERTY/.test(c)) return "YELUM";
  if (/PORTO/.test(c)) return "PORTO";
  return SEGURADORAS[c] ?? c;
};

// Excel "Simplificado com Produtor" do relatório Documentos → Renovações.
export function lerSimplificadoComProdutor(arquivo: Buffer): ApoliceCorp[] {
  const wb = XLSX.read(arquivo, { type: "buffer" });
  const linhas = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
  const faltando = ["Nosso Nº", "Apólice", "Seguradora", "Ramo", "Final Vig.", "Produtor 1"].filter((c) => linhas.length && !(c in linhas[0]));
  if (faltando.length) throw new Error(`Excel do Corp sem as colunas: ${faltando.join(", ")} (é o modelo "Simplificado com Produtor"?)`);
  return linhas
    .filter((l) => texto(l["Cancelado"]) !== "V" && texto(l["Cancelado"]) !== "S")
    .map((l) => {
      const produtores = Object.keys(l).filter((k) => /^Produtor \d/.test(k)).map((k) => texto(l[k])).filter(Boolean);
      const { imobiliaria, canais } = escolherImobiliaria(produtores);
      return {
        nossoNumero: texto(l["Nosso Nº"]),
        apolice: texto(l["Apólice"]),
        seguradoraCodigo: texto(l["Seguradora"]),
        ramoCodigo: texto(l["Ramo"]),
        inicioVigencia: dataExcel(l["Início Vig."]),
        fimVigencia: dataExcel(l["Final Vig."]),
        cliente: texto(l["Cliente"]).replace(/^[\d.]+\s+(?=\D)/, ""), // Corp põe o CNPJ na frente do nome de PJ
        documento: digitos(texto(l["CPF/CNPJ"])),
        premioTotal: numero(l["Prêmio Total"]),
        percentualComissao: numero(l["% Com."]),
        produtores,
        imobiliaria,
        canais,
      };
    });
}

// Planilhas de lote dos anos anteriores. O formato varia por imobiliária e por
// ano (lê pelo nome da coluna): Special/Yelum ("LMI DE INCÊNDIO", "LMI DE
// ALUGUEL"), Renascença ("CPFLOCD", "LMI"), Liberty ("LMI", "PERDA DE ALUGUEL",
// endereço com número numa coluna só) e o orçamento Tokio/Segimob, que não tem
// LMI — só "Valor Aluguel" (a base do cálculo da Tokio).
export function lerHistorico(arquivo: Buffer, nomeArquivo: string): HistoricoItem[] {
  const wb = XLSX.read(arquivo, { type: "buffer" });
  const itens: HistoricoItem[] = [];
  for (const nome of wb.SheetNames) {
    const matriz = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nome], { header: 1, defval: "" });
    const iCab = matriz
      .slice(0, 15)
      .findIndex((l) => l.some((c) => /CPF/i.test(texto(c))) && l.some((c) => /LMI|INC[EÊ]NDIO|ALUGUEL/i.test(texto(c))));
    if (iCab < 0) continue;
    const cab = matriz[iCab].map((c) => semAcento(texto(c)));
    const col = (re: RegExp) => cab.findIndex((c) => re.test(c));
    const c = {
      doc: col(/CPF/), num: col(/^N[º°O]?$|^NUMERO/), comp: col(/COMPLEMENTO/), cep: col(/^CEP/), apolice: col(/APOLICE/),
      end: col(/^ENDERECO|^LOGRADOURO/),
      ocup: col(/OCUPACAO|TIPO DO IMOVEL/), ativ: col(/ATIVIDADE/),
      inc: col(/LMI.*INCENDIO|^INCENDIO|^LMI$/), alu: col(/LMI.*ALUGUEL|PERDA DE ALUGUEL/),
      valorAluguel: col(/^VALOR (DO )?ALUGUEL/),
      de: col(/DANOS? ELETRICOS?/), ven: col(/VENDAVAL/), plano: col(/PLANO|ASSISTENCIA/),
    };
    for (const l of matriz.slice(iCab + 1)) {
      const doc = digitos(texto(l[c.doc]));
      if (!doc) continue;
      const v = (i: number) => (i >= 0 && texto(l[i]) !== "" && numero(l[i]) > 0 ? numero(l[i]) : null);
      let numeroImovel = c.num >= 0 ? texto(l[c.num]) : "";
      let complemento = c.comp >= 0 ? texto(l[c.comp]) : "";
      // "R SÃO PAULO 27/COB 01" → número 27, complemento COB 01
      if (!numeroImovel && c.end >= 0) {
        const m = texto(l[c.end]).match(/^.*?[\s,]+(\d+)\s*(?:[/-]\s*(.*))?$/);
        if (m) {
          numeroImovel = m[1];
          if (!complemento) complemento = (m[2] ?? "").trim();
        }
      }
      itens.push({
        documento: doc.replace(/^0+/, ""),
        numero: numeroImovel,
        complemento,
        valorAluguel: v(c.valorAluguel),
        cep: c.cep >= 0 ? digitos(texto(l[c.cep])) : "",
        apolice: c.apolice >= 0 ? digitos(texto(l[c.apolice])) : "",
        ocupacao: [c.ocup, c.ativ].filter((i) => i >= 0).map((i) => texto(l[i])).find(Boolean) ?? "",
        lmiIncendio: v(c.inc),
        lmiAluguel: v(c.alu),
        danosEletricos: v(c.de),
        vendaval: v(c.ven),
        plano: c.plano >= 0 ? texto(l[c.plano]) : "",
        arquivo: nomeArquivo,
      });
    }
  }
  return itens;
}

// Mesmo segurado (CPF/CNPJ) e mesmo imóvel (número + complemento; senão CEP +
// número; senão o CPF só tem um imóvel no histórico). O mesmo imóvel aparece em
// vários lotes (um por ano/versão): fica o mais recente que tem LMI — o nome do
// arquivo começa pela data de modificação no Drive (AAAA-MM-DD), então a ordem
// alfabética é a cronológica.
export function acharNoHistorico(hist: HistoricoItem[], documento: string, numeroImovel: string, complemento: string, cep: string) {
  const doc = documento.replace(/^0+/, "");
  const doCpf = hist.filter((h) => h.documento === doc && (h.lmiIncendio || h.valorAluguel));
  if (!doCpf.length) return null;
  // com LMI antes de só aluguel; depois o mais recente
  const maisRecente = (l: HistoricoItem[]) =>
    [...l].sort((a, b) => Number(!!b.lmiIncendio) - Number(!!a.lmiIncendio) || b.arquivo.localeCompare(a.arquivo))[0];
  const exato = doCpf.filter((h) => norm(h.numero) === norm(numeroImovel) && norm(h.complemento) === norm(complemento));
  if (exato.length) return { item: maisRecente(exato), como: "CPF + endereço" };
  const porCep = doCpf.filter((h) => cep && h.cep && h.cep.padStart(8, "0") === cep.padStart(8, "0") && norm(h.numero) === norm(numeroImovel));
  if (porCep.length) return { item: maisRecente(porCep), como: "CPF + CEP + número" };
  const imoveis = new Set(doCpf.map((h) => `${norm(h.numero)}|${norm(h.complemento)}`));
  if (imoveis.size === 1) return { item: maisRecente(doCpf), como: "único imóvel do CPF no histórico (conferir endereço)" };
  return null;
}

export type LinhaLote = { linha: LinhaSpecial; fonteEndereco: string; fonteLmi: string };

export function montarLinha(ap: ApoliceCorp, kamila: ItemRenovacao | undefined, pdf: DocumentoPdf | undefined, hist: HistoricoItem[]): LinhaLote {
  const obs: string[] = [];
  let end = { cep: "", logradouro: "", numero: "", complemento: "", bairro: "" };
  let fonteEndereco = "sem endereço";
  let ocupacao = "";
  let plano = "";
  if (kamila) {
    end = {
      cep: kamila.cepItem,
      logradouro: kamila.logradouroItem,
      numero: kamila.numeroImovel,
      complemento: kamila.complementoItem,
      bairro: kamila.bairroItem,
    };
    fonteEndereco = "Corp (itens)";
    ocupacao = kamila.observacao["Ocupação"] ?? kamila.atividade;
    plano = kamila.observacao["Assistência 24 Horas"] ?? "";
  } else if (pdf?.enderecoRisco) {
    const p = separarEndereco(pdf.enderecoRisco);
    end = { cep: "", ...p };
    fonteEndereco = "Corp (PDF — bairro pode vir abreviado, sem CEP)";
    ocupacao = pdf.atividade ?? "";
  }
  const achado = acharNoHistorico(hist, ap.documento, end.numero, end.complemento, end.cep);
  let lmiInc: number | "" = "";
  let lmiAlu: number | "" = "";
  let de: number | "" = "";
  let fonteLmi = "LMI a conferir";
  if (achado) {
    const h = achado.item;
    lmiInc = h.lmiIncendio ?? "";
    lmiAlu = h.lmiAluguel ?? "";
    de = h.danosEletricos ?? "";
    if (!ocupacao) ocupacao = h.ocupacao;
    if (!plano) plano = h.plano;
    fonteLmi = h.lmiIncendio ? `histórico (${achado.como}) — ${h.arquivo}` : "LMI a conferir";
    if (h.lmiIncendio && achado.como !== "CPF + endereço") obs.push(`LMI achado por ${achado.como} — conferir unidade`);
    if (h.valorAluguel) obs.push(`aluguel R$ ${h.valorAluguel.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} no lote anterior`);
    if (!h.lmiIncendio && kamila?.lmiCorp) { lmiInc = kamila.lmiCorp; fonteLmi = "Corp (Limite Máximo de Garantia da Yelum)"; }
    if (h.vendaval) obs.push(`vendaval ano anterior ${h.vendaval.toLocaleString("pt-BR")}`);
  } else if (kamila?.lmiCorp) {
    lmiInc = kamila.lmiCorp;
    fonteLmi = "Corp (Limite Máximo de Garantia da Yelum)";
  }
  if (fonteLmi === "LMI a conferir") obs.push("LMI a conferir");
  if (pdf?.parcelas) obs.push(`ano anterior em ${pdf.parcelas}x`);
  if (ap.canais.length) obs.push(`indicação ${ap.canais.join("/")}`);
  return {
    fonteEndereco,
    fonteLmi,
    linha: {
      STATUS: "AG COTAÇÃO",
      "FIM DE VIGÊNCIA": dataBr(ap.fimVigencia),
      APÓLICE: ap.apolice,
      "NOME DO LOCADOR": ap.cliente,
      "CPF / CNPJ": ap.documento,
      CEP: end.cep,
      ENDEREÇO: end.logradouro,
      Nº: end.numero,
      COMPLEMENTO: end.complemento,
      BAIRRO: end.bairro,
      OCUPAÇÃO: ocupacao.toUpperCase(),
      "LMI DE INCÊNDIO": lmiInc,
      "LMI DE ALUGUEL": lmiAlu,
      "DANOS ELÉTRICOS": de,
      PLANO: plano.toUpperCase(),
      "PARCELAS (X)": "",
      PARCELAS: "",
      "VALOR 2025": ap.premioTotal,
      "VALOR 2026": "",
      ORÇAMENTO: "",
      CM: ap.percentualComissao || "",
      RP: "",
      AGRAVO: "",
      OBS: obs.join("; "),
    },
  };
}

export function planilhaDoLote(linhas: LinhaSpecial[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(linhas, { header: [...COLUNAS_SPECIAL] });
  ws["!cols"] = COLUNAS_SPECIAL.map((c) => ({ wch: Math.min(45, Math.max(c.length, ...linhas.map((l) => String(l[c] ?? "").length)) + 2) }));
  ws["!autofilter"] = { ref: ws["!ref"]! };
  for (const [i, l] of linhas.entries()) {
    for (const c of ["LMI DE INCÊNDIO", "LMI DE ALUGUEL", "DANOS ELÉTRICOS", "VALOR 2025"] as const) {
      const ref = XLSX.utils.encode_cell({ r: i + 1, c: COLUNAS_SPECIAL.indexOf(c) });
      if (typeof l[c] === "number" && ws[ref]) ws[ref].z = "#,##0.00";
    }
  }
  XLSX.utils.book_append_sheet(wb, ws, "Página1");
  return wb;
}

export { lerObservacao };
