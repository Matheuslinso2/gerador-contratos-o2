import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../../actions";
import AppHeader from "@/components/AppHeader";
import BackLink from "@/components/BackLink";
import { listarPlanilhasDasPastas, idsDePastasDoEnv, lerCabecalhoEAmostra } from "@/lib/googleSheetsProspeccao";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Página temporária, só para descobrir a estrutura real das planilhas do
// Google Drive (nomes de arquivo + colunas) antes de escrever a lógica de
// cruzamento da Fase 3. Remover depois que a Fase 3 estiver pronta.
async function diagnosticarPasta(rotulo: string, folderIdsEnv: string | undefined) {
  const folderIds = idsDePastasDoEnv(folderIdsEnv);
  if (!folderIds.length) {
    return { rotulo, erro: `Variável de ambiente da pasta de ${rotulo} não configurada.` };
  }
  try {
    const planilhas = await listarPlanilhasDasPastas(folderIds);
    if (!planilhas.length) {
      return { rotulo, erro: "Nenhuma planilha encontrada nessa pasta (verifique o compartilhamento com a conta de serviço)." };
    }
    const { aba, cabecalho, amostra } = await lerCabecalhoEAmostra(planilhas[0].id);
    return { rotulo, planilhas, aba, cabecalho, amostra };
  } catch (e) {
    return { rotulo, erro: e instanceof Error ? e.message : "Erro desconhecido." };
  }
}

export default async function DiagnosticoProspeccaoPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const [incendio, fianca] = await Promise.all([
    diagnosticarPasta("incêndio", process.env.GOOGLE_FOLDER_ID_INCENDIO),
    diagnosticarPasta("fiança", process.env.GOOGLE_FOLDER_ID_FIANCA),
  ]);

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-3xl flex-1 space-y-8 p-8">
        <div className="space-y-2">
          <BackLink />
          <h1 className="text-xl font-semibold text-o2-navy">Diagnóstico das planilhas (temporário)</h1>
          <p className="text-sm text-gray-500">
            Página de uso único, para eu conferir a estrutura real das planilhas antes de escrever a
            lógica de cruzamento. Vai ser removida depois.
          </p>
        </div>

        {[incendio, fianca].map((r) => (
          <section key={r.rotulo} className="space-y-2 rounded-xl border border-o2-navy/10 bg-white p-4">
            <h2 className="text-lg font-semibold text-o2-navy capitalize">{r.rotulo}</h2>
            {r.erro ? (
              <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{r.erro}</p>
            ) : (
              <>
                <p className="text-sm text-gray-600">
                  {r.planilhas!.length} planilha(s) encontrada(s) na pasta. Mostrando a mais recente:{" "}
                  <strong>{r.planilhas![0].nome}</strong> (aba &quot;{r.aba}&quot;)
                </p>
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        {r.cabecalho!.map((col, i) => (
                          <th key={i} className="border-b border-gray-200 p-2 font-medium text-gray-700">
                            {col || `(coluna ${i + 1} vazia)`}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {r.amostra!.map((linha, i) => (
                        <tr key={i}>
                          {r.cabecalho!.map((_, j) => (
                            <td key={j} className="border-b border-gray-100 p-2 text-gray-600">
                              {linha[j] ?? ""}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-gray-500">
                  Todas as planilhas encontradas: {r.planilhas!.map((p) => p.nome).join(", ")}
                </p>
              </>
            )}
          </section>
        ))}
      </main>
    </>
  );
}
