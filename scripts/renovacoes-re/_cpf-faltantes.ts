// Só leitura: para os 10 documentos de jan/2027 sem CPF/CNPJ válido no locatário, mostra o que o Corp tem (CPF mascarado) e quem já detém esse CPF no ERP.
process.loadEnvFile(".env.local");
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const L = JSON.parse(fs.readFileSync("../renovacoes-re/corp-2027-01/linhas-2027-01.json", "utf8")).linhas as Record<string, any>[];
const alvo = [81579, 89920, 90265, 90272, 101449, 101466, 119667, 119795, 119798, 130326, 120744, 119294];
const mask = (c: string) => (c.length >= 11 ? `${c.slice(0, 3)}…${c.slice(-2)} (${c.length} díg.)` : c || "sem CPF no Corp");
(async () => {
  for (const n of alvo) {
    const l = L.find((x) => x["Nosso nº do Corp"] === n); if (!l) { console.log(n, "fora do relatório"); continue; }
    const cpf = String(l["CPF/CNPJ (Corp)"] ?? "").replace(/\D/g, "");
    const k = cpf ? cpf.padStart(cpf.length <= 11 ? 11 : 14, "0") : "";
    let dono = "";
    if (k.replace(/0/g, "")) { const { data } = await sb.from("locatarios").select("id,nome").eq("cpf", k); dono = (data ?? []).map((x) => x.nome).join(" / "); }
    const { data: d } = await sb.from("erp_documentos").select("id,locatario_id").eq("nosso_numero_corp", n).neq("tipo", "F").limit(1);
    const { data: lo } = d?.[0]?.locatario_id ? await sb.from("locatarios").select("id,nome,cpf").eq("id", d[0].locatario_id) : { data: [] as any[] };
    console.log(n, l["Ramo"], "| Corp cliente:", String(l["Cliente (Corp)"]).slice(0, 40), "| CPF Corp:", mask(cpf), "| ERP locatário:", lo?.[0]?.nome, "| quem já tem esse CPF no ERP:", dono || "(ninguém)");
  }
})();
