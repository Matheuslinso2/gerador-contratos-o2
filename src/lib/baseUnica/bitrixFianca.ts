import type { SupabaseClient } from "@supabase/supabase-js";
import { buscarDefinicaoCampos, buscarEmpresas, buscarUsuarios, listarHistoricoEtapas, listarItensSpa } from "@/lib/bitrix/client";
import { CATEGORIA_ANALISE, CATEGORIA_NEGOCIACAO, ENTITY_TYPE_ID, idsResponsaveisEtapas, montarContagemMensal, type LinhaContagem } from "@/lib/bitrix/seguroFianca";

// Base Única — Fase 4: cotações de Seguro Fiança do Bitrix (SPA 1042) na
// mesma linha do tempo das planilhas (producao_unificada, fonte='bitrix').
// Regra do Matheus (20/10/2026): o SPA é o mesmo processo de controle das
// planilhas de análise; quando a fonte muda, só a fonte muda — os KPIs são
// alimentados da mesma forma. Por isso usa exatamente a leitura do painel
// /seguro-fianca (montarContagemMensal): entrada = mês de criação do card;
// aprovação/recusa/perda/conversão = mês em que o evento aconteceu.
// 1 card = 1 linha; imobiliária = Empresa do card (companyId), resolvida pela
// base única só com vínculo confirmado (fonte bitrix_empresa).
// Usado pelo cron /api/cron/base-unica-bitrix e por
// scripts/base-unica/sincronizar-bitrix-fianca.ts (simulação/conferência).

export const ARQUIVO_BITRIX_FIANCA = "bitrix:spa-1042";
const CATEGORIAS = new Set([CATEGORIA_ANALISE, CATEGORIA_NEGOCIACAO]);

// Etapa no padrão da base única (mesmo vocabulário validado para as planilhas).
export function statusPadraoBitrix(l: LinhaContagem): string {
  if (l.resultado === "Recusado") return "Recusado";
  if (l.resultado === "Perdido") return "Perdido";
  if (l.resultado === "Convertido") return "Convertido";
  if (l.resultado === "Aprovado" || l.funil === "Negociação e Contrato") return "Aprovado";
  return "Em análise";
}

export type ContagemMes = Partial<Record<"entradas" | "aprovados" | "recusados" | "perdidos" | "convertidos", number>>;

export async function lerBitrixFianca() {
  const [todos, historicoTodo, defs] = await Promise.all([
    listarItensSpa(ENTITY_TYPE_ID),
    listarHistoricoEtapas(ENTITY_TYPE_ID),
    buscarDefinicaoCampos(ENTITY_TYPE_ID),
  ]);
  // Só contratação nova (Análise e Cotação + Negociação e Contrato), como o painel.
  const itens = todos.filter((i) => CATEGORIAS.has(Number(i.categoryId)));
  const ids = new Set(itens.map((i) => Number(i.id)));
  const historico = historicoTodo.filter((h) => ids.has(Number(h.OWNER_ID)) && CATEGORIAS.has(Number(h.CATEGORY_ID)));
  const [empresas, usuarios] = await Promise.all([
    buscarEmpresas(itens.map((i) => i.companyId).filter((x): x is number => !!x)),
    buscarUsuarios(itens.flatMap((i) => [i.assignedById, i.createdBy, i.movedBy, ...idsResponsaveisEtapas(i)]).filter((x): x is number => !!x)),
  ]);
  const linhas = montarContagemMensal(itens, historico, usuarios, empresas, defs);
  const empresaPorCard = new Map(itens.map((i) => [Number(i.id), i.companyId ? String(i.companyId) : null]));

  const porMes: Record<string, ContagemMes> = {};
  const soma = (data: string, k: keyof ContagemMes) => {
    if (!data) return;
    const m = data.slice(0, 7);
    (porMes[m] ||= {})[k] = (porMes[m][k] ?? 0) + 1;
  };
  for (const l of linhas) {
    soma(l.competencia, "entradas");
    soma(l.dataAprovacao, "aprovados");
    soma(l.dataRecusa, "recusados");
    soma(l.dataPerda, "perdidos");
    soma(l.dataConversao, "convertidos");
  }
  return { linhas, empresaPorCard, porMes, empresas };
}

