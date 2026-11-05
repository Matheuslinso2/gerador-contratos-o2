// Carrega a consulta por CPF/CNPJ do portal Tokio (apólices e endossos por cliente) em erp_portal_tokio_apolices.
// Entrada: tokio-apolices-<codigo>.json em Downloads (55002, 70145, 195354), baixados do navegador logado.
// Nova carga = nova identificação. Uso: npx tsx --require ./scripts/erp/_sem-server-only.cjs scripts/erp/carregar-portal-tokio-apolices.ts
process.loadEnvFile(".env.local");
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServiceClient } from "@/lib/supabase/service";

const sb = createServiceClient();
const dir = path.join(os.homedir(), "Downloads");
const carga = `tokio-apol-${new Date().toISOString().slice(0, 16)}`;
const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
const br = (v: unknown) => { const m = typeof v === "string" ? v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/) : null; return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

async function main() {
  const linhas: Record<string, unknown>[] = [];
  for (const cod of [55002, 70145, 195354]) {
    const arq = path.join(dir, `tokio-apolices-${cod}.json`);
    if (!fs.existsSync(arq)) { console.log("faltando", arq); continue; }
    const j = JSON.parse(fs.readFileSync(arq, "utf8")) as { codigo: number; coletado_em: string; itens: Record<string, unknown>[] };
    for (const x of j.itens) {
      linhas.push({
        carga, coletado_em: j.coletado_em, codigo_corretor: j.codigo, documento: (x.cpf as string) ?? null,
        apolice: x.apolice == null ? null : String(x.apolice), cod_negocio: x.codNegocio == null ? null : String(x.codNegocio),
        produto: (x.produto as string) ?? null, emissao: br(x.emissao), vigencia_inicio: br(x.inicio), vigencia_fim: br(x.fim),
        premio_liquido: num(x.premioLiquido), premio_total: num(x.premioTotal), comissao_pct: num(x.comissaoPct),
        possui_endosso: (x.possuiEndosso as string) ?? null, endossos: x.endossos ?? null, cancelamento: br(x.cancelamento),
        segurado: (x.segurado as string) ?? null, razao_social: (x.razao as string) ?? null, idepol: num(x.idepol), bruto: x,
      });
    }
  }
  console.log("linhas lidas:", linhas.length);
  // o mesmo CPF pode aparecer em mais de um código: a chave única inclui o código, então repetições entre códigos ficam
  const vistos = new Set<string>();
  const unicas = linhas.filter((l) => { const k = [l.codigo_corretor, l.documento, l.apolice, l.idepol].join("|"); if (vistos.has(k)) return false; vistos.add(k); return true; });
  for (let i = 0; i < unicas.length; i += 400) {
    const { error } = await sb.from("erp_portal_tokio_apolices").insert(unicas.slice(i, i + 400));
    if (error) throw new Error(error.message);
  }
  console.log("carga", carga, "gravada:", unicas.length);
}
main().catch((e) => { console.error(e); process.exit(1); });
