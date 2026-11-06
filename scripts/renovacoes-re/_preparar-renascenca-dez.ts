// Prepara os 2 cards da Renascença (Tokio e SEG/Tokio) de dez/2026 (Matheus autorizou 06/11): tira apólices já renovadas/canceladas no ERP e confere duplicidade no Bitrix (só leitura).
// Escreve renovacoes-re/cards/2026-12/cards-2026-12.PENDENTES.json (o original NÃO é alterado).
process.loadEnvFile(".env.local");
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { listarItensSpaCategoria } from "@/lib/bitrix/client";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
async function main() {
  const dir = path.resolve(process.cwd(), "..", "renovacoes-re", "cards", "2026-12");
  const todos = JSON.parse(fs.readFileSync(path.join(dir, "cards-2026-12.ORIGINAL.json"), "utf8")) as any[];
  const alvo = todos.filter((c) => !c.bitrixId && /RENASCEN/.test(norm(c.titulo)));
  const existentes = await listarItensSpaCategoria(1046, 34);
  const titulos = new Set(existentes.map((i: any) => norm(String(i.title ?? ""))));
  const apolicasBitrix = new Map<string, string>();
  for (const i of existentes as any[]) for (const a of String(i["ufCrm12NumApolice"] ?? "").split(/[;,]/).map((x) => x.trim()).filter(Boolean)) apolicasBitrix.set(a, `${i.id} ${i.title}`);
  const saida: any[] = [];
  for (const c of alvo) {
    const motivo = new Map<string, string>();
    for (let k = 0; k < c.apolices.length; k += 100) {
      const lote = c.apolices.slice(k, k + 100);
      const { data: docs } = await sb.from("erp_documentos").select("id,numero_apolice,situacao,vigencia_fim").eq("tipo", "A").in("numero_apolice", lote);
      const porNum = new Map((docs ?? []).map((d) => [d.numero_apolice as string, d]));
      for (const a of lote) {
        const d = porNum.get(a);
        if (!d) { motivo.set(a, "não encontrada no ERP"); continue; }
        if (d.situacao !== "vigente") { motivo.set(a, `situação ${d.situacao} no ERP`); continue; }
        const { data: suc } = await sb.rpc("erp_renovacao_tem_sucessora", { doc: d.id });
        if (suc) { motivo.set(a, "já tem renovação emitida no ERP"); continue; }
        const { data: x } = await sb.from("erp_documentos").select("id").eq("documento_pai_id", d.id).eq("tipo", "X").in("situacao", ["vigente", "proposta", "cancelado"]).limit(1);
        if (x?.length) motivo.set(a, "cancelada por endosso no ERP");
      }
    }
    const manter = c.apolices.filter((a: string) => !motivo.has(a));
    const dup = titulos.has(norm(c.titulo));
    const jaNoBitrix = manter.filter((a: string) => apolicasBitrix.has(a)).map((a: string) => `${a} -> ${apolicasBitrix.get(a)}`);
    console.log(`${dup ? "DUPLICADO " : ""}${c.titulo} | itens ${c.itens} -> ${manter.length} | retiradas: ${[...motivo].map(([a, m]) => `${a} (${m})`).join("; ") || "nenhuma"}${jaNoBitrix.length ? " | JÁ EM CARD: " + jaNoBitrix.slice(0, 3).join("; ") : ""}`);
    if (dup || jaNoBitrix.length || !manter.length) continue;
    const nota = [...motivo].map(([a, m]) => `Apólice ${a} fora do card: ${m} (conferido em 06/11/2026), ainda consta na planilha do Drive.`);
    saida.push({
      ...c, alertas: ["Parceria encerrada com o grupo Renascença: comunicar a renovação ao segurado; sem previsão de receita de renovação."], apolices: manter, itens: manter.length,
      observacoes: c.observacoes.replace(/Quantidade de itens: \d+/, `Quantidade de itens: ${manter.length}`) + "\nParceria encerrada com o grupo Renascença (06/11/2026): comunicar a renovação ao segurado; sem previsão de receita de renovação." + (nota.length ? "\n" + nota.join("\n") : ""),
    });
  }
  fs.writeFileSync(path.join(dir, "cards-2026-12.PENDENTES.json"), JSON.stringify(saida, null, 1));
  console.log(`\n${saida.length} cards prontos para criar (nada foi criado no Bitrix)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
