import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../../actions";
import AppHeader from "@/components/AppHeader";
import { confirmarIdentificacao, tentarReabrirComSenha, reprocessarIdentificacao, resolverDuplicata } from "./actions";

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
      .select(
        "id, competencia, arquivo_nome, seguradora, valor, texto_bruto_extraido, confianca, imobiliaria_id, status, possivel_duplicidade_de"
      )
      .in("status", ["aguardando_identificacao", "aguardando_conferencia", "duplicada"])
      .order("created_at", { ascending: false }),
    supabase.from("imobiliarias").select("id, nome").order("nome"),
  ]);
  const imobiliarias = imobiliariasData ?? [];
  const imobiliariasPorId = new Map(imobiliarias.map((i) => [i.id, i.nome]));

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

                {f.status === "duplicada" ? (
                  <>
                    <p className="mb-2 rounded-lg border border-orange-200 bg-orange-50 p-2 text-xs text-orange-800">
                      Parece duplicata de uma fatura já carregada
                      {f.possivel_duplicidade_de && f.imobiliaria_id && imobiliariasPorId.get(f.imobiliaria_id)
                        ? ` de ${imobiliariasPorId.get(f.imobiliaria_id)}`
                        : ""}{" "}
                      nessa competência. Confira antes de decidir.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <form action={resolverDuplicata}>
                        <input type="hidden" name="fatura_id" value={f.id} />
                        <input type="hidden" name="acao" value="manter" />
                        <button
                          type="submit"
                          className="rounded-full border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                        >
                          É duplicata mesmo — arquivar
                        </button>
                      </form>
                      <form action={resolverDuplicata}>
                        <input type="hidden" name="fatura_id" value={f.id} />
                        <input type="hidden" name="acao" value="substituir" />
                        <button
                          type="submit"
                          className="rounded-full bg-o2-coral px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
                        >
                          Não é duplicata — processar essa e arquivar a antiga
                        </button>
                      </form>
                    </div>
                  </>
                ) : arquivoNuncaAbriu ? (
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
                  <>
                    <details className="mb-2">
                      <summary className="cursor-pointer text-xs text-gray-400">
                        Ver texto extraído (diagnóstico)
                      </summary>
                      <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-[11px] text-gray-600">
                        {f.texto_bruto_extraido?.slice(0, 4000)}
                      </pre>
                    </details>
                    <form action={reprocessarIdentificacao} className="mb-2">
                      <input type="hidden" name="fatura_id" value={f.id} />
                      <button type="submit" className="text-xs font-medium text-o2-navy hover:underline">
                        Reprocessar identificação (usa o texto já extraído, não baixa o arquivo de novo)
                      </button>
                    </form>
                    {f.confianca === "baixa" && (
                      <p className="mb-2 rounded-lg border border-yellow-200 bg-yellow-50 p-2 text-xs text-yellow-800">
                        ⚠️ Mais de uma imobiliária parecida com o nome no documento — não pré-selecionamos
                        nenhuma, confira o texto extraído acima antes de escolher.
                      </p>
                    )}
                    <form action={confirmarIdentificacao} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="fatura_id" value={f.id} />
                    <div className="flex-1">
                      <label className="mb-1 block text-xs text-gray-600">
                        Imobiliária {f.confianca ? `(sugestão: confiança ${f.confianca})` : ""}
                      </label>
                      <select
                        name="imobiliaria_id"
                        defaultValue={f.confianca === "baixa" ? "" : f.imobiliaria_id ?? ""}
                        className={inputClass}
                      >
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
                  </>
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
