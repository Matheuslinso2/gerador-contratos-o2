import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buscarEmpresas,
  buscarUsuarios,
  listarHistoricoEtapasCategoria,
  listarItensSpaCategoria,
  type BitrixItemRaw,
  type BitrixStageHistoryEvent,
} from "./client";
import { minutosComerciaisEntre } from "./horarioComercial";

// Aba "Endossos" do painel /seguro-fianca -- funil Endossos da SPA Seguro
// Fiança (entityTypeId 1042, categoryId 42, criado em 28/10/2026 a partir do
// desenho "Funil de Endosso – SPA Seguro Fiança"). Mesma lógica mensal da aba
// Renovação: competência = mês de ENTRADA do card (createdTime em Brasília);
// "herdado" = card de mês anterior ainda em andamento ou resolvido neste mês.
// Mês atual ao vivo + retrato em seguro_fianca_endosso_snapshots; mês fechado
// congelado pelo cron do dia 1º (/api/cron/congelar-paineis).
// Imobiliária: Empresa do card → ficha do banco único (imobiliaria_registros_fonte,
// fonte bitrix_empresa), regra fixa de 22/10/2026.

const ENTITY_TYPE_ID = 1042;
export const CATEGORIA_ENDOSSO = 42;

// stageIds criados em 28/10/2026 -- reconfira com crm.status.list
// (ENTITY_ID=DYNAMIC_1042_STAGE_42) se uma etapa for renomeada ou recriada.
export const ETAPAS_ENDOSSO: { id: string; nome: string; semantica: "P" | "S" | "F" }[] = [
  { id: "DT1042_42:NEW", nome: "Nova solicitação", semantica: "P" },
  { id: "DT1042_42:PREPARATION", nome: "Em análise", semantica: "P" },
  { id: "DT1042_42:CLIENT", nome: "Pendente documento", semantica: "P" },
  { id: "DT1042_42:AGUARD_SEG", nome: "Aguardando seguradora", semantica: "P" },
  { id: "DT1042_42:PEND_SEG", nome: "Pendência seguradora", semantica: "P" },
  { id: "DT1042_42:LIB_CADASTRO", nome: "Liberado para cadastro", semantica: "P" },
  { id: "DT1042_42:SUCCESS", nome: "Cadastrado", semantica: "S" },
  { id: "DT1042_42:FAIL", nome: "Sem retorno de documentos", semantica: "F" },
];
const ETAPA_POR_ID = new Map(ETAPAS_ENDOSSO.map((e) => [e.id, e]));
const ETAPA_PENDENTE_DOCUMENTO = "DT1042_42:CLIENT";
const ETAPA_PENDENCIA_SEGURADORA = "DT1042_42:PEND_SEG";
const ETAPA_LIBERADO_CADASTRO = "DT1042_42:LIB_CADASTRO";
const ETAPA_CADASTRADO = "DT1042_42:SUCCESS";
const ETAPA_SEM_RETORNO = "DT1042_42:FAIL";

const CAMPO_TIPO_ENDOSSO = "ufCrm10_1793216247";
const CAMPO_SEGURADORA = "ufCrm10_1776352200";
const CAMPO_RESPONSAVEL_CADASTRO = "ufCrm10_1786644365";

// IDs das opções das listas (crm.item.fields, 28/10/2026).
export const TIPOS_ENDOSSO: { id: string; nome: string }[] = [
  { id: "3636", nome: "Entrega das chaves" },
  { id: "3638", nome: "Óbito" },
  { id: "3640", nome: "Troca de garantia" },
  { id: "3642", nome: "Cancelamento por sinistro" },
  { id: "3644", nome: "Troca de administradora" },
  { id: "3646", nome: "Desistência" },
  { id: "3648", nome: "Endosso de correção (alteração de itens)" },
];
const TIPO_POR_ID = new Map(TIPOS_ENDOSSO.map((t) => [t.id, t.nome]));
const SEGURADORA_POR_ID: Record<string, string> = { "1808": "Too", "1810": "Porto", "1812": "Pottencial", "1814": "Tokio", "1816": "Junto" };
const SEM_TIPO = "Tipo não informado";
const SEM_SEGURADORA = "Seguradora não informada";
export const SEM_IMOBILIARIA = "Sem imobiliária";

