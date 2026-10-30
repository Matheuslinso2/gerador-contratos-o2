import "server-only";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { executar, ler, mesesEntre, mesRegex, ErroConector, supabaseDoToken, type Contexto } from "./conectorLeitura";
import { parearRepassesDaFicha } from "@/lib/repassesIdentificacao";

// Ferramentas do conector de leitura (Fase 1). Cada uma chama a MESMA função
// ou tabela pronta que a tela correspondente usa, para os números saírem
// iguais. Nenhuma grava nada.

const mes = z.string().regex(mesRegex, "use AAAA-MM");
const lista = z.array(z.string()).optional();
const INICIO_BITRIX_FIANCA = "2026-08";

const REGRA_VIGENCIA = "Mês de INÍCIO DE VIGÊNCIA do documento (espelho do Corp/Power BI). Mês fechado fica congelado; o mês anterior fica aberto até o dia 15.";

type Auth = { http?: { authInfo?: { token: string; extra?: Record<string, unknown> } } };
function contexto(c: Auth): Contexto {
  const info = c.http?.authInfo;
  if (!info?.token) throw new ErroConector("Sem login.");
  return { email: String(info.extra?.email ?? ""), sb: supabaseDoToken(info.token) };
}

async function telaPronta(ctx: Contexto, chave: string) {
  const { data } = await ctx.sb.from("corp_painel_pronto").select("dados, gerado_em").eq("chave", chave).maybeSingle();
  return data as { dados: unknown; gerado_em: string } | null;
}

async function importadoEm(ctx: Contexto): Promise<string | null> {
  const { data } = await ctx.sb.rpc("corp_opcoes_filtro");
  const d = data as { importado_em?: string } | null;
  return d?.importado_em ?? null;
}

const filtrosCorp = {
  seguradoras: lista.describe("Seguradoras (valores de fontes_e_filtros)"),
  grupos: lista.describe("Grupos de produtor do Corp"),
  ramos: lista,
  centralizadores: lista.describe("CNPJ/SUSEP centralizador (1ª/2ª SUSEP)"),
  produtores: lista,
  origens: lista.describe("Origem/canal (Segimob, Superlógica, venda direta...)"),
  tipos: lista.describe("Tipo de operação: NOVO, RENV, ENDO, FATU, CANC..."),
  cancelado: lista,
};
type FiltrosCorp = { [K in keyof typeof filtrosCorp]?: string[] };
function paramsCorp(f: FiltrosCorp) {
  const v = (x?: string[]) => (x && x.length ? x : null);
  return {
    p_seg: v(f.seguradoras), p_grupo: v(f.grupos), p_ramo: v(f.ramos), p_central: v(f.centralizadores),
    p_produtor: v(f.produtores), p_origem: v(f.origens), p_tipo: v(f.tipos), p_cancelado: v(f.cancelado),
  };
}
const temFiltro = (f: FiltrosCorp) => Object.values(f).some((x) => Array.isArray(x) && x.length > 0);

