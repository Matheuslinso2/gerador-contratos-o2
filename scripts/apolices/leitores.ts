// Leitura das apólices de Seguro Fiança em PDF (texto extraído com unpdf).
// Uma regra fixa por seguradora -- cada uma tem um modelo -- montada sobre o
// lote de teste de 23/10/2026 (Porto, Pottencial, Too, Tokio, Liberty/Yelum,
// Bradesco). Nada de adivinhar: campo que não bate com o padrão fica vazio e
// a apólice cai em "não lida" (motivo no resultado). A certeza final vem do
// casamento com o Corp (carga-drive.ts), que confere nº, vigência e segurado.

export type Pessoa = { nome: string | null; documento: string };
export type Cobertura = { cobertura: string; verba: number | null; lmi: number | null };
export type Leitura = {
  seguradora: string | null; // código do Corp: PORT, POTT, TOO, TOKI, YELU, BRAD
  fianca: boolean;
  ramo: string | null;
  numero: string | null;
  emitida_em: string | null;
  vigencia_inicio: string | null;
  vigencia_fim: string | null;
  segurado: Pessoa | null;
  garantidos: Pessoa[];
  local_risco: string | null;
  estipulante_nome: string | null;
  estipulante_documento: string | null;
  limite_maximo_garantia: number | null;
  coberturas: Cobertura[];
  problemas: string[];
};

// ---------- utilidades ----------
const digitos = (s: string | null | undefined) => String(s ?? "").replace(/\D/g, "");
const limpo = (s: string | null | undefined) => {
  const v = String(s ?? "").replace(/\s+/g, " ").trim();
  return v || null;
};

