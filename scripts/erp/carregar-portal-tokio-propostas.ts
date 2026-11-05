// Carrega a leitura do portal Tokio (Acompanhamento de Propostas e Endossos) em erp_portal_tokio_propostas.
// Entrada: tokio-propostas-<codigo>.json em Downloads (um por código de corretor: 55002, 70145, 195354), baixados do navegador logado.
// Nova carga = nova identificação (nunca sobrescreve). Uso: npx tsx --require ./scripts/erp/_sem-server-only.cjs scripts/erp/carregar-portal-tokio-propostas.ts
process.loadEnvFile(".env.local");
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServiceClient } from "@/lib/supabase/service";

const sb = createServiceClient();
const dir = path.join(os.homedir(), "Downloads");
const carga = `tokio-prop-${new Date().toISOString().slice(0, 16)}`;
const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
const dia = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

async function main() {
  const linhas: Record<string, unknown>[] = [];
  for (const cod of [55002, 70145, 195354]) {
    const arq = path.join(dir, `tokio-propostas-${cod}.json`);
    if (!fs.existsSync(arq)) { console.log("faltando", arq); continue; }
    const j = JSON.parse(fs.readFileSync(arq, "utf8")) as { codigo: number; coletado_em: string; tipos: Record<string, Record<string, unknown>[]> };
    for (const [lista, itens] of Object.entries(j.tipos)) {
      for (const x of itens) {
        linhas.push({
          carga, coletado_em: j.coletado_em, codigo_corretor: j.codigo, lista,
          id_ppota: num(x.idPpota), nr_proposta: num(x.nrProposta), tp_proposta: (x.tpProposta as string) ?? null,
          situacao_portal: (x.tipoSituacaoProposta as string) ?? null, produto: (x.nmProduto as string) ?? null,
          cliente: (x.nmCliente as string) ?? null, documento: ((x.nrDocumentoCliente as string) ?? "").replace(/\D/g, "") || null,
          tipo_documento: (x.tipoDocumento as string) ?? null, premio: num(x.vlPremio),
          dt_liberado: dia(x.dtLiberado ?? x.dtPendencia), dt_venc_parcela: dia(x.dtVencParcela),
          origem_venda: (x.origemVenda as string) ?? null, bruto: x,
        });
      }
    }
  }
  console.log("linhas lidas:", linhas.length);
  for (let i = 0; i < linhas.length; i += 500) {
    const { error } = await sb.from("erp_portal_tokio_propostas").insert(linhas.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }
  console.log("carga", carga, "gravada");
}
main().catch((e) => { console.error(e); process.exit(1); });
