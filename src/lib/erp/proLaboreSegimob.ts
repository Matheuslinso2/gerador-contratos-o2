// ERP O2 — leitor do "Extrato de pagamento de Pró-labore" que o Segimob manda por e-mail (31/10/2026).
// O PDF traz, por apólice e parcela, o prêmio líquido (sem IOF) e o valor do pró-labore pago pela seguradora DIRETO à
// imobiliária. Cada linha termina sempre em "<nn>/<NN> R$ <prêmio> R$ <pró-labore> <produto> <apólice>"; o que vem antes é
// o código da venda (número, ou o texto "SEGURO REALIZADO FORA DO PORTAL SEG IMOB" em fiança) e o nome do segurado
// (o nome e os valores podem quebrar de linha). Confere a soma com o "Valor Total Bruto" do cabeçalho.

export type LinhaProLabore = {
  codigo_venda: string;
  segurado: string;
  parcela_n: number;
  parcelas_total: number;
  premio_liquido: number;
  valor_pro_labore: number;
  produto: string;
  apolice: string;
};

export type ExtratoProLabore = { imobiliaria: string | null; data_pagamento: string | null; total_bruto: number | null; linhas: LinhaProLabore[]; fecha: boolean };

const valor = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));
const FIM_DA_LINHA = /(\d{1,3})\/(\d{1,3})\s+R\$\s*(-?[\d.]+,\d{2})\s+R\$\s*(-?[\d.]+,\d{2})\s+([A-Za-zÀ-ú]+(?:\s[A-Za-zÀ-ú]+)?)\s+(\d{5,})/g;

export function lerExtratoProLabore(texto: string): ExtratoProLabore {
  // Quando o valor do pró-labore quebra de linha, o texto do PDF sai embaralhado:
  //   "08/11 R$ 104,29 R$ Incêndio 2355440 RODRIGAO JPA LTDA 15,64 1301224" → "08/11 R$ 104,29 R$ 15,64 Incêndio 2355440 1301224"
  // (o resto do nome do segurado se perde; prêmio, pró-labore e apólice ficam certos).
  const t = texto.replace(/\s+/g, " ").replace(
    /R\$ ([A-Za-zÀ-ú]+(?: [A-Za-zÀ-ú]+)?) (\d{5,}) ([A-Za-zÀ-ú .&'\-]*?) ?(-?[\d.]+,\d{2})(?= (?:\d{6,9} |SEGURO REALIZADO)| ?$)/g,
    (_m, prod: string, ap: string, _nome: string, v: string) => `R$ ${v} ${prod} ${ap}`,
  );
  const imob = /Imobiliária:\s*(.+?)\s+Valor Total/i.exec(t)?.[1]?.trim() ?? null;
  const pag = /Data Previsão\s+Pagamento:\s*(\d{2})\/(\d{2})\/(\d{4})/i.exec(t);
  const bruto = /Valor Total\s+Bruto:\s*R\$\s*(-?[\d.]+,\d{2})/i.exec(t);
  const ini = t.search(/Produto\s+Apólice/i);
  const corpo = ini >= 0 ? t.slice(ini).replace(/^Produto\s+Apólice\s*/i, "") : t;
  const linhas: LinhaProLabore[] = [];
  let fim = 0;
  for (const m of corpo.matchAll(FIM_DA_LINHA)) {
    const antes = corpo.slice(fim, m.index).trim();
    fim = (m.index ?? 0) + m[0].length;
    const cod = /^(\d{6,9})\s+(.*)$/.exec(antes);
    const fora = /^SEGURO REALIZADO FORA DO PORTAL SEG IMOB\s*(.*)$/i.exec(antes);
    linhas.push({
      codigo_venda: cod ? cod[1] : fora ? "fora do portal" : "sem código",
      segurado: (cod ? cod[2] : fora ? fora[1] : antes).trim(),
      parcela_n: Number(m[1]), parcelas_total: Number(m[2]),
      premio_liquido: valor(m[3]), valor_pro_labore: valor(m[4]), produto: m[5].trim(), apolice: m[6],
    });
  }
  const total = bruto ? valor(bruto[1]) : null;
  const soma = Math.round(linhas.reduce((s, l) => s + l.valor_pro_labore, 0) * 100) / 100;
  // Estorno (prêmio negativo) aparece com pró-labore R$ 0,00, mas o total do cabeçalho desconta o % do pró-labore sobre ele
  // (ex.: Silverio 26/10: −169,09 e −161,70 × 35% = −115,78). Por isso o total também fecha com esse desconto.
  const pcts = linhas.filter((l) => l.premio_liquido > 0 && l.valor_pro_labore > 0).map((l) => l.valor_pro_labore / l.premio_liquido).sort((a, b) => a - b);
  const mediana = pcts.length ? pcts[Math.floor(pcts.length / 2)] : 0;
  const descontoEstornos = linhas.filter((l) => l.premio_liquido < 0 && l.valor_pro_labore === 0).reduce((s, l) => s + l.premio_liquido * mediana, 0);
  const fecha = total !== null && (Math.abs(soma - total) <= 0.05 || Math.abs(soma + descontoEstornos - total) <= 0.10);
  return { imobiliaria: imob, data_pagamento: pag ? `${pag[3]}-${pag[2]}-${pag[1]}` : null, total_bruto: total, linhas, fecha };
}