export async function gravarBitrixFianca(supabase: SupabaseClient, dados: Awaited<ReturnType<typeof lerBitrixFianca>>) {
  const { linhas, empresaPorCard, porMes, empresas } = dados;
  const num = (v: number | "") => (typeof v === "number" ? v : null);

  const { data: imp, error: e1 } = await supabase
    .from("base_unica_importacoes")
    .upsert(
      {
        arquivo_id: ARQUIVO_BITRIX_FIANCA,
        arquivo_nome: "Bitrix — SPA Seguro Fiança (Análise e Cotação + Negociação e Contrato)",
        aba: "contratacao_nova",
        produto: "fianca",
        layout: "bitrix_spa",
        competencia: null,
        linhas_lidas: linhas.length,
        linhas_importadas: linhas.length,
        descartes: {},
        totais_planilha: porMes,
        totais_importados: { cards: linhas.length },
        confere: true,
        importado_em: new Date().toISOString(),
      },
      { onConflict: "arquivo_id,aba" }
    )
    .select("id")
    .single();
  if (e1) throw new Error("importacoes: " + e1.message);

  const registros = linhas.map((l) => ({
    importacao_id: imp.id,
    produto: "fianca",
    tipo: "novo",
    fonte: "bitrix",
    origem_arquivo_id: ARQUIVO_BITRIX_FIANCA,
    origem_aba: "contratacao_nova",
    origem_bitrix_id: String(l.id),
    competencia_arquivo: l.competencia,
    herdada: false,
    chave_caso: `bitrix|fianca|${l.id}`,
    data_recebimento: l.dataCriacao || null,
    data_efetivacao: l.dataEfetivacao || null,
    status_original: l.etapaAtual,
    status_padrao: statusPadraoBitrix(l),
    seguradora: l.seguradoraEscolhida || null,
    imobiliaria_texto: empresaPorCard.get(l.id) ?? null,
    fonte_vinculo: "bitrix_empresa",
    responsavel: l.responsaveisCotacao.join(", ") || null,
    aluguel: num(l.aluguel),
    premio: num(l.premioLiquido),
    comissao: null,
    extras: {
      funil: l.funil,
      data_aprovacao: l.dataAprovacao || null,
      data_recusa: l.dataRecusa || null,
      data_perda: l.dataPerda || null,
      data_conversao: l.dataConversao || null,
      ...(l.imobiliaria && !empresaPorCard.get(l.id) ? { imobiliaria_nome: l.imobiliaria } : {}),
      ...(typeof l.comissaoFinalPct === "number" ? { comissao_percentual: l.comissaoFinalPct } : {}),
      ...(l.motivoRecusaPerda ? { motivo: l.motivoRecusaPerda } : {}),
    },
  }));

  // Empresa nova nos cards entra na base única como registro a identificar; a
  // rotina /api/cron/base-unica-vinculos liga à ficha (mesmas regras de sempre).
  const idsEmpresa = [...new Set([...empresaPorCard.values()].filter((v): v is string => !!v))];
  if (idsEmpresa.length) {
    const { error: eReg } = await supabase.from("imobiliaria_registros_fonte").upsert(
      idsEmpresa.map((id) => ({ fonte: "bitrix_empresa", chave_externa: id, nome_original: empresas[Number(id)] ?? null })),
      { onConflict: "fonte,chave_externa", ignoreDuplicates: true }
    );
    if (eReg) throw new Error("registros bitrix_empresa: " + eReg.message);
  }

  // Atualiza card a card (upsert pelo ID do Bitrix) em vez de apagar e regravar:
  // se o cron cair no meio, o que já estava gravado continua lá.
  for (let i = 0; i < registros.length; i += 500) {
    const { error } = await supabase.from("producao_unificada").upsert(registros.slice(i, i + 500), { onConflict: "fonte,produto,origem_bitrix_id" });
    if (error) throw new Error("producao_unificada: " + error.message);
  }
  // Card apagado no Bitrix sai da linha do tempo.
  const atuais = new Set(registros.map((r) => r.origem_bitrix_id));
  const gravados: { id: string; origem_bitrix_id: string }[] = [];
  for (let inicio = 0; ; inicio += 1000) {
    const { data, error } = await supabase
      .from("producao_unificada")
      .select("id, origem_bitrix_id")
      .eq("fonte", "bitrix")
      .eq("produto", "fianca")
      .order("id")
      .range(inicio, inicio + 999);
    if (error) throw new Error("listar gravados: " + error.message);
    gravados.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const sobras = gravados.filter((g) => !atuais.has(g.origem_bitrix_id)).map((g) => g.id);
  for (let i = 0; i < sobras.length; i += 200) {
    const { error } = await supabase.from("producao_unificada").delete().in("id", sobras.slice(i, i + 200));
    if (error) throw new Error("apagar cards removidos: " + error.message);
  }
  // Remonta o resumo do painel Produção com os números novos.
  const { error: e3 } = await supabase.rpc("atualizar_producao_painel", { p_forcar: true });
  if (e3) throw new Error("atualizar painel: " + e3.message);
  return { cards: registros.length, removidos: sobras.length };
}
