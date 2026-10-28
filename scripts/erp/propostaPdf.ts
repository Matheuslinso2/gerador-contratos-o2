// Extração dos dados de proposta/apólice em PDF (28/10/2026): vigência, segurado/garantido (CPF/CNPJ válido), prêmio, parcelamento e datas.
// Só lê o que está escrito; campo que não aparece fica null (nada é inventado). Valores em reais como número.
import { documento } from "../apolices/leitores";

export type DadosPdf = {
  vigencia_inicio: string | null; // aaaa-mm-dd
  vigencia_fim: string | null;
  documentos: string[]; // CPFs/CNPJs válidos encontrados (só dígitos)
  premio_total: number | null;
  premio_liquido: number | null;
  iof: number | null;
  adicional_fracionamento: number | null; // adicional de fracionamento / juros de parcelamento, quando o PDF separa
  premio_soma_ok: boolean | null; // total do PDF = líquido + IOF + adicional (tolerância de 5 centavos); null se faltar campo
  parcelas: number | null;
  valor_parcela: number | null;
  data_emissao: string | null;
  data_proposta: string | null;
  numero: string | null; // nº da apólice/proposta/certificado, como escrito
  apolices_citadas: string[]; // nºs que aparecem depois da palavra "apólice" (só dígitos, ≥ 6): em endosso é a apólice endossada
  numero_endosso: string | null;
  tipo: "apolice" | "proposta" | "endosso" | "cotacao" | "certificado" | "boleto" | "outro";
};

const D = String.raw`(\d{2}\/\d{2}\/\d{4})`;
const iso = (d: string | undefined) => (d ? d.split("/").reverse().join("-") : null);
const reais = (s: string | undefined) => (s ? Number(s.replace(/\./g, "").replace(",", ".")) : null);

