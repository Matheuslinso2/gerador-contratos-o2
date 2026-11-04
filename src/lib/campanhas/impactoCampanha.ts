import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { imobiliariasDaCampanha } from "./imobiliariasDaCampanha";
import { participantesDaCampanha } from "./metasCampanha";
import { produtosBaseDaCampanha } from "./desempenho";
import { produtosDaCampanha } from "./produtos";
import { aplicarMinimoCapitalizacao } from "./minimoCapitalizacao";
import { contarNoPeriodo, datasDeContratacao, somarAnos, somarDias, type LinhaFunilBruta } from "./tendencia";

// Impacto da campanha (03/11/2026): unidades participantes e carteira de comparação, e a
// atualização do ANDAMENTO (produção até hoje contra o que seria esperado sem a campanha) a cada
// parcial enviada. A foto de partida (tendência e baseline) continua CONGELADA; só o andamento muda.

type Linha = LinhaFunilBruta & { imobiliaria_id: string; produto: string; herdada: boolean | null; valor_titulo: number | null };
type Ficha = { id: string; nome: string; apelido: string | null; grupo_id: string | null };

export type UnidadeParticipante = { chave: string; nome: string; fichas: string[]; meta: number; inicio: string; fim: string; capMinimo: number | null };

export type ContextoCampanha = {
  participantes: UnidadeParticipante[];
  controles: Map<string, string[]>; // unidade (rede ou ficha) ativa FORA da campanha -> fichas
  unidadeDe: (fichaId: string) => string;
};

/** Participantes (com período individual) e carteira ativa de comparação, com a mesma regra do painel. */
export async function contextoDaCampanha(db: SupabaseClient, campanha: Record<string, unknown> & { id: string }): Promise<ContextoCampanha> {
  const { data: fichasBd } = await db.from("imobiliarias").select("id, nome, apelido, grupo_id");
  const ficha = new Map(((fichasBd ?? []) as Ficha[]).map((f) => [f.id, f]));
  const { data: gruposBd } = await db.from("imobiliaria_grupos").select("id, nome");
  const nomeGrupo = new Map(((gruposBd ?? []) as { id: string; nome: string }[]).map((g) => [g.id, g.nome]));
  const unidadeDe = (id: string) => ficha.get(id)?.grupo_id ?? id;
  const fichasDoGrupo = (g: string) => [...ficha.values()].filter((f) => f.grupo_id === g).map((f) => f.id);

  const idsImobs = await imobiliariasDaCampanha(db, campanha as never);
  const { participantes } = await participantesDaCampanha(db, campanha.id, idsImobs);
  const part: UnidadeParticipante[] = participantes
    .filter((p) => p.meta !== null && Number(p.meta) > 0)
    .map((p) => {
      const f = p.imobiliaria_id ? ficha.get(p.imobiliaria_id) : undefined;
      return {
        chave: p.grupo_id ?? p.imobiliaria_id!,
        nome: p.grupo_id ? (nomeGrupo.get(p.grupo_id) ?? "Grupo") : f?.apelido || f?.nome || "—",
        fichas: p.grupo_id ? fichasDoGrupo(p.grupo_id) : [p.imobiliaria_id!],
        meta: Number(p.meta),
        inicio: p.periodo_inicio || (campanha.valido_de as string),
        fim: p.periodo_fim || (campanha.valido_ate as string),
        capMinimo: Number(p.cap_valor_minimo) > 0 ? Number(p.cap_valor_minimo) : null,
      };
    });
  // Redes com ao menos uma ficha participante ficam fora da comparação (a rede toda é "tocada").
  const tocadas = new Set(part.flatMap((u) => u.fichas.map((f) => unidadeDe(f))));
  const lanc = campanha.valido_de as string;
  const { data: ativas } = await db.rpc("imobiliarias_ativas", { p_desde: somarAnos(lanc, -1), p_ate: somarDias(lanc, -1) });
  const controles = new Map<string, string[]>();
  for (const a of (ativas ?? []) as { imobiliaria_id: string }[]) {
    const u = unidadeDe(a.imobiliaria_id);
    if (tocadas.has(u)) continue;
    controles.set(u, ficha.get(a.imobiliaria_id)?.grupo_id ? fichasDoGrupo(u) : [a.imobiliaria_id]);
  }
  return { participantes: part, controles, unidadeDe };
}

