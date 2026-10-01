import "server-only";
import {
  buscarEmpresas,
  buscarUsuarios,
  listarHistoricoEtapasCategoria,
  listarItensSpaCategoria,
  type BitrixItemRaw,
  type BitrixStageHistoryEvent,
} from "./client";
import { minutosComerciaisEntre } from "./horarioComercial";

// Aba "Renovação" do painel /seguro-fianca -- funil de Renovação da SPA
// Seguro Fiança (entityTypeId 1042, categoryId 32, criado em 30/09/2026).
// Mesma lógica mensal do resto do painel: competência = mês de ENTRADA do
// card no funil (createdTime em Brasília); "herdado" = card de mês anterior
// ainda em andamento no início da competência (ou resolvido durante ela).
// Mês atual é calculado ao vivo e gravado em seguro_fianca_renovacao_snapshots;
// meses fechados são congelados pelo cron do dia 1º (/api/cron/congelar-paineis).
// Plano completo do funil: seguro-fianca-analise/PLANEJAMENTO-RENOVACAO-FIANCA-PARA-CLAUDE.md

const ENTITY_TYPE_ID = 1042;
export const CATEGORIA_RENOVACAO = 32;

// stageIds devolvidos pelo Bitrix na criação do funil (30/09/2026) --
// reconfira com crm.status.list (ENTITY_ID=DYNAMIC_1042_STAGE_32) se uma
// etapa for renomeada ou recriada.
export const ETAPAS_RENOVACAO: { id: string; nome: string; semantica: "P" | "S" | "F" }[] = [
  { id: "DT1042_32:NEW", nome: "Entrada e conferência", semantica: "P" },
  { id: "DT1042_32:PREPARATION", nome: "Aguardando cotação", semantica: "P" },
  { id: "DT1042_32:CLIENT", nome: "Liberado para negociação", semantica: "P" },
  { id: "DT1042_32:UC_RNNEG", nome: "Em negociação", semantica: "P" },
  { id: "DT1042_32:UC_RNLIB", nome: "Liberado para renovar", semantica: "P" },
  { id: "DT1042_32:UC_RND01", nome: "Renovar dia 01", semantica: "P" },
  { id: "DT1042_32:UC_RNCON", nome: "Concluir", semantica: "P" },
  { id: "DT1042_32:UC_RNPEN", nome: "Pendente", semantica: "P" },
  { id: "DT1042_32:SUCCESS", nome: "Sucesso", semantica: "S" },
  { id: "DT1042_32:FAIL", nome: "Perdido", semantica: "F" },
];
const ETAPA_POR_ID = new Map(ETAPAS_RENOVACAO.map((e) => [e.id, e]));
const ETAPA_AGUARDANDO_COTACAO = "DT1042_32:PREPARATION";
const ETAPA_SUCESSO = "DT1042_32:SUCCESS";
const ETAPA_RENOVAR_DIA_01 = "DT1042_32:UC_RND01";
// Etapas que contam como trabalho de efetivação da Vic -- "Renovar dia 01"
// fica de fora de propósito: é espera pedida pela imobiliária, não trabalho.
const ETAPAS_EFETIVACAO = new Set(["DT1042_32:UC_RNLIB", "DT1042_32:UC_RNCON", "DT1042_32:UC_RNPEN"]);

