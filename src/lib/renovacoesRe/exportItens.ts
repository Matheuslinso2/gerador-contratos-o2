import * as XLSX from "xlsx";

// Robô de renovações de Ramos Elementares (reunião Kamila × Matheus, 22/10/2026).
// Lê o Excel "Exporta itens pacote" do Corp (1 linha = 1 apólice/item que vence
// no mês) e agrupa nos cards do funil Renovações (SPA 1046, categoria 34):
//  - IMOBILIÁRIO: 1 card por imobiliária + seguradora, com os itens dentro;
//  - RESIDENCIAL e EMPRESARIAL: 1 card por apólice.
// Fase 1 = só leitura e prévia; nada vai para o Bitrix daqui.

export type ProdutoRenovacao = "imobiliario" | "residencial" | "empresarial" | "outro";

export type ItemRenovacao = {
  linha: number; // linha no Excel (cabeçalho = 1)
  nossoNumero: string;
  apolice: string;
  produto: ProdutoRenovacao;
  ramo: string;
  seguradora: string;
  inicioVigencia: string | null; // AAAA-MM-DD
  fimVigencia: string | null;
  premioLiquido: number;
  premioTotal: number;
  percentualComissao: number;
  valorComissao: number;
  cliente: string;
  clienteDocumento: string;
  proprietario: string;
  proprietarioDocumento: string;
  numeroItem: string;
  enderecoItem: string;
  logradouroItem: string;
  numeroImovel: string;
  complementoItem: string;
  bairroItem: string;
  cepItem: string;
  cidadeItem: string;
  atividade: string;
  // Observação do item, aberta em campos. Yelum traz LMI e ocupação; Tokio traz
  // assistência, tipo de cobertura e % prédio/conteúdo (sem LMI); Porto vem vazio.
  observacao: Record<string, string>;
  lmiCorp: number | null;
  produtores: string[]; // como estão no Corp, na ordem
  imobiliaria: string | null; // produtor que é imobiliária (sem o prefixo "IMOB - ")
  canais: string[]; // sistemas parceiros que só indicam (Segimob, Superlógica…)
  renovadoNoCorp: boolean;
  endossos: number;
  alertas: string[];
};

export type CardRenovacao = {
  chave: string;
  produto: ProdutoRenovacao;
  imobiliaria: string | null;
  seguradora: string;
  mes: string; // AAAA-MM do fim da vigência
  titulo: string;
  itens: ItemRenovacao[];
  premioTotalAnterior: number;
  comissaoAnterior: number;
  itensComLmiCorp: number;
  alertas: string[];
};

// Regra do Matheus (18/10 e 22/10/2026): sistemas parceiros que indicam a
// imobiliária (Segimob, Superlógica, Sohtec, Base Software) entram no Corp como
// produtor só para identificação — a produção é da imobiliária. O2 Corretora,
// Retransmissão e Tombamento também nunca são imobiliária. Mesma lista de
// escolherProdutor() da base única, acrescida da Sohtec.
const CANAL = /^(SEGIMOB|BASE SOFTWARE|SUPERLOGICA|SOHTEC)\b/;
const NAO_IMOBILIARIA = /^(O2 CORRETORA|O2 SEGUROS|SEGIMOB|BASE SOFTWARE|SUPERLOGICA|SOHTEC|RETRANSMISS|TOMBAMENTO)\b/;

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
const texto = (v: unknown) => String(v ?? "").trim();
const numero = (v: unknown) => (typeof v === "number" ? v : Number(texto(v).replace(/\./g, "").replace(",", ".")) || 0);
const semPrefixoImob = (p: string) => p.replace(/^IMOB\s*-\s*/i, "").trim();