export function registrarFerramentas(server: McpServer) {
  server.registerTool(
    "fontes_e_filtros",
    {
      title: "Fontes, filtros e atualização",
      description:
        "Lista os valores válidos de filtro (seguradoras, ramos, grupos, produtores, origens, tipos, meses disponíveis, produtos, grupos de imobiliária) e quando cada fonte foi atualizada. Use antes das outras ferramentas.",
      inputSchema: z.object({}),
    },
    async (_a, c) => {
      const ctx = contexto(c as Auth);
      return executar(ctx, "fontes_e_filtros", {}, async () => {
        const [corp, producao, gruposSinistros, fianca] = await Promise.all([
          ler(ctx.sb.rpc("corp_opcoes_filtro")),
          ler(ctx.sb.rpc("opcoes_filtro_producao")),
          ler(ctx.sb.rpc("opcoes_grupos_sinistros")),
          ler(ctx.sb.from("seguro_fianca_snapshots").select("competencia, atualizado_em").order("competencia", { ascending: false }).limit(1)),
        ]);
        return {
          fonte: "Workspace O2 (espelho do Corp/SharePoint, base única de imobiliárias, Bitrix)",
          regra_data: "Varia por ferramenta; cada resposta informa a sua.",
          atualizado_em: (corp as { importado_em?: string })?.importado_em ?? null,
          dados: { producao_corp: corp, producao_workspace: producao, grupos_sinistros: gruposSinistros, ultimo_retrato_fianca: fianca },
        };
      });
    }
  );

  server.registerTool(
    "buscar_imobiliaria",
    {
      title: "Buscar imobiliária ou grupo",
      description: "Procura imobiliárias e grupos da base única pelo nome e devolve os ids usados nos filtros de produção_kpis, imobiliaria_360 e sinistros.",
      inputSchema: z.object({ nome: z.string().min(2) }),
    },
    async ({ nome }, c) => {
      const ctx = contexto(c as Auth);
      return executar(ctx, "buscar_imobiliaria", { nome }, async () => {
        const termo = `%${nome.replace(/[%_]/g, "")}%`;
        const [imobs, grupos] = await Promise.all([
          ler(ctx.sb.from("imobiliarias").select("id, nome, grupo_id").ilike("nome", termo).order("nome").limit(30)),
          ler(ctx.sb.from("imobiliaria_grupos").select("id, nome").ilike("nome", termo).order("nome").limit(30)),
        ]);
        return { fonte: "Base única de imobiliárias", regra_data: "Cadastro (sem data)", dados: { imobiliarias: imobs, grupos } };
      });
    }
  );

  server.registerTool(
    "producao_flash",
    {
      title: "Flash Report",
      description:
        "Comissão da corretora do mês e acumulado no ano (YTD) por ramo do Flash, com meta. Supermeta = meta × 1,1 (regra da tela). Mesmos números da tela Produção › Flash Report.",
      inputSchema: z.object({ mes, ramos_flash: lista.describe("Opcional: recorte por ramo do Flash") }),
    },
    async ({ mes: m, ramos_flash }, c) => {
      const ctx = contexto(c as Auth);
      return executar(ctx, "producao_flash", { mes: m, ramos_flash }, async () => {
        const pronta = ramos_flash?.length ? null : await telaPronta(ctx, `flash:${m}`);
        const dados = pronta?.dados ?? (await ler(ctx.sb.rpc("corp_painel_flash", { p_mes: `${m}-01`, p_ramo_flash: ramos_flash?.length ? ramos_flash : null })));
        return {
          fonte: "Produção › Flash Report (corp_painel_flash; meta = Base de Metas do SharePoint)",
          regra_data: REGRA_VIGENCIA,
          atualizado_em: pronta?.gerado_em ?? (await importadoEm(ctx)),
          observacoes: ["Supermeta = meta × 1,1. PREMIAÇÃO não tem meta.", "Comissão = base corretora; Segimob/Superlógica/Retransmissão vêm da base de exceção."],
          dados,
        };
      });
    }
  );

  server.registerTool(
    "producao_historica",
    {
      title: "Produção Histórica",
      description: "Série mês a mês (desde 2015) de documentos, prêmio líquido (pl), comissão da corretora (com) e do produtor (com_prod), com filtros. Mesmos números da tela Produção › Produção Histórica. Some os meses para ano/trimestre.",
      inputSchema: z.object({ de: mes.optional(), ate: mes.optional(), ...filtrosCorp }),
    },
    async ({ de, ate, ...f }, c) => {
      const ctx = contexto(c as Auth);
      return executar(ctx, "producao_historica", { de, ate, ...f }, async () => {
        const pronta = temFiltro(f) ? null : await telaPronta(ctx, "historico");
        const serie = ((pronta?.dados ?? (await ler(ctx.sb.rpc("corp_painel_historico", paramsCorp(f))))) as { mes: string }[]) ?? [];
        const recorte = serie.filter((x) => (!de || x.mes >= de) && (!ate || x.mes <= ate));
        return { fonte: "Produção › Produção Histórica (corp_painel_historico)", regra_data: REGRA_VIGENCIA, atualizado_em: pronta?.gerado_em ?? (await importadoEm(ctx)), dados: recorte };
      });
    }
  );

  server.registerTool(
    "producao_geral",
    {
      title: "Produção Geral",
      description: "Mês × mês anterior × mesmo mês do ano anterior e YTD (docs, comissão, prêmio), com quebras por tipo, grupo, ramo, seguradora, centralizador, produtor, origem e parcelas. Mesmos números da tela Produção › Produção Geral.",
      inputSchema: z.object({ mes, ...filtrosCorp }),
    },
    async ({ mes: m, ...f }, c) => {
      const ctx = contexto(c as Auth);
      return executar(ctx, "producao_geral", { mes: m, ...f }, async () => {
        const pronta = temFiltro(f) ? null : await telaPronta(ctx, `geral:${m}`);
        const dados = pronta?.dados ?? (await ler(ctx.sb.rpc("corp_painel_geral", { p_mes: `${m}-01`, ...paramsCorp(f) })));
        return { fonte: "Produção › Produção Geral (corp_painel_geral)", regra_data: REGRA_VIGENCIA, atualizado_em: pronta?.gerado_em ?? (await importadoEm(ctx)), dados };
      });
    }
  );

  server.registerTool(
    "producao_kpis",
    {
      title: "KPIs de produção (apólices + funil de cotações)",
      description: "Apólices e funil de cotações por produto, grupo, imobiliária e seguradora no período (tela Produção). Use para o Seguro Fiança antes de 08/2026 (planilhas) e para recortes por imobiliária/grupo.",
      inputSchema: z.object({
        de: mes, ate: mes,
        produtos: lista.describe("ex.: fianca, capitalizacao, incendio, auto..."),
        grupos_ids: lista.describe("ids de grupo (buscar_imobiliaria)"),
        imobiliarias_ids: lista.describe("ids de imobiliária (buscar_imobiliaria)"),
        seguradoras: lista,
      }),
    },
    async (a, c) => {
      const ctx = contexto(c as Auth);
      return executar(ctx, "producao_kpis", a, async () => {
        await ctx.sb.rpc("atualizar_producao_painel", { p_forcar: false });
        const v = (x?: string[]) => (x && x.length ? x : null);
        const dados = await ler(ctx.sb.rpc("kpis_producao", { p_de: a.de, p_ate: a.ate, p_produtos: v(a.produtos), p_grupos: v(a.grupos_ids), p_imobs: v(a.imobiliarias_ids), p_seguradoras: v(a.seguradoras) }));
        return {
          fonte: "Produção (kpis_producao)",
          regra_data: "Apólices: mês de início de vigência. Funil: entrada pelo mês em que a cotação entrou; aprovação/recusa/perda/conversão pelo mês do evento.",
          observacoes: ["Seguradora recorta só as apólices.", "Imobiliária entra só por vínculo confirmado na base única.", `Seguro Fiança: antes de ${INICIO_BITRIX_FIANCA} os números vêm das planilhas; depois, do Bitrix.`],
          dados,
        };
      });
    }
  );

  server.registerTool(
    "imobiliaria_360",
    {
      title: "Imobiliária 360",
      description: "Visão completa de uma imobiliária ou grupo no período (produção, cotações, conversões, sinistros abertos). Mesmos números da Imobiliária 360.",
      inputSchema: z.object({ tipo: z.enum(["imobiliaria", "grupo"]), id: z.string().uuid(), de: mes, ate: mes }),
    },
    async (a, c) => {
      const ctx = contexto(c as Auth);
      return executar(ctx, "imobiliaria_360", a, async () => {
        const dados = await ler(ctx.sb.rpc("visao_360_imobiliaria", { p_tipo: a.tipo, p_id: a.id, p_de: a.de, p_ate: a.ate }));
        return { fonte: "Produção › Imobiliária 360 (visao_360_imobiliaria)", regra_data: "Apólices: início de vigência. Cotações: datas do card.", dados };
      });
    }
  );

  server.registerTool(
    "producao_inconsistencias",
    {
      title: "Log de Inconsistências",
      description: "Inconsistências da base do Corp (duplicidades, produtores ausentes, nomes a corrigir) e alterações detectadas em meses já fechados. Mesma tela Produção › Inconsistências.",
      inputSchema: z.object({}),
    },
    async (_a, c) => {
      const ctx = contexto(c as Auth);
      return executar(ctx, "producao_inconsistencias", {}, async () => {
        const [inconsistencias, alteracoes] = await Promise.all([
          ler(ctx.sb.rpc("corp_painel_inconsistencias")),
          ler(ctx.sb.from("corp_alteracoes_pos_fechamento").select("id, assunto, mes, detectado_em, resumo").order("detectado_em", { ascending: false }).limit(100)),
        ]);
        return { fonte: "Produção › Inconsistências", regra_data: "Varredura de toda a base (sem período)", atualizado_em: await importadoEm(ctx), dados: { inconsistencias, alteracoes_pos_fechamento: alteracoes } };
      });
    }
  );

  server.registerTool(
    "fianca_funil",
    {
      title: "Funil do Seguro Fiança",
      description:
        `Por mês: análises, aprovados, recusados, negativados (= perdidos: cliente não quis contratar), convertidos, em andamento (cada um em mês atual/herdado/total), cotado e convertido por seguradora, tempo por etapa, contratos tardios. Retratos da tela Seguro Fiança, só a partir de ${INICIO_BITRIX_FIANCA}. Para antes, use producao_kpis com produto fianca.`,
      inputSchema: z.object({ de: mes, ate: mes }),
    },
    async ({ de, ate }, c) => {
      const ctx = contexto(c as Auth);
      return executar(ctx, "fianca_funil", { de, ate }, async () => {
        const meses = mesesEntre(de < INICIO_BITRIX_FIANCA ? INICIO_BITRIX_FIANCA : de, ate);
        const linhas = await ler(ctx.sb.from("seguro_fianca_snapshots").select("competencia, atualizado_em, payload").in("competencia", meses).order("competencia"));
        const lista = (linhas ?? []) as { competencia: string; atualizado_em: string; payload: unknown }[];
        return {
          fonte: "Seguro Fiança (retratos seguro_fianca_snapshots; Bitrix SPA 1042)",
          regra_data: "Datas do card: novidades pelo mês de criação; herdados contam no mês do evento.",
          atualizado_em: lista.map((l) => l.atualizado_em).sort().at(-1) ?? null,
          observacoes: [
            `O funil do Seguro Fiança existe no Bitrix desde ${INICIO_BITRIX_FIANCA}; antes disso não há etapas nem tempo por etapa.`,
            "\"perdidos\" = negativados (cliente não quis contratar).",
            ...(de < INICIO_BITRIX_FIANCA ? [`Período pedido começa antes de ${INICIO_BITRIX_FIANCA}: use producao_kpis (produto fianca) para os meses anteriores.`] : []),
          ],
          dados: lista.map((l) => ({ competencia: l.competencia, atualizado_em: l.atualizado_em, ...(l.payload as object) })),
        };
      });
    }
  );

  server.registerTool(
    "fianca_renovacao",
    {
      title: "Funil de Renovação do Seguro Fiança",
      description: "Por mês: total, novos, herdados, em andamento, renovados, perdidos, taxa de renovação, seguradoras, financeiro e imobiliárias. Retratos da aba Renovação (funil desde 10/2026).",
      inputSchema: z.object({ de: mes, ate: mes }),
    },
    async ({ de, ate }, c) => {
      const ctx = contexto(c as Auth);
      return executar(ctx, "fianca_renovacao", { de, ate }, async () => {
        const linhas = await ler(ctx.sb.from("seguro_fianca_renovacao_snapshots").select("competencia, atualizado_em, payload").in("competencia", mesesEntre(de, ate)).order("competencia"));
        const lista = (linhas ?? []) as { competencia: string; atualizado_em: string; payload: unknown }[];
        return {
          fonte: "Seguro Fiança › Renovação (seguro_fianca_renovacao_snapshots; Bitrix categoria 32)",
          regra_data: "Competência = mês de entrada no funil de renovação (horário de Brasília).",
          atualizado_em: lista.map((l) => l.atualizado_em).sort().at(-1) ?? null,
          dados: lista.map((l) => ({ competencia: l.competencia, atualizado_em: l.atualizado_em, ...(l.payload as object) })),
        };
      });
    }
  );

  server.registerTool(
    "sinistros_kpis",
    {
      title: "Sinistros",
      description: "Avisados, em aberto, encerrados, indenizado, despesas, frequência e sinistralidade por produto/seguradora/imobiliária no período (desde 2015). Mesmos números do dashboard de Sinistros, com comparação com o período anterior e o ano anterior.",
      inputSchema: z.object({
        de: mes, ate: mes, seguradoras: lista, produtos: lista,
        imobiliaria: z.string().optional().describe("'g:<id do grupo>' ou 'i:<id da imobiliária>'"),
        tipos: lista, situacoes: lista,
      }),
    },
    async (a, c) => {
      const ctx = contexto(c as Auth);
      return executar(ctx, "sinistros_kpis", a, async () => {
        const v = (x?: string[]) => (x && x.length ? x : null);
        const [aF, mF] = a.ate.split("-").map(Number);
        const fim = new Date(Date.UTC(aF, mF, 0)).toISOString().slice(0, 10);
        const dados = await ler(ctx.sb.rpc("kpis_sinistros_dashboard", {
          p_inicio: `${a.de}-01`, p_fim: fim, p_seguradoras: v(a.seguradoras), p_grupo: a.imobiliaria ?? null,
          p_tipos: v(a.tipos), p_situacoes: v(a.situacoes), p_produtos: v(a.produtos),
        }));
        return {
          fonte: "Sinistros › Dashboard (kpis_sinistros_dashboard)",
          regra_data: "Avisados pela data de aviso (sem ela, a de ocorrência); indenizado e encerrados pela data de encerramento; em aberto = foto do último dia.",
          atualizado_em: (dados as { base_atualizada_em?: string })?.base_atualizada_em ?? null,
          observacoes: ["Sinistralidade = indenizado ÷ prêmio ganho (pro rata por dia de vigência).", "Frequência = avisados ÷ média de apólices vigentes no fim de cada mês; fica nula se a base for menor que 20."],
          dados,
        };
      });
    }
  );

  server.registerTool(
    "repasses_competencia",
    {
      title: "Repasses de uma competência",
      description: "Repasses às imobiliárias numa competência (relatórios do Corp carregados em Repasses): total e por imobiliária, com status de conferência (relatório × comprovante). Número oficial enquanto o repasse do ERP está em teste.",
      inputSchema: z.object({ competencia: mes, imobiliaria_id: z.string().uuid().optional() }),
    },
    async (a, c) => {
      const ctx = contexto(c as Auth);
      return executar(ctx, "repasses_competencia", a, async () => {
        let q = ctx.sb.from("repasses").select("imobiliaria_id, tipo_documento, valor, status, codigo_produtor_corp, created_at").eq("competencia", a.competencia).neq("status", "cancelada");
        if (a.imobiliaria_id) q = q.eq("imobiliaria_id", a.imobiliaria_id);
        const arquivos = (await ler(q)) as { imobiliaria_id: string | null; tipo_documento: string | null; valor: number | null; status: string; created_at: string }[];
        const ids = [...new Set(arquivos.map((x) => x.imobiliaria_id).filter(Boolean))] as string[];
        const nomes = ids.length ? ((await ler(ctx.sb.from("imobiliarias").select("id, nome").in("id", ids))) as { id: string; nome: string }[]) : [];
        const nomePorId = new Map(nomes.map((n) => [n.id, n.nome]));
        const porImob = new Map<string, typeof arquivos>();
        for (const x of arquivos) porImob.set(x.imobiliaria_id ?? "sem_imobiliaria", [...(porImob.get(x.imobiliaria_id ?? "sem_imobiliaria") ?? []), x]);
        const linhas = [...porImob.entries()].map(([id, lista]) => {
          const p = parearRepassesDaFicha(lista);
          return { imobiliaria_id: id === "sem_imobiliaria" ? null : id, imobiliaria: nomePorId.get(id) ?? null, valor_repasse: p.valorRelatorios, valor_comprovantes: p.valorComprovantes, relatorios: p.relatorios.length, comprovantes: p.comprovantes.length, conferido: p.completo };
        });
        const total = linhas.reduce((t, l) => t + (l.valor_repasse ?? 0), 0);
        return {
          fonte: "Repasses (relatórios do Corp carregados no Workspace)",
          regra_data: "Competência do repasse (mês do relatório do Corp).",
          atualizado_em: arquivos.map((x) => x.created_at).sort().at(-1) ?? null,
          observacoes: ["valor_repasse = soma dos relatórios; conferido = todo relatório tem comprovante de mesmo valor.", "Imobiliária sem vínculo aparece como null."],
          dados: { competencia: a.competencia, total, imobiliarias: linhas.sort((x, y) => (y.valor_repasse ?? 0) - (x.valor_repasse ?? 0)) },
        };
      });
    }
  );
}