/** Linhas do funil (Fiança + Capitalização) das fichas, desde uma data. Falha de consulta PROPAGA (nunca vira zero). */
export async function lerFunil(db: SupabaseClient, fichas: string[], produtos: string[], desde: string): Promise<Linha[]> {
  const linhas: Linha[] = [];
  for (let i = 0; i < fichas.length; i += 80) {
    for (let de = 0; ; de += 1000) {
      const { data, error } = await db.rpc("campanha_programa_funil", { p_imobs: fichas.slice(i, i + 80), p_produtos: produtos, p_desde: desde }).range(de, de + 999);
      if (error) throw new Error("Falha ao consultar a produção: " + error.message);
      linhas.push(...((data ?? []) as Linha[]));
      if (!data || data.length < 1000) break;
    }
  }
  return linhas;
}

type Andamento = { ate: string; realizado: number; esperado: number; diasDecorridos: number; diasPeriodo: number; atualizadoEm: string; parcial: number | null };
type PontoRazao = { ate: string; elite: [number, number]; comparacao: [number, number]; razao: number | null; intervalo: [number, number] | null; atualizadoEm: string; parcial: number | null };

const diasEntre = (de: string, ate: string) => Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000);

/** Recalcula o andamento de cada participante e a leitura provisória (Elite × comparação). Guarda o histórico. */
export async function recalcularAndamento(db: SupabaseClient, campanhaId: string, opcoes: { parcial?: number } = {}): Promise<{ participantes: number; ate: string; razao: number | null }> {
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const { data: campanha } = await db.from("campanhas").select("*").eq("id", campanhaId).single();
  if (!campanha) throw new Error("Campanha não encontrada.");
  const { data: linhasFoto } = await db.from("campanhas_foto_partida").select("id, unidade, imobiliaria_ids, periodo_inicio, periodo_fim, dados").eq("campanha_id", campanhaId);
  const fotos = (linhasFoto ?? []) as { id: string; unidade: string; imobiliaria_ids: string[]; periodo_inicio: string; periodo_fim: string; dados: Record<string, unknown> }[];
  const participantesFoto = fotos.filter((f) => f.unidade !== "__agregado__");
  const agregadoFoto = fotos.find((f) => f.unidade === "__agregado__");
  if (!participantesFoto.length) return { participantes: 0, ate: hoje, razao: null };

  const ctx = await contextoDaCampanha(db, campanha);
  const produtos = produtosBaseDaCampanha(produtosDaCampanha(campanha as never));
  const menorInicio = participantesFoto.reduce((m, f) => (f.periodo_inicio < m ? f.periodo_inicio : m), campanha.valido_de as string);
  const desde = somarDias(somarAnos(menorInicio, -1), -120); // folga para não cortar casos que começaram antes
  const todasFichas = [...new Set([...participantesFoto.flatMap((f) => f.imobiliaria_ids), ...[...ctx.controles.values()].flat()])];
  // Valor mínimo do título de Capitalização (Campanha Elite): mesma regra do painel.
  const minimoPorFicha = new Map<string, number>();
  for (const u of ctx.participantes) if (u.capMinimo) for (const f of u.fichas) minimoPorFicha.set(f, u.capMinimo);
  const linhas = aplicarMinimoCapitalizacao(await lerFunil(db, todasFichas, produtos, desde), minimoPorFicha).linhas;
  const porFicha = new Map<string, Linha[]>();
  const porUnidade = new Map<string, Linha[]>();
  for (const l of linhas) {
    porFicha.set(l.imobiliaria_id, [...(porFicha.get(l.imobiliaria_id) ?? []), l]);
    const u = ctx.unidadeDe(l.imobiliaria_id);
    porUnidade.set(u, [...(porUnidade.get(u) ?? []), l]);
  }

  const agora = new Date().toISOString();
  let e26 = 0;
  let e25 = 0;
  for (const f of participantesFoto) {
    const datas = datasDeContratacao(f.imobiliaria_ids.flatMap((id) => porFicha.get(id) ?? []));
    const ate = hoje < f.periodo_fim ? hoje : f.periodo_fim;
    const diasPeriodo = diasEntre(f.periodo_inicio, f.periodo_fim) + 1;
    const decorridos = Math.max(1, diasEntre(f.periodo_inicio, ate) + 1);
    const realizado = contarNoPeriodo(datas, f.periodo_inicio, ate);
    const usado = Number((f.dados.baseline as { usado?: number } | undefined)?.usado ?? 0);
    const esperado = Math.round(usado * (decorridos / diasPeriodo) * 10) / 10;
    e26 += realizado;
    e25 += contarNoPeriodo(datas, somarAnos(f.periodo_inicio, -1), somarAnos(ate, -1));
    const historico = ((f.dados.andamento as Andamento[] | undefined) ?? []).filter((a) => a.ate !== ate);
    const ponto: Andamento = { ate, realizado, esperado, diasDecorridos: decorridos, diasPeriodo, atualizadoEm: agora, parcial: opcoes.parcial ?? null };
    const dados = { ...f.dados, andamento: [...historico, ponto].slice(-60), provisorio: { ate, realizado, esperadoAteAgora: esperado, diasDecorridos: decorridos, diasPeriodo } };
    const { error } = await db.from("campanhas_foto_partida").update({ dados }).eq("id", f.id);
    if (error) throw new Error("Não consegui gravar o andamento: " + error.message);
  }

  // Leitura provisória: Elite × comparação nas mesmas datas do ano anterior.
  const lanc = campanha.valido_de as string;
  const fimJanela = hoje < (campanha.valido_ate as string) ? hoje : (campanha.valido_ate as string);
  let c26 = 0;
  let c25 = 0;
  for (const [u] of ctx.controles) {
    const datas = datasDeContratacao(porUnidade.get(u) ?? []);
    c26 += contarNoPeriodo(datas, lanc, fimJanela);
    c25 += contarNoPeriodo(datas, somarAnos(lanc, -1), somarAnos(fimJanela, -1));
  }
  const razao = e25 > 0 && c25 > 0 && c26 > 0 && e26 > 0 ? e26 / e25 / (c26 / c25) : null;
  const se = razao ? Math.sqrt(1 / e26 + 1 / e25 + 1 / c26 + 1 / c25) : null;
  const intervalo: [number, number] | null = razao && se ? [Math.exp(Math.log(razao) - 1.96 * se), Math.exp(Math.log(razao) + 1.96 * se)] : null;
  const anterior = (agregadoFoto?.dados.historico as PontoRazao[] | undefined) ?? [];
  const ponto: PontoRazao = { ate: fimJanela, elite: [e25, e26], comparacao: [c25, c26], razao, intervalo, atualizadoEm: agora, parcial: opcoes.parcial ?? null };
  const dadosAgregado = {
    ate: fimJanela,
    elite: { ano_anterior: e25, atual: e26 },
    comparacao: { ano_anterior: c25, atual: c26, unidades: ctx.controles.size },
    razao,
    intervalo,
    historico: [...anterior.filter((p) => p.ate !== fimJanela), ponto].slice(-60),
  };
  const { error } = await db.from("campanhas_foto_partida").upsert(
    { campanha_id: campanhaId, unidade: "__agregado__", nome: "Leitura provisória (agregado)", imobiliaria_ids: [], periodo_inicio: lanc, periodo_fim: fimJanela, meta: null, tendencia: "agregado", dados: dadosAgregado },
    { onConflict: "campanha_id,unidade" }
  );
  if (error) throw new Error("Não consegui gravar a leitura provisória: " + error.message);
  return { participantes: participantesFoto.length, ate: fimJanela, razao };
}
