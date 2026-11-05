process.loadEnvFile(".env.local");
// Carrega a lista de apólices/propostas/endossos do Corretor Online da Porto (policy-list/listPolicies: EMITIDAS, CANCELADAS, VENCIDAS, A_VENCER)
// em erp_portal_porto_apolices. Entrada: porto_lista_apolices_<ddmm>.json em Downloads, baixado do navegador logado. Nova carga = nova identificação.
// Uso: npx tsx --require ./scripts/erp/_sem-server-only.cjs scripts/erp/carregar-portal-porto-apolices.ts [arquivo.json]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServiceClient } from "@/lib/supabase/service";

const sb = createServiceClient();
const arq = process.argv[2] ?? path.join(os.homedir(), "Downloads", "porto_lista_apolices_0511.json");
const carga = `porto-apol-${new Date().toISOString().slice(0, 16)}`;
const dt = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const s = (v: unknown) => (v == null || v === "" ? null : String(v));

async function main() {
  const j = JSON.parse(fs.readFileSync(arq, "utf8")) as { lido_em: string; susep: string; linhas: Record<string, unknown>[] };
  // a mesma apólice aparece em mais de uma consulta (emitidas/vencidas/a vencer): uma linha por chave, guardando quais consultas a trouxeram
  const mapa = new Map<string, Record<string, unknown>>();
  for (const x of j.linhas) {
    const k = [x.ramo, x.sucursal, x.apolice, x.endosso, x.numeroProposta].join("|");
    const ant = mapa.get(k);
    if (ant) { ant.consulta = [...new Set(String(ant.consulta).split(",").concat(String(x._consulta)))].join(","); continue; }
    mapa.set(k, {
      carga, coletado_em: j.lido_em, susep: j.susep, consulta: String(x._consulta),
      ramo: s(x.ramo), sucursal: s(x.sucursal), apolice: s(x.apolice), endosso: s(x.endosso), numero_proposta: s(x.numeroProposta), origem_proposta: s(x.origemProposta), empresa: s(x.empresa),
      codigo_produto: s(x.codigoProduto), produto: s(x.nomeProduto), status: s(x.status),
      emissao: dt(x.dataEmissao), vigencia_inicio: dt(x.dataInicioVigencia), vigencia_fim: dt(x.dataFinalVigencia),
      cpf_cnpj: s(x.cpfCnpj), codigo_pessoa: s(x.codigoPessoa), segurado: s(x.nomeRazaoSocial), bruto: x,
    });
  }
  const linhas = [...mapa.values()];
  for (let i = 0; i < linhas.length; i += 300) {
    let erro = "";
    for (let t = 1; t <= 4; t++) {
      try {
        const { error } = await sb.from("erp_portal_porto_apolices").insert(linhas.slice(i, i + 300));
        if (!error) { erro = ""; break; }
        erro = error.message;
      } catch (e) { erro = (e as Error).message; }
      await new Promise((r) => setTimeout(r, 4000 * t));
    }
    if (erro) { await sb.from("erp_portal_porto_apolices").delete().eq("carga", carga); throw new Error(erro + " (carga parcial apagada)"); }
  }
  console.log("lidas:", j.linhas.length, "únicas gravadas:", linhas.length, "carga", carga);
}
main().catch((e) => { console.error(e); process.exit(1); });
