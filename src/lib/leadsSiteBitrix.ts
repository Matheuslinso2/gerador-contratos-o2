import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { chamarBitrix } from "@/lib/bitrix/client";

// Qualidade do lead do site: cruza e-mail/telefone de cada lead com o CRM do
// Bitrix (somente leitura) pra mostrar em que etapa do funil ele está.
// Os formulários do site ainda não criam lead no Bitrix -- então "não
// encontrado" pode só significar que o time ainda não cadastrou. Pedido do
// Matheus, 05/10/2026.

export type LeadParaCruzar = {
  id: string;
  email: string | null;
  telefone: string | null;
  bitrix_status: string | null;
  bitrix_checado_em: string | null;
};

const REVERIFICAR_APOS_MS = 6 * 60 * 60 * 1000;
const MAX_CHECAGENS_POR_CARGA = 20;
const STATUS_FINAIS = new Set(["CONVERTED", "JUNK"]);

type Duplicados = { LEAD?: number[]; CONTACT?: number[]; COMPANY?: number[] };

function variantesTelefone(telefone: string): string[] {
  const digitos = telefone.replace(/\D/g, "");
  if (digitos.length < 10) return [];
  const local = digitos.startsWith("55") && digitos.length >= 12 ? digitos.slice(2) : digitos;
  return [local, `55${local}`];
}

async function procurar(tipo: "EMAIL" | "PHONE", valores: string[]): Promise<Duplicados> {
  if (valores.length === 0) return {};
  const { result } = await chamarBitrix<{ result: Duplicados | []; }>("crm.duplicate.findbycomm", {
    type: tipo,
    values: valores,
  });
  return Array.isArray(result) ? {} : result;
}

export async function mapaEtapasLead(): Promise<Record<string, string>> {
  const { result } = await chamarBitrix<{ result: { STATUS_ID: string; NAME: string }[] }>("crm.status.list", {
    "filter[ENTITY_ID]": "STATUS",
  });
  return Object.fromEntries(result.map((s) => [s.STATUS_ID, s.NAME.replace(/^\d+\.\s*/, "")]));
}

async function cruzarUm(lead: LeadParaCruzar) {
  const [porEmail, porTelefone] = await Promise.all([
    procurar("EMAIL", lead.email ? [lead.email.trim().toLowerCase()] : []),
    procurar("PHONE", lead.telefone ? variantesTelefone(lead.telefone) : []),
  ]);
  const idsLead = Array.from(new Set([...(porEmail.LEAD ?? []), ...(porTelefone.LEAD ?? [])]));
  const conhecido = idsLead.length > 0 || [porEmail, porTelefone].some((r) => (r.CONTACT?.length ?? 0) + (r.COMPANY?.length ?? 0) > 0);

  let bitrixLeadId: number | null = null;
  let status: string | null = null;
  if (idsLead.length > 0) {
    bitrixLeadId = Math.max(...idsLead);
    const { result } = await chamarBitrix<{ result: { STATUS_ID: string } }>("crm.lead.get", { id: bitrixLeadId });
    status = result.STATUS_ID;
  }
  return { bitrix_lead_id: bitrixLeadId, bitrix_status: status, bitrix_conhecido: conhecido };
}

// Atualiza (no máximo 20 por carga) os leads ainda não checados ou com
// checagem antiga, e devolve quantos foram atualizados. Erros do Bitrix não
// derrubam a tela -- o lead só fica sem checagem até a próxima carga.
export async function cruzarLeadsComBitrix(supabase: SupabaseClient, leads: LeadParaCruzar[]): Promise<number> {
  const agora = Date.now();
  const pendentes = leads
    .filter((l) => (l.email || l.telefone) && !(l.bitrix_status && STATUS_FINAIS.has(l.bitrix_status)))
    .filter((l) => !l.bitrix_checado_em || agora - new Date(l.bitrix_checado_em).getTime() > REVERIFICAR_APOS_MS)
    .slice(0, MAX_CHECAGENS_POR_CARGA);

  let atualizados = 0;
  for (let i = 0; i < pendentes.length; i += 3) {
    await Promise.all(
      pendentes.slice(i, i + 3).map(async (lead) => {
        try {
          const dados = await cruzarUm(lead);
          const { error } = await supabase
            .from("leads_site_o2seguros")
            .update({ ...dados, bitrix_checado_em: new Date().toISOString() })
            .eq("id", lead.id);
          if (!error) atualizados++;
        } catch (erro) {
          console.error("Falha ao cruzar lead do site com o Bitrix:", erro);
        }
      })
    );
  }
  return atualizados;
}
