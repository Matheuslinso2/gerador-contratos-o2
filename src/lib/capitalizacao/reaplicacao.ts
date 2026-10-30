import type { BitrixItemRaw } from "@/lib/bitrix/client";
import type { CardCapitalizacao, LinhaStatusCap } from "./painel";

// Aba "Reaplicação" do painel de Capitalização (pedido do Matheus, 30/10/2026): funil
// Reaplicações da SPA 1048 (categoria 38). Cada card é um título que vence e precisa ser
// reaplicado ("VENCE dd/mm/aaaa | titular | CORP nnn"). Os cards nascem em "Final de
// vigência" antes do vencimento. Renovado = reaplicação feita; Não renovou = perdida.
// Competência = mês da VIGÊNCIA (fim da vigência do título); o fluxo do mês (cards criados
// no mês + herança) é fatiado em "vigência neste mês" e "vigência em outros meses".

export const CATEGORIA_REAPLICACAO = 38;

export type EtapaReaplicacao = { statusId: string; nome: string; semantica: "P" | "S" | "F" };
export const ETAPAS_REAPLICACAO: EtapaReaplicacao[] = [
  { statusId: "DT1048_38:NEW", nome: "Final de vigência", semantica: "P" },
  { statusId: "DT1048_38:PREPARATION", nome: "Liberado para cadastro", semantica: "P" },
  { statusId: "DT1048_38:CLIENT", nome: "Cadastrado", semantica: "P" },
  { statusId: "DT1048_38:UC_XCP7EZ", nome: "Conferência", semantica: "P" },
  { statusId: "DT1048_38:SUCCESS", nome: "Renovado", semantica: "S" },
  { statusId: "DT1048_38:FAIL", nome: "Não renovou", semantica: "F" },
];
const etapaPorId = new Map(ETAPAS_REAPLICACAO.map((e) => [e.statusId, e]));

export type CardReaplicacao = CardCapitalizacao & { vigenciaMes: string | null };

export type KpisReaplicacao = {
  entradas: number; // cards criados no mês
  renovadas: number; // chegaram em Renovado no mês
  naoRenovaram: number; // chegaram em Não renovou no mês
  emAndamento: number; // abertos (criados até o fim do mês e ainda sem desfecho)
  taxaRenovacao: number | null; // renovadas ÷ (renovadas + não renovaram)
  valorRenovado: number; // valor do título (atualizado quando houver) das renovadas
  comissaoRenovada: number;
  vigenciaNoMes: { total: number; renovadas: number };
  vigenciaOutrosMeses: { total: number; renovadas: number };
};

export type PainelReaplicacao = {
  competencia: string;
  kpis: KpisReaplicacao;
  kpisAnterior: KpisReaplicacao & { competencia: string };
  funil: { statusId: string; nome: string; semantica: "P" | "S" | "F"; quantidadeAtual: number }[];
  statusImobiliarias: LinhaStatusCap[];
  statusSeguradoras: LinhaStatusCap[];
  titulos: { id: number; titular: string; imobiliaria: string; etapaNome: string; valorTitulo: number; comissao: number; vigencia: string | null }[];
};

const texto = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

function dinheiro(valor: unknown): number {
  if (typeof valor === "number" && Number.isFinite(valor)) return valor;
  const bruto = texto(valor).split("|")[0].replace(/\s/g, "");
  if (!bruto) return 0;
  const normalizado = bruto.includes(",") ? bruto.replace(/\./g, "").replace(",", ".") : bruto;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : 0;
}

