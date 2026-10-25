// ERP O2 — leitores fixos dos extratos de comissão em PDF baixados dos portais (pasta oficial
// "- RELATÓRIO COMISSÃO SEGURADORAS"). Exatos e sem custo de IA; a IA fica só para os formatos desconhecidos.
//   Tokio "Extrato do Corretor": Segurado | Negócio | Ramo | Apólice/Bilhete | Endosso | Tipo | Parc | Prêmio | Comissão % | Comissão R$
//   Porto "Analítico de Pagamentos de Comissões": Histórico | Marca | Suc. | Ramo | Apl/Prop. | Fat/Eds | Parc. | Carne | Data | Ordem |
//         Prêmio | Taxa | Comissão | Tipo (46-RESTITUICAO DE PREMIO = estorno, 45-COMISSAO FRACIONADA, 69-COMISSAO TOTAL…)
import type { LinhaExtrato } from "./extratos";

export type ExtratoPdf = { linhas: LinhaExtrato[]; total_bruto: number | null; total_liquido: number | null; pago_em: string | null; corretora_cnpj: string | null; numero?: string | null; cod_corretor?: string | null };

// O portal da Tokio exporta UM PDF com todos os extratos do período ("Exportar em PDF"); cada extrato começa em
// "Extrato do Corretor Extrato nº N". Divide e lê cada um (cada extrato = um pagamento, com sua data de crédito).
export function parseTokioPdfVarios(texto: string): ExtratoPdf[] {
  const blocos = texto.split(/(?=Extrato do Corretor\s+Extrato n[ºo°])/i).filter((b) => /Extrato n[ºo°]/i.test(b));
  return blocos.map((b) => parseTokioPdf(b)).filter((x): x is ExtratoPdf => x !== null);
}

const valor = (s: string, neg = false) => {
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? (neg && n > 0 ? -n : n) : null;
};
const dataBr = (s: string | undefined) => (s ? s.split("/").reverse().join("-") : null);
const soma = (ls: LinhaExtrato[]) => Math.round(ls.reduce((t, l) => t + (l.valor_comissao ?? 0), 0) * 100) / 100;

// Nome do segurado pode quebrar em 2–3 linhas antes da linha com os números.
function linhasDoTexto(texto: string) {
  return texto.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
}

const RE_TOKIO = /^(.*?)\s*(\d+) ([A-ZÀ-Ú][A-ZÀ-Ú0-9\/ .-]*?) (\d+) (\d+) ([A-ZÀ-Ú][A-ZÀ-Ú ]*?) (\d+)\/(\d+) (-?)R\$ ?(-?[\d.]+,\d{2}) ([\d.]+,\d{2})% (-?)R\$ ?(-?[\d.]+,\d{2})$/;

export function parseTokioPdf(texto: string): ExtratoPdf | null {
  if (!/Extrato do Corretor/i.test(texto) || !/Apolice \/ Bilhete/i.test(texto)) return null;
  const linhas: LinhaExtrato[] = [];
  let nomePendente: string[] = [];
  let dentro = false;
  for (const l of linhasDoTexto(texto)) {
    if (/^Segurado Neg[oó]cio Ramo/i.test(l)) { dentro = true; nomePendente = []; continue; }
    if (!dentro) continue;
    if (/^P[aá]gina \d+ de \d+$/i.test(l) || /^Extrato do Corretor/i.test(l)) { nomePendente = []; continue; }
    // Nome e ramo ("TOKIO MARINE / ALUGUEL") podem quebrar linha: testa a linha junto com as pendentes.
    nomePendente.push(l);
    const m = RE_TOKIO.exec(nomePendente.join(" "));
    if (!m) continue;
    const [, nome, negocio, ramo, apolice, endosso, tipo, parc, , negP, premio, pct, negC, com] = m;
    const cliente = nome.trim() || null;
    nomePendente = [];
    linhas.push({
      n: linhas.length + 1, tipo: tipo.trim(), apolice, proposta: negocio !== "0" ? negocio : null, endosso: endosso !== "0" ? endosso : null,
      parcela: Number(parc), cliente, cpf_cnpj: null, premio: valor(premio, negP === "-"), pct_comissao: valor(pct),
      valor_comissao: valor(com, negC === "-"), vigencia_inicio: null, produto: ramo.trim(),
    });
  }
  if (!linhas.length) return null;
  // Cabeçalho: "20/08/2026 R$ 754,21" = data de crédito + total bruto; última "R$ x" antes da tabela = líquido.
  const cab = texto.split(/Segurado Neg[oó]cio Ramo/i)[0];
  const credito = /(\d{2}\/\d{2}\/\d{4}) R\$ ?([\d.]+,\d{2})/.exec(cab);
  const valoresCab = [...cab.matchAll(/(-?)R\$ ?([\d.]+,\d{2})/g)];
  const liquido = valoresCab.length ? valor(valoresCab[valoresCab.length - 1][2]) : null;
  const cnpj = /CPF\/CNPJ: ([\d./-]+)/.exec(cab)?.[1]?.replace(/\D/g, "") ?? null;
  const numero = /Extrato n[ºo°]\s*(\d+)/i.exec(cab)?.[1] ?? null;
  const codCorretor = /Cod\. Corretor:\s*(\d+)/i.exec(cab)?.[1]?.replace(/^0+/, "") ?? null;
  return { linhas, total_bruto: credito ? valor(credito[2]) : soma(linhas), total_liquido: liquido, pago_em: dataBr(credito?.[1]), corretora_cnpj: cnpj, numero, cod_corretor: codCorretor };
}