const CAMPO_REAJUSTE_PCT = "ufCrm10_1778259647";
const CAMPO_PREMIO_LIQUIDO = "ufCrm10_1781029986152";
const CAMPO_COMISSAO_PCT = "ufCrm10_1779820737";
// "Seguradora anterior" (ufCrm10_1790800679) saiu do card em 01/10/2026 -- não é mais lida.
const CAMPO_SEGURADORA_ESCOLHIDA = "ufCrm10_1776352200";
const CAMPO_MOTIVO_PERDA = "ufCrm10_1790800692";
const CAMPO_FIM_VIGENCIA_ANTERIOR = "ufCrm10_1790800678";
// "Taxa do pacote de locação (%)" da renovação (nova) -- campo criado junto
// com o funil (30/09/2026), equivalente ao % Pacote do quadro de status.
const CAMPO_TAXA_PACOTE = "ufCrm10_1790800688";
const CAMPO_RESPONSAVEL_CADASTRO = "ufCrm10_1786644365";
const CAMPO_RESPONSAVEIS_COTACAO = "ufCrm10_1786644429";
const CAMPO_RESPONSAVEIS_NEGOCIACAO = "ufCrm10_1786644450";
const CAMPO_RESPONSAVEL_EFETIVACAO = "ufCrm10_1786644465";
const CAMPO_INICIO_PREENCHIMENTO = "ufCrm10_1786550633206";
const CAMPO_FIM_PREENCHIMENTO = "ufCrm10_1786550683792";
const CAMPO_INICIO_COTACAO = "ufCrm10_1785946291045";
const CAMPO_FIM_COTACAO = "ufCrm10_1785946326148";
const CAMPO_INICIO_NEGOCIACAO = "ufCrm10_1790800689";
const CAMPO_FIM_NEGOCIACAO = "ufCrm10_1790800690";
// Mesmo campo que a equipe já usa no Fiança pra registrar o recebimento do
// contrato -- na Renovação vale para contrato ou aditivo.
const CAMPO_RECEBIMENTO_CONTRATO = "ufCrm10_1786112097172";

// IDs das opções das listas, devolvidos pelo Bitrix na criação/consulta
// dos campos (30/09/2026).
const SEGURADORA_POR_ID: Record<string, string> = {
  "3240": "Too", "3242": "Porto", "3244": "Pottencial", "3246": "Tokio", "3248": "Junto", // Seguradora anterior
  "1808": "Too", "1810": "Porto", "1812": "Pottencial", "1814": "Tokio", "1816": "Junto", // Seguradora Escolhida
};
export const MOTIVOS_PERDA_RENOVACAO: { id: string; nome: string }[] = [
  { id: "3250", nome: "Troca de garantia" },
  { id: "3252", nome: "Entrega das chaves" },
  { id: "3254", nome: "Sinistro" },
  { id: "3256", nome: "Preço" },
  { id: "3258", nome: "CAP O2" },
  { id: "3260", nome: "Troca de corretor" },
  { id: "3262", nome: "Sem retorno" },
  { id: "3264", nome: "Outros motivos" },
];
const MOTIVO_POR_ID = new Map(MOTIVOS_PERDA_RENOVACAO.map((m) => [m.id, m.nome]));
export const SEM_IMOBILIARIA = "Sem imobiliária";

// ---------- helpers de data ----------

// Timestamps de EVENTO (createdTime, histórico de etapa) vêm com offset real
// do servidor -- converte o instante pro dia civil de Brasília.
function diaBrasilia(instante: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instante);
}

// Campos datetime preenchidos à mão (USE_TIMEZONE=N) guardam a hora de
// parede de Brasília, mas o Bitrix devolve com o rótulo +03:00 do servidor
// (ex: digitado 14:00 -> "…T14:00:00+03:00"). Lê a hora como Brasília,
// ignorando o rótulo -- senão o horário comercial sai deslocado 6h.
function horaManual(v: unknown): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(v ?? ""));
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4] ?? "00"}-03:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}
function diaManual(v: unknown): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v ?? ""));
  return m ? m[1] : "";
}

function diasDoMes(competencia: string): string[] {
  const [ano, mes] = competencia.split("-").map(Number);
  const ultimoDia = new Date(ano, mes, 0).getDate();
  return Array.from({ length: ultimoDia }, (_, i) => `${competencia}-${String(i + 1).padStart(2, "0")}`);
}

// ---------- helpers de valor ----------

function numero(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).split("|")[0]);
  return Number.isFinite(n) ? n : null;
}
function idsUsuarios(v: unknown): number[] {
  if (v === null || v === undefined || v === "") return [];
  return (Array.isArray(v) ? v : [v]).map(Number).filter((n) => Number.isFinite(n) && n > 0);
}

