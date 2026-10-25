import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { lerFiltros, SEGURADORA_FATURA } from "@/lib/erp/filtros";
import FiltrosErp from "../FiltrosErp";

export const metadata = { title: "Imobiliárias" };

// ERP O2 — imobiliárias vistas pelo ERP (mesma base única `imobiliarias` do Workspace; aqui só o que é de gestão:
// Código O2 do produtor, código Corp, modo fatura, pró-labore pago direto pela seguradora).
type Linha = { id: string; nome: string; codigo_o2: number | null; codigo_produtor_corp: number | null; fatura_habilitada: boolean | null };

export default async function ErpImobiliarias({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const f = lerFiltros(await searchParams);
  const q = f.q;
  const supabase = await createClient();
  let consulta = supabase.from("imobiliarias").select("id, nome, codigo_o2, codigo_produtor_corp, fatura_habilitada").order("nome").limit(300);
  if (q?.trim()) {
    const termo = q.trim();
    consulta = /^\d+$/.test(termo)
      ? consulta.or(`codigo_o2.eq.${termo},codigo_produtor_corp.eq.${termo}`)
      : consulta.ilike("nome", `%${termo}%`);
  } else if (!f.seguradora) {
    consulta = consulta.not("codigo_o2", "is", null);
  }
  if (f.seguradora) {
    const { data: seg } = await supabase.from("erp_seguradoras").select("id").eq("abreviacao", f.seguradora).maybeSingle();
    const [{ data: comFatura }, { data: comPl }] = await Promise.all([
      supabase.from("faturas_esperadas").select("imobiliaria_id").eq("ativo", true).eq("seguradora", SEGURADORA_FATURA[f.seguradora] ?? "—"),
      supabase.from("erp_repasse_direto_seguradora").select("imobiliaria_id").eq("seguradora_id", seg?.id ?? "00000000-0000-0000-0000-000000000000"),
    ]);
    const ids = [...new Set([...(comFatura ?? []), ...(comPl ?? [])].map((r: { imobiliaria_id: string }) => r.imobiliaria_id))];
    consulta = consulta.in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  }
  const [{ data }, { data: pl }] = await Promise.all([
    consulta,
    supabase.from("erp_repasse_direto_seguradora").select("imobiliaria_id, pct, seguradora:erp_seguradoras(abreviacao)"),
  ]);
  const linhas = (data ?? []) as Linha[];
  const proLabore = new Map<string, string[]>();
  for (const r of (pl ?? []) as unknown as { imobiliaria_id: string; pct: number; seguradora: { abreviacao: string } | null }[]) {
    const l = proLabore.get(r.imobiliaria_id) ?? [];
    l.push(`${r.seguradora?.abreviacao ?? "?"} ${Number(r.pct)}`);
    proLabore.set(r.imobiliaria_id, l);
  }

  return (
    <main className="mx-auto w-full max-w-[1200px] flex-1 space-y-4 p-8">
      <div>
        <h1 className="text-xl font-semibold text-o2-navy">Imobiliárias</h1>
        <p className="text-sm text-gray-600">Mesma base única de imobiliárias do Workspace; aqui só os dados de gestão do ERP.</p>
      </div>
      <FiltrosErp
        caminho="/erp/imobiliarias"
        campos={["busca", "seguradora"]}
        valores={f}
        rotuloBusca="Imobiliária"
        placeholderBusca="Nome, Código O2 ou código do Corp"
        resumo="Seguradora: imobiliárias com fatura nessa seguradora ou com pró-labore pago direto por ela."
      />
      <p className="text-xs text-gray-500">{q?.trim() || f.seguradora ? `${linhas.length} encontradas` : `${linhas.length} imobiliárias com Código O2 de produtor (até 300; use a busca para as demais)`}</p>
      <div className="overflow-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">Imobiliária</th>
              <th className="px-3 py-2">Código O2</th>
              <th className="px-3 py-2">Código Corp</th>
              <th className="px-3 py-2">Modo fatura</th>
              <th className="px-3 py-2">Pró-labore pago direto (pontos)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {linhas.map((l) => (
              <tr key={l.id}>
                <td className="px-3 py-1.5">
                  <Link href={`/erp/imobiliarias/${l.id}`} className="text-o2-navy hover:underline">{l.nome}</Link>
                </td>
                <td className="px-3 py-1.5">{l.codigo_o2 ?? "—"}</td>
                <td className="px-3 py-1.5 text-gray-500">{l.codigo_produtor_corp ?? "—"}</td>
                <td className="px-3 py-1.5">{l.fatura_habilitada ? <span className="text-green-700">habilitada</span> : <span className="text-gray-400">não</span>}</td>
                <td className="px-3 py-1.5 text-gray-600">{proLabore.get(l.id)?.join(" · ") ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
