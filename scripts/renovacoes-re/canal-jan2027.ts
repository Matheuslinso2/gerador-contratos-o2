// Canal (Segimob/Superlógica/Base Software) no documento — SÓ INFORMAÇÃO (erp_documentos.canal_id). Não mexe em imobiliária, comissão nem repasse.
// Fonte: produtores do relatório de Renovações do Corp (jan/2027). Só preenche onde canal_id está vazio. uso: ... --mes 2027-01 [--gravar]
process.loadEnvFile(".env.local");
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const mes = process.argv[process.argv.indexOf("--mes") + 1];
const GRAVAR = process.argv.includes("--gravar");
const L = JSON.parse(fs.readFileSync(`../renovacoes-re/corp-${mes}/linhas-${mes}.json`, "utf8")).linhas as Record<string, any>[];
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
const canalDe = (p: string) => /^SEGIMOB/.test(norm(p)) ? "Segimob" : /^SUPERLOGICA/.test(norm(p)) ? "Superlógica" : /^BASE SOFTWARE/.test(norm(p)) ? "Base Software" : /^SOHTEC/.test(norm(p)) ? "Sohtec" : null;
(async () => {
  const { data: canais } = await sb.from("erp_canais").select("id,nome");
  const id = new Map((canais ?? []).map((c) => [c.nome, c.id]));
  const cont: Record<string, number> = {}, vaziosPorCanal: Record<string, number> = {}, difere: Record<string, number> = {};
  const aGravar: { doc: string; canal: string; corp: number }[] = [];
  for (const l of L) {
    const cs = [...new Set([l["Produtor 1"], l["Produtor 2"], l["Produtor 3"]].filter(Boolean).map(canalDe).filter(Boolean))] as string[];
    if (!cs.length) continue;
    if (cs.length > 1) { cont["(mais de um canal)"] = (cont["(mais de um canal)"] ?? 0) + 1; continue; }
    const c = cs[0]; cont[c] = (cont[c] ?? 0) + 1;
    const { data } = await sb.from("erp_documentos").select("id,canal_id").eq("nosso_numero_corp", l["Nosso nº do Corp"]).neq("tipo", "F").limit(1);
    const d = data?.[0]; if (!d) continue;
    if (!d.canal_id) { vaziosPorCanal[c] = (vaziosPorCanal[c] ?? 0) + 1; if (id.get(c)) aGravar.push({ doc: d.id, canal: c, corp: l["Nosso nº do Corp"] }); else cont[`${c} (canal não cadastrado)`] = (cont[`${c} (canal não cadastrado)`] ?? 0) + 1; }
    else if (d.canal_id !== id.get(c)) { const k = `${c} no Corp × ${[...id].find(([, v]) => v === d.canal_id)?.[0]} no ERP`; difere[k] = (difere[k] ?? 0) + 1; }
  }
  console.log("Corp traz o canal em:", cont);
  console.log("ERP sem canal (seria preenchido):", vaziosPorCanal, "total", aGravar.length);
  console.log("ERP com OUTRO canal (não mexo):", difere);
  if (GRAVAR) {
    let ok = 0;
    for (const g of aGravar) { const { error } = await sb.from("erp_documentos").update({ canal_id: id.get(g.canal) }).eq("id", g.doc).is("canal_id", null); if (error) console.log("erro", g.corp, error.message); else ok++; }
    console.log("gravados:", ok);
  }
})();
