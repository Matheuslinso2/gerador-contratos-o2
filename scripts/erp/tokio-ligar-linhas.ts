// Roda erp_identificar_linhas (função da sessão de baixa) em cada extrato da Tokio que tem linhas pendentes de identificação, e conta antes/depois.
// Só liga linha de extrato ao documento (não cria baixa, recebimento nem repasse).
process.loadEnvFile(".env.local");
import { createServiceClient } from "@/lib/supabase/service";
const sb = createServiceClient();
(async () => {
  const conta = async () => { const o: Record<string, number> = {}; for (let de = 0; ; de += 1000) { const { data } = await sb.from("erp_baixa_linha_estado").select("estado").eq("seguradora_abrev", "TOKI").gt("valor_comissao", 0).range(de, de + 999); for (const x of data ?? []) o[x.estado] = (o[x.estado] ?? 0) + 1; if ((data ?? []).length < 1000) break; } return o; };
  const antes = await conta(); console.log("ANTES", JSON.stringify(antes));
  const { data: ext } = await sb.from("erp_baixa_linha_estado").select("extrato_id").eq("seguradora_abrev", "TOKI").eq("estado", "pendente_identificacao"); const ids = [...new Set((ext ?? []).map((e) => e.extrato_id))];
  const tot: Record<string, number> = {}; let erros = 0;
  for (const id of ids) { const { data, error } = await sb.rpc("erp_identificar_linhas", { p_extrato: id }); if (error) { erros++; if (erros <= 3) console.log("erro", id, error.message.slice(0, 100)); continue; } for (const [k, v] of Object.entries(data ?? {})) if (typeof v === "number") tot[k] = (tot[k] ?? 0) + v; }
  console.log("extratos processados", ids.length, "erros", erros, "retorno somado", JSON.stringify(tot));
  console.log("DEPOIS", JSON.stringify(await conta()));
})();