function data(v: unknown): string | null {
  if (typeof v === "number" && v > 0) return new Date(Date.UTC(1899, 11, 30) + v * 864e5).toISOString().slice(0, 10);
  const m = texto(v).match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export function produtoDoRamo(ramo: string): ProdutoRenovacao {
  const r = semAcento(ramo);
  if (/IMOBILIARIO/.test(r)) return "imobiliario";
  if (/RESIDENCIAL/.test(r)) return "residencial";
  if (/EMPRESARIAL/.test(r)) return "empresarial";
  return "outro";
}

export function lerObservacao(obs: string): Record<string, string> {
  const campos: Record<string, string> = {};
  for (const linha of obs.split(/\r\n|\r|\n/)) {
    const i = linha.indexOf(":");
    if (i <= 0) continue;
    const chave = linha.slice(0, i).trim();
    const valor = linha.slice(i + 1).trim();
    if (chave && valor) campos[chave] = valor;
  }
  return campos;
}

function lmiDaObservacao(obs: Record<string, string>): number | null {
  const chave = Object.keys(obs).find((k) => /LIMITE M[AÁ]XIMO|^LMI\b/i.test(k));
  if (!chave) return null;
  const v = numero(obs[chave]);
  return v > 0 ? v : null;
}

export function escolherImobiliaria(produtores: string[]) {
  const nomes = produtores.map(semPrefixoImob).filter(Boolean);
  const canais = nomes.filter((n) => CANAL.test(semAcento(n)));
  const imobs = nomes.filter((n) => !NAO_IMOBILIARIA.test(semAcento(n)));
  return { imobiliaria: imobs[0] ?? null, canais, outrasImobiliarias: imobs.slice(1) };
}

export function lerExportItens(arquivo: Buffer): ItemRenovacao[] {
  const wb = XLSX.read(arquivo, { type: "buffer" });
  const linhas = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
  const faltando = ["Apólice", "Fim Vig.", "Seguradora", "Ramo", "Agente - Produtor"].filter((c) => linhas.length && !(c in linhas[0]));
  if (faltando.length) throw new Error(`Colunas que o robô precisa e não estão no Excel: ${faltando.join(", ")}`);

  return linhas.map((l, i) => {
    const produtores = Object.keys(l)
      .filter((k) => /^Agente - Produtor/.test(k))
      .map((k) => texto(l[k]))
      .filter(Boolean);
    const { imobiliaria, canais, outrasImobiliarias } = escolherImobiliaria(produtores);
    const observacao = lerObservacao(texto(l["Obs. - Item"]));
    const inicio = data(l["Início Vig."]);
    const fim = data(l["Fim Vig."]);
    const endereco = [texto(l["Logradouro - Item"]), texto(l["Número - Item"]), texto(l["Complemento - Item"]), texto(l["Bairro - Item"])]
      .filter(Boolean)
      .join(", ");
    const item: ItemRenovacao = {
      linha: i + 2,
      nossoNumero: texto(l["Nosso Nº"]),
      apolice: texto(l["Apólice"]),
      produto: produtoDoRamo(texto(l["Ramo"])),
      ramo: texto(l["Ramo"]),
      seguradora: texto(l["Seguradora"]),
      inicioVigencia: inicio,
      fimVigencia: fim,
      premioLiquido: numero(l["Pr. Líquido"]),
      premioTotal: numero(l["Pr. Total"]),
      percentualComissao: numero(l["% Comissão"]),
      valorComissao: numero(l["Vl. Comissão"]),
      cliente: texto(l["Cliente"]),
      clienteDocumento: texto(l["CPF/CNPJ"]),
      proprietario: texto(l["Proprietário - Item"]),
      proprietarioDocumento: texto(l["CPF/CNPJ - Item"]),
      numeroItem: texto(l["Item"]),
      enderecoItem: endereco,
      logradouroItem: texto(l["Logradouro - Item"]),
      numeroImovel: texto(l["Número - Item"]),
      complementoItem: texto(l["Complemento - Item"]),
      bairroItem: texto(l["Bairro - Item"]),
      cepItem: texto(l["CEP - Item"]),
      cidadeItem: [texto(l["Cidade - Item"]), texto(l["Estado - Item"])].filter(Boolean).join("/"),
      atividade: texto(l["Atividade"]),
      observacao,
      lmiCorp: lmiDaObservacao(observacao),
      produtores,
      imobiliaria,
      canais,
      renovadoNoCorp: /^S/i.test(texto(l["Renovado"])),
      endossos: numero(l["Endossos"]),
      alertas: [],
    };
    // Decisão do Matheus (22/10, item 7): casos especiais viram card normalmente;
    // os alertas só aparecem na prévia e no comentário do card.
    if (!imobiliaria) item.alertas.push("sem imobiliária no Corp (só sistema parceiro/O2)");
    if (outrasImobiliarias.length) item.alertas.push(`mais de uma imobiliária no Corp: ${[imobiliaria, ...outrasImobiliarias].join(" / ")}`);
    if (imobiliaria && /INATIV/i.test(imobiliaria)) item.alertas.push("imobiliária marcada INATIVO no Corp");
    if (item.renovadoNoCorp) item.alertas.push("Corp já marca como renovado");
    if (inicio && fim && (Date.parse(fim) - Date.parse(inicio)) / 864e5 < 330) item.alertas.push("vigência menor que 1 ano");
    if (item.endossos > 0) item.alertas.push(`${item.endossos} endosso(s) na apólice`);
    if (!item.fimVigencia) item.alertas.push("sem fim de vigência");
    return item;
  });
}

const SEGURADORA_CURTA: [RegExp, string][] = [
  [/TOKIO/i, "TOKIO"],
  [/YELUM|LIBERTY SEG/i, "YELUM"],
  [/PORTO/i, "PORTO"],
  [/ALLIANZ/i, "ALLIANZ"],
  [/MAPFRE/i, "MAPFRE"],
  [/HDI/i, "HDI"],
  [/SURA/i, "SURA"],
];
export const seguradoraCurta = (s: string) => SEGURADORA_CURTA.find(([r]) => r.test(s))?.[1] ?? s.toUpperCase();

// Padrão de título que a equipe já usa no funil (ex.: "RENOVAÇÃO - RIO CAPITAL
// IMOBILIÁRIA - TOKIO - 10.2026").
function titulo(c: Omit<CardRenovacao, "titulo">) {
  const mes = c.mes ? `${c.mes.slice(5, 7)}.${c.mes.slice(0, 4)}` : "";
  const imob = c.imobiliaria ?? "SEM IMOBILIÁRIA";
  if (c.produto === "imobiliario") {
    const lote = c.itens.length > 1 ? ` - ${c.itens.length} ITENS` : "";
    return `RENOVAÇÃO - ${imob} - ${seguradoraCurta(c.seguradora)} - ${mes}${lote}`;
  }
  const item = c.itens[0];
  return `RENOVAÇÃO - ${item.cliente} - ${imob} - ${seguradoraCurta(c.seguradora)} - ${mes}`;
}

export function agruparEmCards(itens: ItemRenovacao[]): CardRenovacao[] {
  const grupos = new Map<string, ItemRenovacao[]>();
  for (const it of itens) {
    const mes = (it.fimVigencia ?? "").slice(0, 7);
    const chave =
      it.produto === "imobiliario"
        ? `imobiliario|${mes}|${semAcento(it.imobiliaria ?? "-")}|${seguradoraCurta(it.seguradora)}`
        : `${it.produto}|${mes}|apolice ${it.apolice}`;
    grupos.set(chave, [...(grupos.get(chave) ?? []), it]);
  }
  return [...grupos.entries()]
    .map(([chave, its]) => {
      const base = {
        chave,
        produto: its[0].produto,
        imobiliaria: its[0].imobiliaria,
        seguradora: its[0].seguradora,
        mes: (its[0].fimVigencia ?? "").slice(0, 7),
        itens: its,
        premioTotalAnterior: its.reduce((s, i) => s + i.premioTotal, 0),
        comissaoAnterior: its.reduce((s, i) => s + i.valorComissao, 0),
        itensComLmiCorp: its.filter((i) => i.lmiCorp != null).length,
        alertas: [...new Set(its.flatMap((i) => i.alertas.map((a) => (/endosso/.test(a) ? "endosso(s) em itens" : a))))],
      };
      return { ...base, titulo: titulo(base) };
    })
    .sort((a, b) => b.itens.length - a.itens.length || a.titulo.localeCompare(b.titulo));
}
