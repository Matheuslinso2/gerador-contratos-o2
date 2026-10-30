// Lista (SÓ LEITURA) as propostas da Tokio sem nº de apólice no ERP e os CPFs/CNPJs das partes, para consultar no portal da Tokio.
// Grava %TEMP%\tokio-propostas.json = [{id, codigo_o2, ramo, proposta, cpfs[]}] e imprime os CPFs únicos.
process.loadEnvFile(".env.local");
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { createServiceClient } from "@/lib/supabase/service";
import { carregarDocs } from "@/lib/erp/anexosEmail";
const sb = createServiceClient();
(async () => {
  const { data: segs } = await sb.from("erp_seguradoras").select("id").ilike("nome", "%TOKIO%");
  const { data: ramos } = await sb.from("erp_ramos").select("id,nome"); const nr = new Map((ramos ?? []).map((r) => [r.id, r.nome]));
  const docs: any[] = [];
  for (let de = 0; ; de += 1000) { const { data } = await sb.from("erp_documentos").select("id,nosso_numero,ramo_id,numero_proposta,vigencia_inicio").in("seguradora_id", (segs ?? []).map((s) => s.id)).eq("situacao", "proposta").is("numero_apolice", null).order("id").range(de, de + 999); docs.push(...(data ?? [])); if ((data ?? []).length < 1000) break; }
  const m = await carregarDocs(sb, docs.map((d) => d.id));
  const lista = docs.map((d) => ({ id: d.id, codigo_o2: d.nosso_numero, ramo: nr.get(d.ramo_id) ?? "?", proposta: d.numero_proposta, cpfs: [...new Set(m.get(d.id)?.cpfs ?? [])] }));
  fs.writeFileSync(path.join(os.tmpdir(), "tokio-propostas.json"), JSON.stringify(lista));
  const cpfs = [...new Set(lista.flatMap((x) => x.cpfs))];
  console.log("propostas", lista.length, "sem CPF", lista.filter((x) => !x.cpfs.length).length, "CPFs únicos", cpfs.length);
  fs.writeFileSync(path.join(os.tmpdir(), "tokio-cpfs.json"), JSON.stringify(cpfs));
})();