// ---------- helpers ----------

function diaBrasilia(instante: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(instante);
}
function diasDoMes(competencia: string): string[] {
  const [ano, mes] = competencia.split("-").map(Number);
  const ultimoDia = new Date(ano, mes, 0).getDate();
  return Array.from({ length: ultimoDia }, (_, i) => `${competencia}-${String(i + 1).padStart(2, "0")}`);
}
function idsUsuarios(v: unknown): number[] {
  if (v === null || v === undefined || v === "") return [];
  return (Array.isArray(v) ? v : [v]).map(Number).filter((n) => Number.isFinite(n) && n > 0);
}

export type EstatisticaTempoEndosso = { n: number; media: number; mediana: number };
function estatisticas(minutos: number[]): EstatisticaTempoEndosso {
  if (!minutos.length) return { n: 0, media: 0, mediana: 0 };
  const o = [...minutos].sort((a, b) => a - b);
  const meio = Math.floor(o.length / 2);
  return { n: o.length, media: o.reduce((s, x) => s + x, 0) / o.length, mediana: o.length % 2 ? o[meio] : (o[meio - 1] + o[meio]) / 2 };
}

// ---------- tipos do payload ----------

export type ContagemEndosso = { total: number; cadastrados: number; semRetorno: number; emAndamento: number };
export type LinhaAgrupadaEndosso = { nome: string; novos: number; taxaConclusao: number | null } & ContagemEndosso;
export type LinhaImobiliariaEndosso = LinhaAgrupadaEndosso & { imobiliariaId: string | null };

export type PainelEndosso = {
  competencia: string;
  totalCardsFunil: number;
  kpis: {
    total: number; // novos + herdados relevantes neste mês
    novos: number;
    herdados: number;
    emAndamento: number;
    cadastrados: number; // entraram em Cadastrado neste mês
    semRetorno: number; // entraram em Sem retorno de documentos neste mês
    taxaConclusao: number | null; // cadastrados ÷ (cadastrados + sem retorno)
  };
  porEtapa: { etapa: string; quantidade: number }[]; // em andamento, etapa atual
  // "Principais pendências (documentos × seguradora)" do desenho
  pendencias: {
    documento: { agora: number; entradasNoMes: number; tempo: EstatisticaTempoEndosso };
    seguradora: { agora: number; entradasNoMes: number; tempo: EstatisticaTempoEndosso };
  };
  controleDiario: { data: string; novos: number; liberadosCadastro: number; cadastrados: number; semRetorno: number }[];
  tempoPorEtapa: { etapa: string; estatistica: EstatisticaTempoEndosso }[]; // minutos comerciais
  // ciclo completo dos cadastrados no mês: criação do card → Cadastrado
  cicloCadastrados: EstatisticaTempoEndosso;
  porTipo: LinhaAgrupadaEndosso[];
  porSeguradora: LinhaAgrupadaEndosso[];
  imobiliarias: LinhaImobiliariaEndosso[];
  imobiliariasSemVinculo: number; // cards com Empresa que ainda não está ligada a uma ficha do banco único
  equipe: {
    // responsável do card (processo): cards do mês e ciclo dos cadastrados
    processo: { nome: string; cards: number; cadastrados: number; ciclo: EstatisticaTempoEndosso }[];
    // Responsável pelo Cadastro: cadastrados no mês e espera em "Liberado para cadastro"
    cadastro: { nome: string; cadastrados: number; espera: EstatisticaTempoEndosso }[];
  };
};

type Resultado = "Cadastrado" | "Sem retorno" | "Em andamento";
export type FichaImobiliaria = { id: string; nome: string };

