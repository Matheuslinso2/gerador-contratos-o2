import type { RegraRepasse } from "@/lib/erp/documentos";

// ERP O2 — regra ESPERADA de repasse da imobiliária (o que foi combinado na
// parceria). A negociação real é por documento (erp_documento_produtores);
// a ficha mostra o padrão. Edição chega com a Fase 3 (repasses calculados).

const BASE: Record<string, string> = {
  valor_fixo: "valor fixo",
  premio_liquido: "prêmio líquido",
  liquido_adicional: "líquido + adicional",
  premio_total: "prêmio total",
  base_comissao: "base de comissão",
  comissao_corretora: "comissão da corretora",
};

export default function RegrasRepasseErp({
  regras,
  codigoO2,
  codigoCorp,
  faturaHabilitada,
  faturaHabilitadaEm,
}: {
  regras: RegraRepasse[];
  codigoO2: number | null;
  codigoCorp: number | null;
  faturaHabilitada: boolean;
  faturaHabilitadaEm: string | null;
}) {
  return (
    <section className="space-y-2 rounded-lg border border-gray-200 bg-white p-3 text-sm">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">ERP — Produtor e regras de repasse</h2>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
        <span>
          <span className="text-gray-500">Cód. O2 da imobiliária (produtor):</span> <b>{codigoO2 ?? "—"}</b>
        </span>
        <span>
          <span className="text-gray-500">Código no Corp:</span> {codigoCorp ?? "—"}
        </span>
        <span>
          <span className="text-gray-500">Modo fatura:</span>{" "}
          {faturaHabilitada ? <b className="text-green-700">habilitada{faturaHabilitadaEm ? ` em ${faturaHabilitadaEm.slice(8, 10)}/${faturaHabilitadaEm.slice(5, 7)}/${faturaHabilitadaEm.slice(0, 4)}` : ""}</b> : <span className="text-gray-500">não habilitada (só contratação individual)</span>}
        </span>
      </div>
      {regras.length === 0 ? (
        <p className="text-xs text-gray-500">Nenhuma regra ainda (a inferência usa documentos novos desde 2025; menos de 3 documentos = sem regra).</p>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-left text-[11px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="py-1 pr-3">Seguradora</th>
              <th className="py-1 pr-3">Ramo</th>
              <th className="py-1 pr-3">Base</th>
              <th className="py-1 pr-3 text-right">Novo</th>
              <th className="py-1 pr-3 text-right">Renovado</th>
              <th className="py-1 pr-3">Forma</th>
              <th className="py-1 pr-3">Origem</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {regras.map((r) => (
              <tr key={r.id}>
                <td className="py-1 pr-3">{r.seguradora ?? <span className="text-gray-400">padrão</span>}</td>
                <td className="py-1 pr-3">{r.ramo ?? <span className="text-gray-400">padrão</span>}</td>
                <td className="py-1 pr-3">{r.valor_fixo !== null ? `R$ ${r.valor_fixo.toLocaleString("pt-BR")} fixo` : BASE[r.base_calculo] ?? r.base_calculo}</td>
                <td className="py-1 pr-3 text-right">{r.pct_novo.toLocaleString("pt-BR")}%</td>
                <td className="py-1 pr-3 text-right">{r.pct_renovado.toLocaleString("pt-BR")}%</td>
                <td className="py-1 pr-3">{r.forma_repasse.replace("_", " ")}</td>
                <td className="py-1 pr-3 text-gray-500" title={r.observacao ?? ""}>
                  {r.origem === "corp_import" ? "inferida do Corp" : "manual"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-[11px] text-gray-500">
        Retenção de imposto padrão: 18% (parâmetro global do ERP). Repasses fixos e premiação de campanha não sofrem retenção.
      </p>
    </section>
  );
}
