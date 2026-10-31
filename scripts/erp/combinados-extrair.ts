// Extrai os "combinados" de cadastro (comissão, repasse, pró-labore, vigência, plano) das mensagens das tarefas CADASTRO do Bitrix,
// lendo o ÍNDICE LOCAL da sessão da baixa (cópia do tarefas-indice.jsonl) — não relê o Bitrix. NUNCA guarda o texto bruto da mensagem.
// Ensaio por padrão (só conta e mostra amostra mascarada); --gravar grava em erp_combinados_cadastro (supabase/erp_combinados_cadastro.sql).
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/combinados-extrair.ts <indice.jsonl> [--desde 2025-01-01] [--gravar]
process.loadEnvFile(".env.local");
import fs from "node:fs";
import { createServiceClient } from "@/lib/supabase/service";
import { lerMensagemCadastro } from "@/lib/erp/tarefaCadastro";

const arq = process.argv[2]; if (!arq) throw new Error("informe o indice.jsonl");
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const GRAVAR = process.argv.includes("--gravar");
const desde = arg("desde") ?? "2025-01-01";
const num = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));
const numPct = (s: string) => Number(s.replace(",", "."));

/** Pró-labore da mensagem: com/sem + % ou R$. Só o que está escrito; ausente = null. */
function proLabore(t: string) {
  const linhas = t.split("\n").filter((l) => /PR[OÓ][\s-]?LABORE/i.test(l));
  if (!linhas.length) return { status: null as string | null, pct: null as number | null, valor: null as number | null };
  const l = linhas.join(" | ");
  const sem = /\bSEM\s+PR[OÓ][\s-]?LABORE/i.test(l);
  const pct = /(\d+(?:[.,]\d+)?)\s*%/.exec(l);
  const valor = /R\$\s*([\d.]+(?:,\d{2})?)/.exec(l);
  return { status: sem ? "sem" : "com", pct: pct ? numPct(pct[1]) : null, valor: valor ? num(valor[1]) : null };
}
/** Primeiro repasse escrito como % ou R$ (o texto original não é guardado). */
function repasse(rs: { quem: string | null; valor: string }[]) {
  for (const r of rs) {
    const p = /(\d+(?:[.,]\d+)?)\s*%/.exec(r.valor), v = /R\$\s*([\d.]+(?:,\d{2})?)/.exec(r.valor);
    if (p || v) return { pct: p ? numPct(p[1]) : null, valor: v ? num(v[1]) : null };
  }
  return { pct: null, valor: null };
}
const setorDe = (titulo: string) => {
  const t = titulo.toUpperCase();
  for (const [k, re] of [["ENDOSSO", /ENDOSS/], ["RENOVACAO", /RENOVA/], ["CAPITALIZACAO", /CAPITALIZA|\bCAP\b/], ["FIANCA", /FIAN[CÇ]A/], ["INCENDIO", /INC[EÊ]NDIO/], ["DEMAIS_RAMOS", /DEMAIS RAMOS/]] as const) if (re.test(t.normalize("NFD").replace(/[̀-ͯ]/g, ""))) return k;
  return "OUTRO";
};

(async () => {
  const linhas = fs.readFileSync(arq, "utf8").split("\n").filter(Boolean);
  const out: Record<string, unknown>[] = [];
  let tarefas = 0, msgs = 0, ignoradas = 0;
  for (const l of linhas) {
    let o: any; try { o = JSON.parse(l); } catch { continue; }
    if (!/^\s*CADASTRO\b/i.test(o.titulo ?? "") || /TESTE|NOVO CLIENTE|LEAD #/i.test(o.titulo)) continue;
    if ((o.criada ?? "") < desde) continue;
    tarefas++;
    for (const m of o.mensagens ?? []) {
      msgs++;
      const p = lerMensagemCadastro(String(m.texto ?? ""), { arquivos: 0, data: m.data ?? null, id: m.id, tarefa: o.tarefa });
      if (!p) { ignoradas++; continue; }
      const pl = proLabore(String(m.texto)); const rp = repasse(p.repasses);
      out.push({
        tarefa_id: o.tarefa, mensagem_id: m.id, data_mensagem: m.data ?? null, setor: setorDe(o.titulo), titulo_tarefa: String(o.titulo).slice(0, 120),
        imobiliaria_nome: p.imobiliaria, segurado_nome: p.nome, seg_numero: p.seg, vigencia_ini: p.vigencia_inicio, vigencia_fim: p.vigencia_fim,
        seguradora_plano: p.seguradora_plano, comissao_pct: p.comissao_pct, repasse_pct: rp.pct, repasse_valor: rp.valor, sem_repasse: p.sem_repasse,
        pro_labore_status: pl.status, pro_labore_pct: pl.pct, pro_labore_valor: pl.valor, n_arquivos: 0,
        fonte: "tarefa Bitrix", nivel: 3, lido_em: new Date().toISOString(),
      });
    }
  }
  const c = (f: (x: any) => boolean) => out.filter(f).length;
  console.log(`${GRAVAR ? "GRAVANDO" : "ENSAIO"}: tarefas ${tarefas} | mensagens ${msgs} | combinados ${out.length} | sem dados de cadastro ${ignoradas}`);
  console.log(`com comissão % ${c((x) => x.comissao_pct != null)} | com vigência ${c((x) => x.vigencia_ini)} | com SEG ${c((x) => x.seg_numero)} | repasse % ${c((x) => x.repasse_pct != null)} | repasse R$ ${c((x) => x.repasse_valor != null)} | sem repasse ${c((x) => x.sem_repasse)}`);
  console.log(`pró-labore: com ${c((x) => x.pro_labore_status === "com")} (com % ${c((x) => x.pro_labore_status === "com" && x.pro_labore_pct != null)}) | sem ${c((x) => x.pro_labore_status === "sem")}`);
  const porSetor = new Map<string, number>(); for (const x of out) porSetor.set(String(x.setor), (porSetor.get(String(x.setor)) ?? 0) + 1);
  console.log("por setor:", [...porSetor].map(([k, v]) => `${k} ${v}`).join(" | "));
  for (const x of out.slice(0, 5)) console.log(`  ${String(x.segurado_nome).split(" ")[0]} … | ${String(x.imobiliaria_nome).slice(0, 20)} | SEG ${x.seg_numero ? "****" : "-"} | ${x.vigencia_ini}→${x.vigencia_fim} | com ${x.comissao_pct} | rep ${x.repasse_pct ?? x.repasse_valor ?? "-"} | PL ${x.pro_labore_status ?? "-"} ${x.pro_labore_pct ?? ""}`);
  if (!GRAVAR) return;
  const sb = createServiceClient();
  for (let i = 0; i < out.length; i += 200) {
    const { error } = await sb.from("erp_combinados_cadastro").upsert(out.slice(i, i + 200), { onConflict: "tarefa_id,mensagem_id" });
    if (error) throw new Error(error.message);
  }
  console.log(`gravados ${out.length}`);
})();
