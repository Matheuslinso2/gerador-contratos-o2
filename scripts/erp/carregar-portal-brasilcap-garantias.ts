process.loadEnvFile(".env.local");
// Carrega a leitura do portal Brasilcap (B2Cap) em erp_portal_brasilcap_garantias. Entrada: brasilcap-reaplicacoes.json em Downloads (baixado do navegador logado).
// Nova carga = nova identificação (nunca sobrescreve). Uso: tsx --require ./scripts/erp/_sem-server-only.cjs scripts/erp/carregar-portal-brasilcap-garantias.ts [arquivo.json] [origem]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServiceClient } from "@/lib/supabase/service";

const sb = createServiceClient();
const arq = process.argv[2] ?? path.join(os.homedir(), "Downloads", "brasilcap-reaplicacoes.json");
const origem = process.argv[3] ?? "reaplicacao_garantias";
const carga = `brasilcap-${new Date().toISOString().slice(0, 16)}`;
const dia = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const dig = (v: unknown) => (v == null ? null : String(v).replace(/\D/g, "") || null);

(async () => {
  const j = JSON.parse(fs.readFileSync(arq, "utf8")) as { coletado_em: string; itens: Record<string, unknown>[] };
  const vistos = new Set<string>();
  const linhas = j.itens.map((x) => ({
    carga, coletado_em: j.coletado_em, origem, mes_consulta: (x.mes_consulta as string) ?? null, numero_garantia: String(x.numeroGarantia),
    data_inicio: dia(x.dataInicioGarantia), data_fim: dia(x.dataFimVigencia), valor_garantia: x.valorGarantia == null ? null : Number(x.valorGarantia),
    situacao: (x.situacaoGarantia as string) ?? null, opcao_renovacao: (x.opcaoRenovacao as string) ?? null, titular: (x.titular as string) ?? null,
    documento_titular: dig(x.cpfCnpjTitular), locador: (x.locador as string) ?? null, documento_locador: dig(x.cpfCnpjLocador),
    representante: (x.representanteLocador as string) ?? null, bruto: x,
  })).filter((l) => { const k = l.numero_garantia; if (vistos.has(k)) return false; vistos.add(k); return true; });
  for (let i = 0; i < linhas.length; i += 400) {
    const { error } = await sb.from("erp_portal_brasilcap_garantias").insert(linhas.slice(i, i + 400));
    if (error) throw new Error(error.message);
  }
  console.log("carga", carga, "gravada:", linhas.length, "de", j.itens.length);
})();
