// Lê as planilhas de lote devolvidas (anexo "Planilha de itens / controle operacional" dos cards do funil Renovações, SPA 1046 cat 34)
// dos cards CONCLUÍDOS (etapa Efetivado). Cada linha = um documento com negociação individual (decisão, parcelamento, prêmio, comissão).
// Ensaio por padrão: mostra por card quantas linhas, decididas, pendentes e sem documento no ERP. --gravar grava em erp_renovacao_negociacao.
// Regra do Matheus (29/10): o item só é "renovado" no ERP depois que o card é concluído no funil E a planilha atualizada é lida.
// uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/ler-planilhas-renovacao.ts [--card N] [--gravar] [--todas-etapas]
process.loadEnvFile(".env.local");
import { createServiceClient } from "@/lib/supabase/service";
import { lerPlanilhaNegociacao } from "@/lib/erp/planilhaNegociacao";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const GRAVAR = process.argv.includes("--gravar");
const TODAS = process.argv.includes("--todas-etapas");
const CARD = arg("card");
const base = (process.env.BITRIX_WEBHOOK_URL ?? "").replace(/\/$/, "");
const sb = createServiceClient();
type Card = { id: number; title: string; stageId: string; ufCrm12PlanilhaItens: { id: number; urlMachine: string }[] | null };

(async () => {
  let filtro = "filter[categoryId]=34" + (TODAS ? "" : "&filter[stageId]=DT1046_34:SUCCESS");
  if (CARD) filtro = `filter[id]=${CARD}`;
  const cards: Card[] = [];
  for (let start = 0; ; ) {
    const r = await (await fetch(`${base}/crm.item.list.json?entityTypeId=1046&${filtro}&start=${start}`)).json();
    cards.push(...(r.result?.items ?? []));
    if (r.next === undefined) break;
    start = r.next;
  }
  console.log(`${cards.length} card(s) (${TODAS || CARD ? "sem filtro de etapa" : "Efetivado"}) · ${GRAVAR ? "GRAVANDO" : "ENSAIO"}`);
  let totalLinhas = 0, totalGrav = 0;
  for (const c of cards) {
    let lido = false;
    for (const a of c.ufCrm12PlanilhaItens ?? []) {
      const buf = Buffer.from(await (await fetch(a.urlMachine)).arrayBuffer());
      let r;
      try { r = lerPlanilhaNegociacao(buf); } catch { continue; }
      if (!r) continue;
      lido = true;
      const decididas = r.linhas.filter((l) => l.decisao).length;
      let semDoc = 0;
      const gravar: Record<string, unknown>[] = [];
      for (const l of r.linhas) {
        let q = sb.from("erp_documentos").select("id").eq("numero_apolice", l.apolice).in("tipo", ["A", "F"]);
        if (l.fim_vigencia) q = q.eq("vigencia_fim", l.fim_vigencia);
        const { data: docs } = await q.limit(2);
        const doc = (docs ?? []).length === 1 ? docs![0] : null;
        if (!doc) semDoc++;
        gravar.push({ card_id: c.id, apolice: l.apolice, fim_vigencia: l.fim_vigencia, linha: l.linha, decisao: l.decisao, parcelas: l.parcelas, premio_total: l.premio_total, comissao_pct: l.comissao_pct, comissao_valor: l.comissao_valor, extras: l.extras, arquivo_id: a.id, documento_anterior_id: doc?.id ?? null });
      }
      totalLinhas += r.linhas.length;
      console.log(`card ${c.id} ${c.title.slice(0, 50)} · ${r.linhas.length} itens · decididos ${decididas} · pendentes ${r.linhas.length - decididas} · sem documento no ERP ${semDoc} · reconhecidas: ${r.reconhecidas.join(",")}${r.ausentes.length ? " · ausentes: " + r.ausentes.join(",") : ""}`);
      if (GRAVAR && gravar.length) {
        const { error } = await sb.from("erp_renovacao_negociacao").upsert(gravar, { onConflict: "card_id,apolice,fim_vigencia" });
        if (error) console.log("  erro ao gravar:", error.message); else totalGrav += gravar.length;
      }
    }
    if (!lido) console.log(`card ${c.id} ${c.title.slice(0, 50)} · sem planilha de itens legível`);
  }
  console.log(`\n${totalLinhas} itens lidos${GRAVAR ? ` · ${totalGrav} gravados` : " (ensaio, nada gravado)"}`);
})();