// ---------- montagem ----------

function montarCards(items: BitrixItemRaw[], historico: BitrixStageHistoryEvent[]) {
  const eventosPorCard = new Map<number, BitrixStageHistoryEvent[]>();
  for (const e of historico) {
    if (Number(e.CATEGORY_ID) !== CATEGORIA_ENDOSSO) continue;
    const lista = eventosPorCard.get(Number(e.OWNER_ID)) ?? [];
    lista.push(e);
    eventosPorCard.set(Number(e.OWNER_ID), lista);
  }
  for (const lista of eventosPorCard.values()) lista.sort((a, b) => new Date(a.CREATED_TIME).getTime() - new Date(b.CREATED_TIME).getTime());

  return items
    .filter((it) => Number(it.categoryId) === CATEGORIA_ENDOSSO)
    .map((it) => {
      const eventos = eventosPorCard.get(Number(it.id)) ?? [];
      const semantica = ETAPA_POR_ID.get(it.stageId)?.semantica ?? "P";
      const resultado: Resultado = semantica === "S" ? "Cadastrado" : semantica === "F" ? "Sem retorno" : "Em andamento";
      let resolvidoEm: Date | null = null;
      if (resultado !== "Em andamento") {
        const ultima = [...eventos].reverse().find((e) => e.STAGE_ID === it.stageId);
        resolvidoEm = new Date(ultima?.CREATED_TIME ?? it.movedTime ?? it.updatedTime);
      }
      return {
        it,
        eventos,
        resultado,
        criadoEm: new Date(it.createdTime),
        mesEntrada: diaBrasilia(new Date(it.createdTime)).slice(0, 7),
        resolvidoEm,
        mesResolucao: resolvidoEm ? diaBrasilia(resolvidoEm).slice(0, 7) : "",
        tipo: TIPO_POR_ID.get(String(it[CAMPO_TIPO_ENDOSSO] ?? "")) ?? SEM_TIPO,
        seguradora: SEGURADORA_POR_ID[String(it[CAMPO_SEGURADORA] ?? "")] ?? SEM_SEGURADORA,
      };
    });
}

