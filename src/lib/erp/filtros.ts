// ERP O2 — filtros padronizados das telas (Matheus 25/10/2026: "padronizar os filtros possíveis e adequados a cada
// necessidade; poder filtrar os níveis hierárquicos da tela em questão"). Cada tela escolhe os campos que fazem
// sentido para ela; nome do parâmetro na URL, rótulo e comportamento são os mesmos em todas as telas.
import type { SupabaseClient } from "@supabase/supabase-js";

export type CampoFiltro =
  | "busca" // texto livre: nº (Código O2, Nosso Nº, apólice) ou nome (cliente/imobiliária)
  | "seguradora" // abreviação de erp_seguradoras (TOKI, PORT, POTT…)
  | "corretora" // O2 Corretora | O2 Capitalização
  | "produto" // erp_ramos.produto (fianca, incendio, capitalizacao…)
  | "situacao"
  | "tipo"
  | "imobiliaria" // nome (ou parte) — resolvido na base única de imobiliárias
  | "forma_pagamento" // modo_cobranca: fatura / boleto / cartao / debito / nao_informado
  | "canal" // erp_canais (Superlógica, Base Software, Segimob)
  | "periodo" // de / ate (datas) — cada tela diz qual data é
  | "mes"; // AAAA-MM

export type ValoresFiltro = Partial<Record<"q" | "seguradora" | "corretora" | "produto" | "situacao" | "tipo" | "imobiliaria" | "forma" | "canal" | "de" | "ate" | "mes", string>>;

const CHAVES = ["q", "seguradora", "corretora", "produto", "situacao", "tipo", "imobiliaria", "forma", "canal", "de", "ate", "mes"] as const;

/** Lê os filtros da URL (só os conhecidos, aparados, vazios descartados). */
export function lerFiltros(sp: Record<string, string | string[] | undefined>): ValoresFiltro {
  const v: ValoresFiltro = {};
  for (const k of CHAVES) {
    const bruto = sp[k];
    const s = (Array.isArray(bruto) ? bruto[0] : bruto)?.trim();
    if (s) v[k] = s;
  }
  if (v.de && !/^\d{4}-\d{2}-\d{2}$/.test(v.de)) delete v.de;
  if (v.ate && !/^\d{4}-\d{2}-\d{2}$/.test(v.ate)) delete v.ate;
  if (v.mes && !/^\d{4}-\d{2}$/.test(v.mes)) delete v.mes;
  return v;
}

export const temFiltro = (v: ValoresFiltro, exceto: (keyof ValoresFiltro)[] = []) =>
  Object.entries(v).some(([k, x]) => x && !exceto.includes(k as keyof ValoresFiltro));

/** ids das imobiliárias (base única) cujo nome/apelido contém o texto. */
export async function idsImobiliarias(sb: SupabaseClient, texto: string): Promise<string[]> {
  const like = `%${texto.replace(/[%_,()]/g, "")}%`;
  const { data } = await sb.from("imobiliarias").select("id").or(`nome.ilike.${like},apelido.ilike.${like}`).limit(200);
  return (data ?? []).map((i: { id: string }) => i.id);
}

// nome usado nas tabelas de fatura (faturas, faturas_esperadas, alertas) a partir da abreviação do ERP
export const SEGURADORA_FATURA: Record<string, string> = { TOKI: "TOKIO", POTT: "POTTENCIAL", TOO: "TOO", YELU: "YELUM", PORT: "PORTO FIANÇA" };

export const CORRETORAS = ["O2 Corretora", "O2 Capitalização"];
export const FORMAS_PAGAMENTO: Record<string, string> = {
  fatura: "Fatura da imobiliária",
  boleto: "Boleto",
  cartao: "Cartão",
  debito: "Débito",
  nao_informado: "Não informada",
};
export const PRODUTOS: Record<string, string> = {
  fianca: "Fiança",
  incendio: "Incêndio",
  capitalizacao: "Capitalização",
  condominio: "Condomínio",
  automovel: "Automóvel",
  rc: "RC",
  vida: "Vida",
  saude: "Saúde",
  viagem: "Viagem",
  portateis: "Portáteis",
  pet: "Pet",
  outros: "Outros",
};

/** Primeiro e último dia do mês AAAA-MM. */
export function limitesMes(mes: string): { de: string; ate: string } {
  const [a, m] = mes.split("-").map(Number);
  const fim = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
  return { de: `${mes}-01`, ate: fim };
}
