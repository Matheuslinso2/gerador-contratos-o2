import type { SupabaseClient } from "@supabase/supabase-js";
import { listarCardsRenovacaoFianca } from "@/lib/bitrix/renovacaoFianca";
import { listarRenovacoesRamosElementares } from "@/lib/ramos-elementares/fonteBitrix";

// Base Única — RENOVAÇÕES de Seguro Fiança e de Ramos Elementares do Bitrix
// na linha do tempo única (producao_unificada, tipo='renovacao',
// fonte='bitrix'), como série separada das cotações novas no Power BI -
// O2 Seguros (pedido do Matheus, 21/10/2026). Cada produto com a mesma
// leitura do painel do produto:
//  - Fiança (SPA 1042, funil Renovação, categoria 32, criado em 30/09/2026):
//    recebida = mês de criação do card; renovada/perdida = mês em que entrou
//    em Sucesso/Perdido (lib/bitrix/renovacaoFianca.ts, aba Renovação do
//    /seguro-fianca). Imobiliária = Empresa do card.
//  - RE (SPA 1046, funil Renovações, categoria 34, criado em 21/10/2026, com
//    os cards antigos da categoria 22 marcados como Renovação): recebida =
//    competência do card (Competência operacional, senão o mês do fim da
//    vigência); efetivada/não efetivada = mês do desfecho
//    (lib/ramos-elementares/fonteBitrix.ts). 1 card = 1 negociação por
//    imobiliária (os itens ficam em planilha anexa) — por isso a transição
//    planilha (item) → Bitrix (card) muda a unidade a partir de out/2026.
// Antes do Bitrix as renovações vêm das planilhas (scripts/base-unica/
// importar-planilhas-renovacoes.ts): Fiança até set/2026; RE até set/2026 —
// em set/2026 o painel de RE soma planilha e Bitrix (não se sobrepõem).
// 1 card = 1 linha; datas dos eventos em extras (data_conversao, data_perda),
// lidas pelo resumo producao_painel_mensal.

export type ProdutoRenovacao = "fianca" | "re";
type Linha = {
  produto: string;
  origem_bitrix_id: string;
  competencia_arquivo: string;
  data_recebimento: string | null;
  data_efetivacao: string | null;
  status_original: string;
  status_padrao: string;
  seguradora: string | null;
  imobiliaria_texto: string | null;
  fonte_vinculo: string | null;
  ramo_original: string | null;
  premio: number | null;
  comissao: number | null;
  extras: Record<string, unknown>;
};

export const ARQUIVOS_RENOVACAO: Record<ProdutoRenovacao, { arquivo: string; nome: string }> = {
  fianca: { arquivo: "bitrix:spa-1042:renovacao", nome: "Bitrix — SPA Seguro Fiança (funil Renovação)" },
  re: { arquivo: "bitrix:spa-1046:renovacao", nome: "Bitrix — SPA Ramos Elementares (funil Renovações)" },
};
const valor = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) && v !== 0 ? v : null);

async function lerFianca(): Promise<{ linhas: Linha[]; empresas: Map<string, string | null> }> {
  const cards = await listarCardsRenovacaoFianca();
  const empresas = new Map<string, string | null>();
  const linhas = cards.map((c): Linha => {
    if (c.companyId) empresas.set(String(c.companyId), c.empresa);
    const renovado = c.resultado === "Renovado";
    const perdido = c.resultado === "Perdido";
    return {
      produto: "fianca",
      origem_bitrix_id: String(c.id),
      competencia_arquivo: c.competencia,
      data_recebimento: c.dataCriacao,
      data_efetivacao: renovado ? c.dataResolucao : null,
      status_original: c.etapa,
      status_padrao: renovado ? "Convertido" : perdido ? "Perdido" : "Em análise",
      seguradora: c.seguradora,
      imobiliaria_texto: c.companyId ? String(c.companyId) : null,
      fonte_vinculo: c.companyId ? "bitrix_empresa" : null,
      ramo_original: null,
      premio: renovado ? valor(c.premioLiquido) : null,
      comissao: renovado ? valor(c.comissao) : null,
      extras: {
        data_conversao: renovado ? c.dataResolucao : null,
        data_perda: perdido ? c.dataResolucao : null,
        fim_vigencia_anterior: c.fimVigenciaAnterior,
        ...(c.motivoPerda ? { motivo: c.motivoPerda } : {}),
        ...(c.reajustePct !== null ? { reajuste_percentual: c.reajustePct } : {}),
        ...(valor(c.premioLiquido) !== null && !renovado ? { premio_cotado: c.premioLiquido } : {}),
      },
    };
  });
  return { linhas, empresas };
}

async function lerRe(): Promise<{ linhas: Linha[]; empresas: Map<string, string | null> }> {
  const cards = await listarRenovacoesRamosElementares();
  const empresas = new Map<string, string | null>();
  const linhas = cards.map((c): Linha => {
    // Automóvel/moto lançado na SPA de RE conta como Automóvel (tradução de
    // ramos validada pelo Matheus em 18/10/2026).
    const produto = /AUTO|MOTO|TRICICLO/i.test(c.produto) ? "automovel" : "re";
    if (c.companyId) empresas.set(String(c.companyId), c.empresa);
    const convertido = c.desfecho === "EFETIVADO";
    const perdido = c.desfecho === "NÃO EFETIVADO";
    return {
      produto,
      origem_bitrix_id: String(c.id),
      competencia_arquivo: c.competencia,
      data_recebimento: c.criadoEm,
      data_efetivacao: convertido ? c.dataDesfecho : null,
      status_original: c.status,
      status_padrao: convertido ? "Convertido" : perdido ? "Perdido" : "Em análise",
      seguradora: c.seguradora || null,
      imobiliaria_texto: produto === "re" && c.companyId ? String(c.companyId) : null,
      fonte_vinculo: produto === "re" && c.companyId ? "bitrix_empresa" : null,
      ramo_original: c.produto,
      premio: convertido ? valor(c.premioTotal) : null,
      comissao: convertido ? valor(c.comissao) : null,
      extras: {
        data_conversao: convertido ? c.dataDesfecho : null,
        data_perda: perdido ? c.dataDesfecho : null,
        spa: 1046,
        categoria: c.categoria,
        fim_vigencia: c.fimVigencia,
        ...(c.numeroApolice ? { apolice: c.numeroApolice } : {}),
      },
    };
  });
  return { linhas, empresas };
}