export type EstatisticaTempoRenovacao = { n: number; media: number; mediana: number };
function estatisticas(minutos: number[]): EstatisticaTempoRenovacao {
  if (!minutos.length) return { n: 0, media: 0, mediana: 0 };
  const o = [...minutos].sort((a, b) => a - b);
  const meio = Math.floor(o.length / 2);
  return {
    n: o.length,
    media: o.reduce((s, x) => s + x, 0) / o.length,
    mediana: o.length % 2 ? o[meio] : (o[meio - 1] + o[meio]) / 2,
  };
}

// ---------- tipos do payload ----------

export type ContagemStatus = { total: number; renovados: number; perdidos: number; emAndamento: number };

// Valores por imobiliária do quadro "status de todos os cards" da Renovação
// (mesmo modelo do quadro de status da aba Imobiliária, Matheus 01/10/2026).
// Médias sobre os cards do mês com o campo preenchido; null = nenhum.
export type ValoresImobiliariaRenovacao = {
  premioMedio: number | null; // prêmio líquido
  comissaoMedia: number | null; // prêmio líquido × % comissão
  reajusteMedio: number | null; // %
  taxaPacoteMedia: number | null; // %
  premioRenovado: number; // soma dos renovados no mês
  comissaoRenovada: number;
};

export type PainelRenovacao = {
  competencia: string;
  totalCardsFunil: number;
  kpis: {
    total: number; // novos + herdados relevantes neste mês
    novos: number;
    herdados: number;
    emAndamento: number;
    renovados: number; // entraram em Sucesso neste mês
    perdidos: number; // entraram em Perdido neste mês
    taxaRenovacao: number | null; // renovados / (renovados + perdidos) -- null sem base
  };
  porEtapa: { etapa: string; quantidade: number }[]; // cards em andamento, etapa atual
  controleDiario: { data: string; valoresAtualizados: number; contratosRecebidos: number; efetivacoes: number }[];
  perdasPorMotivo: { motivo: string; quantidade: number }[];
  reajuste: { mediaGeral: number | null; nGeral: number; mediaRenovados: number | null; nRenovados: number };
  financeiro: { premioLiquidoRenovado: number; comissaoRenovada: number };
  seguradoras: {
    mesmaSeguradora: number;
    trocouSeguradora: number;
    semInformacao: number;
    porSeguradoraNova: { seguradora: string; renovados: number }[];
  };
  // Partial: retratos salvos antes de 01/10/2026 não têm os valores.
  imobiliarias: ({ nome: string; novos: number; taxaRenovacao: number | null } & ContagemStatus &
    Partial<ValoresImobiliariaRenovacao>)[];
  equipe: {
    conferencia: Record<string, EstatisticaTempoRenovacao>; // Responsável pelo Cadastro
    cotacao: Record<string, EstatisticaTempoRenovacao>; // Responsáveis pela Cotação
    negociacao: Record<string, EstatisticaTempoRenovacao>; // Responsáveis pela Negociação
    efetivacao: Record<string, EstatisticaTempoRenovacao>; // Responsável pela Efetivação
  };
  tempoPorEtapa: { etapa: string; estatistica: EstatisticaTempoRenovacao }[]; // minutos comerciais
  porVencimento: ({ mes: string } & ContagemStatus)[]; // mês do Fim da vigência anterior (carteira inteira)
};

// ---------- montagem ----------

type Resultado = "Renovado" | "Perdido" | "Em andamento";

