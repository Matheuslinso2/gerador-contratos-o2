import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../actions";
import AppHeader from "@/components/AppHeader";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ROTULO_STATUS: Record<string, string> = {
  aguardando_upload: "Aguardando upload",
  fatura_carregada: "Carregada",
  aguardando_identificacao: "Aguardando identificação",
  aguardando_conferencia: "Aguardando conferência",
  pronta_para_envio: "Pronta para envio",
  enviada: "Enviada",
  erro_no_envio: "Erro no envio",
  duplicada: "Duplicada",
  cancelada: "Cancelada",
};

const COR_STATUS: Record<string, string> = {
  aguardando_upload: "bg-gray-100 text-gray-700",
  fatura_carregada: "bg-blue-100 text-blue-700",
  aguardando_identificacao: "bg-yellow-100 text-yellow-800",
  aguardando_conferencia: "bg-yellow-100 text-yellow-800",
  pronta_para_envio: "bg-green-100 text-green-700",
  enviada: "bg-green-100 text-green-700",
  erro_no_envio: "bg-red-100 text-red-700",
  duplicada: "bg-red-100 text-red-700",
  cancelada: "bg-gray-100 text-gray-500",
};

export default async function FaturasPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; aviso?: string; erro?: string }>;
}) {
  const { ok, aviso, erro } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const { data: faturas } = await supabase
    .from("faturas")
    .select("id, competencia, arquivo_nome, seguradora, valor, vencimento, status, confianca, imobiliarias(nome)")
    .order("created_at", { ascending: false })
    .limit(100);

  const pendentes = (faturas ?? []).filter(
    (f) => f.status === "aguardando_identificacao" || f.status === "aguardando_conferencia"
  ).length;

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-4xl flex-1 space-y-6 p-8">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-o2-navy">Faturas mensais</h1>
            <p className="text-sm text-gray-500">
              Boletos de seguradora recebidos para reenvio às imobiliárias — uso interno O2.
            </p>
          </div>
          <div className="flex gap-2">
            {pendentes > 0 && (
              <Link
                href="/faturas/conferencia"
                className="whitespace-nowrap rounded-full border border-o2-navy px-4 py-1.5 text-sm font-medium text-o2-navy transition hover:bg-o2-navy hover:text-white"
              >
                Conferência ({pendentes})
              </Link>
            )}
            <Link
              href="/faturas/upload"
              className="whitespace-nowrap rounded-full bg-o2-coral px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
            >
              Enviar fatura
            </Link>
          </div>
        </div>

        {ok && <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-700">{ok}</p>}
        {aviso && (
          <p className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">{aviso}</p>
        )}
        {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

        <div className="overflow-x-auto rounded-xl border border-o2-navy/10 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-500">
                <th className="px-4 py-2 font-medium">Imobiliária</th>
                <th className="px-4 py-2 font-medium">Competência</th>
                <th className="px-4 py-2 font-medium">Seguradora</th>
                <th className="px-4 py-2 font-medium">Valor</th>
                <th className="px-4 py-2 font-medium">Vencimento</th>
                <th className="px-4 py-2 font-medium">Situação</th>
              </tr>
            </thead>
            <tbody>
              {(faturas ?? []).map((f) => {
                const imob = Array.isArray(f.imobiliarias) ? f.imobiliarias[0] : f.imobiliarias;
                return (
                  <tr key={f.id} className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-2.5 text-gray-800">{imob?.nome ?? "—"}</td>
                    <td className="px-4 py-2.5 text-gray-800">{f.competencia}</td>
                    <td className="px-4 py-2.5 text-gray-800">{f.seguradora ?? "—"}</td>
                    <td className="px-4 py-2.5 text-gray-800">
                      {f.valor != null ? f.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-gray-800">
                      {f.vencimento ? new Date(f.vencimento + "T00:00:00").toLocaleDateString("pt-BR") : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${COR_STATUS[f.status] ?? "bg-gray-100 text-gray-700"}`}>
                        {ROTULO_STATUS[f.status] ?? f.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {!faturas?.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500">
                    Nenhuma fatura enviada ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
