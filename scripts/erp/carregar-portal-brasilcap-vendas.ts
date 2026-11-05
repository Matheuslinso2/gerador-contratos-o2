process.loadEnvFile(".env.local");
// Carrega as vendas lidas no portal Brasilcap (B2Cap, Consulta de Venda) em erp_portal_brasilcap_vendas. Entrada: brasilcap-vendas.json em Downloads.
// Nova carga = nova identificação (nunca sobrescreve). Uso: tsx --require ./scripts/erp/_sem-server-only.cjs scripts/erp/carregar-portal-brasilcap-vendas.ts [arquivo.json]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServiceClient } from "@/lib/supabase/service";

const sb = createServiceClient();
const arq = process.argv[2] ?? path.join(os.homedir(), "Downloads", "brasilcap-vendas.json");
const carga = `brasilcap-vendas-${new Date().toISOString().slice(0, 16)}`;
const dia = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const dig = (v: unknown) => (v == null ? null : String(v).replace(/\D/g, "") || null);
const s = (v: unknown) => (v == null ? null : String(v));

(async () => {
  const j = JSON.parse(fs.readFileSync(arq, "utf8")) as { coletado_em: string; itens: Record<string, unknown>[] };
  const vistos = new Set<string>();
  const linhas = j.itens.map((x) => ({
    carga, coletado_em: j.coletado_em, id_venda: Number(x.idVenda), numero_garantia: s(x.numeroGarantia), data_venda: dia(x.dataVenda), produto: s(x.nomeItem),
    forma_pagamento: s(x.descFormaPagamento), vencimento_boleto: dia(x.dataVencimentoBoleto), data_debito: dia(x.dataDebito), situacao_venda: s(x.descSituacaoVenda),
    valor_garantia: x.valorGarantia == null ? null : Number(x.valorGarantia), qtd_titulos: x.qtdTitulos == null ? null : Number(x.qtdTitulos),
    titular: s(x.nomeTitular), documento_titular: dig(x.cpfCnpjTitular), terceiro: s(x.nomeTerceiro), documento_terceiro: dig(x.cpfCnpjTerceiro),
    contratante: s(x.nomeContratante), documento_contratante: dig(x.cpfCnpjContratante), objeto: s(x.objetoGarantia), cocorretor: s(x.nomeCocorretor), bruto: x,
  })).filter((l) => { const k = String(l.id_venda); if (vistos.has(k)) return false; vistos.add(k); return true; });
  for (let i = 0; i < linhas.length; i += 300) {
    const { error } = await sb.from("erp_portal_brasilcap_vendas").insert(linhas.slice(i, i + 300));
    if (error) throw new Error(error.message);
  }
  console.log("carga", carga, "gravada:", linhas.length, "de", j.itens.length);
})();