export function montarPainelRenovacao(
  items: BitrixItemRaw[],
  historico: BitrixStageHistoryEvent[],
  usuarios: Record<number, string>,
  empresas: Record<number, string>,
  competencia: string,
  agora: Date = new Date()
): PainelRenovacao {
  const nome = (id: number) => usuarios[id] || `ID ${id}`;
  const eventosPorCard = new Map<number, BitrixStageHistoryEvent[]>();
  for (const e of historico) {
    if (Number(e.CATEGORY_ID) !== CATEGORIA_RENOVACAO) continue;
    const lista = eventosPorCard.get(Number(e.OWNER_ID)) ?? [];
    lista.push(e);
    eventosPorCard.set(Number(e.OWNER_ID), lista);
  }
  for (const lista of eventosPorCard.values()) {
    lista.sort((a, b) => new Date(a.CREATED_TIME).getTime() - new Date(b.CREATED_TIME).getTime());
  }

  const cards = items
    .filter((it) => Number(it.categoryId) === CATEGORIA_RENOVACAO)
    .map((it) => {
      const eventos = eventosPorCard.get(Number(it.id)) ?? [];
      const semantica = ETAPA_POR_ID.get(it.stageId)?.semantica ?? "P";
      const resultado: Resultado = semantica === "S" ? "Renovado" : semantica === "F" ? "Perdido" : "Em andamento";
      // Resolução = última entrada na etapa final ATUAL (um card reaberto e
      // fechado de novo conta pela data do fechamento vigente).
      let resolvidoEm: Date | null = null;
      if (resultado !== "Em andamento") {
        const ultima = [...eventos].reverse().find((e) => e.STAGE_ID === it.stageId);
        resolvidoEm = new Date(ultima?.CREATED_TIME ?? it.movedTime ?? it.updatedTime);
      }
      return {
        it,
        eventos,
        resultado,
        mesEntrada: diaBrasilia(new Date(it.createdTime)).slice(0, 7),
        resolvidoEm,
        mesResolucao: resolvidoEm ? diaBrasilia(resolvidoEm).slice(0, 7) : "",
      };
    });

  const relevantes = cards.filter(
    (c) =>
      c.mesEntrada === competencia ||
      (c.mesEntrada < competencia && (c.resultado === "Em andamento" || c.mesResolucao >= competencia))
  );
  const renovadosMes = relevantes.filter((c) => c.resultado === "Renovado" && c.mesResolucao === competencia);
  const perdidosMes = relevantes.filter((c) => c.resultado === "Perdido" && c.mesResolucao === competencia);
  const emAndamento = relevantes.filter((c) => c.resultado === "Em andamento");
  const taxa = (r: number, p: number) => (r + p > 0 ? (r / (r + p)) * 100 : null);

  // --- etapas ---
  const porEtapa = ETAPAS_RENOVACAO.filter((e) => e.semantica === "P").map((e) => ({
    etapa: e.nome,
    quantidade: emAndamento.filter((c) => c.it.stageId === e.id).length,
  }));

  // --- controle diário ---
  const valores: Record<string, number> = {};
  const contratos: Record<string, number> = {};
  const efetivacoes: Record<string, number> = {};
  for (const c of cards) {
    // Valores atualizados = 1ª entrada em "Aguardando cotação" (a Bianca
    // registra os valores que a imobiliária mandou e libera pra cotação).
    const entradaCotacao = c.eventos.find((e) => e.STAGE_ID === ETAPA_AGUARDANDO_COTACAO);
    if (entradaCotacao) {
      const dia = diaBrasilia(new Date(entradaCotacao.CREATED_TIME));
      if (dia.startsWith(competencia)) valores[dia] = (valores[dia] ?? 0) + 1;
    }
    const diaContrato = diaManual(c.it[CAMPO_RECEBIMENTO_CONTRATO]);
    if (diaContrato.startsWith(competencia)) contratos[diaContrato] = (contratos[diaContrato] ?? 0) + 1;
    // Efetivação = 1ª entrada em Sucesso dentro da competência (um card
    // movido duas vezes pra Sucesso no mês conta uma vez só).
    const entradaSucesso = c.eventos.find(
      (e) => e.STAGE_ID === ETAPA_SUCESSO && diaBrasilia(new Date(e.CREATED_TIME)).startsWith(competencia)
    );
    if (entradaSucesso) {
      const dia = diaBrasilia(new Date(entradaSucesso.CREATED_TIME));
      efetivacoes[dia] = (efetivacoes[dia] ?? 0) + 1;
    }
  }
  const controleDiario = diasDoMes(competencia).map((data) => ({
    data,
    valoresAtualizados: valores[data] ?? 0,
    contratosRecebidos: contratos[data] ?? 0,
    efetivacoes: efetivacoes[data] ?? 0,
  }));

  // --- perdas ---
  const contagemMotivo: Record<string, number> = {};
  for (const c of perdidosMes) {
    const motivo = MOTIVO_POR_ID.get(String(c.it[CAMPO_MOTIVO_PERDA] ?? "")) ?? "Sem motivo";
    contagemMotivo[motivo] = (contagemMotivo[motivo] ?? 0) + 1;
  }
  const perdasPorMotivo = [...MOTIVOS_PERDA_RENOVACAO.map((m) => m.nome), "Sem motivo"]
    .map((motivo) => ({ motivo, quantidade: contagemMotivo[motivo] ?? 0 }))
    .filter((l) => l.motivo !== "Sem motivo" || l.quantidade > 0);

  // --- reajuste e financeiro ---
  const mediaDe = (vs: number[]) => (vs.length ? vs.reduce((s, x) => s + x, 0) / vs.length : null);
  const reajustesGeral = relevantes.map((c) => numero(c.it[CAMPO_REAJUSTE_PCT])).filter((v): v is number => v !== null);
  const reajustesRenov = renovadosMes.map((c) => numero(c.it[CAMPO_REAJUSTE_PCT])).filter((v): v is number => v !== null);
  let premioLiquidoRenovado = 0;
  let comissaoRenovada = 0;
  for (const c of renovadosMes) {
    const premio = numero(c.it[CAMPO_PREMIO_LIQUIDO]) ?? 0;
    const pct = numero(c.it[CAMPO_COMISSAO_PCT]) ?? 0; // percentual, mesma convenção do Fiança
    premioLiquidoRenovado += premio;
    comissaoRenovada += premio * (pct / 100);
  }

  // --- seguradoras ---
  // Renovação é sempre na mesma seguradora da apólice: desde 01/10/2026 o
  // card tem uma lista só (Seguradora Escolhida) -- "Seguradora anterior" e
  // os blocos de cotação por seguradora saíram do formulário da categoria 32.
  // mesma/trocou ficam só por compatibilidade do payload (sempre 0).
  let semInformacao = 0;
  const porNova: Record<string, number> = {};
  for (const c of renovadosMes) {
    const nova = SEGURADORA_POR_ID[String(c.it[CAMPO_SEGURADORA_ESCOLHIDA] ?? "")];
    if (nova) porNova[nova] = (porNova[nova] ?? 0) + 1;
    else semInformacao++;
  }

  // --- imobiliárias ---
  type LinhaImob = { nome: string; novos: number } & ContagemStatus & {
    premios: number[];
    comissoes: number[];
    reajustes: number[];
    taxasPacote: number[];
    premioRenovado: number;
    comissaoRenovada: number;
  };
  const porImob = new Map<string, LinhaImob>();
  for (const c of relevantes) {
    const nomeImob = c.it.companyId ? empresas[c.it.companyId] || `ID ${c.it.companyId}` : SEM_IMOBILIARIA;
    const linha = porImob.get(nomeImob) ?? {
      nome: nomeImob, novos: 0, total: 0, renovados: 0, perdidos: 0, emAndamento: 0,
      premios: [], comissoes: [], reajustes: [], taxasPacote: [], premioRenovado: 0, comissaoRenovada: 0,
    };
    linha.total++;
    if (c.mesEntrada === competencia) linha.novos++;
    if (c.resultado === "Em andamento") linha.emAndamento++;
    const renovadoNoMes = c.resultado === "Renovado" && c.mesResolucao === competencia;
    if (renovadoNoMes) linha.renovados++;
    if (c.resultado === "Perdido" && c.mesResolucao === competencia) linha.perdidos++;
    const premio = numero(c.it[CAMPO_PREMIO_LIQUIDO]);
    const pctComissao = numero(c.it[CAMPO_COMISSAO_PCT]); // percentual, mesma convenção do Fiança
    const reajuste = numero(c.it[CAMPO_REAJUSTE_PCT]);
    const taxaPacote = numero(c.it[CAMPO_TAXA_PACOTE]);
    if (premio) {
      linha.premios.push(premio);
      if (pctComissao !== null) linha.comissoes.push(premio * (pctComissao / 100));
      if (renovadoNoMes) {
        linha.premioRenovado += premio;
        linha.comissaoRenovada += premio * ((pctComissao ?? 0) / 100);
      }
    }
    if (reajuste !== null) linha.reajustes.push(reajuste);
    if (taxaPacote) linha.taxasPacote.push(taxaPacote);
    porImob.set(nomeImob, linha);
  }
  const imobiliarias = [...porImob.values()]
    .map(({ premios, comissoes, reajustes, taxasPacote, ...l }) => ({
      ...l,
      taxaRenovacao: taxa(l.renovados, l.perdidos),
      premioMedio: mediaDe(premios),
      comissaoMedia: mediaDe(comissoes),
      reajusteMedio: mediaDe(reajustes),
      taxaPacoteMedia: mediaDe(taxasPacote),
    }))
    .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome));

  // --- equipe (tempos manuais, horário comercial, pelo mês do FIM) ---
  const acumula = (alvo: Record<string, number[]>, nomes: string[], minutos: number) => {
    for (const n of nomes) (alvo[n] ??= []).push(minutos);
  };
  const conf: Record<string, number[]> = {};
  const cot: Record<string, number[]> = {};
  const neg: Record<string, number[]> = {};
  const efe: Record<string, number[]> = {};
  const fases: [string, string, string, Record<string, number[]>][] = [
    [CAMPO_INICIO_PREENCHIMENTO, CAMPO_FIM_PREENCHIMENTO, CAMPO_RESPONSAVEL_CADASTRO, conf],
    [CAMPO_INICIO_COTACAO, CAMPO_FIM_COTACAO, CAMPO_RESPONSAVEIS_COTACAO, cot],
    [CAMPO_INICIO_NEGOCIACAO, CAMPO_FIM_NEGOCIACAO, CAMPO_RESPONSAVEIS_NEGOCIACAO, neg],
  ];
  for (const c of cards) {
    for (const [campoIni, campoFim, campoResp, alvo] of fases) {
      const ini = horaManual(c.it[campoIni]);
      const fim = horaManual(c.it[campoFim]);
      if (!ini || !fim || !diaManual(c.it[campoFim]).startsWith(competencia)) continue;
      const [a, b] = ini <= fim ? [ini, fim] : [fim, ini];
      const nomes = idsUsuarios(c.it[campoResp]).map(nome);
      acumula(alvo, nomes.length ? nomes : ["Sem responsável"], minutosComerciaisEntre(a, b));
    }
  }

  // --- tempo por etapa (histórico) e efetivação ---
  const porEtapaMin: Record<string, number[]> = {};
  for (const c of relevantes) {
    const fimCard = c.resolvidoEm ?? agora;
    let minutosEfetivacao = 0;
    c.eventos.forEach((e, i) => {
      const inicio = new Date(e.CREATED_TIME);
      const fim = i + 1 < c.eventos.length ? new Date(c.eventos[i + 1].CREATED_TIME) : fimCard;
      const etapa = ETAPA_POR_ID.get(e.STAGE_ID);
      if (!etapa || etapa.semantica !== "P") return;
      const minutos = minutosComerciaisEntre(inicio, fim);
      // Só segmentos que terminaram neste mês ou ainda estão abertos.
      const fimMes = diaBrasilia(fim).slice(0, 7);
      if (fimMes === competencia || (i + 1 === c.eventos.length && c.resultado === "Em andamento")) {
        (porEtapaMin[etapa.nome] ??= []).push(minutos);
      }
      if (ETAPAS_EFETIVACAO.has(e.STAGE_ID)) minutosEfetivacao += minutos;
    });
    if (c.resultado === "Renovado" && c.mesResolucao === competencia) {
      const nomes = idsUsuarios(c.it[CAMPO_RESPONSAVEL_EFETIVACAO]).map(nome);
      acumula(efe, nomes.length ? nomes : ["Sem responsável"], minutosEfetivacao);
    }
  }
  const stats = (r: Record<string, number[]>) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, estatisticas(v)]));
  const tempoPorEtapa = ETAPAS_RENOVACAO.filter((e) => e.semantica === "P" && e.id !== ETAPA_RENOVAR_DIA_01)
    .concat(ETAPAS_RENOVACAO.filter((e) => e.id === ETAPA_RENOVAR_DIA_01))
    .map((e) => ({ etapa: e.nome, estatistica: estatisticas(porEtapaMin[e.nome] ?? []) }));

  // --- carteira por mês de vencimento (todos os cards do funil) ---
  const porVenc = new Map<string, { mes: string } & ContagemStatus>();
  for (const c of cards) {
    const mes = diaManual(c.it[CAMPO_FIM_VIGENCIA_ANTERIOR]).slice(0, 7) || "Sem data";
    const linha = porVenc.get(mes) ?? { mes, total: 0, renovados: 0, perdidos: 0, emAndamento: 0 };
    linha.total++;
    if (c.resultado === "Renovado") linha.renovados++;
    else if (c.resultado === "Perdido") linha.perdidos++;
    else linha.emAndamento++;
    porVenc.set(mes, linha);
  }
  const porVencimento = [...porVenc.values()].sort((a, b) =>
    a.mes === "Sem data" ? 1 : b.mes === "Sem data" ? -1 : a.mes.localeCompare(b.mes)
  );

  return {
    competencia,
    totalCardsFunil: cards.length,
    kpis: {
      total: relevantes.length,
      novos: relevantes.filter((c) => c.mesEntrada === competencia).length,
      herdados: relevantes.filter((c) => c.mesEntrada !== competencia).length,
      emAndamento: emAndamento.length,
      renovados: renovadosMes.length,
      perdidos: perdidosMes.length,
      taxaRenovacao: taxa(renovadosMes.length, perdidosMes.length),
    },
    porEtapa,
    controleDiario,
    perdasPorMotivo,
    reajuste: {
      mediaGeral: mediaDe(reajustesGeral),
      nGeral: reajustesGeral.length,
      mediaRenovados: mediaDe(reajustesRenov),
      nRenovados: reajustesRenov.length,
    },
    financeiro: { premioLiquidoRenovado, comissaoRenovada },
    seguradoras: {
      mesmaSeguradora: 0,
      trocouSeguradora: 0,
      semInformacao,
      porSeguradoraNova: Object.entries(porNova)
        .map(([seguradora, renovados]) => ({ seguradora, renovados }))
        .sort((a, b) => b.renovados - a.renovados),
    },
    imobiliarias,
    equipe: { conferencia: stats(conf), cotacao: stats(cot), negociacao: stats(neg), efetivacao: stats(efe) },
    tempoPorEtapa,
    porVencimento,
  };
}

