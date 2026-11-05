process.loadEnvFile(".env.local");
// Carrega a lista de apólices/endossos de Fiança do Portal Parceiro da Too (POST fiancabffweb/apolice/listar, por CNPJ do corretor; janela máx. 60 dias) em erp_portal_too_apolices.
// O login da Too é o da O2 Capitalização (CNPJ 54.493.758/0001-38): só traz o que pertence a esse CNPJ. Entrada: too_fianca_apolices_*.json em Downloads.
// Uso: npx tsx --require ./scripts/erp/_sem-server-only.cjs scripts/erp/carregar-portal-too-apolices.ts [arquivo.json]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServiceClient } from "@/lib/supabase/service";

const sb = createServiceClient();
const arq = process.argv[2] ?? path.join(os.homedir(), "Downloads", "too_fianca_apolices_0511.json");
const carga = `too-apol-${new Date().toISOString().slice(0, 16)}`;
const dt = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const s = (v: unknown) => (v == null || v === "" ? null : String(v));

async function main() {
  const j = JSON.parse(fs.readFileSync(arq, "utf8")) as { lido_em: string; cnpj: string; itens: Record<string, unknown>[] };
  const mapa = new Map<string, Record<string, unknown>>();
  for (const x of j.itens) {
    mapa.set(`${x.numeroApolice}|${x.cdProposta}|${x.status}`, {
      carga, coletado_em: j.lido_em, cnpj_corretor: j.cnpj, numero_apolice: String(x.numeroApolice), numero_proposta: s(x.cdProposta), produto: s(x.produto), status: s(x.status),
      emissao: dt(x.dataEmissao), vigencia_inicio: dt(x.dataInicioVigencia), vigencia_fim: dt(x.dataFimVigencia),
      segurado: s(x.nomeClienteSegurado), garantido: s(x.nomeGarantido), cpf_cnpj_garantido: s(x.nrCnpjCpfCliente), pagador_tomador: s(x.pagadorTomador),
      imobiliaria: s(x.razaoSocialImobiliaria), tipo_emissao: s(x.tipoEmissao), bruto: x,
    });
  }
  const linhas = [...mapa.values()];
  const { error: e0 } = await sb.from("erp_portal_too_apolices").delete().neq("id", 0);
  if (e0) throw new Error(e0.message);
  const { error } = await sb.from("erp_portal_too_apolices").insert(linhas);
  if (error) throw new Error(error.message);
  console.log("lidas:", j.itens.length, "gravadas:", linhas.length, "carga", carga);
}
main().catch((e) => { console.error(e); process.exit(1); });
