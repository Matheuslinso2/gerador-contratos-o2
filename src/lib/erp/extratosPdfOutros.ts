// ERP O2 — leitores fixos (sem IA) dos extratos de comissão em PDF das seguradoras que ainda não tinham leitor (01/11/2026):
// Brasilcap (portal antigo), Tokio "Extrato do Corretor", Allianz, Icatu (extrato analítico), Too (demonstrativo de corretagem),
// Alfa (demonstrativo de agenciamento/comissões), Zurich e Suhai. Cada um devolve as linhas e os totais impressos no extrato,
// para conferir soma × total. Formato não reconhecido → null.
import type { LinhaExtrato } from "./extratos";

export type ExtratoLido = { leitor: string; linhas: LinhaExtrato[]; total_bruto: number | null; total_liquido: number | null };

const br = (s: string) => Number(s.replace(/R\$\s*/g, "").replace(/\s/g, "").replace(/\./g, "").replace(",", "."));
const pt = (s: string) => Number(s.replace(/,/g, "")); // número com ponto decimal (Allianz)
const iso = (s: string) => { const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(s); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const um = (t: string) => t.replace(/\s+/g, " ").trim();
const linha = (n: number, l: Partial<LinhaExtrato>): LinhaExtrato => ({
  n, apolice: null, proposta: null, endosso: null, parcela: null, cliente: null, cpf_cnpj: null, premio: null, pct_comissao: null,
  valor_comissao: null, vigencia_inicio: null, produto: null, tipo: null, ...l,
});

// Brasilcap — "Relatório Analítico - Remessa": Data Produto TipoEvento Proposta / Caução Parcela Valor Comissão Total % Comissão Bruta
function brasilcap(texto: string): ExtratoLido | null {
  if (!/Brasilcap/i.test(texto) || !/Relat[oó]rio Anal[ií]tico/i.test(texto)) return null;
  const t = um(texto);
  const linhas: LinhaExtrato[] = [];
  const re = /(\d{2}\/\d{2}\/\d{4}) (\S+) ([A-Z]) (\d+) ?\/ ?(\d+) (\d+) R\$ ?(-?[\d.]+,\d{2}) R\$ ?(-?[\d.]+,\d{2}) (\d+(?:,\d+)?) R\$ ?(-?[\d.]+,\d{2})/g;
  for (const m of t.matchAll(re)) {
    linhas.push(linha(linhas.length + 1, { proposta: m[4], apolice: m[4], parcela: Number(m[6]), premio: br(m[7]), pct_comissao: br(m[9]),
      valor_comissao: br(m[10]), produto: m[2], tipo: m[3] === "E" ? "estorno" : "comissao", vigencia_inicio: null, cpf_cnpj: null,
      endosso: null, cliente: null } as Partial<LinhaExtrato>));
    (linhas[linhas.length - 1] as any).extras = { data_evento: iso(m[1]), caucao: m[5], comissao_total: br(m[8]), tipo_evento: m[3] };
  }
  const tot = /Total L[ií]quido R\$ ?(-?[\d.]+,\d{2}) R\$ ?(-?[\d.]+,\d{2}) R\$ ?(-?[\d.]+,\d{2}) R\$ ?(-?[\d.]+,\d{2}) R\$ ?(-?[\d.]+,\d{2}) R\$ ?(-?[\d.]+,\d{2})/.exec(t);
  return { leitor: "leitor Brasilcap (PDF)", linhas, total_bruto: tot ? br(tot[3]) : null, total_liquido: tot ? br(tot[6]) : null };
}

// Tokio — "Extrato do Corretor": Segurado Negócio Ramo Apólice/Bilhete Endosso Tipo Parc Prêmio Comissão(%) Comissão(R$)
function tokioCorretor(texto: string): ExtratoLido | null {
  if (!/Extrato do Corretor/i.test(texto) || !/Apolice \/ Bilhete/i.test(texto)) return null;
  const t = um(texto);
  const ini = t.search(/Comiss[aã]o \(R\$\)/);
  const corpo = ini >= 0 ? t.slice(ini).replace(/^Comiss[aã]o \(R\$\) ?/, "") : t;
  const re = /(\d{6,12}) ([A-ZÀ-Ú][A-ZÀ-Ú .\/-]*?) (\d{3,}) (\d+) ([A-ZÀ-Ú][A-ZÀ-Ú ]*?) (\d+)\/(\d+) (-?)R\$ ?(-?[\d.]+,\d{2}) (\d+(?:,\d+)?)% (-?)R\$ ?(-?[\d.]+,\d{2})/g;
  const linhas: LinhaExtrato[] = [];
  let fim = 0;
  for (const m of corpo.matchAll(re)) {
    const segurado = corpo.slice(fim, m.index).replace(/P[aá]gina \d+ de \d+/g, "").trim();
    fim = (m.index ?? 0) + m[0].length;
    const l = linha(linhas.length + 1, { cliente: segurado || null, produto: m[2].trim(), apolice: m[3], endosso: m[4] === "0" ? null : m[4],
      tipo: m[5].trim().toLowerCase(), parcela: Number(m[6]), premio: (m[8] ? -1 : 1) * br(m[9]), pct_comissao: br(m[10]),
      valor_comissao: (m[11] ? -1 : 1) * br(m[12]) });
    (l as any).extras = { negocio: m[1], parcelas_total: Number(m[7]) };
    linhas.push(l);
  }
  // lançamento fora de apólice (premiação/campanha, ex.: "0 GANHE MAIS null/null R$ 0,00 null% R$ 641,71")
  for (const m of corpo.matchAll(/(?:^| )(\d+) ([A-ZÀ-Ú][A-ZÀ-Ú ]*?) null\/null (-?)R\$ ?([\d.]+,\d{2}) null% (-?)R\$ ?([\d.]+,\d{2})/g)) {
    const l = linha(linhas.length + 1, { cliente: null, produto: m[2].trim(), apolice: null, tipo: "fora_apolice", premio: (m[3] ? -1 : 1) * br(m[4]),
      valor_comissao: (m[5] ? -1 : 1) * br(m[6]) });
    (l as any).extras = { negocio: m[1], descricao: m[2].trim() };
    linhas.push(l);
  }
  // bloco de totais: "<data crédito> R$ <bruta> ... R$ <líquida>" antes da tabela
  const cab = t.slice(0, ini >= 0 ? ini : t.length);
  const b = /Total Comiss[aã]o L[ií]quida (\d{2}\/\d{2}\/\d{4}) R\$ ?(-?[\d.]+,\d{2})/.exec(cab);
  const valores = [...cab.matchAll(/(-?)R\$ ?([\d.]+,\d{2})/g)];
  const liquida = valores.length ? (valores[valores.length - 1][1] ? -1 : 1) * br(valores[valores.length - 1][2]) : null;
  return { leitor: "leitor Tokio Extrato do Corretor (PDF)", linhas, total_bruto: b ? br(b[2]) : null, total_liquido: liquida };
}

// Allianz — "EXTRATO DE COMISSÕES PAGAS POR SUSEP" (ponto como decimal)
function allianz(texto: string): ExtratoLido | null {
  if (!/Allianz/i.test(texto) || !/EXTRATO DE COMISS/i.test(texto)) return null;
  const linhas: LinhaExtrato[] = [];
  const re = /^(\d{2}\/\d{2}\/\d{4}) (\d+) (\S{12,}) (\d{6,}) (?:(\d{6}) )?(\d{6,}) (\d+)\/(\d+) O2 CORRETORA DE SEGUROS LTDA (.+?) (\d+ - .+?) (-?[\d,]*\.?\d+) (-?\d+(?:\.\d+)?)% (-?[\d,]*\.?\d+) ([SN])$/;
  for (const bruta of texto.split(/\r?\n/)) {
    const m = re.exec(um(bruta));
    if (!m) continue;
    const l = linha(linhas.length + 1, { apolice: m[4], endosso: m[5] ?? null, parcela: Number(m[7]), cliente: m[9], produto: m[10],
      premio: pt(m[11]), pct_comissao: Number(m[12]), valor_comissao: pt(m[13]), tipo: m[14] === "S" ? "antecipada" : "comissao" });
    (l as any).extras = { data_pagto: iso(m[1]), mediador: m[2], apolice_susep: m[3], recibo: m[6], parcelas_total: Number(m[8]) };
    linhas.push(l);
  }
  const b = /Total Bruto: ?(-?[\d,]*\.?\d+)/.exec(texto), lq = /Total L[ií]quido: ?(-?[\d,]*\.?\d+)/.exec(texto);
  return { leitor: "leitor Allianz (PDF)", linhas, total_bruto: b ? pt(b[1]) : null, total_liquido: lq ? pt(lq[1]) : null };
}

// Icatu — "Extrato analítico individual": ... <data pagto><proposta><parcela> <vencimento>R$ <base><%>% R$ <comissão>
function icatu(texto: string): ExtratoLido | null {
  if (!/Extrato anal[ií]tico/i.test(texto) || !/Icatu|Ponto\s+de Venda/i.test(texto)) return null;
  const t = um(texto);
  const re = /(\d{2}\/\d{2}\/\d{4})(\d{6,}) (\d{2}\/\d{2}\/\d{4}) ?R\$ ?([\d.]+,\d{2})(\d+(?:[.,]\d+)?)% ?R\$ ?(-?[\d.]+,\d{2})/g;
  const linhas: LinhaExtrato[] = [];
  let fim = t.search(/tribut[aá]rio, nos termos da legisla[cç][aã]o em vigor\.?/i);
  fim = fim >= 0 ? t.indexOf(".", fim) + 1 : 0;
  for (const m of t.matchAll(re)) {
    const antes = t.slice(fim, m.index).trim();
    fim = (m.index ?? 0) + m[0].length;
    const cod = /^(.*?) (PU\S+|\S*\d\S*) (.*)$/.exec(antes);
    // proposta + parcela vêm colados; Icatu Cap é pagamento único (parcela 1) — só separa quando termina em 1 e tem 12 dígitos
    const dig = m[2];
    const separa = dig.length === 12 && dig.endsWith("1");
    const l = linha(linhas.length + 1, { cliente: cod ? cod[1] : antes || null, produto: cod ? cod[2] : null, proposta: separa ? dig.slice(0, -1) : dig,
      apolice: separa ? dig.slice(0, -1) : dig, parcela: separa ? 1 : null, premio: br(m[4]), pct_comissao: Number(m[5].replace(",", ".")), valor_comissao: br(m[6]) });
    (l as any).extras = { data_pagamento: iso(m[1]), vencimento: iso(m[3]), ponto_venda: cod ? cod[3] : null, proposta_parcela_bruto: dig };
    linhas.push(l);
  }
  const tot = /Valor total R\$ ?([\d.]+,\d{2}) R\$ ?(-?[\d.]+,\d{2})/.exec(t);
  return { leitor: "leitor Icatu (PDF)", linhas, total_bruto: tot ? br(tot[2]) : null, total_liquido: tot ? br(tot[2]) : null };
}

// Too — "Demonstrativo de Corretagem": Apólice Produto Endosso Parcela Data Tomador Prêmios % Valor
function too(texto: string): ExtratoLido | null {
  if (!/Demonstrativo de Corretagem/i.test(texto)) return null;
  const linhas: LinhaExtrato[] = [];
  const re = /^(\d{10,}) (.+?) (\d+) (\d+) (\d{2}\/\d{2}\/\d{4}) (.+?) (-?)R\$ ?([\d.]+,\d{2}) (\d+(?:,\d+)?) (-?)R\$ ?([\d.]+,\d{2})$/;
  for (const bruta of texto.split(/\r?\n/)) {
    const m = re.exec(um(bruta));
    if (!m) continue;
    const l = linha(linhas.length + 1, { apolice: m[1], produto: m[2], endosso: m[3] === "0" ? null : m[3], parcela: Number(m[4]), cliente: m[6],
      premio: (m[7] ? -1 : 1) * br(m[8]), pct_comissao: br(m[9]), valor_comissao: (m[10] ? -1 : 1) * br(m[11]) });
    (l as any).extras = { data_pagamento: iso(m[5]) };
    linhas.push(l);
  }
  const b = /Comiss[aã]o Total (-?)R\$ ?([\d.]+,\d{2})/.exec(texto), lq = /L[ií]quido (-?)R\$ ?([\d.]+,\d{2})/.exec(texto);
  return { leitor: "leitor Too demonstrativo (PDF)", linhas, total_bruto: b ? (b[1] ? -1 : 1) * br(b[2]) : null, total_liquido: lq ? (lq[1] ? -1 : 1) * br(lq[2]) : null };
}

// Alfa — "Demonstrativo de Agenciamento/Comissões": Ramo Documento PR Nome %Com Prêm.Liq. Comissão L
function alfa(texto: string): ExtratoLido | null {
  if (!/Demonstrativo de Agenciamento/i.test(texto)) return null;
  const linhas: LinhaExtrato[] = [];
  const re = /^(\S+) (\d+\/\d+\/\d+\/\d+) (\d+)\/(\d+) (.+?) (\d+,\d{2,4}) (-?[\d.]+,\d{2}) (-?[\d.]+,\d{2}) (\d)$/;
  const TIPO: Record<string, string> = { "1": "pagamento", "2": "antecipacao", "3": "endosso_devolucao", "4": "cancelamento", "5": "reativacao", "6": "estorno_parcela", "7": "amortizacao", "8": "movimento_manual" };
  for (const bruta of texto.split(/\r?\n/)) {
    const m = re.exec(um(bruta));
    if (!m) continue;
    const l = linha(linhas.length + 1, { produto: m[1], apolice: m[2], parcela: Number(m[3]), cliente: m[5], pct_comissao: br(m[6]), premio: br(m[7]),
      valor_comissao: br(m[8]), tipo: TIPO[m[9]] ?? m[9] });
    (l as any).extras = { parcelas_total: Number(m[4]), tipo_lancamento: m[9] };
    linhas.push(l);
  }
  const b = /Total Comiss[aã]o (-?[\d.]+,\d{2})/.exec(texto), lq = /Valor a Pagar\s+(-?[\d.]+,\d{2})/.exec(texto);
  return { leitor: "leitor Alfa (PDF)", linhas, total_bruto: b ? br(b[1]) : null, total_liquido: lq ? br(lq[1]) : null };
}

// Zurich — "Extrato de Comissões": SUB COD CARTEIRA APÓLICE END PARC NOME PRÊMIO % COMISSÃO TIPO NAT
function zurich(texto: string): ExtratoLido | null {
  if (!/Extrato de Comiss/i.test(texto) || !/Zurich|DETALHAMENTO/i.test(texto)) return null;
  const linhas: LinhaExtrato[] = [];
  const re = /^(\d+) (\S+) (\d+) (\d+) (\d+) (.+?) R\$ ?(-?[\d.]+,\d{2}) (-?[\d.]+,\d{2}) ?% R\$ ?(-?[\d.]+,\d{2}) (\S+) (\S+)$/;
  for (const bruta of texto.split(/\r?\n/)) {
    const m = re.exec(um(bruta));
    if (!m) continue;
    const negativa = /^(RC|CC|CN|SC|SR|RI)$/.test(m[11]);
    const v = br(m[9]);
    const l = linha(linhas.length + 1, { produto: m[2], apolice: m[3], endosso: m[4] === "0" ? null : m[4], parcela: Number(m[5]), cliente: m[6],
      premio: br(m[7]), pct_comissao: br(m[8]), valor_comissao: negativa && v > 0 ? -v : v, tipo: `${m[10]}/${m[11]}` });
    (l as any).extras = { sub: m[1], tipo_comissao: m[10], natureza: m[11] };
    linhas.push(l);
  }
  const t = um(texto);
  const r = /Saldo Bruto ISSQN L\S*quido a Receber R\$ ?(-?[\d.]+(?:,\d{2})?) R\$ ?(-?[\d.]+(?:,\d{2})?) R\$ ?(-?[\d.]+(?:,\d{2})?) R\$ ?(-?[\d.]+(?:,\d{2})?) R\$ ?(-?[\d.]+(?:,\d{2})?)/.exec(t);
  return { leitor: "leitor Zurich (PDF)", linhas, total_bruto: r ? br(r[3]) : null, total_liquido: r ? br(r[5]) : null };
}

// Suhai — "Demonstrativo de Comissão": Cliente Apólice-Endosso\Proposta Parcela % Tipo Valor Parcela Valor Comissão
function suhai(texto: string): ExtratoLido | null {
  if (!/Demonstrativo de Comiss[aã]o/i.test(texto) || !/SUSEP|Suhai/i.test(texto) || /Demonstrativo de Agenciamento|Corretagem/i.test(texto)) return null;
  const linhas: LinhaExtrato[] = [];
  const re = /^(.+?) (\d{8,}) End: ?(\d+) (\d+) (\d+,\d{2}) (.+?) (-?[\d.]+,\d{2}) (-?[\d.]+,\d{2})$/;
  for (const bruta of texto.split(/\r?\n/)) {
    const m = re.exec(um(bruta));
    if (!m) continue;
    linhas.push(linha(linhas.length + 1, { cliente: m[1], apolice: m[2], endosso: /^0+$/.test(m[3]) ? null : m[3], parcela: Number(m[4]),
      pct_comissao: br(m[5]), tipo: m[6].toLowerCase(), premio: br(m[7]), valor_comissao: br(m[8]) }));
  }
  const b = /Valor Total \(Tribut[aá]rio\) (-?[\d.]+,\d{2})/.exec(texto), lq = /Valor L[ií]quido (-?[\d.]+,\d{2})/.exec(texto);
  return { leitor: "leitor Suhai (PDF)", linhas, total_bruto: b ? br(b[1]) : null, total_liquido: lq ? br(lq[1]) : null };
}

// Brasilcap portal novo (b2cap "Consultar Comissão"): Garantia Data da Venda Produto Reaplicação Valor Títulos Valor Comissões Situação
function brasilcapNovo(texto: string): ExtratoLido | null {
  if (!/Comiss[aã]o Bruta:/i.test(texto) || !/Garantia Data da Venda/i.test(texto)) return null;
  const t = um(texto);
  const linhas: LinhaExtrato[] = [];
  for (const m of t.matchAll(/(\d{3,}) (\d{2}\/\d{2}\/\d{4}) (.+?) ([SN]) R\$ ?(-?[\d.]+,\d{2}) R\$ ?(-?[\d.]+,\d{2}) ([A-ZÇÃÉÍ]{3,})/g)) {
    const l = linha(linhas.length + 1, { apolice: m[1], produto: m[3], premio: br(m[5]), valor_comissao: (m[7] === "ESTORNADA" ? -1 : 1) * br(m[6]),
      tipo: m[7].toLowerCase(), parcela: 1 });
    (l as any).extras = { garantia: m[1], data_venda: iso(m[2]), reaplicacao: m[4] === "S", situacao: m[7] };
    linhas.push(l);
  }
  const b = /Comiss[aã]o Bruta: R\$ ?(-?[\d.]+,\d{2})/.exec(t);
  return { leitor: "leitor Brasilcap portal novo (PDF)", linhas, total_bruto: b ? br(b[1]) : null, total_liquido: b ? br(b[1]) : null };
}

// Allianz modelo 2025 (colunas coladas no texto do PDF): ... Comissão Antecipada(S/N)Prêmio<apólice> <recibo> O2 CORRETORA ... <pct>%<mediador>
function allianz2025(texto: string): ExtratoLido | null {
  if (!/Allianz/i.test(texto) || !/\(Detalhamento\)/i.test(texto)) return null;
  const t = um(texto);
  const linhas: LinhaExtrato[] = [];
  const re = /(\d{2}\/\d{2}\/\d{4}) (\S{12,}) (\d+)\/(\d+) (.+?) (\d{2,5} - .+?) (-?[\d.]+,\d{2}) ([SN]) ?(-?[\d.]+,\d{2})(\d{6,})(?: (\d{6}))? (\d{6,}) O2 CORRETORA DE SEGUROS LTDA (\d+(?:\.\d+)?)%(\d+)/g;
  for (const m of t.matchAll(re)) {
    const l = linha(linhas.length + 1, { apolice: m[10], endosso: m[11] ?? null, parcela: Number(m[3]), cliente: m[5], produto: m[6],
      valor_comissao: br(m[7]), premio: br(m[9]), pct_comissao: Number(m[13]), tipo: m[8] === "S" ? "antecipada" : "comissao" });
    (l as any).extras = { data_pagto: iso(m[1]), apolice_susep: m[2], parcelas_total: Number(m[4]), recibo: m[12], mediador: m[14] };
    linhas.push(l);
  }
  const tot = /Total L[ií]quido: ?(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)/.exec(t);
  return { leitor: "leitor Allianz 2025 (PDF)", linhas, total_bruto: tot ? Number(tot[1]) : null, total_liquido: tot ? Number(tot[6]) : null };
}

// Tokio modelo antigo "Extrato de Comissões" (sem R$ nas linhas, ramo quebrado em 2 linhas)
function tokioComissoes(texto: string): ExtratoLido | null {
  if (!/Tokio Marine/i.test(texto) || !/Extrato de Comiss[oõ]es/i.test(texto) || /Apolice \/ Bilhete Endosso Tipo Parc Pr/i.test(um(texto))) return null;
  const t = um(texto);
  const ini = t.search(/Comiss[aã]o \(%\) Comiss[aã]o \(R\$\)/);
  if (ini < 0) return null;
  const corpo = t.slice(ini).replace(/^Comiss[aã]o \(%\) Comiss[aã]o \(R\$\) ?/, "");
  const re = /(\d{6,12}) ([A-ZÀ-Ú][A-ZÀ-Ú .\/-]*?) (\d{3,}) (\d+) ([A-ZÀ-Ú][A-ZÀ-Ú ]*?) (\d+) ?\/ ?(\d+) (-?[\d.]+,\d{2}) (\d+(?:,\d+)?) (-?[\d.]+,\d{2})/g;
  const linhas: LinhaExtrato[] = [];
  let fim = 0;
  for (const m of corpo.matchAll(re)) {
    const segurado = corpo.slice(fim, m.index).replace(/Pag \d+ de \d+/g, "").trim();
    fim = (m.index ?? 0) + m[0].length;
    const l = linha(linhas.length + 1, { cliente: segurado || null, produto: m[2].replace(/ /g, " ").trim(), apolice: m[3], endosso: m[4] === "0" ? null : m[4],
      tipo: m[5].trim().toLowerCase(), parcela: Number(m[6]), premio: br(m[8]), pct_comissao: br(m[9]), valor_comissao: br(m[10]) });
    (l as any).extras = { negocio: m[1], parcelas_total: Number(m[7]) };
    linhas.push(l);
  }
  const b = /Total da Comiss[aã]o Bruta: R\$ ?(-?[\d.]+,\d{2})/.exec(t), lq = /Total Comiss[aã]o L[ií]quida R\$ ?(-?[\d.]+,\d{2})/.exec(t);
  return { leitor: "leitor Tokio Extrato de Comissões (PDF)", linhas, total_bruto: b ? br(b[1]) : null, total_liquido: lq ? br(lq[1]) : null };
}

// Mapfre Capitalização — "EXTRATO DE COMISSÕES / Corretagens Pagas": Ficha/Proposta Parcela Titular Histórico Quitação Mensalidades % Débitos Créditos
function mapfreCap(texto: string): ExtratoLido | null {
  if (!/MAPFRE/i.test(texto) || !/Corretagens Pagas/i.test(texto)) return null;
  const linhas: LinhaExtrato[] = [];
  let total = 0, temTotal = false;
  for (const bruta of texto.split(/\r?\n/)) {
    const s = um(bruta);
    const m = /^(\d{4,}) (\d+)\/(\d+) (.+?) (Pagamento|Estorno|Cancelamento|[A-ZÀ-Ú][a-zà-ú]+) (\d{2}\/\d{2}\/\d{4}) ([\d.]+,\d{2}) (\d+,\d{1,4}) ([\d.]+,\d{2}) ([\d.]+,\d{2})$/.exec(s);
    if (m) {
      const l = linha(linhas.length + 1, { proposta: m[1], apolice: m[1], parcela: Number(m[2]), cliente: m[4], tipo: m[5].toLowerCase(), premio: br(m[7]),
        pct_comissao: br(m[8]), valor_comissao: br(m[10]) - br(m[9]) });
      (l as any).extras = { parcelas_total: Number(m[3]), quitacao: iso(m[6]), debito: br(m[9]), credito: br(m[10]) };
      linhas.push(l);
      continue;
    }
    const t = /^TOTAL ([\d.]+,\d{2}) ([\d.]+,\d{2}) ([\d.]+,\d{2})$/.exec(s);
    if (t) { total += br(t[3]) - br(t[2]); temTotal = true; }
  }
  return { leitor: "leitor Mapfre Capitalização (PDF)", linhas, total_bruto: temTotal ? Math.round(total * 100) / 100 : null, total_liquido: null };
}

// Porto Capitalização — "Movimentações": Ficha Valor da Proposta Titular Valor Bruto Data Status IR INSS ISS Valor Líquido
function portoCap(texto: string): ExtratoLido | null {
  if (!/PORTO SEGURO CAPITALIZA/i.test(texto) || !/Movimenta[cç][oõ]es/i.test(texto)) return null;
  const t = um(texto);
  const linhas: LinhaExtrato[] = [];
  for (const m of t.matchAll(/(\d{6,}) R\$ ?([\d.]+,\d{2}) (.+?) R\$ ?(-?[\d.]+,\d{2}) (\d{2}\/\d{2}\/\d{4}) ([A-Z]+) R\$ ?([\d.]+,\d{2}) R\$ ?([\d.]+,\d{2}) R\$ ?([\d.]+,\d{2}) R\$ ?(-?[\d.]+,\d{2})/g)) {
    const l = linha(linhas.length + 1, { proposta: m[1], apolice: m[1], parcela: 1, premio: br(m[2]), cliente: m[3], valor_comissao: br(m[4]), tipo: m[6].toLowerCase() });
    (l as any).extras = { data_pagamento: iso(m[5]), ir: br(m[7]), inss: br(m[8]), iss: br(m[9]), liquido: br(m[10]) };
    linhas.push(l);
  }
  const tot = /Totais \d+ R\$ ?(-?[\d.]+,\d{2}) R\$ ?([\d.]+,\d{2}) R\$ ?([\d.]+,\d{2}) R\$ ?([\d.]+,\d{2}) R\$ ?(-?[\d.]+,\d{2})/.exec(t)
    ?? /Totais \d+ R\$ ?(-?[\d.]+,\d{2})/.exec(t);
  return { leitor: "leitor Porto Capitalização (PDF)", linhas, total_bruto: tot ? br(tot[1]) : null, total_liquido: tot && tot[5] ? br(tot[5]) : null };
}

// HDI — "DETALHAMENTO DE COMISSÃO DE CORRETAGEM": Data Documento - parc/total Cliente Prêmio % Valor (+ recuperação de comissão)
function hdi(texto: string): ExtratoLido | null {
  if (!/DETALHAMENTO DE COMISS[AÃ]O DE CORRETAGEM/i.test(texto)) return null;
  const t = um(texto);
  const linhas: LinhaExtrato[] = [];
  for (const m of t.matchAll(/(\d{2}\/\d{2}\/\d{4}) ([\d.]{15,}) - (\d+)\/(\d+) (.+?) (-?[\d.]+,\d{2}) (\d+,\d{2}) (-?[\d.]+,\d{2})(?= \d{2}\/\d{2}\/\d{4}| Total Bruto)/g)) {
    const l = linha(linhas.length + 1, { apolice: m[2], parcela: Number(m[3]), cliente: m[5], premio: br(m[6]), pct_comissao: br(m[7]), valor_comissao: br(m[8]), tipo: "comissao" });
    (l as any).extras = { data: iso(m[1]), parcelas_total: Number(m[4]) };
    linhas.push(l);
  }
  for (const m of t.matchAll(/(\d{2}\/\d{2}\/\d{4}) ([\d.]{15,}) (.+?) - Recup\. Comissao.*? ABATIMENTO - ([\d.]+,\d{2})/g)) {
    const l = linha(linhas.length + 1, { apolice: m[2], cliente: m[3], valor_comissao: -br(m[4]), tipo: "recuperacao_comissao" });
    (l as any).extras = { data: iso(m[1]) };
    linhas.push(l);
  }
  const b = /Total Bruto (-?[\d.]+,\d{2})/.exec(t);
  return { leitor: "leitor HDI (PDF)", linhas, total_bruto: b ? br(b[1]) : null, total_liquido: null };
}


// Sulamérica — print do Portal do Corretor ("Comissões e Demonstrativos"): a parte útil são os blocos de detalhe de cada comissão
// (Nome / Apólice-Título / Tipo de documento / Produto / Valor Prêmio Total / Valor Remuneração / Parcela ...). A lista do topo vem truncada e é ignorada.
function sulamerica(texto: string): ExtratoLido | null {
  if (!/Portal do Corretor/i.test(texto) || !/Valor Remunera[cç][aã]o/i.test(texto) || !/sulamerica/i.test(texto)) return null;
  const t = um(texto).replace(/\d{2}\/\d{2}\/\d{4}, \d{2}:\d{2} \S+ logada \| Portal do Corretor https:\/\/\S+ \d+\/\d+ ?/g, "");
  const linhas: LinhaExtrato[] = [];
  const blocos = t.split(/(?=Nome: [^:]{2,80}? Ap[oó]lice\/T[ií]tulo:)/).filter((b) => /Valor Remunera[cç][aã]o: R\$/.test(b));
  const nExtrato = /N[ºo] do Extrato (\d+)/.exec(t)?.[1] ?? null;
  const dEmissao = iso(/Data de Emiss[aã]o (\d{2}\/\d{2}\/\d{4})/.exec(t)?.[1] ?? "");
  for (const b of blocos) {
    const g = (re: RegExp) => re.exec(b)?.[1]?.trim() ?? null;
    const valor = g(/Valor Remunera[cç][aã]o: R\$ ?(-?[\d.]+,\d{2})/);
    const premio = g(/Valor Pr[eê]mio Total: R\$ ?(-?[\d.]+,\d{2})/);
    const pct = g(/Remunera[cç][aã]o: (\d+(?:,\d+)?)%/);
    if (!valor) continue;
    const l = linha(linhas.length + 1, {
      apolice: g(/Ap[oó]lice\/T[ií]tulo: (\S+)/), proposta: g(/Proposta: (\S+)/), endosso: g(/Documento: (\S+)/),
      parcela: Number(g(/Parcela atual: (\d+)/) ?? 0) || null, cliente: g(/^Nome: (.+?) Ap[oó]lice\/T[ií]tulo:/),
      premio: premio ? br(premio) : null, pct_comissao: pct ? br(pct) : null, valor_comissao: br(valor),
      vigencia_inicio: iso(g(/In[ií]cio de Vig[eê]ncia: (\d{2}\/\d{2}\/\d{4})/) ?? ""), produto: g(/Produto: (.+?) (?:Proposta|Sucursal)/), tipo: "comissao",
    });
    (l as any).extras = {
      tipo_documento: g(/Tipo de documento: (.+?) Produto:/), contrato: g(/Contrato\/Empresa: (.+?) Item\/Plano:/), tipo_remuneracao: g(/Tipo remunera[cç][aã]o: (\S+)/),
      grupo_faturamento: g(/Grupo faturamento: (\S+)/), data_pagamento: iso(g(/Data pagamento: (\d{2}\/\d{2}\/\d{4})/) ?? ""), parcelas_total: Number(g(/Total de parcelas: (\d+)/) ?? 0) || null,
      parcela_remuneracao: Number(g(/Parcela remunera[cç][aã]o: (\d+)/) ?? 0) || null, parcelas_remuneradas: Number(g(/Total de parc\. remuneradas: (\d+)/) ?? 0) || null,
      situacao_portal: g(/Situa[cç][aã]o: (\w+)/), cia: g(/CIA: (\d+)/), ea: g(/EA: (\d+)/), ev: g(/EV: (\d+)/), uop: g(/UOP: (\d+)/), codigo_produtor: g(/C[oó]digo Produtor: (\d+)/),
      numero_extrato: nExtrato, data_emissao: dEmissao,
    };
    linhas.push(l);
  }
  const tot = /Total de remunera[cç][aã]o R\$ ?(-?[\d.]+,\d{2})/.exec(t);
  const liq = /Valor l[ií]quido R\$ ?(-?[\d.]+,\d{2})/.exec(t);
  return { leitor: "leitor Sulamérica (PDF do portal)", linhas, total_bruto: tot ? br(tot[1]) : null, total_liquido: liq ? br(liq[1]) : null };
}

const LEITORES: Record<string, ((t: string) => ExtratoLido | null)[]> = {
  MAPF: [mapfreCap], PORT: [portoCap], HDI: [hdi], SULA: [sulamerica],
  BRAS: [brasilcap, brasilcapNovo], TOKI: [tokioCorretor, tokioComissoes], ALLI: [allianz, allianz2025], ICAT: [icatu], TOO: [too], ALF: [alfa], ZURI: [zurich], SUHA: [suhai],
};

export function lerExtratoPdfOutros(seguradora: string, texto: string): ExtratoLido | null {
  for (const f of [...(LEITORES[seguradora] ?? []), ...Object.values(LEITORES).flat()]) {
    const r = f(texto);
    if (r && r.linhas.length) return r;
  }
  return null;
}
