// Foto de partida de uma campanha: tendência de produção, baseline, engajamento prévio e grupo de
// comparação de cada participante. Só leitura (grava a foto em campanhas_foto_partida).
//   NODE_PATH="$TEMP/stub" npx tsx scripts/campanhas/foto-de-partida.ts <campanha_id>
process.loadEnvFile(".env.local");
import { createClient } from "@supabase/supabase-js";
import { participantesDaCampanha } from "../../src/lib/campanhas/metasCampanha";
import { imobiliariasDaCampanha } from "../../src/lib/campanhas/imobiliariasDaCampanha";
import { produtosBaseDaCampanha } from "../../src/lib/campanhas/desempenho";
import { produtosDaCampanha } from "../../src/lib/campanhas/produtos";
import { baselineDoPeriodo, classificarTendencia, contarNoPeriodo, datasDeContratacao, matrizDeAcao, mesesDeHistorico, somarAnos, somarDias, type LinhaFunilBruta } from "../../src/lib/campanhas/tendencia";

type Linha = LinhaFunilBruta & { imobiliaria_id: string };
type Ficha = { id: string; nome: string; apelido: string | null; grupo_id: string | null };
const mediana = (v: number[]) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pc = (v: number | null) => (v === null ? "  —  " : `${v >= 0 ? "+" : ""}${Math.round(v * 100)}%`.padStart(5));

