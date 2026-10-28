// Correções autorizadas pelo Matheus (28/10/2026): religar 5 documentos ao cliente completo (mesmo CPF/CNPJ do Corp) e corrigir o prêmio do Nosso nº do Corp 119408
// pela proposta contratada anexada. Registra antes/depois em renovacoes-re/corp-2027-01/correcoes-aplicadas.csv.
process.loadEnvFile(".env.local");
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const L = JSON.parse(fs.readFileSync("../renovacoes-re/corp-2027-01/linhas-2027-01.json", "utf8")).linhas as Record<string, any>[];
const out: string[] = ["Código O2 do documento;Nosso nº do Corp;Campo;Valor antigo;Valor novo;Fonte"];
(async () => {
  for (const n of [89920, 90265, 90272, 119795, 119798]) {
    const l = L.find((x) => x["Nosso nº do Corp"] === n)!;
    const cpf = String(l["CPF/CNPJ (Corp)"]).replace(/\D/g, ""); const k = cpf.padStart(cpf.length <= 11 ? 11 : 14, "0");
    const { data: cands } = await sb.from("locatarios").select("id,nome").eq("cpf", k);
    if (cands?.length !== 1) { console.log(n, "ignorado: candidatos =", cands?.length); continue; }
    const { data: d } = await sb.from("erp_documentos").select("id,nosso_numero,locatario_id").eq("nosso_numero_corp", n).neq("tipo", "F").single();
    if (!d || d.locatario_id === cands[0].id) continue;
    const { data: antigo } = await sb.from("locatarios").select("nome").eq("id", d.locatario_id).single();
    const { error } = await sb.from("erp_documentos").update({ locatario_id: cands[0].id }).eq("id", d.id).eq("locatario_id", d.locatario_id);
    console.log(n, error ? "ERRO " + error.message : `ok: ${antigo?.nome} → ${cands[0].nome}`);
    if (!error) out.push(`${d.nosso_numero};${n};cliente (locatario_id);${antigo?.nome};${cands[0].nome};CPF/CNPJ do relatório de Renovações do Corp + nome completo`);
  }
  const { data: p } = await sb.from("erp_documentos").select("id,nosso_numero,premio_liquido,iof,premio_total").eq("nosso_numero_corp", 119408).single();
  if (p && Number(p.premio_total) === 208.73) {
    const novo = { premio_liquido: 388.77, iof: 28.68, premio_total: 417.45 };
    const { error } = await sb.from("erp_documentos").update(novo).eq("id", p.id);
    console.log(119408, error ? "ERRO " + error.message : "ok");
    if (!error) for (const c of ["premio_liquido", "iof", "premio_total"] as const) out.push(`${p.nosso_numero};119408;${c};${(p as any)[c]};${(novo as any)[c]};SEGURO_INCENDIO_PROPOSTA_CONTRATADA_1338.pdf (corp_anexos)`);
  }
  fs.writeFileSync("../renovacoes-re/corp-2027-01/correcoes-aplicadas.csv", "\ufeff" + out.join("\r\n"));
})();
