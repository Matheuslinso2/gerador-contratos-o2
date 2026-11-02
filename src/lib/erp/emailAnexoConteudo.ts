// Classificação e extração de campos pelo CONTEÚDO do PDF (texto nativo; sem IA, sem texto bruto guardado): apólice, proposta, endosso, certificado, cotação, boleto ou outro,
// com seguradora, nºs candidatos, CPF/CNPJ, datas e prêmio. Usado pela fila de anexos de e-mail (scripts/erp/email-anexos-ler.ts). Nível 5 (e-mail/anexo) até ligar com prova.
export const VERSAO_LEITOR_EMAIL = 1;

const SEG: [string, RegExp][] = [["TOKI", /tokio marine/i], ["PORT", /porto seguro|portoseguro/i], ["POTT", /pottencial/i], ["ALLI", /allianz/i], ["YELU", /yelum|liberty seguros/i], ["ZURI", /zurich/i], ["MAPF", /mapfre/i], ["HDI", /\bhdi\b/i], ["ALF", /alfa seguradora|alfaseg/i], ["SUHA", /suhai/i], ["BRAS", /brasilcap/i], ["ICAT", /icatu/i], ["AZUL", /azul seguros|azul companhia/i], ["BRAD", /bradesco seguros|bradesco auto/i], ["SULA", /sul\s?am[eé]rica/i], ["ITAU", /ita[uú] seguros/i], ["TOO", /too seguros/i]];
export const seguradoraDoTexto = (t: string): string | null => { const a = SEG.filter(([, re]) => re.test(t)).map(([k]) => k); return a.length === 1 ? a[0] : null; };

const dig = (s: string) => s.replace(/\D/g, "");
const semZeros = (s: string) => dig(s).replace(/^0+/, "");
const sa = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

export type Classe = "apolice" | "proposta" | "endosso" | "certificado" | "cotacao" | "boleto" | "outro";
export type Conteudo = { classe: Classe; seguradora: string | null; numero_apolice: string[]; numero_proposta: string[]; numeros: string[]; cpf_cnpj: string[]; datas: string[]; premio_total: number | null; premio_liquido: number | null };

export function classificar(texto: string): Classe {
  const T = sa(texto.replace(/\s+/g, " ")); const cab = T.slice(0, 1500);
  if (/LINHA DIGITAVEL|CODIGO DE BARRAS|PAGAVEL EM QUALQUER|BENEFICIARIO.{0,80}(SACADO|PAGADOR)/.test(T.slice(0, 2500)) && !/APOLICE N|PROPOSTA N/.test(cab)) return "boleto";
  const achados = (["ENDOSSO", "APOLICE", "CERTIFICADO", "BILHETE", "PROPOSTA", "COTACAO"] as const).map((k) => [k, cab.indexOf(k)] as const).filter(([, i]) => i >= 0).sort((a, b) => a[1] - b[1]);
  if (!achados.length) return "outro";
  const k = achados[0][0];
  return k === "BILHETE" ? "certificado" : k === "ENDOSSO" ? "endosso" : k === "APOLICE" ? "apolice" : k === "CERTIFICADO" ? "certificado" : k === "PROPOSTA" ? "proposta" : "cotacao";
}

const rotulado = (t: string, rot: RegExp): string[] => {
  const out = new Set<string>();
  for (const m of t.matchAll(new RegExp(`(?:${rot.source})(?:\\s+(?:individual|digital|de seguro|n[ºo°.]{0,2}))*\\s*(?:n[ºo°.]{0,2}|:)?\\s*[:#-]?\\s*(\\d[\\d.\\-/ ]{4,24}\\d)`, "gi"))) {
    const v = m[1].replace(/\s+/g, ""); if (/^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(v)) continue;
    const d = semZeros(v); if (d.length >= 5 && d.length <= 20) out.add(d);
  }
  return [...out].slice(0, 8);
};

export function extrair(texto: string): Conteudo {
  const t = texto.replace(/\s+/g, " ");
  const numero_apolice = rotulado(t, /ap[oó]lice|certificado|bilhete/);
  const numero_proposta = rotulado(t, /proposta/);
  const todos = new Set<string>([...numero_apolice, ...numero_proposta]);
  for (const m of t.matchAll(/\b\d[\d.\-/]{4,22}\d\b/g)) { const d = semZeros(m[0]); if (d.length >= 6 && d.length <= 14 && !/^\d{2}\/\d{2}\/\d{4}$/.test(m[0])) todos.add(d); if (todos.size >= 80) break; }
  const cpf_cnpj = [...new Set([...t.matchAll(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g)].map((m) => dig(m[0])))].slice(0, 12);
  const datas = [...new Set([...t.matchAll(/\b(\d{2})\/(\d{2})\/(\d{4})\b/g)].map((m) => `${m[3]}-${m[2]}-${m[1]}`))].filter((d) => +d.slice(0, 4) >= 2000 && +d.slice(0, 4) <= 2040 && +d.slice(5, 7) >= 1 && +d.slice(5, 7) <= 12).sort().slice(0, 40);
  const num = (s?: string) => (s ? Number(s.replace(/\./g, "").replace(",", ".")) : null);
  return {
    classe: classificar(texto), seguradora: seguradoraDoTexto(t), numero_apolice, numero_proposta, numeros: [...todos], cpf_cnpj, datas,
    premio_total: num(t.match(/Pr[eê]mio\s+Total[^\d]{0,40}([\d.]+,\d{2})/i)?.[1]), premio_liquido: num(t.match(/Pr[eê]mio\s+L[ií]quido[^\d]{0,40}([\d.]+,\d{2})/i)?.[1]),
  };
}