async function main() {
  const campanhaId = process.argv[2];
  if (!campanhaId) throw new Error("Informe o id da campanha.");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const { data: campanha } = await db.from("campanhas").select("*").eq("id", campanhaId).single();
  if (!campanha) throw new Error("Campanha não encontrada.");
  const produtos = produtosBaseDaCampanha(produtosDaCampanha(campanha as never));

  const { data: fichasBd } = await db.from("imobiliarias").select("id, nome, apelido, grupo_id");
  const ficha = new Map(((fichasBd ?? []) as Ficha[]).map((f) => [f.id, f]));
  const { data: gruposBd } = await db.from("imobiliaria_grupos").select("id, nome");
  const nomeGrupo = new Map(((gruposBd ?? []) as { id: string; nome: string }[]).map((g) => [g.id, g.nome]));
  const unidadeDe = (id: string) => ficha.get(id)?.grupo_id ?? id;
  const fichasDoGrupo = (g: string) => [...ficha.values()].filter((f) => f.grupo_id === g).map((f) => f.id);

  const idsImobs = await imobiliariasDaCampanha(db, campanha as never);
  const { participantes } = await participantesDaCampanha(db, campanha.id, idsImobs);
  const comMeta = participantes.filter((p) => p.meta !== null && Number(p.meta) > 0);

  type Unid = { chave: string; nome: string; fichas: string[]; meta: number; inicio: string; fim: string };
  const part: Unid[] = comMeta.map((p) => {
    const f = p.imobiliaria_id ? ficha.get(p.imobiliaria_id) : undefined;
    return {
      chave: p.grupo_id ?? p.imobiliaria_id!,
      nome: p.grupo_id ? (nomeGrupo.get(p.grupo_id) ?? "Grupo") : (f?.apelido || f?.nome || "—"),
      fichas: p.grupo_id ? fichasDoGrupo(p.grupo_id) : [p.imobiliaria_id!],
      meta: Number(p.meta),
      inicio: p.periodo_inicio || (campanha.valido_de as string),
      fim: p.periodo_fim || (campanha.valido_ate as string),
    };
  });
  // Grupos que têm ao menos uma ficha participante ficam fora da comparação (a rede toda é "tocada" pela campanha).
  const chavesPart = new Set(part.flatMap((u) => u.fichas.map((f) => unidadeDe(f))));

  // Carteira ativa de comparação: ativas nos 12 meses antes do lançamento, fora da campanha.
  const lanc = campanha.valido_de as string;
  const { data: ativas } = await db.rpc("imobiliarias_ativas", { p_desde: somarAnos(lanc, -1), p_ate: somarDias(lanc, -1) });
  const controlesFichas = new Map<string, string[]>();
  for (const a of (ativas ?? []) as { imobiliaria_id: string }[]) {
    const u = unidadeDe(a.imobiliaria_id);
    if (chavesPart.has(u)) continue;
    controlesFichas.set(u, ficha.get(a.imobiliaria_id)?.grupo_id ? fichasDoGrupo(u) : [a.imobiliaria_id]);
  }
  console.log(`participantes: ${part.length} | carteira de comparação (ativas fora da campanha): ${controlesFichas.size} unidades`);

  // Funil de todas as fichas envolvidas (desde 2023), em lotes. Falha de consulta interrompe (nunca vira zero).
  const todasFichas = [...new Set([...part.flatMap((u) => u.fichas), ...[...controlesFichas.values()].flat()])];
  const linhas: Linha[] = [];
  for (let i = 0; i < todasFichas.length; i += 80) {
    for (let de = 0; ; de += 1000) {
      const { data, error } = await db.rpc("campanha_programa_funil", { p_imobs: todasFichas.slice(i, i + 80), p_produtos: produtos, p_desde: "2023-01-01" }).range(de, de + 999);
      if (error) throw new Error("Falha ao consultar a produção: " + error.message);
      linhas.push(...((data ?? []) as Linha[]));
      if (!data || data.length < 1000) break;
    }
  }
  console.log(`linhas de funil lidas: ${linhas.length}`);
  const linhasPorUnidade = new Map<string, Linha[]>(); // comparação: rede inteira
  const linhasPorFicha = new Map<string, Linha[]>(); // participante: só as suas fichas (igual ao painel)
  for (const l of linhas) {
    const u = unidadeDe(l.imobiliaria_id);
    linhasPorUnidade.set(u, [...(linhasPorUnidade.get(u) ?? []), l]);
    linhasPorFicha.set(l.imobiliaria_id, [...(linhasPorFicha.get(l.imobiliaria_id) ?? []), l]);
  }
  const datasDe = (chave: string) => datasDeContratacao(linhasPorUnidade.get(chave) ?? []);
  const datasDoParticipante = (u: Unid) => datasDeContratacao(u.fichas.flatMap((f) => linhasPorFicha.get(f) ?? []));

  const { data: eng } = await db.from("imobiliaria_engajamento_snapshot").select("unidade, nivel_resposta, nivel_esforco, esforco_pontos, resposta_pontos, disponibilidade").eq("janela_inicio", "2026-07-03");
  const engDe = new Map((eng ?? []).map((e) => [e.unidade as string, e]));

  const ctrl = [...controlesFichas.keys()].map((c) => {
    const d = datasDe(c);
    return { chave: c, datas: d, n12: contarNoPeriodo(d, somarAnos(lanc, -1), somarDias(lanc, -1)), t: classificarTendencia(d, lanc) };
  });

  const linhasOut: Record<string, unknown>[] = [];
  let e26 = 0;
  let e25 = 0;
  for (const u of part.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))) {
    const datas = datasDoParticipante(u);
    const t = classificarTendencia(datas, u.inicio);
    const meses = mesesDeHistorico(datas, somarDias(u.inicio, -1));
    const b = baselineDoPeriodo(datas, u.inicio, u.fim, u.inicio, meses);
    const e = engDe.get(unidadeDe(u.fichas[0]));
    const nivelResp = e?.disponibilidade === "ok" ? (e.nivel_resposta as string) : "Indisponível";
    const mat = matrizDeAcao(t.tendencia, nivelResp);
    const pares = ctrl.filter((c) => c.n12 >= Math.max(5, 0.5 * t.ultimos12m) && c.n12 <= 2 * Math.max(t.ultimos12m, 5));
    const variacoes = pares.filter((c) => c.t.tendencia !== "Dados insuficientes" && c.t.variacao !== null).map((c) => c.t.variacao as number);
    const diasP = Math.round((Date.parse(`${u.fim}T12:00:00Z`) - Date.parse(`${u.inicio}T12:00:00Z`)) / 86_400_000) + 1;
    const ate = hoje < u.fim ? hoje : u.fim;
    const decorridos = Math.max(1, Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${u.inicio}T12:00:00Z`)) / 86_400_000) + 1);
    const realizado = contarNoPeriodo(datas, u.inicio, ate);
    const esperadoAteAgora = Math.round(b.usado * (decorridos / diasP) * 10) / 10;
    e26 += realizado;
    e25 += contarNoPeriodo(datas, somarAnos(u.inicio, -1), somarAnos(ate, -1));
    const ambicao = b.usado > 0 ? Math.round((u.meta / b.usado) * 100) / 100 : null;
    const dados = {
      tendencia: t,
      baseline: b,
      ambicao,
      engajamento: e ? { nivelResposta: e.nivel_resposta, nivelEsforco: e.nivel_esforco, pontosResposta: e.resposta_pontos, pontosEsforco: e.esforco_pontos, disponibilidade: e.disponibilidade } : null,
      matriz: mat,
      controles: { qtd: pares.length, medianaVariacao: mediana(variacoes), qtdClassificaveis: variacoes.length },
      provisorio: { ate, realizado, esperadoAteAgora, diasDecorridos: decorridos, diasPeriodo: diasP },
    };
    linhasOut.push({ campanha_id: campanhaId, unidade: u.chave, nome: u.nome, imobiliaria_ids: u.fichas, periodo_inicio: u.inicio, periodo_fim: u.fim, meta: u.meta, tendencia: t.tendencia, dados });
    console.log(
      `${u.nome.slice(0, 28).padEnd(28)} | ${t.tendencia.padEnd(19)} ${String(t.anteriores12m).padStart(3)}→${String(t.ultimos12m).padEnd(3)} ${pc(t.variacao)} | base ${String(b.usado).padStart(5)} ${b.criterio.startsWith("média") ? "(média)" : "(ritmo)"} meta/base ${String(ambicao ?? "—").padEnd(5)} | resp ${nivelResp.padEnd(12)} | ${mat.quadrante} | contr ${String(pares.length).padStart(2)} (med ${pc(mediana(variacoes))}) | agora ${realizado} vs esperado ${esperadoAteAgora}`
    );
  }
  for (let i = 0; i < linhasOut.length; i += 50) {
    const { error } = await db.from("campanhas_foto_partida").upsert(linhasOut.slice(i, i + 50), { onConflict: "campanha_id,unidade" });
    if (error) throw new Error(error.message);
  }
  console.log(`\nfoto de partida gravada: ${linhasOut.length} participantes`);

  // Leitura PROVISÓRIA (poucos dias e poucos casos): Elite x carteira de comparação nas mesmas datas.
  const c26 = ctrl.reduce((s, c) => s + contarNoPeriodo(c.datas, lanc, hoje), 0);
  const c25 = ctrl.reduce((s, c) => s + contarNoPeriodo(c.datas, somarAnos(lanc, -1), somarAnos(hoje, -1)), 0);
  const razao = e25 > 0 && c25 > 0 && c26 > 0 && e26 > 0 ? e26 / e25 / (c26 / c25) : null;
  const se = razao ? Math.sqrt(1 / e26 + 1 / e25 + 1 / c26 + 1 / c25) : null;
  console.log(`\nPROVISÓRIO (${lanc} a ${hoje} contra as mesmas datas de 2025): Elite ${e25}→${e26} (${e25 ? Math.round((e26 / e25 - 1) * 100) : "—"}%) | comparação ${c25}→${c26} (${c25 ? Math.round((c26 / c25 - 1) * 100) : "—"}%)`);
  const agregado = { ate: hoje, elite: { ano_anterior: e25, atual: e26 }, comparacao: { ano_anterior: c25, atual: c26, unidades: ctrl.length }, razao, intervalo: razao && se ? [Math.exp(Math.log(razao) - 1.96 * se), Math.exp(Math.log(razao) + 1.96 * se)] : null };
  const { error: eAgr } = await db.from("campanhas_foto_partida").upsert({ campanha_id: campanhaId, unidade: "__agregado__", nome: "Leitura provisória (agregado)", imobiliaria_ids: [], periodo_inicio: lanc, periodo_fim: hoje, meta: null, tendencia: "agregado", dados: agregado }, { onConflict: "campanha_id,unidade" });
  if (eAgr) throw new Error(eAgr.message);
  if (razao && se) console.log(`  razão de razões (Elite ÷ comparação) = ${razao.toFixed(2)}  [95%: ${Math.exp(Math.log(razao) - 1.96 * se).toFixed(2)} a ${Math.exp(Math.log(razao) + 1.96 * se).toFixed(2)}]`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