// No texto extraído a coluna Marca sai grudada no fim do Tipo ("46-RESTITUICAO DE PREMIOPorto").
// Venda avulsa de cartão não tem Apl/Prop: entre Ramo e Data vêm de 1 a 4 campos (Apl/Prop, Fat/Eds, Parc., Carne).
const RE_PORTO = /^(.*?) (\d+) (\d+) ((?:\S+ ){1,4})(\d{4}-\d{2}-\d{2})(?: (\d+))? (-?[\d.]+,\d{2}) (-?[\d.]+,\d{2}) (-?[\d.]+,\d{2}) (\d+-.+)$/;
const MARCAS = /(PortoCap|Porto|Azul|Ita[uú]|Mitsui|Cr[eé]dito)$/;

export function parsePortoPdf(texto: string): ExtratoPdf | null {
  if (!/PAGAMENTOS DE COMISS/i.test(texto) || !/Apl\/Prop/i.test(texto)) return null;
  const linhas: LinhaExtrato[] = [];
  let nomePendente: string[] = [];
  let dentro = false;
  for (const l of linhasDoTexto(texto)) {
    if (/Apl\/Prop/i.test(l)) { dentro = true; nomePendente = []; continue; }
    if (/^Valor$/i.test(l) || /^Comiss[aã]oTaxa/i.test(l)) continue;
    if (/^Total /i.test(l) || /^Susep Produ/i.test(l) || /^Comiss[aã]o Bruta/i.test(l)) { dentro = /^Susep Produ/i.test(l) ? dentro : false; nomePendente = []; continue; }
    if (!dentro) continue;
    nomePendente.push(l);
    const m = RE_PORTO.exec(nomePendente.join(" "));
    if (!m) continue;
    const [, nome, , ramo, meio, , , premio, taxa, com, tipoMarca] = m;
    const campos = meio.trim().split(" ");
    const [apl, eds, parc] = campos.length === 4 ? campos : [null, null, null];
    const marca = MARCAS.exec(tipoMarca)?.[1] ?? "";
    const tipo = marca ? tipoMarca.slice(0, -marca.length) : tipoMarca;
    const cliente = nome.trim() || null;
    nomePendente = [];
    linhas.push({
      n: linhas.length + 1, tipo: tipo.trim(), apolice: apl, proposta: null, endosso: eds && eds !== "0" ? eds : null,
      parcela: Number(parc) || (apl && /TOTAL/i.test(tipo) ? 1 : null), cliente, cpf_cnpj: null, premio: valor(premio), pct_comissao: valor(taxa),
      valor_comissao: valor(com), vigencia_inicio: null /* "Data" da linha = data do pagamento, não vigência */, produto: `${marca || "Porto"} ramo ${ramo}`,
    });
  }
  if (!linhas.length) return null;
  // Rodapé "Total Susep Favorecida": Comissão Bruta | INSS | IRRF | ISS | Líquido | Débito/Crédito | A pagar (o último bloco vale).
  const rodapes = [...texto.matchAll(/Comiss[aã]o Bruta INSS IRRF ISS L[ií]quido D[eé]bito\/Cr[eé]dito A pagar\s+((?:-?[\d.]+,\d{2}\s*){7})/gi)];
  const ult = rodapes.length ? rodapes[rodapes.length - 1][1].trim().split(/\s+/) : null;
  const pago = /(\d{2}\/\d{2}\/\d{4})/.exec(texto)?.[1];
  return {
    linhas, total_bruto: ult ? valor(ult[0]) : soma(linhas), total_liquido: ult ? valor(ult[6]) : null, pago_em: dataBr(pago),
    corretora_cnpj: /O2 CAPITALIZA/i.test(texto) ? "54493758000138" : /O2 CORRETORA/i.test(texto) ? "20001784000180" : null,
  };
}

