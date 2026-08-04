import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../../actions";
import AppHeader from "@/components/AppHeader";
import { confirmarIdentificacao, tentarReabrirComSenha } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-o2-coral focus:outline-none";

export default async function ConferenciaFaturasPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; erro?: string }>;
}) {
  const { ok, erro } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const [{ data: pendentes }, { data: imobiliariasData }] = await Promise.all([
    supabase
      .from("faturas")
      .select("id, competencia, arquivo_nome, seguradora, valor, texto_bruto_extraido, confianca, imobiliaria_id")
      .in("status", ["aguardando_identificacao", "aguardando_conferencia"])
      .order("created_at", { ascending: false }),
    supabase.from("imobiliarias").select("id, nome").order("nome"),
  ]);
  const imobiliarias = imobiliariasData ?? [];

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-3xl flex-1 space-y-6 p-8">
        <div className="space-y-1">
          <Link
            href="/faturas"
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-o2-navy hover:underline"
          >
            ← Voltar para Faturas
          </Link>
          <h1 className="text-xl font-semibold text-o2-navy">Conferência de faturas</h1>
          <p className="text-sm text-gray-500">
            Faturas que precisam de confirmação manual da imobiliária.
          </p>
        </div>

        {ok && <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-700">{ok}</p>}
        {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

        <div className="space-y-3">
          {(pendentes ?? []).map((f) => {
            const arquivoNuncaAbriu = !f.texto_bruto_extraido;
            return (
              <div key={f.id} className="rounded-xl border border-o2-navy/10 bg-white p-4 shadow-sm">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium text-o2-navy">{f.arquivo_nome}</p>
                  <span className="text-xs text-gray-500">Competência: {f.competencia}</span>
                </div>
                {f.seguradora && <p className="mb-2 text-xs text-gray-500">Seguradora: {f.seguradora}</p>}

                {arquivoNuncaAbriu ? (
                  <form action={tentarReabrirComSenha} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="fatura_id" value={f.id} />
                    <div className="flex-1">
                      <label className="mb-1 block text-xs text-gray-600">
                        Não conseguimos abrir esse arquivo com os CNPJs da O2 — informe a senha manualmente
                      </label>
                      <input name="senha" placeholder="Senha do PDF" className={inputClass} />
                    </div>
                    <button
                      type="submit"
                      className="rounded-full bg-o2-navy px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
                    >
                      Tentar abrir
                    </button>
                  </form>
                ) : (
                  <form action={confirmarIdentificacao} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="fatura_id" value={f.id} />
                    <div className="flex-1">
                      <label className="mb-1 block text-xs text-gray-600">
                        Imobiliária {f.confianca ? `(sugestão: confiança ${f.confianca})` : ""}
                      </label>
                      <select name="imobiliaria_id" defaultValue={f.imobiliaria_id ?? ""} className={inputClass}>
                        <option value="">Selecione...</option>
                        {imobiliarias.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.nome}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      type="submit"
                      className="rounded-full bg-o2-coral px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
                    >
                      Confirmar
                    </button>
                  </form>
                )}
              </div>
            );
          })}

          {!pendentes?.length && (
            <p className="rounded-xl border border-o2-navy/10 bg-white p-6 text-center text-sm text-gray-500 shadow-sm">
              Nada pendente de conferência.
            </p>
          )}
        </div>
      </main>
    </>
  );
}
