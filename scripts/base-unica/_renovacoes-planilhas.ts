// Leitor das abas de RENOVAÇÃO das planilhas congeladas (bucket
// planilhas-congeladas, referência de 18/10/2026), para a Base Única pôr as
// renovações de Seguro Fiança e de Ramos Elementares no Power BI - O2 Seguros.
// Levantamento (21/10/2026, varredura das abas das 174 cópias):
//  - Fiança: as planilhas mensais de análise só têm a aba RENOVAÇÕES de
//    nov/2025 em diante (2020 a out/2025 não têm aba de renovação; 2016–2019
//    são outro formato, não lido aqui). Colunas por NOME: STATUS, FIM DE
//    VIGENCIA, IMOBILIARIA, DATA RECEB, LOCATARIO, APOLICE, NOSSO Nº CORP,
//    SEGURADORA, PLANO, ALUGUEL, COMISSAO (%), PREMIO LIQUIDO, PREMIO TOTAL.
//    A partir de out/2026 a fonte é o funil Renovação do Bitrix (categoria 32).
//  - RE: planilhas "COTAÇÃO DIÁRIA RE" têm a aba da competência (RENOVAÇÃO em
//    nov/2025, BASE RN DEZ, BASE RN JAN 2026, RN FEV, RN MARÇO … RN SETEMBRO)
//    e a da competência seguinte (não lida: é a mesma lista do mês seguinte).
//    Colunas por NOME (o layout muda todo mês): STATUS, OPERACAO, APOLICE,
//    FIM. VIG, IMOBILIARIA, SEGURADO, RAMO, SEGURADORA, PREM. TOTAL,
//    COMISSAO, COTADOR/NEGOCIADOR, DATA DE ENVIO DA COTACAO, DATA EFETIVACAO.
//    A partir de out/2026 a fonte é o funil Renovações do Bitrix (categoria 34).
// Abas de LOTE (RN LOTES / RENOVAÇÃO LOTES) não entram: são o mesmo lote
// resumido por imobiliária (contariam dobrado).
import { listarCopias, abrirCopia, norm } from "./_copias.mjs";
import { imobiliariaCanonica, ramoCanonico, statusCanonico } from "@/lib/ramos-elementares/analise";

export type LinhaRenovacaoPlanilha = {
  produto: "fianca" | "re" | "automovel";
  comp: string; // competência da aba (mês do vencimento / lote)
  arquivoId: string;
  arquivoNome: string;
  aba: string;
  linha: number;
  status: string; // como está na planilha (normalizado)
  statusPadrao: "Convertido" | "Perdido" | "Em análise" | "Cancelado";
  imobiliaria: string | null;
  apolice: string | null;
  fimVigencia: string | null; // AAAA-MM-DD
  dataRecebimento: string | null; // Fiança: DATA RECEB; RE: DATA DE ENVIO DA COTACAO
  dataEfetivacao: string | null; // só RE tem a coluna
  seguradora: string | null;
  ramo: string | null;
  premio: number | null;
  comissao: number | null; // R$ (RE); Fiança: prêmio líquido × % quando a coluna é percentual
  responsavel: string | null;
  extras: Record<string, unknown>;
};

type Copia = { arquivo_id: string; nome: string; pasta: string; copia_storage_path: string | null };
const MESES = ["JANEIRO", "FEVEREIRO", "MARCO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"];
const ABREV = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

