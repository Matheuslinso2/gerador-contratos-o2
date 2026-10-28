import type { SupabaseClient } from "@supabase/supabase-js";

// ERP O2 — parcelas próprias do endosso (Matheus 28/10): o endosso pode gerar cobrança, com parcelas em paralelo às da
// apólice-mãe. O card de endosso traz 3 campos (achados pelo TÍTULO, para valer nos 3 funis): "Valor do endosso a pagar",
// "Nº de parcelas do endosso" e "1º vencimento do endosso". Sem valor ou sem 1º vencimento NÃO nasce parcela (o vencimento é
// obrigatório e alimenta comissão/baixa; nada é inventado) — o endosso fica em Emissão com "parcelas a informar".
// Valor negativo (restituição) = 1 parcela negativa, como o Corp faz.

type Defs = Record<string, { title?: string; type?: string }>;
const CAMPOS = {
  valor: /valor\s+do\s+endosso/i,
  parcelas: /parcelas?\s+do\s+endosso/i,
  vencimento: /1\S{0,3}\s+vencimento\s+do\s+endosso/i,
};

function campoPorTitulo(defs: Defs, re: RegExp): string | null {
  return Object.entries(defs).find(([, d]) => d.title && re.test(d.title))?.[0] ?? null;
}
function numero(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).split("|")[0].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function somaMeses(dataIso: string, meses: number): string {
  const [a, m, d] = dataIso.split("-").map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
}

/** Parcelas iguais; o último centavo vai na última parcela. */
export function dividirParcelas(total: number, qtd: number): number[] {
  const base = Math.round((total / qtd) * 100) / 100;
  const out = Array.from({ length: qtd }, () => base);
  out[qtd - 1] = Math.round((total - base * (qtd - 1)) * 100) / 100;
  return out;
}

export type ResultadoParcelasEndosso = { acao: "sem_campos" | "sem_dados" | "preservadas" | "geradas"; parcelas?: number };

export async function gerarParcelasEndosso(sb: SupabaseClient, docId: string, item: Record<string, unknown>, defs: Defs): Promise<ResultadoParcelasEndosso> {
  const cValor = campoPorTitulo(defs, CAMPOS.valor);
  const cVenc = campoPorTitulo(defs, CAMPOS.vencimento);
  if (!cValor || !cVenc) return { acao: "sem_campos" };
  const cQtd = campoPorTitulo(defs, CAMPOS.parcelas);
  const valor = numero(item[cValor]);
  const venc = typeof item[cVenc] === "string" ? String(item[cVenc]).slice(0, 10) : null;
  if (valor === null || valor === 0 || !venc || !/^\d{4}-\d{2}-\d{2}$/.test(venc)) return { acao: "sem_dados" };
  const qtd = valor < 0 ? 1 : Math.min(Math.max(Math.round(numero(cQtd ? item[cQtd] : 1) ?? 1), 1), 60);

  // nunca mexe em parcela quitada nem em parcela que veio de outra fonte (Corp, manual)
  const { data: existentes } = await sb.from("erp_parcelas").select("id, origem, quitada_em").eq("documento_id", docId);
  if ((existentes ?? []).some((p: { origem: string; quitada_em: string | null }) => p.origem !== "api" || p.quitada_em)) return { acao: "preservadas" };

  const valores = dividirParcelas(valor, qtd);
  const linhas = valores.map((v, i) => ({ documento_id: docId, n: i + 1, vencimento: somaMeses(venc, i), valor: v, origem: "api" }));
  if ((existentes ?? []).length) await sb.from("erp_parcelas").delete().eq("documento_id", docId).eq("origem", "api");
  const { error } = await sb.from("erp_parcelas").insert(linhas);
  if (error) throw new Error(`parcelas do endosso: ${error.message}`);
  await sb.from("erp_documentos").update({ qtd_parcelas: qtd }).eq("id", docId);
  return { acao: "geradas", parcelas: qtd };
}