export async function lerRenovacoesBitrix(produto: ProdutoRenovacao) {
  return produto === "fianca" ? lerFianca() : lerRe();
}

// Totais por mês (recebidas / renovadas / não renovadas), para conferir com o painel do produto.
export function contarRenovacoesPorMes(linhas: Linha[]) {
  const porMes: Record<string, Record<string, number>> = {};
  const soma = (m: string | null | undefined, k: string) => {
    if (!m) return;
    (porMes[m.slice(0, 7)] ||= {})[k] = (porMes[m.slice(0, 7)][k] ?? 0) + 1;
  };
  for (const l of linhas) {
    if (!l.extras.sem_entrada) soma(l.competencia_arquivo, `recebidas_${l.produto}`);
    soma(l.extras.data_conversao as string | null, `renovadas_${l.produto}`);
    soma(l.extras.data_perda as string | null, `nao_renovadas_${l.produto}`);
  }
  return porMes;
}

export async function gravarRenovacoesBitrix(sb: SupabaseClient, produto: ProdutoRenovacao, dados: Awaited<ReturnType<typeof lerRenovacoesBitrix>>) {
  const { arquivo, nome } = ARQUIVOS_RENOVACAO[produto];
  const { linhas, empresas } = dados;
  const ok = async <T>(p: PromiseLike<{ data: T; error: { message: string } | null }>) => {
    const { data, error } = await p;
    if (error) throw new Error(error.message);
    return data;
  };
  await ok(
    sb.from("base_unica_planilhas_congeladas").upsert({ arquivo_id: arquivo, nome: `${nome} (fonte viva, sincronizada)`, pasta: "Bitrix", mime_type: "application/x-bitrix-spa" }, { onConflict: "arquivo_id", ignoreDuplicates: true })
  );
  const imp = (await ok(
    sb
      .from("base_unica_importacoes")
      .upsert(
        {
          arquivo_id: arquivo,
          arquivo_nome: nome,
          aba: "renovacoes",
          produto,
          layout: "bitrix_spa",
          competencia: null,
          linhas_lidas: linhas.length,
          linhas_importadas: linhas.length,
          descartes: {},
          totais_planilha: contarRenovacoesPorMes(linhas),
          totais_importados: { cards: linhas.length },
          confere: true,
          importado_em: new Date().toISOString(),
        },
        { onConflict: "arquivo_id,aba" }
      )
      .select("id")
      .single()
  )) as { id: string };

  // Empresa nova nos cards entra na base única como registro a identificar;
  // a ligação com a ficha é do cron /api/cron/base-unica-vinculos.
  const registros = new Map<string, { fonte: string; chave_externa: string; nome_original: string | null }>();
  for (const l of linhas) {
    if (!l.imobiliaria_texto || !l.fonte_vinculo) continue;
    registros.set(`${l.fonte_vinculo}|${l.imobiliaria_texto}`, { fonte: l.fonte_vinculo, chave_externa: l.imobiliaria_texto, nome_original: empresas.get(l.imobiliaria_texto) ?? null });
  }
  if (registros.size) await ok(sb.from("imobiliaria_registros_fonte").upsert([...registros.values()], { onConflict: "fonte,chave_externa", ignoreDuplicates: true }));

  const registrosProducao = linhas.map((l) => ({
    ...l,
    importacao_id: imp.id,
    tipo: "renovacao",
    fonte: "bitrix",
    origem_arquivo_id: arquivo,
    origem_aba: "renovacoes",
    herdada: false,
    chave_caso: `bitrix|${produto}|renovacao|${l.origem_bitrix_id}`,
  }));
  // Upsert pelo ID do card (índice único fonte+produto+origem_bitrix_id): os
  // IDs são únicos dentro da SPA, então não colidem com os cards de negócio novo.
  for (let i = 0; i < registrosProducao.length; i += 500) {
    await ok(sb.from("producao_unificada").upsert(registrosProducao.slice(i, i + 500), { onConflict: "fonte,produto,origem_bitrix_id" }));
  }
  // Card apagado (ou que mudou de produto) sai desta carga.
  const atuais = new Set(registrosProducao.map((r) => `${r.produto}|${r.origem_bitrix_id}`));
  const gravados: { id: string; produto: string; origem_bitrix_id: string }[] = [];
  for (let ini = 0; ; ini += 1000) {
    const data = (await ok(sb.from("producao_unificada").select("id, produto, origem_bitrix_id").eq("origem_arquivo_id", arquivo).order("id").range(ini, ini + 999))) as typeof gravados;
    gravados.push(...data);
    if (data.length < 1000) break;
  }
  const sobras = gravados.filter((g) => !atuais.has(`${g.produto}|${g.origem_bitrix_id}`)).map((g) => g.id);
  for (let i = 0; i < sobras.length; i += 200) await ok(sb.from("producao_unificada").delete().in("id", sobras.slice(i, i + 200)));
  await ok(sb.rpc("atualizar_producao_painel", { p_forcar: true }));
  return { cards: registrosProducao.length, removidos: sobras.length };
}