export function competenciaDoNome(nome: string, pasta = ""): string | null {
  const n = norm(nome);
  const mes = MESES.findIndex((m) => n.includes(m));
  const ano = (n.match(/20\d\d/) || [])[0] || (norm(pasta).match(/20\d\d/) || [])[0];
  return mes >= 0 && ano ? `${ano}-${String(mes + 1).padStart(2, "0")}` : null;
}
const txt = (v: unknown) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());
// Datas da cópia xlsx vêm como Date (meia-noite de Brasília) ou texto d/m/aaaa.
// Ano fora de 2000–2100 (digitação, ex.: 20255) vira vazio.
const anoOk = (iso: string | null) => (iso && /^20[0-9][0-9]-/.test(iso) ? iso : null);
function data(v: unknown, anoRef?: string): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date && !isNaN(v.getTime())) return anoOk(new Date(v.getTime() - 3 * 3600_000).toISOString().slice(0, 10));
  if (typeof v === "number" && v > 20000 && v < 80000) return anoOk(new Date(Math.round((v - 25569) * 86400e3)).toISOString().slice(0, 10));
  const m = String(v).trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (!m) return null;
  let [, d, mes, a] = m;
  if (!a) a = anoRef ?? "";
  if (a.length === 2) a = "20" + a;
  if (!a || +mes > 12 || +d > 31 || +d < 1) return null;
  const iso = `${a}-${mes.padStart(2, "0")}-${d.padStart(2, "0")}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  return isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== iso ? null : iso;
}
function valor(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  const s = String(v).replace(/R\$|\s/g, "");
  if (!/\d/.test(s) || /#/.test(s)) return null;
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}
function cabecalho(linhas: unknown[][], ancora: RegExp) {
  for (let i = 0; i < Math.min(8, linhas.length); i++) {
    const l = (linhas[i] || []).map((x) => (x instanceof Date ? "" : norm(x)));
    if (l.some((c) => ancora.test(c))) return { indice: i, colunas: l };
  }
  return null;
}

// Status da Fiança (renovação) → padrão da base única. Vocabulário visto nas
// abas RENOVAÇÕES nov/2025–out/2026; o que não casar fica "Em análise" e é
// listado pela simulação para o Matheus validar.
export const STATUS_RENOVACAO_FIANCA: Record<string, LinhaRenovacaoPlanilha["statusPadrao"]> = {
  RENOVADO: "Convertido", RENOVADA: "Convertido", CONVERTIDO: "Convertido", EMITIDO: "Convertido", "EM EMISSAO": "Convertido", EFETIVADO: "Convertido", CONTRATADO: "Convertido",
  "NAO RENOVADO": "Perdido", "NAO RENOVADA": "Perdido", NEGATIVADO: "Perdido", PERDIDO: "Perdido", DESISTENCIA: "Perdido", "SEM RETORNO": "Perdido",
  "ENTREGA DE CHAVES": "Perdido", "ENTREGA DAS CHAVES": "Perdido", "TROCA DE GARANTIA": "Perdido", SINISTRO: "Perdido", "TROCA DE CORRETOR": "Perdido", "CAP O2": "Perdido",
  CANCELADO: "Cancelado", CANCELADA: "Cancelado",
};
export function statusPadraoRe(s: string): LinhaRenovacaoPlanilha["statusPadrao"] {
  if (s === "EFETIVADO") return "Convertido";
  if (s === "CANCELADO") return "Cancelado";
  if (s === "NÃO EFETIVADO" || s === "SEM PARCERIA") return "Perdido";
  return "Em análise";
}

export async function lerRenovacoesFiancaPlanilhas(de = "2025-11", ate = "2026-09"): Promise<LinhaRenovacaoPlanilha[]> {
  const copias = ((await listarCopias()) as Copia[]).filter(
    (c) => c.copia_storage_path && /^PLANILHA|^\d\d PLANILHA/.test(norm(c.nome)) && !/COPIA DE|PADRAO|TITULOS|CAPITALIZA|CONTROLE/.test(norm(c.nome))
  );
  const saida: LinhaRenovacaoPlanilha[] = [];
  for (const c of copias) {
    const comp = competenciaDoNome(c.nome, c.pasta);
    if (!comp || comp < de || comp > ate) continue;
    const abas = (await abrirCopia(c, { bruto: true })) as [string, unknown[][]][];
    const aba = abas.find(([n]) => /^RENOVAC/.test(norm(n)));
    if (!aba) continue;
    const [nomeAba, linhas] = aba;
    const cab = cabecalho(linhas, /^IMOBILI/);
    if (!cab) continue;
    const col = (re: RegExp) => cab.colunas.findIndex((x) => re.test(x));
    const k = {
      status: col(/^STATUS$/), fimVig: col(/^FIM DE VIGENCIA/), imob: col(/^IMOBILI/), dataReceb: col(/^DATA RECEB/), cotador: col(/^COTADOR$/),
      locatario: col(/^LOCATARIO$/), apolice: col(/^APOLICE$/), corp: col(/^NOSSO N/), seguradora: col(/^SEGURADORA$/), plano: col(/^PLANO$/),
      aluguel: col(/^ALUGUEL$/), comissaoPct: col(/^COMISSAO$/), premioLiq: col(/^PREMIO LIQUIDO$/), premioTotal: col(/^PREMIO TOTAL$/), proposta: col(/^COTACAO\/PROPOSTA/),
    };
    linhas.slice(cab.indice + 1).forEach((l, i) => {
      const g = (ix: number) => (ix >= 0 ? l?.[ix] : null);
      const status = norm(g(k.status));
      const imob = txt(g(k.imob));
      const locatario = txt(g(k.locatario));
      if (!status && !imob && !locatario) return;
      if (!status || /^#/.test(status) || /^#/.test(imob)) return;
      const premio = valor(g(k.premioLiq));
      const pct = valor(g(k.comissaoPct));
      saida.push({
        produto: "fianca", comp, arquivoId: c.arquivo_id, arquivoNome: c.nome, aba: nomeAba, linha: cab.indice + 2 + i,
        status, statusPadrao: STATUS_RENOVACAO_FIANCA[status] ?? "Em análise",
        imobiliaria: imob || null, apolice: txt(g(k.apolice)) || null,
        fimVigencia: data(g(k.fimVig), comp.slice(0, 4)), dataRecebimento: data(g(k.dataReceb), comp.slice(0, 4)), dataEfetivacao: null,
        seguradora: txt(g(k.seguradora)) || null, ramo: null,
        premio, comissao: premio !== null && pct !== null ? Math.round(premio * (pct > 1 ? pct / 100 : pct) * 100) / 100 : null,
        responsavel: txt(g(k.cotador)) || null,
        extras: { nosso_numero_corp: txt(g(k.corp)) || null, plano: txt(g(k.plano)) || null, aluguel: valor(g(k.aluguel)), comissao_percentual: pct, proposta: txt(g(k.proposta)) || null, premio_total: valor(g(k.premioTotal)), locatario_nome: locatario || null },
      });
    });
  }
  return saida.sort((a, b) => a.comp.localeCompare(b.comp) || a.linha - b.linha);
}

// Aba de renovação da PRÓPRIA competência do arquivo de RE (a da competência
// seguinte é a mesma lista do mês seguinte e não é lida).
function abaRenovacaoDoMes(abas: [string, unknown[][]][], comp: string) {
  const mes = Number(comp.slice(5)) - 1;
  const candidatos = [`RN ${MESES[mes]}`, `RN ${ABREV[mes]}`, `BASE RN ${ABREV[mes]}`, `BASE RN ${ABREV[mes]} ${comp.slice(0, 4)}`, `BASE RN ${MESES[mes]}`, "RENOVACAO", "RENOVACOES"];
  return abas.find(([n]) => candidatos.includes(norm(n)));
}

export async function lerRenovacoesRePlanilhas(de = "2025-11", ate = "2026-09"): Promise<LinhaRenovacaoPlanilha[]> {
  const copias = ((await listarCopias()) as Copia[]).filter((c) => c.copia_storage_path && /COTACAO DIARIA RE/.test(norm(c.nome)) && !/^COPIA DE/.test(norm(c.nome)));
  const saida: LinhaRenovacaoPlanilha[] = [];
  for (const c of copias) {
    const n = norm(c.nome);
    const m = n.match(/(JANEIRO|FEVEREIRO|MARCO|ABRIL|MAIO|JUNHO|JULHO|AGOSTO|SETEMBRO|OUTUBRO|NOVEMBRO|DEZEMBRO)\s*\/\s*(\d{4})/);
    if (!m) continue;
    const comp = `${m[2]}-${String(MESES.indexOf(m[1]) + 1).padStart(2, "0")}`;
    if (comp < de || comp > ate) continue;
    const abas = (await abrirCopia(c, { linhas: 5000, bruto: true })) as [string, unknown[][]][];
    const aba = abaRenovacaoDoMes(abas, comp);
    if (!aba) continue;
    const [nomeAba, linhas] = aba;
    const cab = cabecalho(linhas, /^IMOBILI/);
    if (!cab) continue;
    const col = (re: RegExp) => cab.colunas.findIndex((x) => re.test(x));
    const k = {
      status: col(/^STATUS$/), operacao: col(/^OPERACAO$/), apolice: col(/^APOLICE$/), fimVig: col(/^FIM\.? ?VIG/), imob: col(/^IMOBILI/), segurado: col(/^SEGURADO$/),
      ramo: col(/^RAMO$/), seguradora: col(/^SEGURADORA$/), premioTotal: col(/^PREM\.? TOTAL$/), premioLiq: col(/^PREM\.? LIQ\.?$/), comissao: col(/^COMISSAO$/),
      repasse: col(/^REPASSE$/), cotador: col(/^(COTADOR|NEGOCIADOR)$/), dataEnvio: col(/^(DATA|HORA) DE ENVIO DA COTACAO/), dataEfet: col(/^DATA EFETIVACAO/), efetivador: col(/^EFETIVADOR$/),
    };
    linhas.slice(cab.indice + 1).forEach((l, i) => {
      const g = (ix: number) => (ix >= 0 ? l?.[ix] : null);
      const statusRaw = txt(g(k.status));
      const imob = txt(g(k.imob));
      const seg = txt(g(k.segurado));
      if (!statusRaw || /^\d+$/.test(statusRaw) || (!imob && !seg)) return;
      const status = statusCanonico(statusRaw);
      const ramo = ramoCanonico(txt(g(k.ramo)));
      saida.push({
        produto: ramo === "AUTOMÓVEL" ? "automovel" : "re", comp, arquivoId: c.arquivo_id, arquivoNome: c.nome.trim(), aba: nomeAba, linha: cab.indice + 2 + i,
        status, statusPadrao: statusPadraoRe(status),
        imobiliaria: imob ? imobiliariaCanonica(imob) : null, apolice: txt(g(k.apolice)) || null,
        fimVigencia: data(g(k.fimVig), comp.slice(0, 4)), dataRecebimento: data(g(k.dataEnvio), comp.slice(0, 4)), dataEfetivacao: data(g(k.dataEfet), comp.slice(0, 4)),
        seguradora: txt(g(k.seguradora)).toUpperCase() || null, ramo,
        premio: valor(g(k.premioTotal)), comissao: valor(g(k.comissao)),
        responsavel: txt(g(k.cotador)) || null,
        extras: { operacao: txt(g(k.operacao)) || null, premio_liquido: valor(g(k.premioLiq)), repasse: valor(g(k.repasse)), efetivador: txt(g(k.efetivador)) || null, segurado_nome: seg || null },
      });
    });
  }
  return saida.sort((a, b) => a.comp.localeCompare(b.comp) || a.linha - b.linha);
}
