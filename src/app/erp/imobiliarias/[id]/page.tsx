import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buscarRegrasRepasse } from "@/lib/erp/documentos";
import RegrasRepasseErp from "../RegrasRepasseErp";

export const metadata = { title: "Imobiliária" };

// ERP O2 — ficha de gestão da imobiliária (base única `imobiliarias`). Antes ficava dentro da ficha do Workspace
// (/admin/imobiliarias/[id]); saiu de lá em 25/10/2026 porque o ERP é um aplicativo à parte.
export default async function ErpImobiliaria({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: imob } = await supabase
    .from("imobiliarias")
    .select("id, nome, codigo_o2, codigo_produtor_corp, fatura_habilitada, fatura_habilitada_em")
    .eq("id", id)
    .maybeSingle();
  if (!imob) notFound();
  const [regras, { data: pl }, { count: docs }] = await Promise.all([
    buscarRegrasRepasse(supabase, id),
    supabase.from("erp_repasse_direto_seguradora").select("pct, confirmado, fonte, observacao, seguradora:erp_seguradoras(nome)").eq("imobiliaria_id", id),
    supabase.from("erp_documentos").select("id", { count: "exact", head: true }).eq("imobiliaria_principal_id", id),
  ]);
  const proLabore = (pl ?? []) as unknown as { pct: number; confirmado: boolean; fonte: string; observacao: string | null; seguradora: { nome: string } | null }[];

  return (
    <main className="mx-auto w-full max-w-[1000px] flex-1 space-y-6 p-8">
      <div className="space-y-1">
        <Link href="/erp/imobiliarias" className="text-sm text-gray-500 hover:text-o2-navy hover:underline">← Imobiliárias</Link>
        <h1 className="text-xl font-semibold text-o2-navy">{imob.nome}</h1>
        <p className="text-sm text-gray-600">
          {docs ?? 0} documentos no ERP ·{" "}
          <Link href={`/erp/documentos?q=${encodeURIComponent(imob.nome)}`} className="underline">ver documentos</Link>
        </p>
      </div>

      <RegrasRepasseErp
        regras={regras}
        codigoO2={imob.codigo_o2 ?? null}
        codigoCorp={imob.codigo_produtor_corp ?? null}
        faturaHabilitada={!!imob.fatura_habilitada}
        faturaHabilitadaEm={imob.fatura_habilitada_em ?? null}
      />

      <section className="space-y-2 rounded-lg border border-gray-200 bg-white p-3 text-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Pró-labore pago direto pela seguradora</h2>
        <p className="text-xs text-gray-500">
          A seguradora paga esta fatia direto à imobiliária (NF da imob): não entra na conta da O2, não é pendência de comissão e não pode gerar repasse da O2.
        </p>
        {proLabore.length === 0 ? (
          <p className="text-xs text-gray-500">Nenhum.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-left text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="py-1 pr-3">Seguradora</th>
                <th className="py-1 pr-3 text-right">Pontos</th>
                <th className="py-1 pr-3">Situação</th>
                <th className="py-1 pr-3">Como foi apurado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {proLabore.map((r, i) => (
                <tr key={i}>
                  <td className="py-1 pr-3">{r.seguradora?.nome ?? "—"}</td>
                  <td className="py-1 pr-3 text-right">{Number(r.pct)}</td>
                  <td className="py-1 pr-3">{r.confirmado ? <span className="text-green-700">confirmado</span> : <span className="text-orange-700">a confirmar</span>}</td>
                  <td className="py-1 pr-3 text-gray-500">{r.observacao ?? r.fonte}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