export function painelRenovacaoVazio(competencia: string): PainelRenovacao {
  return montarPainelRenovacao([], [], {}, {}, competencia);
}

// Busca ao vivo + monta -- compartilhada entre a página e o cron de
// congelamento mensal, igual buscarAnaliseGerencialAoVivo.
export async function buscarPainelRenovacaoAoVivo(competencia: string): Promise<PainelRenovacao> {
  const [items, historico] = await Promise.all([
    listarItensSpaCategoria(ENTITY_TYPE_ID, CATEGORIA_RENOVACAO),
    listarHistoricoEtapasCategoria(ENTITY_TYPE_ID, CATEGORIA_RENOVACAO),
  ]);
  const idsEmpresa = items.map((it) => it.companyId).filter((id): id is number => !!id);
  const idsUsuario = items
    .flatMap((it) => [
      ...idsUsuarios(it[CAMPO_RESPONSAVEL_CADASTRO]),
      ...idsUsuarios(it[CAMPO_RESPONSAVEIS_COTACAO]),
      ...idsUsuarios(it[CAMPO_RESPONSAVEIS_NEGOCIACAO]),
      ...idsUsuarios(it[CAMPO_RESPONSAVEL_EFETIVACAO]),
    ])
    .filter((id) => id > 0);
  const [empresas, usuarios] = await Promise.all([buscarEmpresas(idsEmpresa), buscarUsuarios(idsUsuario)]);
  return montarPainelRenovacao(items, historico, usuarios, empresas, competencia);
}