export function montarPainelEndosso(
  items: BitrixItemRaw[],
  historico: BitrixStageHistoryEvent[],
  usuarios: Record<number, string>,
  empresas: Record<number, string>,
  fichaPorEmpresa: Record<number, FichaImobiliaria>,
  competencia: string,
  agora: Date = new Date()
): PainelEndosso {
  const nome = (id: number) => usuarios[id] || `ID ${id}`;
  const cards = montarCards(items, historico);
  type Card = (typeof cards)[number];

  const relevantes = cards.filter(
    (c) => c.mesEntrada === competencia || (c.mesEntrada < competencia && (c.resultado === "Em andamento" || c.mesResolucao >= competencia))
  );
  const resolvidoNoMes = (c: Card) => c.mesResolucao === competencia;
  const cadastradosMes = relevantes.filter((c) => c.resultado === "Cadastrado" && resolvidoNoMes(c));
  const semRetornoMes = relevantes.filter((c) => c.resultado === "Sem retorno" && resolvidoNoMes(c));
  const emAndamento = relevantes.filter((c) => c.resultado === "Em andamento");
  const taxa = (cad: number, sr: number) => (cad + sr > 0 ? (cad / (cad + sr)) * 100 : null);

  const porEtapa = ETAPAS_ENDOSSO.filter((e) => e.semantica === "P").map((e) => ({
    etapa: e.nome,
    quantidade: emAndamento.filter((c) => c.it.stageId === e.id).length,
  }));

  // --- tempo por etapa (histórico, minutos comerciais) ---
  // Segmento conta no mês em que terminou, ou se ainda está aberto.
  const porEtapaMin: Record<string, number[]> = {};
  const esperaCadastroPorCard = new Map<number, number>();
  for (const c of cards) {
    const fimCard = c.resolvidoEm ?? agora;
    c.eventos.forEach((e, i) => {
      const etapa = ETAPA_POR_ID.get(e.STAGE_ID);
      if (!etapa || etapa.semantica !== "P") return;
      const inicio = new Date(e.CREATED_TIME);
      const fim = i + 1 < c.eventos.length ? new Date(c.eventos[i + 1].CREATED_TIME) : fimCard;
      const minutos = minutosComerciaisEntre(inicio, fim);
      const aberto = i + 1 === c.eventos.length && c.resultado === "Em andamento";
      if (diaBrasilia(fim).startsWith(competencia) || aberto) (porEtapaMin[etapa.nome] ??= []).push(minutos);
      if (e.STAGE_ID === ETAPA_LIBERADO_CADASTRO) esperaCadastroPorCard.set(Number(c.it.id), (esperaCadastroPorCard.get(Number(c.it.id)) ?? 0) + minutos);
    });
  }
  const tempoPorEtapa = ETAPAS_ENDOSSO.filter((e) => e.semantica === "P").map((e) => ({ etapa: e.nome, estatistica: estatisticas(porEtapaMin[e.nome] ?? []) }));

  // --- pendências (documentos × seguradora) ---
  const entradasNoMes = (etapa: string) =>
    cards.filter((c) => c.eventos.some((e) => e.STAGE_ID === etapa && diaBrasilia(new Date(e.CREATED_TIME)).startsWith(competencia))).length;
  const nomeEtapa = (id: string) => ETAPA_POR_ID.get(id)!.nome;
  const pendencias = {
    documento: {
      agora: emAndamento.filter((c) => c.it.stageId === ETAPA_PENDENTE_DOCUMENTO).length,
      entradasNoMes: entradasNoMes(ETAPA_PENDENTE_DOCUMENTO),
      tempo: estatisticas(porEtapaMin[nomeEtapa(ETAPA_PENDENTE_DOCUMENTO)] ?? []),
    },
    seguradora: {
      agora: emAndamento.filter((c) => c.it.stageId === ETAPA_PENDENCIA_SEGURADORA).length,
      entradasNoMes: entradasNoMes(ETAPA_PENDENCIA_SEGURADORA),
      tempo: estatisticas(porEtapaMin[nomeEtapa(ETAPA_PENDENCIA_SEGURADORA)] ?? []),
    },
  };

  // --- controle diário ---
  const novosDia: Record<string, number> = {};
  const liberadosDia: Record<string, number> = {};
  const cadastradosDia: Record<string, number> = {};
  const semRetornoDia: Record<string, number> = {};
  const primeiraNoMes = (c: Card, etapa: string) => c.eventos.find((e) => e.STAGE_ID === etapa && diaBrasilia(new Date(e.CREATED_TIME)).startsWith(competencia));
  for (const c of cards) {
    const diaCriacao = diaBrasilia(c.criadoEm);
    if (diaCriacao.startsWith(competencia)) novosDia[diaCriacao] = (novosDia[diaCriacao] ?? 0) + 1;
    for (const [etapa, alvo] of [[ETAPA_LIBERADO_CADASTRO, liberadosDia], [ETAPA_CADASTRADO, cadastradosDia], [ETAPA_SEM_RETORNO, semRetornoDia]] as const) {
      const ev = primeiraNoMes(c, etapa);
      if (ev) {
        const dia = diaBrasilia(new Date(ev.CREATED_TIME));
        alvo[dia] = (alvo[dia] ?? 0) + 1;
      }
    }
  }
  const controleDiario = diasDoMes(competencia).map((data) => ({
    data,
    novos: novosDia[data] ?? 0,
    liberadosCadastro: liberadosDia[data] ?? 0,
    cadastrados: cadastradosDia[data] ?? 0,
    semRetorno: semRetornoDia[data] ?? 0,
  }));

  // --- ciclo completo (criação → Cadastrado) dos cadastrados no mês ---
  const cicloPorCard = new Map<number, number>();
  for (const c of cadastradosMes) cicloPorCard.set(Number(c.it.id), minutosComerciaisEntre(c.criadoEm, c.resolvidoEm!));
  const cicloCadastrados = estatisticas([...cicloPorCard.values()]);

  // --- agrupamentos (tipo, seguradora, imobiliária) ---
  const agrupar = <K extends string>(chave: (c: Card) => K) => {
    const mapa = new Map<K, { nome: K; novos: number } & ContagemEndosso>();
    for (const c of relevantes) {
      const k = chave(c);
      const l = mapa.get(k) ?? { nome: k, novos: 0, total: 0, cadastrados: 0, semRetorno: 0, emAndamento: 0 };
      l.total++;
      if (c.mesEntrada === competencia) l.novos++;
      if (c.resultado === "Em andamento") l.emAndamento++;
      else if (resolvidoNoMes(c)) c.resultado === "Cadastrado" ? l.cadastrados++ : l.semRetorno++;
      mapa.set(k, l);
    }
    return [...mapa.values()]
      .map((l) => ({ ...l, taxaConclusao: taxa(l.cadastrados, l.semRetorno) }))
      .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome));
  };
  const ordemTipos = [...TIPOS_ENDOSSO.map((t) => t.nome), SEM_TIPO];
  const porTipoMapa = new Map(agrupar((c) => c.tipo).map((l) => [l.nome, l]));
  const porTipo = ordemTipos
    .map((t) => porTipoMapa.get(t) ?? { nome: t, novos: 0, total: 0, cadastrados: 0, semRetorno: 0, emAndamento: 0, taxaConclusao: null })
    .filter((l) => l.nome !== SEM_TIPO || l.total > 0);
  const porSeguradora = agrupar((c) => c.seguradora);

  let imobiliariasSemVinculo = 0;
  const fichaDoCard = (c: Card) => (c.it.companyId ? fichaPorEmpresa[Number(c.it.companyId)] ?? null : null);
  for (const c of relevantes) if (c.it.companyId && !fichaDoCard(c)) imobiliariasSemVinculo++;
  const rotuloImob = (c: Card) => {
    const ficha = fichaDoCard(c);
    if (ficha) return `${ficha.id}|${ficha.nome}`;
    if (c.it.companyId) return `|${empresas[Number(c.it.companyId)] || `Empresa ${c.it.companyId}`} (sem ficha)`;
    return `|${SEM_IMOBILIARIA}`;
  };
  const imobiliarias = agrupar(rotuloImob).map((l) => {
    const [id, ...resto] = l.nome.split("|");
    return { ...l, nome: resto.join("|"), imobiliariaId: id || null };
  });

  // --- equipe ---
  const processo = new Map<string, { cards: number; cadastrados: number; ciclos: number[] }>();
  for (const c of relevantes) {
    const n = c.it.assignedById ? nome(Number(c.it.assignedById)) : "Sem responsável";
    const l = processo.get(n) ?? { cards: 0, cadastrados: 0, ciclos: [] };
    l.cards++;
    const ciclo = cicloPorCard.get(Number(c.it.id));
    if (ciclo !== undefined) {
      l.cadastrados++;
      l.ciclos.push(ciclo);
    }
    processo.set(n, l);
  }
  const cadastro = new Map<string, { cadastrados: number; esperas: number[] }>();
  for (const c of cadastradosMes) {
    const ids = idsUsuarios(c.it[CAMPO_RESPONSAVEL_CADASTRO]);
    for (const n of ids.length ? ids.map(nome) : ["Não informado"]) {
      const l = cadastro.get(n) ?? { cadastrados: 0, esperas: [] };
      l.cadastrados++;
      const espera = esperaCadastroPorCard.get(Number(c.it.id));
      if (espera !== undefined) l.esperas.push(espera);
      cadastro.set(n, l);
    }
  }

  return {
    competencia,
    totalCardsFunil: cards.length,
    kpis: {
      total: relevantes.length,
      novos: relevantes.filter((c) => c.mesEntrada === competencia).length,
      herdados: relevantes.filter((c) => c.mesEntrada !== competencia).length,
      emAndamento: emAndamento.length,
      cadastrados: cadastradosMes.length,
      semRetorno: semRetornoMes.length,
      taxaConclusao: taxa(cadastradosMes.length, semRetornoMes.length),
    },
    porEtapa,
    pendencias,
    controleDiario,
    tempoPorEtapa,
    cicloCadastrados,
    porTipo,
    porSeguradora,
    imobiliarias,
    imobiliariasSemVinculo,
    equipe: {
      processo: [...processo.entries()]
        .map(([n, l]) => ({ nome: n, cards: l.cards, cadastrados: l.cadastrados, ciclo: estatisticas(l.ciclos) }))
        .sort((a, b) => b.cards - a.cards || a.nome.localeCompare(b.nome)),
      cadastro: [...cadastro.entries()]
        .map(([n, l]) => ({ nome: n, cadastrados: l.cadastrados, espera: estatisticas(l.esperas) }))
        .sort((a, b) => b.cadastrados - a.cadastrados || a.nome.localeCompare(b.nome)),
    },
  };
}