// Porto — "Gerar planilha no formato XLS" de cada pagamento (Comissões → Consulta Pagamentos e Pendências → Pagamentos):
// na verdade é uma tabela HTML (latin1) com as mesmas colunas do Analítico em PDF. Linha de dados = 13 células
// (Histórico, Marca, Suc., Ramo, Apl/Prop, Fat/Eds, Parc., Carne, Data, Prêmio Líq., Taxa, Comissão, Tipo); premiação
// "Programa Super" e venda avulsa vêm com menos células (sem Apl/Prop). Rodapé por favorecida: Bruta|INSS|IRRF|ISS|Líquido|Déb/Créd|A pagar.
export function parsePortoHtml(html: string): ExtratoPdf | null {
  const limpa = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  const trs = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => limpa(c[1])));
  if (!trs.some((r) => r.some((c) => /Anal[ií]tico dos Pagamentos de Comiss/i.test(c)))) return null;
  const valorDe = (rotulo: RegExp) => { for (const r of trs) { const i = r.findIndex((c) => rotulo.test(c)); if (i >= 0 && r[i + 1]) return r[i + 1]; } return null; };
  const linhas: LinhaExtrato[] = [];
  let ultimoRodape: string[] | null = null;
  for (const [k, r] of trs.entries()) {
    if (r[0] === "Comissão Bruta" || r[0] === "Comissao Bruta") { const v = trs[k + 1]; if (v && v.length >= 7) ultimoRodape = v; continue; }
    const iData = r.findIndex((c) => /^\d{4}-\d{2}-\d{2}$/.test(c));
    if (iData < 2 || r.length < iData + 5) continue;
    const antes = r.slice(0, iData);
    const [premio, taxa, com] = r.slice(iData + 1, iData + 4);
    const tipo = r.slice(iData + 4).join(" ");
    const completa = antes.length >= 8;
    const [hist, marca, , ramo, apl, eds, parc] = completa ? antes : [antes[0], "", "", antes[2] ?? "", null, null, null];
    linhas.push({
      n: linhas.length + 1, tipo, apolice: apl && apl !== "0/0" ? apl.replace(/\s/g, "") : null, proposta: null, endosso: eds && eds !== "0" ? eds : null,
      parcela: Number(parc) || (apl && /TOTAL/i.test(tipo) ? 1 : null), cliente: hist || null, cpf_cnpj: null,
      premio: valor(premio), pct_comissao: valor(taxa), valor_comissao: valor(com), vigencia_inicio: null, produto: `${marca || "Porto"} ramo ${ramo}`,
    });
  }
  if (!linhas.length) return null;
  const fav = valorDe(/Susep Favorecida/i) ?? "";
  return {
    linhas, total_bruto: ultimoRodape ? valor(ultimoRodape[0]) : soma(linhas), total_liquido: ultimoRodape ? valor(ultimoRodape[6]) : null,
    pago_em: dataBr(valorDe(/Data de Pagamento/i) ?? undefined), numero: valorDe(/Ordem de Pagamento/i), cod_corretor: fav.split(/\s|-/)[0] || null,
    corretora_cnpj: /CAPITALIZA/i.test(fav) ? "54493758000138" : /CORRETORA/i.test(fav) ? "20001784000180" : null,
  };
}
