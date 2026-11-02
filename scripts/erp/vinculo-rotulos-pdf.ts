process.loadEnvFile(".env.local");
// ERP O2 — 02/11/2026: gera o PDF simples do APRENDIZADO ATIVO (pares mais incertos para o Matheus marcar SIM/NÃO).
// As respostas viram rótulos em erp_vinculo_rotulos (rotulo 1 = SIM, 0 = NÃO). uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/vinculo-rotulos-pdf.ts <saida.html>
import { writeFileSync } from "node:fs";
import { createServiceClient } from "@/lib/supabase/service";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
(async () => {
  const sb = createServiceClient();
  const saida = process.argv[2];
  const { data } = await sb.from("erp_vinculo_rotulos").select("id, par_descricao, prob_modelo").is("rotulo", null).eq("tarefa", "renovacao_sucessora").order("grupo").order("id").limit(300);
  const linhas = (data ?? []).map((r, i) => `<tr><td class="n">${i + 1}</td><td>${esc(r.par_descricao ?? "")}<div class="p">Código ${r.id} · o modelo acha ${(Number(r.prob_modelo) * 100).toFixed(0)}% de chance de ser a mesma renovação</div></td><td class="r">☐ SIM<br>☐ NÃO</td></tr>`).join("\n");
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Conferência de renovações</title><style>
body{font-family:Arial,sans-serif;font-size:11px;margin:18px;color:#222}h1{font-size:16px;margin:0 0 4px}p{margin:2px 0 10px;color:#444}
table{border-collapse:collapse;width:100%}td{border:1px solid #bbb;padding:5px 6px;vertical-align:top}.n{width:24px;text-align:center;color:#666}.r{width:54px;white-space:nowrap}.p{color:#777;font-size:9.5px;margin-top:3px}tr{page-break-inside:avoid}
</style></head><body><h1>Conferência de renovações — marque SIM ou NÃO</h1>
<p>Cada linha pergunta se a apólice nova é mesmo a renovação da apólice antiga. A planilha de renovação marcou todas como EFETIVADAS, mas o sistema ainda não tem prova (PDF ou pagamento) e ficou em dúvida. Sua resposta vira "gabarito" para o sistema aprender.</p>
<table>${linhas}</table></body></html>`;
  writeFileSync(saida, html, "utf8");
  console.log("linhas:", (data ?? []).length, "->", saida);
})().catch((e) => { console.error(e); process.exit(1); });