export function painelEndossoVazio(competencia: string): PainelEndosso {
  return montarPainelEndosso([], [], {}, {}, {}, competencia);
}

// Empresa do Bitrix → ficha do banco único de imobiliárias.
async function fichasPorEmpresa(supabase: SupabaseClient, idsEmpresa: number[]): Promise<Record<number, FichaImobiliaria>> {
  const ids = [...new Set(idsEmpresa)].map(String);
  if (!ids.length) return {};
  const { data: vinculos, error } = await supabase
    .from("imobiliaria_registros_fonte")
    .select("chave_externa, imobiliaria_id")
    .eq("fonte", "bitrix_empresa")
    .in("chave_externa", ids)
    .not("imobiliaria_id", "is", null);
  if (error) throw new Error(`Vínculo de imobiliárias: ${error.message}`);
  const idsFicha = [...new Set((vinculos ?? []).map((v) => v.imobiliaria_id as string))];
  if (!idsFicha.length) return {};
  const { data: fichas, error: erroFichas } = await supabase.from("imobiliarias").select("id, nome").in("id", idsFicha);
  if (erroFichas) throw new Error(`Fichas de imobiliárias: ${erroFichas.message}`);
  const nomePorFicha = new Map((fichas ?? []).map((f) => [f.id as string, String(f.nome)]));
  const out: Record<number, FichaImobiliaria> = {};
  for (const v of vinculos ?? []) {
    const nomeFicha = nomePorFicha.get(v.imobiliaria_id as string);
    if (nomeFicha) out[Number(v.chave_externa)] = { id: v.imobiliaria_id as string, nome: nomeFicha };
  }
  return out;
}

// Busca ao vivo + monta -- compartilhada entre a página e os crons.
export async function buscarPainelEndossoAoVivo(competencia: string, supabase: SupabaseClient): Promise<PainelEndosso> {
  const [items, historico] = await Promise.all([
    listarItensSpaCategoria(ENTITY_TYPE_ID, CATEGORIA_ENDOSSO),
    listarHistoricoEtapasCategoria(ENTITY_TYPE_ID, CATEGORIA_ENDOSSO),
  ]);
  const idsEmpresa = items.map((it) => Number(it.companyId)).filter((id) => id > 0);
  const idsUsuario = items.flatMap((it) => [Number(it.assignedById), ...idsUsuarios(it[CAMPO_RESPONSAVEL_CADASTRO])]).filter((id) => id > 0);
  const [empresas, usuarios, fichas] = await Promise.all([buscarEmpresas(idsEmpresa), buscarUsuarios(idsUsuario), fichasPorEmpresa(supabase, idsEmpresa)]);
  return montarPainelEndosso(items, historico, usuarios, empresas, fichas, competencia);
}
