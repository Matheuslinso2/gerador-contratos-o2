import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import { IconReport } from "@/components/icons";
import { formatarData } from "@/lib/sinistros/regras";
import { signOut } from "../../actions";
import { salvarRegraSeguradora } from "./actions";

export const dynamic = "force-dynamic";

// ERP O2 — Fase 1a: cadastro da regra de pagamento de comissão por seguradora
// (esgotamento × proporcional, limite de parcelas, prazo de pagamento, dia fixo).
// A previsão de comissão de cada parcela é recalculada a partir daqui.

type Seg = {
  id: string;
  nome: string;
  abreviacao: string;
  regra_comissao: "proporcional" | "esgotamento";
  esgotamento_ate_parcelas: number | null;
  prazo_pagamento_dias: number;
  dia_fixo_parcela: number | null;
  canal_demonstrativo: string | null;
  regra_confirmada_em: string | null;
  regra_observacao: string | null;
  docs: number;
};

const inputClass = "rounded-lg border border-gray-300 px-2 py-1 text-xs focus:border-o2-coral focus:outline-none";

export default async function ErpSeguradorasPage({ searchParams }: { searchParams: Promise<{ erro?: string; sucesso?: string }> }) {
  const { erro, sucesso } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const [{ data: segs, error }, { data: contagem }] = await Promise.all([
    supabase
      .from("erp_seguradoras")
      .select("id, nome, abreviacao, regra_comissao, esgotamento_ate_parcelas, prazo_pagamento_dias, dia_fixo_parcela, canal_demonstrativo, regra_confirmada_em, regra_observacao")
      .eq("ativa", true)
      .order("nome"),
    supabase.rpc("erp_docs_por_seguradora_2026"),
  ]);
  if (error) throw new Error(error.message);
  const docsPor = new Map<string, number>(((contagem ?? []) as { seguradora_id: string; docs: number }[]).map((c) => [c.seguradora_id, Number(c.docs)]));
  const linhas: Seg[] = ((segs ?? []) as Omit<Seg, "docs">[])
    .map((s) => ({ ...s, docs: docsPor.get(s.id) ?? 0 }))
    .sort((a, b) => b.docs - a.docs || a.nome.localeCompare(b.nome));

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-[1200px] flex-1 space-y-6 p-8">
        <PageHeader
          icon={<IconReport />}
          titulo="ERP O2 — Seguradoras: regra de comissão"
          subtitulo="Como cada seguradora paga a comissão da O2. Esgotamento = comissão inteira nas primeiras parcelas até zerar; proporcional = mesma fração em cada parcela. O repasse à imobiliária é sempre proporcional."
        />
        <p className="text-xs text-gray-500">
          <Link href="/erp/documentos" className="underline">← Documentos</Link> · Ordenado por volume de documentos em 2026. Marque “confirmada” depois de conferir no Corp (aba Comissões) ou no demonstrativo.
        </p>
        {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">Não salvou: {erro === "dados" ? "confira os números (limite 1–24, prazo 0–60, dia 1–28)." : erro}</p>}
        {sucesso && <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-700">Regra salva. A previsão das parcelas é refeita na próxima recalculação.</p>}

        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2">Seguradora</th>
                <th className="px-3 py-2 text-right">Docs 2026</th>
                <th className="px-3 py-2">Regra</th>
                <th className="px-3 py-2">Esgot. até (parc.)</th>
                <th className="px-3 py-2">Paga em (dias)</th>
                <th className="px-3 py-2">Dia fixo</th>
                <th className="px-3 py-2">Demonstrativo</th>
                <th className="px-3 py-2">Observação</th>
                <th className="px-3 py-2">Confirmada</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {linhas.map((s) => (
                <tr key={s.id} className="align-top">
                  <td className="px-3 py-2 font-medium">
                    {s.abreviacao} <span className="font-normal text-gray-500">{s.nome}</span>
                  </td>
                  <td className="px-3 py-2 text-right">{s.docs.toLocaleString("pt-BR")}</td>
                  <td className="px-3 py-2">
                    <select name="regra_comissao" form={`f-${s.id}`} defaultValue={s.regra_comissao} className={inputClass}>
                      <option value="proporcional">Proporcional</option>
                      <option value="esgotamento">Esgotamento</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input name="esgotamento_ate_parcelas" form={`f-${s.id}`} type="number" min={1} max={24} defaultValue={s.esgotamento_ate_parcelas ?? ""} placeholder="sempre" className={`${inputClass} w-20`} />
                  </td>
                  <td className="px-3 py-2">
                    <input name="prazo_pagamento_dias" form={`f-${s.id}`} type="number" min={0} max={60} defaultValue={s.prazo_pagamento_dias} className={`${inputClass} w-16`} />
                  </td>
                  <td className="px-3 py-2">
                    <input name="dia_fixo_parcela" form={`f-${s.id}`} type="number" min={1} max={28} defaultValue={s.dia_fixo_parcela ?? ""} placeholder="—" className={`${inputClass} w-16`} />
                  </td>
                  <td className="px-3 py-2 text-gray-500">{s.canal_demonstrativo ?? "—"}</td>
                  <td className="px-3 py-2">
                    <input name="regra_observacao" form={`f-${s.id}`} defaultValue={s.regra_observacao ?? ""} placeholder="ex.: conferido no doc 133210" className={`${inputClass} w-56`} />
                  </td>
                  <td className="px-3 py-2">
                    <label className="flex items-center gap-1">
                      <input name="regra_confirmada" form={`f-${s.id}`} type="checkbox" defaultChecked={!!s.regra_confirmada_em} />
                      <span className="text-gray-500">{s.regra_confirmada_em ? formatarData(s.regra_confirmada_em) : "não"}</span>
                    </label>
                  </td>
                  <td className="px-3 py-2">
                    <form id={`f-${s.id}`} action={salvarRegraSeguradora}>
                      <input type="hidden" name="id" value={s.id} />
                      <button type="submit" className="rounded-lg border border-o2-navy px-3 py-1 text-xs font-medium text-o2-navy hover:bg-o2-navy hover:text-white">
                        Salvar
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
