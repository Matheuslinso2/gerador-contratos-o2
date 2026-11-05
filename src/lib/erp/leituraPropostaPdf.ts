// Extrai de um PDF de proposta/apólice/cotação só o dado estruturado (seguradora, números, CPF/CNPJ, prêmios); nunca guarda o texto bruto.
const so = (s: string) => s.replace(/\D/g, "");
const num = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));

export function lerPropostaPdf(texto: string) {
  const t = texto.replace(/\s+/g, " ");
  const seg = /tokio/i.test(t) ? "TOKIO" : /porto/i.test(t) ? "PORTO" : /pottencial/i.test(t) ? "POTTENCIAL" : /too seguros|\btoo\b/i.test(t) ? "TOO" : /pessoal|essor/i.test(t) ? "OUTRA" : null;
  const numeros: Record<string, string[]> = {};
  const add = (k: string, re: RegExp) => { const v = [...t.matchAll(re)].map((m) => m[1]).filter(Boolean); if (v.length) numeros[k] = [...new Set(v)].slice(0, 6); };
  add("proposta", /proposta\s*(?:n[º°o.]*|n[úu]mero)?\s*[:\-]?\s*(\d[\d.\-/]{5,19}\d)/gi);
  add("apolice", /ap[óo]lice\s*(?:n[º°o.]*|n[úu]mero)?\s*[:\-]?\s*(\d[\d.\-/ ]{5,19}\d)/gi);
  add("negocio", /neg[óo]cio\s*[:\-]?\s*(\d{8,10})/gi);
  add("cotacao", /cota[çc][ãa]o\s*(?:n[º°o.]*)?\s*[:\-]?\s*(\d{6,12})/gi);
  const docs = [...new Set([...t.matchAll(/\b(\d{3}\.\d{3}\.\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\b/g)].map((m) => so(m[1])))].slice(0, 8);
  const premios = [...t.matchAll(/(?:pr[êe]mio\s*(?:l[ií]quido|total)?|valor)\s*[:\-]?\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/gi)].map((m) => num(m[1])).filter((n) => n > 0).slice(0, 8);
  return { seg, numeros, docs, premios };
}

/** Tipo do arquivo pelo nome e pelo texto do comentário em que foi anexado. */
export function tipoDoArquivo(nome: string, comentario: string): string {
  const n = nome.toLowerCase(), c = comentario.toLowerCase();
  if (/propost/.test(n) || /^\s*(-+\s*)?propost/.test(c)) return "proposta";
  if (/ap[óo]lice|apolice/.test(n)) return "apolice";
  if (/endosso/.test(n)) return "endosso";
  if (/distrato|cancel/.test(n)) return "cancelamento";
  if (/boleto|comprovante|ades[aã]o/.test(n)) return "boleto_comprovante";
  if (/panorama/.test(n) || /panorama/.test(c)) return "panorama";
  if (/carta.?(resposta|parecer)|parecer/.test(n)) return "carta_resposta";
  if (/contrato/.test(n)) return "contrato_locacao";
  if (/cota[çc][ãa]o|c[aá]lculo|calculo|completo|b[aá]sico|\blmi\b|taxa fixa|trad/.test(n) || /cota[çc][ãa]o|c[aá]lculo|calculo|desconto t[eé]cnico|prolabore/.test(c)) return "cotacao";
  if (/captura de tela|\.(png|jpe?g|gif|webp)$/.test(n)) return "imagem";
  return "outro";
}
