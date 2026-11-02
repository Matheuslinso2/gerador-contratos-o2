// Caminho INVERSO (Matheus 02/11/2026): o ERP já identifica que a apólice A foi renovada pela apólice B (documento_renovado_id, ou sucessora única do mesmo cliente+ramo);
// então procura o card pelo Nº da apólice NOVA (B) / Nosso nº do Corp de B e liga o card à apólice ANTIGA (A), gravando B em documento_novo_id.
// Só vale com 1 candidato certo. Bitrix: só leitura. Sem --gravar só conta.
// uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/renovacoes-re/vincular-cards-pela-renovada.ts [--gravar]
process.loadEnvFile(".env.local");
import { createClient } from "@supabase/supabase-js";
import { lerCardsRenovacao, lerDocumentosParaLigar, statusPelaEtapa, type CardBitrix } from "@/lib/erp/renovacaoCards";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const GRAVAR = process.argv.includes("--gravar");
const dig = (s: string | null) => (s ?? "").replace(/\D/g, "");

(async () => {
  const cards = await lerCardsRenovacao();
  const docs = await lerDocumentosParaLigar(sb);
  const porId = new Map(docs.map((d) => [d.id, d]));

  // pares (antiga → nova): cadeia explícita; senão sucessora única do mesmo cliente+ramo começando de -30 a +60 dias do fim da antiga
  const pares = new Map<string, { nova: string; via: "cadeia" | "sucessora_unica" }>();
  for (let a = 0; ; a += 1000) {
    const { data } = await sb.from("erp_documentos").select("id, documento_renovado_id").not("documento_renovado_id", "is", null).order("id").range(a, a + 999);
    for (const n of data ?? []) if (n.documento_renovado_id && !pares.has(n.documento_renovado_id)) pares.set(n.documento_renovado_id, { nova: n.id, via: "cadeia" });
    if (!data || data.length < 1000) break;
  }
  const { data: suc, error: eS } = await sb.rpc("erp_renovacao_sucessoras_unicas");
  if (eS) console.log("(sem sucessoras únicas:", eS.message + ")");
  for (const s of (suc ?? []) as { antiga_id: string; nova_id: string }[]) if (!pares.has(s.antiga_id)) pares.set(s.antiga_id, { nova: s.nova_id, via: "sucessora_unica" });

  // índice dos cards pelo Nº da apólice / Nosso nº do Corp (dígitos)
  const cardPorApolice = new Map<string, CardBitrix[]>();
  const cardPorCorp = new Map<string, CardBitrix[]>();
  for (const c of cards) {
    for (const ap of c.apolices) { const k = dig(ap); if (k.length >= 5) cardPorApolice.set(k, [...(cardPorApolice.get(k) ?? []), c]); }
    for (const n of c.corp) cardPorCorp.set(n, [...(cardPorCorp.get(n) ?? []), c]);
  }
  // quem já tem card ligado
  const jaLigado = new Set<string>();
  for (let a = 0; ; a += 1000) {
    const { data } = await sb.from("erp_renovacoes").select("documento_id").not("bitrix_card_id", "is", null).order("id").range(a, a + 999);
    for (const r of data ?? []) jaLigado.add(r.documento_id);
    if (!data || data.length < 1000) break;
  }

  let semNova = 0, jaTinha = 0, achou = 0, ambiguo = 0, naoAchou = 0;
  const novos: { antiga: string; nova: string; card: CardBitrix; via: string }[] = [];
  const porFunil: Record<string, number> = {};
  for (const [antigaId, { nova, via }] of pares) {
    const antiga = porId.get(antigaId), novaDoc = porId.get(nova);
    if (!antiga || !novaDoc) { semNova++; continue; }
    if (jaLigado.has(antigaId)) { jaTinha++; continue; }
    const cand = new Map<number, CardBitrix>();
    const k = dig(novaDoc.numero_apolice);
    if (k.length >= 5) for (const c of cardPorApolice.get(k) ?? []) if (c.produto === (["fianca", "capitalizacao"].includes(antiga.produto) ? antiga.produto : "re")) cand.set(c.id, c);
    if (novaDoc.nosso_numero_corp != null) for (const c of cardPorCorp.get(String(novaDoc.nosso_numero_corp)) ?? []) cand.set(c.id, c);
    if (cand.size === 1) { const c = [...cand.values()][0]; novos.push({ antiga: antigaId, nova, card: c, via }); achou++; porFunil[c.funil] = (porFunil[c.funil] ?? 0) + 1; }
    else if (cand.size > 1) ambiguo++; else naoAchou++;
  }
  console.log(`pares antiga→nova: ${pares.size} · sem documento lido: ${semNova} · antiga já com card: ${jaTinha} · card achado pela NOVA: ${achou} (${JSON.stringify(porFunil)}) · ambíguos: ${ambiguo} · nenhum card cita a nova: ${naoAchou}`);
  if (!GRAVAR) return;

  let ok = 0;
  for (const n of novos) {
    const valor = { bitrix_card_id: `${n.card.entity}:${n.card.id}`, status: statusPelaEtapa(n.card.etapa), documento_novo_id: n.nova, card_titulo: n.card.titulo, card_etapa: n.card.etapa, card_ligado_via: "apolice_renovada", fonte: "F8", fonte_nivel: 6, lido_em: new Date().toISOString(), updated_at: new Date().toISOString() };
    const { data: ex } = await sb.from("erp_renovacoes").select("id").eq("documento_id", n.antiga).limit(1);
    const antiga = porId.get(n.antiga)!;
    if (ex?.length) { await sb.from("erp_renovacoes").update(valor).eq("id", ex[0].id); ok++; }
    else {
      const { error } = await sb.from("erp_renovacoes").insert({ documento_id: n.antiga, vence_em: antiga.vigencia_fim, ...valor, observacoes: `Card #${n.card.id} (${n.card.funil}) ligado pela apólice RENOVADA (${n.via})` });
      if (error) console.log("erro", error.message); else ok++;
    }
  }
  console.log(`gravado: ${ok} vínculos card ↔ apólice antiga, com a apólice renovada em documento_novo_id`);
})();