function data(valor: unknown): Date | null {
  const t = texto(valor);
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

const FORMATO_MES = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" });
function mesDe(d: Date): string {
  const p = FORMATO_MES.formatToParts(d);
  return `${p.find((x) => x.type === "year")?.value}-${p.find((x) => x.type === "month")?.value}`;
}

function mesAnteriorDe(competencia: string): string {
  const [ano, mes] = competencia.split("-").map(Number);
  const d = new Date(Date.UTC(ano, mes - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// PORTO / PORTOCAP -> PORTO CAP (mesmo critério do painel de títulos novos).
function seguradoraCanonica(valor: string): string {
  const v = valor.trim().toUpperCase().replace(/\s+/g, " ");
  if (!v) return "NÃO INFORMADA";
  if (v === "PORTO" || v === "PORTOCAP" || v === "PORTO CAP") return "PORTO CAP";
  if (v === "MAPFRE" || v === "MAPFRECAP" || v === "MAPFRE CAP") return "MAPFRE CAP";
  return v;
}

// Mês da vigência = quando o título VENCE e precisa ser reaplicado: o "VENCE dd/mm/aaaa" do
// título; senão o "Início da vigência" do card (a nova vigência começa no vencimento). Não usa o
// "Fim da vigência" (é o fim da vigência NOVA, um ano ou mais depois). O texto do campo é lido
// sem mudar de fuso: o Bitrix manda a data como meia-noite com offset e isso deslocaria o mês.
function mesDaVigencia(item: BitrixItemRaw): string | null {
  const m = texto(item.title).match(/VENCE\s+(\d{2})\/(\d{2})\/(\d{4})/i);
  if (m) return `${m[3]}-${m[2]}`;
  const ini = texto(item["ufCrm14CapVigInicio"]).match(/^(\d{4}-\d{2})/);
  return ini ? ini[1] : null;
}

function mapear(item: BitrixItemRaw): CardReaplicacao | null {
  const criadoEm = data(item.createdTime);
  if (!criadoEm) return null;
  const etapa = etapaPorId.get(texto(item.stageId));
  const semantica = etapa?.semantica ?? "P";
  const movidoEm = data(item.movedTime);
  // Valor atualizado do título (reaplicação) quando preenchido; senão o valor do título.
  const valor = dinheiro(item["ufCrm14_1792780810"]) || dinheiro(item["ufCrm14CapValorTit"]);
  return {
    id: Number(item.id),
    titulo: texto(item.title),
    etapaId: texto(item.stageId),
    etapaNome: etapa?.nome ?? texto(item.stageId),
    semantica,
    criadoEm,
    movidoEm,
    concluidoEm: semantica === "P" ? null : (movidoEm ?? criadoEm),
    valorTitulo: valor,
    comissao: dinheiro(item["ufCrm14CapComissao"]),
    diasParadoEtapaAtual: null,
    titular: texto(item["ufCrm14CapLocatPfNome"]) || texto(item["ufCrm14CapLocatPjRazao"]) || texto(item.title) || "—",
    imobiliaria: texto(item["ufCrm14CapImobAdmin"]) || texto(item["ufCrm14CapCorretor"]) || "—",
    seguradora: seguradoraCanonica(texto(item["ufCrm14CapSeguradora"])),
    companyId: Number(item.companyId) > 0 ? Number(item.companyId) : null,
    vigenciaMes: mesDaVigencia(item),
  };
}

const noMes = (c: CardCapitalizacao, competencia: string) => !!c.concluidoEm && mesDe(c.concluidoEm) === competencia;

// Fluxo do mês: criados no mês + herdados (criados antes e ainda abertos no começo do mês).
function recorte(cards: CardReaplicacao[], competencia: string): CardReaplicacao[] {
  return cards.filter((c) => {
    const criado = mesDe(c.criadoEm);
    return criado === competencia || (criado < competencia && (!c.concluidoEm || mesDe(c.concluidoEm) >= competencia));
  });
}

function kpis(cards: CardReaplicacao[], competencia: string): KpisReaplicacao {
  const fluxo = recorte(cards, competencia);
  const renovadasLista = fluxo.filter((c) => noMes(c, competencia) && c.semantica === "S");
  const naoRenovaram = fluxo.filter((c) => noMes(c, competencia) && c.semantica === "F").length;
  const doMes = fluxo.filter((c) => c.vigenciaMes === competencia);
  const outros = fluxo.filter((c) => c.vigenciaMes !== competencia);
  const ehRenovada = (c: CardReaplicacao) => noMes(c, competencia) && c.semantica === "S";
  return {
    entradas: cards.filter((c) => mesDe(c.criadoEm) === competencia).length,
    renovadas: renovadasLista.length,
    naoRenovaram,
    emAndamento: fluxo.filter((c) => !c.concluidoEm || mesDe(c.concluidoEm) > competencia).length,
    taxaRenovacao: renovadasLista.length + naoRenovaram > 0 ? renovadasLista.length / (renovadasLista.length + naoRenovaram) : null,
    valorRenovado: renovadasLista.reduce((s, c) => s + c.valorTitulo, 0),
    comissaoRenovada: renovadasLista.reduce((s, c) => s + c.comissao, 0),
    vigenciaNoMes: { total: doMes.length, renovadas: doMes.filter(ehRenovada).length },
    vigenciaOutrosMeses: { total: outros.length, renovadas: outros.filter(ehRenovada).length },
  };
}

function linhas(
  cards: CardReaplicacao[],
  competencia: string,
  chaveDe: (c: CardReaplicacao) => { chave: string; nome: string }
): LinhaStatusCap[] {
  const mapa = new Map<string, LinhaStatusCap>();
  const linha = (c: CardReaplicacao) => {
    const { chave, nome } = chaveDe(c);
    let l = mapa.get(chave);
    if (!l) mapa.set(chave, (l = { chave, nome, solicitacoes: 0, emAndamento: 0, naoPagas: 0, fechadas: 0, premioSolicitado: 0, premioFechado: 0, comissaoFechada: 0, solicitacoesMesAnterior: 0 }));
    return l;
  };
  for (const c of recorte(cards, competencia)) {
    const l = linha(c);
    l.solicitacoes++;
    l.premioSolicitado += c.valorTitulo;
    if (!c.concluidoEm || mesDe(c.concluidoEm) > competencia) l.emAndamento++;
    if (noMes(c, competencia) && c.semantica === "F") l.naoPagas++; // aqui = "não renovou"
    if (noMes(c, competencia) && c.semantica === "S") {
      l.fechadas++; // aqui = "renovadas"
      l.premioFechado += c.valorTitulo;
      l.comissaoFechada += c.comissao;
    }
  }
  for (const c of recorte(cards, mesAnteriorDe(competencia))) linha(c).solicitacoesMesAnterior++;
  return [...mapa.values()]
    .filter((l) => l.solicitacoes > 0 || l.solicitacoesMesAnterior > 0)
    .sort((a, b) => b.solicitacoes - a.solicitacoes || a.nome.localeCompare(b.nome, "pt-BR"));
}

const semAcentos = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

export function montarReaplicacao(itensSpa: BitrixItemRaw[], competencia: string, _agora: Date): PainelReaplicacao {
  const cards = itensSpa
    .filter((i) => Number(i.categoryId) === CATEGORIA_REAPLICACAO)
    .map(mapear)
    .filter((c): c is CardReaplicacao => c !== null);

  const contagemPorEtapa = new Map<string, number>();
  for (const c of cards) {
    // Só cards já criados até a competência; abertos contam pelo estado de agora e
    // Renovado/Não renovou só os concluídos neste mês.
    if (mesDe(c.criadoEm) > competencia) continue;
    if (c.semantica !== "P" && !noMes(c, competencia)) continue;
    contagemPorEtapa.set(c.etapaId, (contagemPorEtapa.get(c.etapaId) ?? 0) + 1);
  }

  const doFluxo = recorte(cards, competencia);
  return {
    competencia,
    kpis: kpis(cards, competencia),
    kpisAnterior: { competencia: mesAnteriorDe(competencia), ...kpis(cards, mesAnteriorDe(competencia)) },
    funil: ETAPAS_REAPLICACAO.map((e) => ({ ...e, quantidadeAtual: contagemPorEtapa.get(e.statusId) ?? 0 })),
    statusImobiliarias: linhas(cards, competencia, (c) => {
      const nome = c.imobiliaria === "—" ? "NÃO INFORMADA" : c.imobiliaria.trim().toUpperCase();
      return { chave: c.companyId ? `bitrix_empresa:${c.companyId}` : `cap_nome:${semAcentos(nome)}`, nome };
    }),
    statusSeguradoras: linhas(cards, competencia, (c) => ({ chave: `seg:${c.seguradora}`, nome: c.seguradora })),
    titulos: doFluxo
      .map((c) => ({ id: c.id, titular: c.titular, imobiliaria: c.imobiliaria, etapaNome: c.etapaNome, valorTitulo: c.valorTitulo, comissao: c.comissao, vigencia: c.vigenciaMes }))
      .sort((a, b) => b.id - a.id),
  };
}
