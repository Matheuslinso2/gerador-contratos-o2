// ERP O2 — grava no ERP os extratos baixados dos portais das seguradoras (robô de baixa, scripts/robo-seguradoras).
// Um PDF do portal pode trazer vários extratos (Tokio: todos do período). Cada extrato vira um erp_extratos_seguradora
// (origem 'portal') com suas linhas; não duplica o que já veio da pasta do Drive ou de outra rodada do robô.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExtratoPdf } from "./extratosPdf";

const NOME_LINHA: Record<string, string> = { TOKI: "TOKIO", PORT: "PORTO SEGURO", POTT: "POTTENCIAL", TOO: "TOO" };
const CNPJ_CORRETORA: Record<string, string> = { "20001784000180": "O2 Corretora", "54493758000138": "O2 Capitalização" };

export type ResumoPortal = { lidos: number; novos: number; ja_existiam: number; linhas: number; bruto: number; erros: string[] };

export async function gravarExtratosPortal(
  sb: SupabaseClient,
  seguradora: string,
  extratos: ExtratoPdf[],
  opts: { arquivo: string; gravar: boolean },
): Promise<ResumoPortal> {
  const r: ResumoPortal = { lidos: extratos.length, novos: 0, ja_existiam: 0, linhas: 0, bruto: 0, erros: [] };
  const { data: seg } = await sb.from("erp_seguradoras").select("id").eq("abreviacao", seguradora).single();
  if (!seg) throw new Error(`seguradora ${seguradora} não cadastrada no ERP`);
  const { data: corrs } = await sb.from("erp_corretoras").select("id, apelido");
  const corrId = new Map((corrs ?? []).map((c: { id: string; apelido: string }) => [c.apelido, c.id]));

  for (const e of extratos) {
    const corretora = CNPJ_CORRETORA[e.corretora_cnpj ?? ""] ?? null;
    const corretoraId = corretora ? corrId.get(corretora) ?? null : null;
    const bruto = e.total_bruto ?? 0;
    // Já existe? mesmo nº de extrato, ou mesma data de crédito com o mesmo bruto (arquivo salvo à mão na pasta do Drive).
    let q = sb.from("erp_extratos_seguradora").select("id, numero_extrato, pago_em, total_bruto").eq("seguradora_id", seg.id);
    q = corretoraId ? q.eq("corretora_id", corretoraId) : q.is("corretora_id", null);
    const { data: iguais } = await q.or(
      [e.numero ? `numero_extrato.eq.${e.numero}` : null, e.pago_em ? `pago_em.eq.${e.pago_em}` : null].filter(Boolean).join(",") || "id.is.null",
    );
    const existente = (iguais ?? []).find(
      (x: { numero_extrato: string | null; pago_em: string | null; total_bruto: number | null }) =>
        (e.numero && x.numero_extrato === e.numero) || (x.pago_em === e.pago_em && Math.abs(Number(x.total_bruto ?? 0) - bruto) < 0.01),
    ) as { id: string; numero_extrato: string | null } | undefined;
    if (existente) {
      r.ja_existiam++;
      if (opts.gravar && e.numero && !existente.numero_extrato)
        await sb.from("erp_extratos_seguradora").update({ numero_extrato: e.numero, cod_corretor: e.cod_corretor ?? null }).eq("id", existente.id);
      continue;
    }
    r.novos++;
    r.linhas += e.linhas.length;
    r.bruto += bruto;
    if (!opts.gravar) continue;
    const { data: ext, error } = await sb
      .from("erp_extratos_seguradora")
      .insert({
        seguradora_id: seg.id, corretora_id: corretoraId,
        competencia: e.pago_em ? e.pago_em.slice(0, 7) + "-01" : null, pago_em: e.pago_em,
        tipo: "demonstrativo", origem: "portal", leitura: "ok",
        arquivo_path: `portal:${seguradora}:${e.cod_corretor ?? "?"}:${e.numero ?? e.pago_em}`,
        numero_extrato: e.numero ?? null, cod_corretor: e.cod_corretor ?? null,
        linhas: e.linhas, total_bruto: bruto, total_liquido: e.total_liquido,
        observacao: `${opts.arquivo} · extrato nº ${e.numero ?? "?"} · cód. ${e.cod_corretor ?? "?"} · ${e.linhas.length} linhas`,
      })
      .select("id")
      .single();
    if (error) { r.erros.push(`extrato ${e.numero}: ${error.message}`); continue; }
    const nome = NOME_LINHA[seguradora] ?? seguradora;
    for (let i = 0; i < e.linhas.length; i += 500) {
      const { error: e2 } = await sb.from("erp_extrato_linhas").insert(e.linhas.slice(i, i + 500).map((l) => ({ extrato_id: ext.id, seguradora: nome, ...l })));
      if (e2) r.erros.push(`extrato ${e.numero} linhas: ${e2.message}`);
    }
  }
  r.bruto = Math.round(r.bruto * 100) / 100;
  return r;
}
