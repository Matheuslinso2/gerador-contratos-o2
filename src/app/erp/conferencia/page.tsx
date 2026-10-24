import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import { IconReport } from "@/components/icons";
import { formatarReais } from "@/lib/sinistros/regras";
import { signOut } from "../../actions";

export const dynamic = "force-dynamic";

// ERP O2 — Fase 0: conferência da carga contra o retrato do Power BI
// (view erp_conferencia_corp). Só as células que diferem; o resto bate.

type Linha = {
  mes: string;
  ramo: string | null;
  seg: string | null;
  corp_docs: number | null;
  erp_docs: number | null;
  corp_comissao: number | null;
  erp_comissao: number | null;
  dif_docs: number;
  dif_comissao: number;
};

export default async function ErpConferenciaPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const [{ data: todas }, { data: difs }] = await Promise.all([
    supabase.from("erp_conferencia_corp").select("mes", { count: "exact", head: true }),
    supabase.from("erp_conferencia_corp").select("*").or("dif_docs.neq.0,dif_comissao.gte.0.01,dif_comissao.lte.-0.01").order("mes", { ascending: false }),
  ]);
  const diferencas = (difs ?? []) as Linha[];
  void todas;

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-[1100px] flex-1 space-y-6 p-8">
        <PageHeader
          icon={<IconReport />}
          titulo="ERP O2 — Conferência com o Corp"
          subtitulo="Documentos e comissão por mês × ramo × seguradora: ERP contra o retrato congelado do Power BI. Só o que difere aparece."
        />
        <p className="text-sm text-gray-600">
          <Link href="/erp/documentos" className="underline">← Documentos</Link>. As diferenças abaixo são, em regra, alterações que o próprio Corp fez depois do fechamento do mês
          (cancelamentos e ajustes registrados em <code>corp_alteracoes_pos_fechamento</code>); contra a grade viva do Corp o ERP bate em todas as células.
        </p>
        {diferencas.length === 0 ? (
          <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-700">Nenhuma diferença.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2">Mês</th>
                  <th className="px-3 py-2">Ramo</th>
                  <th className="px-3 py-2">Seg.</th>
                  <th className="px-3 py-2 text-right">Docs Corp</th>
                  <th className="px-3 py-2 text-right">Docs ERP</th>
                  <th className="px-3 py-2 text-right">Dif.</th>
                  <th className="px-3 py-2 text-right">Comissão Corp</th>
                  <th className="px-3 py-2 text-right">Comissão ERP</th>
                  <th className="px-3 py-2 text-right">Dif.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {diferencas.map((l) => (
                  <tr key={`${l.mes}-${l.ramo}-${l.seg}`}>
                    <td className="px-3 py-1.5">{l.mes.slice(0, 7)}</td>
                    <td className="px-3 py-1.5">{l.ramo}</td>
                    <td className="px-3 py-1.5">{l.seg}</td>
                    <td className="px-3 py-1.5 text-right">{l.corp_docs ?? 0}</td>
                    <td className="px-3 py-1.5 text-right">{l.erp_docs ?? 0}</td>
                    <td className={`px-3 py-1.5 text-right ${l.dif_docs ? "font-semibold" : ""}`}>{l.dif_docs}</td>
                    <td className="px-3 py-1.5 text-right">{formatarReais(l.corp_comissao ?? 0)}</td>
                    <td className="px-3 py-1.5 text-right">{formatarReais(l.erp_comissao ?? 0)}</td>
                    <td className={`px-3 py-1.5 text-right ${Math.abs(l.dif_comissao) >= 0.01 ? "font-semibold" : ""}`}>{formatarReais(l.dif_comissao)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
