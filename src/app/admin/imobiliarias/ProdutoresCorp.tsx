import type { SupabaseClient } from "@supabase/supabase-js";

// Quadro "Produtores no Corp" (22/10/2026): uma imobiliária pode ter mais de
// um produtor no Corp (ex.: Dreher — 327 "MARCUS DREHER IMOVEIS/ KARLA" e
// 356 "KARLA CLARK ALMEIDA DREHER"). A ficha é uma só; aqui aparece a
// produção de cada produtor separada. Usado na ficha de cadastro e na 360.
export type LinhaProdutorCorp = {
  imobiliaria_id: string;
  ficha: string;
  codigo: string;
  nome_corp: string | null;
  principal: boolean;
  documentos: number;
  premio: number;
  comissao: number;
  ultima_vigencia: string | null;
};

export async function buscarProdutoresCorp(db: SupabaseClient, ids: string[], de: string, ate: string): Promise<LinhaProdutorCorp[]> {
  if (!ids.length) return [];
  const { data, error } = await db.rpc("produtores_corp_das_fichas", { p_ids: ids, p_de: de, p_ate: ate });
  if (error) throw new Error(`produtores do Corp: ${error.message}`);
  return ((data ?? []) as LinhaProdutorCorp[]).map((l) => ({ ...l, documentos: Number(l.documentos), premio: Number(l.premio), comissao: Number(l.comissao) }));
}

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBr = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");

export function ProdutoresCorp({
  linhas,
  periodo,
  mostrarFicha = false,
}: {
  linhas: LinhaProdutorCorp[];
  periodo: string;
  mostrarFicha?: boolean;
}) {
  if (!linhas.length) {
    return <p className="text-sm text-gray-500">Nenhum produtor do Corp ligado a esta ficha.</p>;
  }
  const total = linhas.reduce((t, l) => ({ documentos: t.documentos + l.documentos, premio: t.premio + l.premio, comissao: t.comissao + l.comissao }), {
    documentos: 0,
    premio: 0,
    comissao: 0,
  });
  return (
    <div className="space-y-1">
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-3 py-2 font-medium">Código</th>
              <th className="px-3 py-2 font-medium">Nome no Corp</th>
              {mostrarFicha && <th className="px-3 py-2 font-medium">Ficha</th>}
              <th className="px-3 py-2 text-right font-medium">Documentos</th>
              <th className="px-3 py-2 text-right font-medium">Prêmio líquido</th>
              <th className="px-3 py-2 text-right font-medium">Comissão</th>
              <th className="px-3 py-2 text-right font-medium">Última vigência</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {linhas.map((l) => (
              <tr key={`${l.imobiliaria_id}-${l.codigo}`}>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-700">
                  {l.codigo}
                  {l.principal && <span className="ml-1.5 rounded-full bg-o2-navy/10 px-1.5 py-0.5 font-sans text-[10px] text-o2-navy">principal</span>}
                </td>
                <td className="px-3 py-2 text-gray-800">{l.nome_corp ?? "—"}</td>
                {mostrarFicha && <td className="px-3 py-2 text-gray-600">{l.ficha}</td>}
                <td className="px-3 py-2 text-right tabular-nums">{l.documentos.toLocaleString("pt-BR")}</td>
                <td className="px-3 py-2 text-right tabular-nums">{reais(l.premio)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{reais(l.comissao)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-500">{dataBr(l.ultima_vigencia)}</td>
              </tr>
            ))}
          </tbody>
          {linhas.length > 1 && (
            <tfoot className="border-t border-gray-200 bg-gray-50 font-semibold text-gray-800">
              <tr>
                <td className="px-3 py-2" colSpan={mostrarFicha ? 3 : 2}>
                  Total
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{total.documentos.toLocaleString("pt-BR")}</td>
                <td className="px-3 py-2 text-right tabular-nums">{reais(total.premio)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{reais(total.comissao)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="text-xs text-gray-500">
        {periodo} · mesma regra do Power BI (por início de vigência; cada documento conta uma vez). O código principal é o que fica no campo da ficha.
      </p>
    </div>
  );
}
