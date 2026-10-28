import "server-only";
import { buscarTodasPaginasFlat, chamarBitrix, listarHistoricoEtapas } from "@/lib/bitrix/client";
import { createServiceClient } from "@/lib/supabase/service";
import { buscarLeadsAoVivo } from "@/lib/bitrix/crmLeads";
import { montarDatasetsCampanhas } from "./campanhas";
import { construirDatasets, mesesDoPeriodo, type AtividadeBruta, type Datasets, type DealBruto, type EmpresaBruta, type HistoricoBruto } from "./construir";

// Leitura do Bitrix (SOMENTE LEITURA: crm.*.list/fields) para o Painel Comercial
// v5. A credencial fica no servidor (BITRIX_WEBHOOK_URL); nada daqui vai ao
// navegador sem passar pelo filtro de perfil de acesso.ts.

const CATEGORIAS = [0, 1, 12]; // Sucesso do Cliente, Ativação Novos Clientes, Campanhas
const CAMPOS_EMPRESA = ["ID", "TITLE", "UF_CRM_1788467865683", "UF_CRM_1788467885830", "UF_CRM_1789589770952"];

async function lerDeals(): Promise<DealBruto[]> {
  const grupos = await Promise.all(
    CATEGORIAS.map((c) => buscarTodasPaginasFlat<DealBruto>("crm.deal.list", { "filter[CATEGORY_ID]": c, select: ["*", "UF_*"] }))
  );
  return grupos.flat();
}

async function lerEmpresas(ids: string[]): Promise<Map<string, EmpresaBruta>> {
  const mapa = new Map<string, EmpresaBruta>();
  const unicos = [...new Set(ids)].filter((x) => x && x !== "0");
  for (let i = 0; i < unicos.length; i += 50) {
    const lote = unicos.slice(i, i + 50);
    const linhas = await buscarTodasPaginasFlat<EmpresaBruta>("crm.company.list", { select: CAMPOS_EMPRESA, "filter[ID]": lote });
    for (const e of linhas) mapa.set(String(e.ID), e);
  }
  return mapa;
}

async function lerNomesEtapas12(): Promise<Record<string, string>> {
  const r = await chamarBitrix<{ result: { STATUS_ID: string; NAME: string }[] }>("crm.dealcategory.stage.list", { id: 12 });
  return Object.fromEntries(r.result.map((s) => [s.STATUS_ID, s.NAME]));
}

/** Ligações e WhatsApp (Voximplant / Open Lines) desde o 1º dia do mês anterior. */
async function lerAtividades(agora: Date): Promise<AtividadeBruta[]> {
  const desde = `${mesesDoPeriodo(agora)[0]}-01T00:00:00`;
  const porProvedor = await Promise.all(
    ["VOXIMPLANT_CALL", "IMOPENLINES_SESSION"].map((p) =>
      buscarTodasPaginasFlat<AtividadeBruta>("crm.activity.list", {
        "filter[>=CREATED]": desde,
        "filter[PROVIDER_ID]": p,
        select: ["ID", "PROVIDER_ID", "DIRECTION", "OWNER_ID", "OWNER_TYPE_ID", "RESPONSIBLE_ID", "CREATED"],
      })
    )
  );
  return porProvedor.flat();
}

export async function calcularDatasetsAoVivo(): Promise<Datasets> {
  const agora = new Date();
  const db = createServiceClient();
  const [deals, historico, nomesEtapas12, atividades, metasRes, fechadosRes] = await Promise.all([
    lerDeals(),
    listarHistoricoEtapas(2) as unknown as Promise<HistoricoBruto[]>,
    lerNomesEtapas12(),
    lerAtividades(agora),
    db.from("painel_comercial_metas_campanha").select("card, meta, unidade, prazo"),
    db.from("painel_comercial_meses_fechados").select("mes, kpi"),
  ]);

  // Empresas: as dos cards (resultado financeiro) + as das ligações/WhatsApp (nome nos rankings).
  const idsDeals = deals.map((d) => String(d.COMPANY_ID ?? ""));
  const donoDeal = new Map(deals.map((d) => [d.ID, String(d.COMPANY_ID ?? "")]));
  const idsAtividades = atividades.map((a) => (a.OWNER_TYPE_ID === "4" ? String(a.OWNER_ID) : a.OWNER_TYPE_ID === "2" ? (donoDeal.get(String(a.OWNER_ID)) ?? "") : ""));
  const empresas = await lerEmpresas([...idsDeals, ...idsAtividades]);

  const metasPersonalizadas = new Map<string, { meta: number | null; unidade: string | null; prazo: string | null }>();
  for (const m of (metasRes.data ?? []) as { card: number; meta: number | null; unidade: string | null; prazo: string | null }[]) {
    metasPersonalizadas.set(String(m.card), { meta: m.meta === null ? null : Number(m.meta), unidade: m.unidade, prazo: m.prazo });
  }
  const mesesCongelados: Datasets = { kpi: [] };
  for (const f of (fechadosRes.data ?? []) as { mes: string; kpi: Record<string, unknown>[] }[]) mesesCongelados.kpi.push(...f.kpi);

  const datasets = construirDatasets({ agora, deals, historico, empresas, atividades, nomesEtapas12, metasPersonalizadas, mesesCongelados });
  Object.assign(datasets, await lerCrmLeads());
  // Aba Campanhas: junta o CRM com metas/produção da área Campanhas. Se falhar, o resto segue.
  try {
    Object.assign(datasets, await montarDatasetsCampanhas(db, datasets.camp_cards ?? []));
  } catch (e) {
    console.error("Integração de Campanhas indisponível no Painel Comercial:", e);
    datasets.camp_erros = [{ erro: e instanceof Error ? e.message : "falha na integração de Campanhas" }];
  }
  return datasets;
}

// CRM Leads (Prioridades, Prospecção, Cadastro e caminhos): mesma fonte e regras
// do painel anterior (crm.lead.* dos responsáveis de prospecção). Se o Bitrix de
// Leads falhar, só essas três visões ficam sem dados: o resto do painel segue.
async function lerCrmLeads(): Promise<Datasets> {
  try {
    const d = await buscarLeadsAoVivo();
    return {
      crm_leads: d.linhas.map((l) => ({
        id: l.id,
        nome: l.nome,
        link: l.link,
        responsavel: l.responsavelNome,
        etapa: l.etapaNome,
        stage_id: l.stageId,
        prioridade: l.prioridade,
        prazo: l.prazo,
        assunto: l.assunto,
        decisor: l.decisorRegistrado ? "Sim" : "Não",
        email_inicial: l.emailInicialEnviado ? "Sim" : "Não",
        cadastro: l.cadastroConcluido ? "Sim" : "Não",
        caminho: l.caminho,
      })),
      crm_leads_info: [{ atualizado_em: d.ultimaAtualizacao }],
    };
  } catch (e) {
    console.error("CRM Leads indisponível no Painel Comercial:", e);
    return { crm_leads_erro: [{ erro: e instanceof Error ? e.message : "falha ao buscar Leads" }] };
  }
}