export function cpfValido(c: string): boolean {
  if (!/^\d{11}$/.test(c) || /^(\d)\1{10}$/.test(c)) return false;
  for (const n of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(c[i]) * (n + 1 - i);
    if (((soma * 10) % 11) % 10 !== Number(c[n])) return false;
  }
  return true;
}
export function cnpjValido(c: string): boolean {
  if (!/^\d{14}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false;
  const calc = (n: number) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = pesos.reduce((s, p, i) => s + p * Number(c[i]), 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(c[12]) && calc(13) === Number(c[13]);
}
/** CPF (11) ou CNPJ (14) válido, só dígitos; senão null. Corrige CNPJ com zero à esquerda a mais. */
export function documento(bruto: string | null | undefined): string | null {
  let d = digitos(bruto);
  if (d.length === 15 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 11 && cpfValido(d)) return d;
  if (d.length === 14 && cnpjValido(d)) return d;
  return null;
}
const data = (s: string | null | undefined): string | null => {
  const m = String(s ?? "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const dinheiro = (s: string | null | undefined): number | null => {
  const m = String(s ?? "").match(/[\d.]+,\d{2}/);
  return m ? Number(m[0].replace(/\./g, "").replace(",", ".")) : null;
};
const pessoa = (nome: string | null | undefined, doc: string | null | undefined): Pessoa | null => {
  const d = documento(doc);
  return d ? { nome: limpo(nome)?.replace(/^[:\-–\s]+/, "") ?? null, documento: d } : null;
};
const D = String.raw`(\d{2}\/\d{2}\/\d{4})`;
const DOC = String.raw`(\d{2,3}[.\d]*[\/\-]?[\d.\-\/]*\d)`;

function vazia(): Leitura {
  return {
    seguradora: null, fianca: false, ramo: null, numero: null, emitida_em: null, vigencia_inicio: null, vigencia_fim: null,
    segurado: null, garantidos: [], local_risco: null, estipulante_nome: null, estipulante_documento: null,
    limite_maximo_garantia: null, coberturas: [], problemas: [],
  };
}

export function identificarSeguradora(t: string): string | null {
  if (/Porto Seguro Cia de Seguros Gerais/i.test(t)) return "PORT";
  if (/POTTENCIAL SEGURADORA/i.test(t)) return "POTT";
  if (/TOO SEGUROS/i.test(t)) return "TOO";
  if (/Tokio Marine/i.test(t)) return "TOKI";
  if (/Liberty (Seguros|Fian)|Yelum/i.test(t)) return "YELU";
  if (/BRADESCO AUTO\/?\s?RE|Bradesco Seguro Fian/i.test(t)) return "BRAD";
  return null;
}

// ---------- por seguradora ----------
function porto(t: string, r: Leitura) {
  // "APÓLICE DO RAMO FIANÇA LOCATÍCIA" ou, no modelo Essencial (2023), "APÓLICE DO RAMO ESSENCIAL 30"
  r.fianca = /RAMO FIAN[ÇC]A LOCAT[IÍ]CIA|RAMO ESSENCIAL|Porto Seguro Aluguel/i.test(t);
  r.ramo = r.fianca ? "0746" : null;
  const ate = t.search(/Vig[êe]ncia do seguro/i);
  const nums = [...t.slice(0, ate > 0 ? ate : 3000).matchAll(/\b(\d{2}\.\d{4}\.\d{15}\.\d{4})\b/g)].map((m) => m[1]);
  r.numero = nums.length >= 2 ? nums[nums.length - 1] : nums[0] ?? null; // com "renova", o 2º é o desta apólice
  if (r.numero) r.emitida_em = data(t.slice(t.indexOf(r.numero), t.indexOf(r.numero) + 40));
  const v = t.match(new RegExp(String.raw`a partir das 24 horas do dia ${D} at[ée] as 24 horas do dia ${D}`, "i"));
  if (v) [r.vigencia_inicio, r.vigencia_fim] = [data(v[1]), data(v[2])];
  const seg = t.match(new RegExp(String.raw`DADOS DO SEGURADO\s+NOME(?:\/RAZ[ÃA]O SOCIAL)?\s+(.+?)\s+NOME SOCIAL.*?CPF(?:\/CNPJ)?\s+${DOC}`, "is"))
    // Essencial (2023): "DADOS DO SEGURADO NOME CPF 00000000000" (nome em branco nesse quadro)
    ?? t.match(new RegExp(String.raw`DADOS DO SEGURADO\s+NOME(?:\/RAZ[ÃA]O SOCIAL)?\s+(.*?)\s*CPF(?:\/CNPJ)?\s+(\d{11}|\d{14})\b`, "is"));
  r.segurado = seg ? pessoa(seg[1], seg[2]) : null;
  for (const m of t.matchAll(new RegExp(String.raw`(?:PRIMEIRO|SEGUNDO|TERCEIRO|QUARTO|QUINTO) LOCAT[ÁA]RIO\s+CPF(?:\/CNPJ)?\s+${DOC}\s+NOME(?:\/RAZ[ÃA]O SOCIAL)?\s+(.+?)\s+NOME SOCIAL`, "gis"))) {
    const p = pessoa(m[2], m[1]);
    if (p) r.garantidos.push(p);
  }
  // Essencial (2023): "GARANTIDO(S) 00000000000 - NOME, 00000000000 - NOME"
  const garBloco = t.match(new RegExp(String.raw`GARANTIDO\(S\)\s+(.+?)\s+(?:PARCEIRO|ESTIPULANTE|[ÍI]NDICE DE REAJUSTE)`, "is"))?.[1];
  if (garBloco && !r.garantidos.length)
    for (const m of garBloco.matchAll(/(\d{11}|\d{14})\s*-\s*([A-Za-zÀ-ú][A-Za-zÀ-ú .'&-]+)/g)) {
      const p = pessoa(m[2], m[1]);
      if (p) r.garantidos.push(p);
    }
  r.local_risco = limpo(t.match(new RegExp(String.raw`LOCAL DE RISCO\s+(.+?)\s+(?:PRIMEIRO LOCAT|GARANTIDO|[ÍI]NDICE DE REAJUSTE)`, "is"))?.[1]);
  const est = t.match(new RegExp(String.raw`(?:ESTIPULANTE|PARCEIRO)\s+\d+-(.+?)\s+CPF\/CNPJ\s+(\d{11,14})`, "is"));
  if (est) [r.estipulante_nome, r.estipulante_documento] = [limpo(est[1]), documento(est[2])];
  r.limite_maximo_garantia = dinheiro(t.match(/LIMITE M[ÁA]XIMO DE GARANTIA\s+R\$\s*([\d.,]+)/i)?.[1]);
  // Tabela de coberturas em colunas: nomes, depois verba / prêmio / LMI (3 por cobertura).
  const bloco = t.match(new RegExp(String.raw`LIMITE\s+M[ÁA]XIMO\s+DE\s+INDENIZA[ÇC][ÃA]O\*?\s+(.+?)\s+(?:\\?\*O Limite|PRE[ÇC]O DO SEGURO)`, "is"))?.[1] ?? "";
  const nomes = (bloco.split(/R\$/)[0] ?? "").split(/\s{2,}|\n/).map((s) => s.trim()).filter((s) => /^[A-Za-zÀ-ú ]+$/.test(s));
  const valores = [...bloco.matchAll(/R\$\s*([\d.]+,\d{2})/g)].map((m) => dinheiro(m[1]));
  if (nomes.length && valores.length === nomes.length * 3)
    r.coberturas = nomes.map((n, i) => ({ cobertura: n, verba: valores[i], lmi: valores[2 * nomes.length + i] }));
}

function too(t: string, r: Leitura) {
  r.fianca = /FIAN[ÇC]A LOCAT[IÍ]CIA/i.test(t);
  r.ramo = r.fianca ? "0746" : null;
  r.numero = t.match(/AP[ÓO]LICE N[ºo°]\s*(\d{10,})/i)?.[1] ?? null;
  const v = t.match(new RegExp(String.raw`IN[ÍI]CIO DE VIG[ÊE]NCIA(?: DAS 24H)?\s+${D}\s+T[ÉE]RMINO DE VIG[ÊE]NCIA(?: DAS 24H)?\s+${D}`, "i"));
  if (v) [r.vigencia_inicio, r.vigencia_fim] = [data(v[1]), data(v[2])];
  r.emitida_em = data(t.match(new RegExp(String.raw`DATA DE EMISS[ÃA]O\s+${D}`, "i"))?.[1]);
  const seg = t.match(new RegExp(String.raw`Segurado:\s*(.+?)\s+CPF\/CNPJ:\s*${DOC}`, "is"));
  r.segurado = seg ? pessoa(seg[1], seg[2]) : null;
  for (const m of t.matchAll(new RegExp(String.raw`Garantido:\s*(.+?)\s+CPF(?:\/CNPJ)?:\s*${DOC}`, "gis"))) {
    const p = pessoa(m[1], m[2]);
    if (p) r.garantidos.push(p);
  }
  r.local_risco = limpo(t.match(new RegExp(String.raw`Local do Risco:\s*(.+?)\s+TIPO DE LOCA`, "is"))?.[1]);
  r.estipulante_nome = limpo(t.match(new RegExp(String.raw`IMOBILI[ÁA]RIA:\s*(.*?)\s+FONE:`, "is"))?.[1]);
  // Uma linha por cobertura: verba + prêmio + LMI (no PDF prêmio e LMI às vezes vêm colados,
  // "4.084,3758.500,00"); a ordem das colunas mudou entre versões -- o LMI é o maior.
  for (const m of t.matchAll(/^\s*(Aluguel|IPTU|Condom[íi]nio|Multas Contratuais|Danos ao Im[óo]vel|Pintura Interna|Pintura Externa|[ÁA]gua|Luz|G[áa]s)\s+([\d.,\s]+)$/gim)) {
    const v = [...m[2].matchAll(/\d{1,3}(?:\.\d{3})*,\d{2}/g)].map((x) => dinheiro(x[0]) ?? 0);
    if (v.length === 3) r.coberturas.push({ cobertura: m[1], verba: v[0], lmi: Math.max(v[1], v[2]) });
  }
}

// No PDF da Pottencial os rótulos vêm todos antes e os valores depois; por isso
// a leitura é por bloco (entre os títulos das seções), pegando "NOME DOCUMENTO".
const ROTULOS_POTT = /(CPF\/CNPJ:|NOME\s*\/\s*RAZ[ÃA]O SOCIAL:|ENDERE[ÇC]O:|CEP:|CIDADE:|UF:|EMAIL:|E-MAIL:|TELEFONE:|PRO-LABORE:[^\n]*|PRINCIPAL:|SOLID[ÁA]RIO\s*\d+:)/gi;
const DOC_PADRAO = String.raw`(\d{3}\.\d{3}\.\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})`;
function pessoasDoBloco(bloco: string): Pessoa[] {
  const limpoBloco = bloco.replace(ROTULOS_POTT, " ");
  return [...limpoBloco.matchAll(new RegExp(String.raw`([A-ZÀ-Ú][A-ZÀ-Ú0-9.'&\- ]{2,}?)\s+${DOC_PADRAO}`, "g"))]
    .map((m) => pessoa(m[1].split(/\n/).pop(), m[2])).filter((p): p is Pessoa => !!p);
}
function pottencial(t: string, r: Leitura) {
  r.fianca = /FIAN[ÇC]A LOCAT[IÍ]CIA/i.test(t);
  r.ramo = r.fianca ? "0746" : null;
  r.numero = t.match(/\b(03069\d{20})\b/)?.[1] ?? t.match(/AP[ÓO]LICE N[ºo°]:?\s*(\d{20,})/i)?.[1] ?? null;
  const v = t.match(new RegExp(String.raw`Vig[êe]ncia do seguro a partir das 24\s?horas do dia ${D} at[ée] as 24 horas do dia ${D}`, "i"));
  if (v) [r.vigencia_inicio, r.vigencia_fim] = [data(v[1]), data(v[2])];
  const secao = (de: RegExp, ate: RegExp) => { const i = t.search(de); if (i < 0) return ""; const resto = t.slice(i); const j = resto.slice(10).search(ate); return j < 0 ? "" : resto.slice(0, j + 10); };
  r.segurado = pessoasDoBloco(secao(/DADOS DO SEGURADO\s*\/\s*LOCADOR/i, /DADOS DO GARANTIDO/i))[0] ?? null;
  r.garantidos = pessoasDoBloco(secao(/DADOS DO GARANTIDO/i, /LOCAL DO RISCO/i));
  const est = pessoasDoBloco(secao(/DADOS DO ESTIPULANTE/i, /DADOS DO SEGURADO/i))[0];
  if (est) [r.estipulante_nome, r.estipulante_documento] = [est.nome, est.documento];
  // O imóvel locado vem depois de "TIPO DE LOCAÇÃO:"; o campo "LOCAL DO RISCO" traz o
  // endereço da imobiliária (conferido no lote de teste).
  const loc = t.match(new RegExp(String.raw`TIPO DE LOCA[ÇC][ÃA]O:\s*(.+?)\s+COBERTURAS`, "is"))?.[1] ?? "";
  r.local_risco = limpo(loc.replace(/PRAZO DO CONTRATO:\s*\d{2}\/\d{2}\/\d{4}\s*[àa]\s*\d{2}\/\d{2}\/\d{4}/i, " ")
    .replace(/DADOS DO SEGURO\s*\/\s*OBJETO/i, " ").replace(/^\s*(N[ÃA]O RESIDENCIAL|RESIDENCIAL|COMERCIAL)\s*$/gim, " "));
  // Coberturas: "Nome R$verba R$LMI R$prêmio" (ou, no PDF, os valores antes do nome).
  for (const m of t.matchAll(/R\$\s*([\d.]+,\d{2})\s+R\$\s*([\d.]+,\d{2})\s+R\$\s*([\d.]+,\d{2})\s*([A-Za-zÀ-ú][^\n]{3,120})/g))
    r.coberturas.push({ cobertura: limpo(m[4]) ?? "", verba: dinheiro(m[1]), lmi: dinheiro(m[2]) });
  if (!r.coberturas.length)
    for (const m of t.matchAll(/((?:Cob\.\s*B[áa]sica|Inadimpl[êe]ncia|B[áa]sica|Adic\.|Danos ao Im[óo]vel|Multa|Pintura)[^R$]{0,120}?)\s*R\$\s*([\d.]+,\d{2})\s+R\$\s*([\d.]+,\d{2})\s+R\$\s*([\d.]+,\d{2})/gi))
      r.coberturas.push({ cobertura: limpo(m[1]) ?? "", verba: dinheiro(m[2]), lmi: dinheiro(m[3]) });
  if (!r.segurado && /LOCADOR\s*\(Segurado\)/i.test(t)) pottencialAluguel2025(t, r);
}

// Modelo "Seguro Pottencial Aluguel" (2025+): rótulos "LOCATÁRIOS (Garantidos)",
// "LOCADOR (Segurado)", "ESTIPULANTE", cada valor como "Nome: X CPF: Y".
function pottencialAluguel2025(t: string, r: Leitura) {
  const v = t.match(new RegExp(String.raw`Vig[êe]ncia do seguro\s+Das 0h do dia ${D} [àa]s 0h do dia ${D}`, "i"));
  if (v) [r.vigencia_inicio, r.vigencia_fim] = [data(v[1]), data(v[2])];
  const nomeDoc = new RegExp(String.raw`Nome:\s*(.+?)\s+(?:CPF|CNPJ)(?:\/CNPJ)?:\s*${DOC_PADRAO}`, "g");
  const entre = (de: RegExp, ate: RegExp) => { const i = t.search(de); if (i < 0) return ""; const resto = t.slice(i); const j = resto.search(ate); return j < 0 ? resto : resto.slice(0, j); };
  r.garantidos = [...entre(/LOCAT[ÁA]RIOS\s*\(Garantidos\)/i, /LOCADOR\s*\(Segurado\)/i).matchAll(nomeDoc)]
    .map((m) => pessoa(m[1], m[2])).filter((p): p is Pessoa => !!p);
  r.segurado = [...entre(/LOCADOR\s*\(Segurado\)/i, /CORRETOR/i).matchAll(nomeDoc)].map((m) => pessoa(m[1], m[2]))[0] ?? null;
  const est = [...entre(/\bESTIPULANTE\b/, /DADOS DO IM[ÓO]VEL/i).matchAll(nomeDoc)].map((m) => pessoa(m[1], m[2]))[0];
  if (est) [r.estipulante_nome, r.estipulante_documento] = [est.nome, est.documento];
  r.local_risco = limpo(t.match(/Local do Risco:\s*([^\n]+)/i)?.[1]);
  r.coberturas = [...t.matchAll(/^\s*(Aluguel \+ Encargos|Danos ao Im[óo]vel|Multa por rescis[ãa]o contratual|Pintura Interna(?: e Externa)? do Im[óo]vel|Pintura[^\n]{0,40})\s+R\$\s*([\d.]+,\d{2})\s+R\$\s*([\d.]+,\d{2})\s*$/gim)]
    .map((m) => ({ cobertura: m[1], verba: dinheiro(m[2]), lmi: dinheiro(m[3]) }));
}

function liberty(t: string, r: Leitura) {
  r.fianca = /Fian[çc]a Locat[íi]cia/i.test(t);
  r.ramo = r.fianca ? "0746" : null;
  r.numero = t.match(/(\d{2}-\d{2}-\d{3}\.\d{3})/)?.[1] ?? null;
  const v = t.match(new RegExp(String.raw`Das 24h de ${D} [àa]s 24h de ${D}\s+${D}?`, "i"));
  if (v) [r.vigencia_inicio, r.vigencia_fim, r.emitida_em] = [data(v[1]), data(v[2]), data(v[3])];
  const seg = t.match(new RegExp(String.raw`Nome do Segurado\(a\)\s+CPF\/CNPJ\s+(.+?)\s+([\d.]{9,14}-\d{2}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})`, "is"));
  r.segurado = seg ? pessoa(seg[1], seg[2]) : null;
  for (const m of t.matchAll(new RegExp(String.raw`Nome do\(a\) Locat[áa]rio\(a\)\s+CPF\/CNPJ\s+(.+?)\s+([\d.]{9,14}-\d{2}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})`, "gis"))) {
    const p = pessoa(m[1], m[2]);
    if (p) r.garantidos.push(p);
  }
  r.local_risco = limpo(t.match(new RegExp(String.raw`DADOS DO IM[ÓO]VEL OBJETO DA LOCA[ÇC][ÃA]O\s+Endere[çc]o\s+(.+?)\s+Inicio de Vig`, "is"))?.[1]);
  const est = t.match(new RegExp(String.raw`Pr[óo]-Labore\(R\$\)\s+(.+?)\s+(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})`, "is"));
  if (est) [r.estipulante_nome, r.estipulante_documento] = [limpo(est[1]), documento(est[2])];
  r.limite_maximo_garantia = dinheiro(t.match(/Limite M[áa]ximo de Garantia \(R\$\)\s+(?:[A-Za-zÀ-ú]+\s+){0,3}([\d.]+,\d{2})/i)?.[1]);
  for (const m of t.matchAll(/\b(ALUGUEL|IPTU|CONDOMINIO|AGUA|LUZ|GAS|DANOS AO IMOVEL|MULTA POR RESCISAO CONTRATUAL|PINTURA DO IMOVEL)\s+(?:([\d.]+,\d{2})\s+)?([\d.]+,\d{2})\s+(?:Sem particip|20%)/g))
    r.coberturas.push({ cobertura: m[1], verba: dinheiro(m[2]), lmi: dinheiro(m[3]) });
}

function tokio(t: string, r: Leitura) {
  r.ramo = t.match(/Ramo:\s*(\d{2}\.\d{2})/)?.[1] ?? null;
  r.fianca = r.ramo === "07.46" || /TOKIO MARINE ALUGUEL/i.test(t);
  r.numero = t.match(/Ap[óo]lice:\s*(\d{5,})/)?.[1] ?? null;
  const v = t.match(new RegExp(String.raw`Vig[êe]ncia: a partir das 24 horas do dia ${D} at[ée] [àa]s 24 horas do dia ${D}`, "i"));
  if (v) [r.vigencia_inicio, r.vigencia_fim] = [data(v[1]), data(v[2])];
  r.emitida_em = data(t.match(new RegExp(String.raw`Data da Emiss[ãa]o:\s*${D}`, "i"))?.[1]);
  // O texto da Tokio embaralha nomes e CPFs; a ordem dos CPFs é confiável:
  // 1º = segurado (locador), demais = garantidos. Nomes só se a contagem bater.
  const docs = [...t.matchAll(/\bCPF:\s*(\d{3}\.\d{3}\.\d{3}-\d{2})/g)].map((m) => m[1]);
  const nomes = [...t.matchAll(/([A-ZÀ-Ú][A-ZÀ-Ú.'&\- ]{3,}?)\s+Nome Social:/g)].map((m) => limpo(m[1]));
  const ps = docs.map((d, i) => pessoa(nomes.length === docs.length ? nomes[i] : null, d)).filter((p): p is Pessoa => !!p);
  r.segurado = ps[0] ?? null;
  r.garantidos = ps.slice(1);
  if (nomes.length !== docs.length) r.problemas.push("nomes da Tokio não alinhados aos CPFs (só CPF)");
  r.local_risco = limpo(t.match(new RegExp(String.raw`Local do Risco:\s*(.+?)\s+(?:Descri[çc][ãa]o|\d\/7)`, "is"))?.[1]);
  const est = t.match(new RegExp(String.raw`Nome da Imobili[áa]ria:\s*(.+?)\s+C[óo]digo:\s*\d+\s+CNPJ\/CPF:\s*(\d{11,14})`, "is"));
  if (est) [r.estipulante_nome, r.estipulante_documento] = [limpo(est[1]), documento(est[2])];
  r.limite_maximo_garantia = dinheiro(t.match(/Limite M[áa]ximo de Garantia\s+R\$\s*([\d.,]+)/i)?.[1]);
  // "Aluguel Até 30 vezes a verba declarada <prêmio> <verba>": LMI = vezes × verba.
  for (const m of t.matchAll(/(Aluguel|Desp\.\s*Ord\.\s*Condominiais|I\.P\.T\.U\.|Danos ao im[óo]vel(?:\(\*\))?|Pintura interna|Multa por rescis[ãa]o)\s+At[ée]\s+(\d+)\s+vezes\s+(?:a verba declarada|o valor do aluguel\s+declarado)\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})/gi)) {
    const verba = dinheiro(m[4]);
    r.coberturas.push({ cobertura: limpo(m[1])!.replace(/\(\*\)/, ""), verba, lmi: verba == null ? null : Math.round(verba * Number(m[2]) * 100) / 100 });
  }
}

function bradesco(t0: string, r: Leitura) {
  const t = t0.slice(0, 20000); // depois vêm as Condições Gerais
  r.fianca = /FIANCA LOCATICIA/i.test(t);
  r.ramo = r.fianca ? "0746" : null;
  const a = t.match(new RegExp(String.raw`Dados da Ap[óo]lice\s+Ap[óo]lice\s+Proposta\s+Data da Emiss[ãa]o\s+(\d+)\s+(\d+)\s+${D}`, "i"));
  if (a) [r.numero, r.emitida_em] = [a[1], data(a[3])];
  // "das 24:00 horas do dia X às 24:00 horas do dia Y" (no PDF vem antes do rótulo "Vigência do seguro").
  const vig = t.match(new RegExp(String.raw`horas do dia ${D}.{0,60}?horas\s+do dia ${D}`, "is"))?.slice(1).join(" ") ?? t.match(new RegExp(String.raw`Vig[êe]ncia do seguro(.{0,160})`, "is"))?.[1] ?? "";
  const datas = [...vig.matchAll(/(\d{2}\/\d{2}\/\d{4})/g)].map((m) => data(m[1])!).sort();
  if (datas.length >= 2) [r.vigencia_inicio, r.vigencia_fim] = [datas[0], datas[datas.length - 1]];
  const segBloco = t.match(new RegExp(String.raw`Dados do\(s\) Segurado\(s\) \(Locador\)(.+?)Dados do\(s\) Garantido`, "is"))?.[1] ?? "";
  r.segurado = pessoa(segBloco.match(new RegExp(String.raw`1\.\s*Nome\s+(.+?)\s+Endere`, "is"))?.[1], segBloco.match(/CPF\/CNPJ\s+([\d.\/-]+)/)?.[1]);
  const garBloco = t.match(new RegExp(String.raw`Dados do\(s\) Garantido\(s\) \(Locat[áa]rio\)(.+?)Dados do Contrato`, "is"))?.[1] ?? "";
  const gNomes = [...garBloco.matchAll(new RegExp(String.raw`\d\.\s*Nome\s+(.+?)\s+Endere`, "gis"))].map((m) => m[1]);
  const gDocs = [...garBloco.matchAll(/CPF\/CNPJ\s+([\d.\/-]+)/g)].map((m) => m[1]);
  gDocs.forEach((d, i) => { const p = pessoa(gNomes.length === gDocs.length ? gNomes[i] : null, d); if (p) r.garantidos.push(p); });
  r.local_risco = limpo(t.match(new RegExp(String.raw`Endere[çc]o do Im[óo]vel\s+(.+?)\s+Coberturas Contratadas`, "is"))?.[1]);
  r.limite_maximo_garantia = dinheiro(t.match(/Limite M[áa]ximo de Garantia da Ap[óo]lice \(R\$\)\s*([\d.,]+)/i)?.[1]);
}

const POR_SEGURADORA: Record<string, (t: string, r: Leitura) => void> = {
  PORT: porto, POTT: pottencial, TOO: too, TOKI: tokio, YELU: liberty, BRAD: bradesco,
};

export function lerApolice(texto: string): Leitura {
  const r = vazia();
  const t = texto.replace(/\r/g, "");
  r.seguradora = identificarSeguradora(t);
  if (!r.seguradora) {
    r.fianca = /fian[çc]a locat[íi]cia/i.test(t);
    r.problemas.push("seguradora não reconhecida");
    return r;
  }
  POR_SEGURADORA[r.seguradora](t, r);
  if (!r.fianca) return r;
  if (!r.numero) r.problemas.push("nº da apólice não encontrado");
  if (!r.vigencia_inicio || !r.vigencia_fim) r.problemas.push("vigência não encontrada");
  if (!r.segurado) r.problemas.push("segurado sem CPF/CNPJ válido");
  if (!r.garantidos.length) r.problemas.push("nenhum locatário com CPF/CNPJ válido");
  return r;
}