export function extrairDadosPdf(textoBruto: string, nomeArquivo = ""): DadosPdf {
  const t = textoBruto.replace(/\s+/g, " ");
  const cab = t.slice(0, 2500).toUpperCase();
  let vig: RegExpExecArray | null =
    new RegExp(String.raw`VIG[ÊE]NCIA\s+DAS?\s+\d{1,2}:\d{2}\s+DO\s+DIA\s+${D}.{0,40}?\d{1,2}:\d{2}\s+DO\s+DIA\s+${D}`, "i").exec(t) ?? // Porto (proposta)
    new RegExp(String.raw`Das\s*\d{1,2}\s*h\s*de\s*${D}\s*[àa]s\s*\d{1,2}\s*h\s*de\s*${D}`, "i").exec(t) ?? // Yelum/Liberty (apólice)
    new RegExp(String.raw`Das\s*\d{1,2}\s*h[^\d]{0,12}do\s*dia\s*${D}.{0,40}?${D}`, "i").exec(t) ??
    new RegExp(String.raw`vig[êe]ncia[^\d]{0,60}${D}[^\d]{1,40}${D}`, "i").exec(t) ??
    new RegExp(String.raw`in[ií]cio[^\d]{0,40}${D}.{0,100}?(?:t[ée]rmino|fim|final)[^\d]{0,40}${D}`, "i").exec(t);
  if (vig && vig[1] === vig[2]) vig = null;
  const docs = new Set<string>();
  for (const m of t.matchAll(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g)) {
    const d = documento(m[0]);
    if (d) docs.add(d);
  }
  const V = String.raw`R?\$?\s*([\d.]+,\d{2})`;
  let liq: number | null = null, iofV: number | null = null, adic: number | null = null, tot: number | null = null;
  // Yelum/Liberty: cabeçalho "Prêmio Líquido (R$) Adic. Frac. (R$) Custo Apólice (R$) IOF (R$) Prêmio Total (R$) Juros (%)" + 6 valores
  const yel = /Pr[êe]mio L[íi]quido \(R\$\)\s*Adic\.? ?Frac\.? \(R\$\)\s*Custo Ap[óo]lice \(R\$\)\s*IOF \(R\$\)\s*Pr[êe]mio Total \(R\$\)\s*Juros \(%\)\s*([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})/i.exec(t);
  // Porto (Print Web): "PRÊMIO LÍQUIDO TOTAL R$ L <rótulo> R$ A I.O.F. R$ I PRÊMIO TOTAL R$ T"
  const por = new RegExp(String.raw`PR[ÊE]MIO L[ÍI]QUIDO TOTAL\s*${V}\s*(.{0,60}?)\s*${V}\s*I\.?O\.?F\.?\s*${V}\s*PR[ÊE]MIO TOTAL\s*${V}`, "i").exec(t);
  // Pottencial: "Prêmio Líquido R$ L IOF R$ I Prêmio Total: R$ T" (o total pode vir depois de outro texto)
  const pot = new RegExp(String.raw`Pr[êe]mio L[íi]quido\s*${V}\s*IOF\s*${V}`, "i").exec(t);
  if (yel) { liq = reais(yel[1]); adic = reais(yel[2]); iofV = reais(yel[4]); tot = reais(yel[5]); const custo = reais(yel[3]) ?? 0; if (custo) adic = (adic ?? 0) + custo; }
  else if (por) { liq = reais(por[1]); iofV = reais(por[4]); tot = reais(por[5]); adic = /FRACION|JUROS|ADICIONAL/i.test(por[2]) ? reais(por[3]) : reais(por[3]); }
  else if (pot) { liq = reais(pot[1]); iofV = reais(pot[2]); }
  const pt = new RegExp(String.raw`pr[êe]mio\s*total[^\d]{0,40}${V}`, "i").exec(t) ?? new RegExp(String.raw`valor\s*total[^\d]{0,30}${V}`, "i").exec(t);
  const pl = new RegExp(String.raw`pr[êe]mio\s*l[íi]quido[^\d]{0,40}${V}`, "i").exec(t);
  if (tot == null) tot = reais(pt?.[1]);
  if (liq == null) liq = reais(pl?.[1]);
  if (iofV == null) iofV = reais(new RegExp(String.raw`I\.?O\.?F\.?(?:\s*\(R\$\))?[^\d]{0,12}${V}`, "i").exec(t)?.[1]);
  const somaOk = liq != null && iofV != null && tot != null ? Math.abs(liq + iofV + (adic ?? 0) - tot) < 0.06 : null;
  const par = new RegExp(String.raw`(\d{1,2})\s*(?:x|parcelas?)\s*(?:de|iguais de)?\s*R?\$?\s*([\d.]+,\d{2})`, "i").exec(t);
  const nPar = /N[ºo°]\s*Parcelas\s*(\d{1,2})/i.exec(t)?.[1] ?? /FORMA DE PAGAMENTO\s*\d*\s*-?\s*(\d{1,2})\s*x/i.exec(t)?.[1] ?? null;
  const vPar = /(?:1[ºo°]?\s*PARCELA|DEMAIS PARCELAS\s*\(R\$\))\s*R\$\s*([\d.]+,\d{2})/i.exec(t)?.[1];
  // Yelum: a data de emissão vem logo depois do período ("… às 24h de dd/mm/aaaa dd/mm/aaaa")
  const emYel = new RegExp(String.raw`Data de Emiss[ãa]o\s*Das\s*\d{1,2}\s*h\s*de\s*${D}\s*[àa]s\s*\d{1,2}\s*h\s*de\s*${D}\s*${D}`, "i").exec(t);
  const em = emYel ? ([emYel[0], emYel[3]] as unknown as RegExpExecArray) : new RegExp(String.raw`emiss[ãa]o[^\d]{0,30}${D}`, "i").exec(t) ?? new RegExp(String.raw`emitid[ao] em[^\d]{0,15}${D}`, "i").exec(t);
  const pr = new RegExp(String.raw`data da proposta[^\d]{0,15}${D}`, "i").exec(t);
  const nu = /(?:ap[óo]lice|proposta|certificado)\s*(?:n[ºo°.]*|número)\s*:?\s*([\d.\-/]{5,25})/i.exec(t);
  const tipo: DadosPdf["tipo"] = /ENDOSSO/.test(cab.slice(0, 600)) || /ENDOSSO/i.test(nomeArquivo) ? "endosso"
    : /CERTIFICADO/.test(cab) || /certificado|caucao|capitaliza/i.test(nomeArquivo) ? "certificado"
    : /BOLETO/i.test(nomeArquivo) ? "boleto"
    : /AP[ÓO]LICE/.test(cab) && !/PROPOSTA/.test(cab.slice(0, 400)) ? "apolice"
    : /COTA[ÇC][ÃA]O/.test(cab) ? "cotacao"
    : /PROPOSTA|LOCAT[ÁA]RIO \(GARANTIDO\)|VIG[ÊE]NCIA DO SEGURO/.test(cab) || /proposta/i.test(nomeArquivo) ? "proposta"
    : /AP[ÓO]LICE/i.test(nomeArquivo) ? "apolice" : "outro";
  return {
    vigencia_inicio: iso(vig?.[1]), vigencia_fim: iso(vig?.[2]), documentos: [...docs],
    premio_total: tot, premio_liquido: liq, iof: iofV, adicional_fracionamento: adic, premio_soma_ok: somaOk, parcelas: nPar ? Number(nPar) : par ? Number(par[1]) : null, valor_parcela: reais(vPar ?? par?.[2]),
    data_emissao: iso(em?.[1]), data_proposta: iso(pr?.[1]), numero: nu?.[1] ?? null, tipo,
    apolices_citadas: [...new Set([...t.matchAll(/ap[óo]lice(?:\s*(?:n[ºo°.]*|número|digital))?[^\d]{0,25}(\d[\d.\-/ ]{4,28}\d)/gi)].map((m) => m[1].replace(/\D/g, "")).filter((d) => d.length >= 6 && d.length <= 22))],
    numero_endosso: /endosso\s*(?:n[ºo°.]*|número)?\s*:?\s*(\d[\d.\-/]{2,20}\d)/i.exec(t)?.[1] ?? null,
  };
}
