import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/service";

// Ficha de visita da imobiliária, só quando pedida no chat interno (Matheus, 03/11/2026). Lê a função
// ficha_visita (tabelas prontas analise_*; ver supabase/schema_ficha_visita.sql e schema_analise_margem.sql):
// aluguel que se pratica na região dela, quanto ficaria o seguro de Fiança pelo perfil de aluguel dela, margem
// atual por produto e potencial na Fiança. Só para quem pode ver comissão/repasse (a ficha traz margem).
// Regra do Matheus: com endereços suficientes dela (30+ cotações com CEP em 24 meses) usa os dados dela; com
// pouca produção, o estudo dos bairros onde ela atua; sem endereço, a cidade da ficha.

export const FERRAMENTA_FICHA_VISITA: Anthropic.Tool = {
  name: "ficha_visita",
  description:
    "Ficha de visita de UMA imobiliária ou grupo, para levar a uma visita: (1) aluguel que se pratica na região dela, (2) quanto ficaria o seguro de Fiança pelo perfil de aluguel dela, por seguradora, (3) margem atual por produto (comissão − repasse, com pró-labore) e margem potencial na Fiança. Informe imobiliaria_id (pegue com buscar_imobiliaria) ou, para um grupo, grupo_id. O retorno diz a 'base' usada: propria (dados dela), bairros (estudo dos bairros onde ela atua, por ter poucos endereços), cidade ou sem_dados.",
  input_schema: {
    type: "object",
    properties: {
      imobiliaria_id: { type: "string", description: "id (uuid) da ficha da imobiliária." },
      grupo_id: { type: "string", description: "id (uuid) do grupo, para somar todas as fichas do grupo." },
    },
  },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Comissão e repasse por produto são da equipe (nível 1); a MARGEM (comissão - repasse) e o ganho extra em margem são do financeiro da O2 (nível 3) e saem da ficha para os demais.
export async function executarFerramentaFichaVisita(nome: string, entrada: unknown, verFinanceiro: boolean): Promise<string | null> {
  if (nome !== "ficha_visita") return null;
  const e = (entrada ?? {}) as { imobiliaria_id?: string; grupo_id?: string };
  const grupo = e.grupo_id && UUID.test(e.grupo_id) ? e.grupo_id : null;
  const imob = e.imobiliaria_id && UUID.test(e.imobiliaria_id) ? e.imobiliaria_id : null;
  if (!grupo && !imob) return "Informe imobiliaria_id (ou grupo_id) válido; use buscar_imobiliaria para achar.";
  const { data, error } = await createServiceClient().rpc("ficha_visita", { p_tipo: grupo ? "grupo" : "imobiliaria", p_id: grupo ?? imob });
  if (error) return `Erro ao montar a ficha: ${error.message}`;
  const f = data as Record<string, unknown> & { areas?: unknown[]; potencial?: { decididas_24m?: number | null } };
  // Com menos de 30 cotações decididas a taxa de fechamento dela é ruído: não estima potencial.
  if ((f.potencial?.decididas_24m ?? 0) < 30) f.potencial = { insuficiente: true, motivo: "menos de 30 cotações decididas em 24 meses", decididas_24m: f.potencial?.decididas_24m ?? 0 } as never;
  if (!verFinanceiro) {
    f.margem = ((f.margem as Record<string, unknown>[] | undefined) ?? []).map((r) => {
      const { margem: _m, margem_apolice: _ma, ...resto } = r;
      void _m; void _ma;
      return resto;
    }) as never;
    if (f.potencial && typeof f.potencial === "object") {
      const { margem_extra_ano: _x, margem_apolice_fianca: _y, ...resto } = f.potencial as Record<string, unknown>;
      void _x; void _y;
      f.potencial = resto as never;
    }
  }
  // O JSON é longo; manda só as 6 regiões principais.
  return JSON.stringify({
    ...f,
    areas: (f.areas ?? []).slice(0, 6),
    observacoes: [
      "Aluguel = cotações de Fiança (contratação nova, 24 meses) da carteira da O2, não o mercado inteiro.",
      "Preço do seguro = prêmio mediano das apólices de Fiança fechadas de 2024 em diante × aluguel de referência; é estimativa, não cotação.",
      ...(verFinanceiro ? ["Margem = comissão − repasse previsto (inclui pró-labore), apólices vigentes/vencidas de 2025-2026; não desconta custos nem impostos."] : ["Comissão e repasse por produto são das apólices de 2025-2026; a margem (comissão menos repasse) é do financeiro da O2 e não foi incluída."]),
      "Potencial = se ela fechasse na taxa média da O2 para o perfil de aluguel dela; é hipótese.",
    ],
  });
}
