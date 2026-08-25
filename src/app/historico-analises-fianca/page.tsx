import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../actions";
import AppHeader from "@/components/AppHeader";
import BackLink from "@/components/BackLink";
import type { AnaliseFianca } from "@/lib/assistenteFianca";

export const dynamic = "force-dynamic";

type LinhaAnalise = {
  id: string;
  criado_por: string;
  resultado: AnaliseFianca;
  feedback_precisao: number | null;
  feedback_utilidade: number | null;
  feedback_comentario: string | null;
  created_at: string;
};

function Estrelas({ valor }: { valor: number | null }) {
  if (!valor) return <span className="text-xs text-gray-400">sem avaliação</span>;
  return (
    <span className="text-o2-coral" title={`${valor}/5`}>
      {"★".repeat(valor)}
      <span className="text-gray-300">{"★".repeat(5 - valor)}</span>
    </span>
  );
}

export default async function HistoricoAnalisesFiancaPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const { data } = await supabase
    .from("assistente_fianca_analises")
    .select("id, criado_por, resultado, feedback_precisao, feedback_utilidade, feedback_comentario, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  const linhas = (data ?? []) as LinhaAnalise[];

  const comPrecisao = linhas.filter((l) => l.feedback_precisao != null);
  const comUtilidade = linhas.filter((l) => l.feedback_utilidade != null);
  const mediaPrecisao = comPrecisao.length
    ? comPrecisao.reduce((soma, l) => soma + (l.feedback_precisao ?? 0), 0) / comPrecisao.length
    : null;
  const mediaUtilidade = comUtilidade.length
    ? comUtilidade.reduce((soma, l) => soma + (l.feedback_utilidade ?? 0), 0) / comUtilidade.length
    : null;
  const totalComFeedback = new Set([...comPrecisao, ...comUtilidade].map((l) => l.id)).size;

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-4xl flex-1 space-y-4 p-8">
        <div className="space-y-2">
          <BackLink />
          <div>
            <h1 className="text-xl font-semibold text-o2-navy">Histórico de análises — Assistente de Vendas Fiança</h1>
            <p className="text-sm text-gray-500">Resumo curto de cada caso analisado, com o feedback do negociador.</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-4 rounded-xl border border-o2-navy/10 bg-white p-4 shadow-sm">
          <div>
            <p className="text-xs text-gray-500">Precisão média</p>
            <p className="text-lg font-semibold text-o2-navy">
              {mediaPrecisao != null ? `${Math.round((mediaPrecisao / 5) * 100)}%` : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Utilidade média</p>
            <p className="text-lg font-semibold text-o2-navy">
              {mediaUtilidade != null ? `${Math.round((mediaUtilidade / 5) * 100)}%` : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Avaliações recebidas</p>
            <p className="text-lg font-semibold text-o2-navy">
              {totalComFeedback} de {linhas.length}
            </p>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-o2-navy/10 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-o2-gray/30 text-xs text-gray-500">
                <th className="px-3 py-2 font-medium">Data</th>
                <th className="px-3 py-2 font-medium">Pacote (aluguel + encargos)</th>
                <th className="px-3 py-2 font-medium">Menor taxa</th>
                <th className="px-3 py-2 font-medium">Precisão</th>
                <th className="px-3 py-2 font-medium">Utilidade</th>
                <th className="px-3 py-2 font-medium">Negociador</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.id} className="border-b border-gray-50 align-top last:border-0">
                  <td className="px-3 py-2 whitespace-nowrap text-gray-600">
                    {new Date(l.created_at).toLocaleDateString("pt-BR")}
                  </td>
                  <td className="px-3 py-2 text-gray-800">{l.resultado?.pacote_locacao ?? "—"}</td>
                  <td className="px-3 py-2 font-medium text-gray-800">{l.resultado?.opcoes?.[0]?.taxa ?? "—"}</td>
                  <td className="px-3 py-2">
                    <Estrelas valor={l.feedback_precisao} />
                  </td>
                  <td className="px-3 py-2">
                    <Estrelas valor={l.feedback_utilidade} />
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">{l.criado_por}</td>
                </tr>
              ))}

              {!linhas.length && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-sm text-gray-500">
                    Nenhuma análise registrada ainda.
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
