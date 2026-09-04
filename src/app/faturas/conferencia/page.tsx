import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../../actions";
import AppHeader from "@/components/AppHeader";
import {
  confirmarIdentificacao,
  tentarReabrirComSenha,
  reprocessarIdentificacao,
  resolverDuplicata,
  escolherOrigemFatura,
} from "./actions";
import SeletorImobiliaria from "./SeletorImobiliaria";
import FaturasSubHeader from "../FaturasSubHeader";
import { IconChecklist } from "../icons";
import { SubmitButton } from "../SubmitButton";
import { SEGURADORAS_CANONICAS } from "@/lib/faturasIdentificacao";

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
      .in("status", ["aguardando_identificacao", "aguardando_conferencia", "aguardando_origem", "duplicada"])
      .order("created_at", { ascending: false }),
    supabase.from("imobiliarias").select("id, nome").order("nome"),
  ]);
  const imobiliarias = imobiliariasData ?? [];
  const imobiliariasPorId = new Map(imobiliarias.map((i) => [i.id, i.nome]));

  // Pra quem está esperando escolher a origem, busca quais origens são
  // possíveis (vem do cadastro, não é uma lista fixa -- pode ser 2 ou 3).
  const pendentesOrigem = (pendentes ?? []).filter((f) => f.status === "aguardando_origem" && f.imobiliaria_id && f.seguradora);
  const origensPorChave = new Map<string, string[]>();
  if (pendentesOrigem.length) {
    const { data: esperadas } = await supabase
      .from("faturas_esperadas")
      .select("imobiliaria_id, seguradora, cnpj_o2")
      .in(
        "imobiliaria_id",
        pendentesOrigem.map((f) => f.imobiliaria_id as string)
      )
      .eq("ativo", true);
    for (const e of esperadas ?? []) {
      if (!e.cnpj_o2) continue;
      const chave = `${e.imobiliaria_id}|${e.seguradora}`;
      const lista = origensPorChave.get(chave) ?? [];
      lista.push(e.cnpj_o2);
      origensPorChave.set(chave, lista);
    }
  }

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-3xl flex-1 space-y-6 p-8">
        <FaturasSubHeader
          icon={<IconChecklist />}
          titulo="Conferência de faturas"
          subtitulo="Faturas que precisam de confirmação manual da imobiliária."
        />

        {ok && <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-700">{ok}</p>}
        {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

        <div className="space-y-3">
          {(pendentes ?? []).map((f) => {
            const arquivoNuncaAbriu = !f.texto_bruto_extraido;
            return (
              <div
                key={f.id}
                id={`fatura-${f.id}`}
                className="rounded-xl border border-o2-navy/10 bg-white p-4 shadow-sm target:ring-2 target:ring-o2-coral"
              >
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
                        <SubmitButton
                          className="rounded-full border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                          textoCarregando="Arquivando..."
                        >
                          É duplicata mesmo — arquivar
                        </SubmitButton>
                      </form>
                      <form action={resolverDuplicata}>
                        <input type="hidden" name="fatura_id" value={f.id} />
                        <input type="hidden" name="acao" value="substituir" />
                        <SubmitButton
                          className="rounded-full bg-o2-coral px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                          textoCarregando="Processando..."
                        >
                          Não é duplicata — processar essa e arquivar a antiga
                        </SubmitButton>
                      </form>
                    </div>
                  </>
                ) : f.status === "aguardando_origem" ? (
                  <>
                    <p className="mb-2 rounded-lg border border-blue-200 bg-blue-50 p-2 text-xs text-blue-800">
                      {f.imobiliaria_id && imobiliariasPorId.get(f.imobiliaria_id)} tem mais de uma origem em{" "}
                      {f.seguradora} — essa fatura é de qual delas?
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {((f.imobiliaria_id && origensPorChave.get(`${f.imobiliaria_id}|${f.seguradora}`)) || []).map((origem: string) => (
                        <form key={origem} action={escolherOrigemFatura}>
                          <input type="hidden" name="fatura_id" value={f.id} />
                          <input type="hidden" name="origem" value={origem} />
                          <SubmitButton
                            className="rounded-full border border-o2-navy px-4 py-2 text-sm font-medium text-o2-navy transition hover:bg-o2-navy hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                            textoCarregando="Confirmando..."
                          >
                            {origem}
                          </SubmitButton>
                        </form>
                      ))}
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
                    <SubmitButton
                      className="rounded-full bg-o2-navy px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                      textoCarregando="Tentando..."
                    >
                      Tentar abrir
                    </SubmitButton>
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
                      <SubmitButton
                        className="text-xs font-medium text-o2-navy hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                        textoCarregando="Reprocessando..."
                      >
                        Reprocessar identificação (usa o texto já extraído, não baixa o arquivo de novo)
                      </SubmitButton>
                    </form>
                    {f.confianca === "baixa" && (
                      <p className="mb-2 rounded-lg border border-yellow-200 bg-yellow-50 p-2 text-xs text-yellow-800">
                        ⚠️ Mais de uma imobiliária parecida com o nome no documento — não pré-selecionamos
                        nenhuma, confira o texto extraído acima antes de escolher.
                      </p>
                    )}
                    <form action={confirmarIdentificacao} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="fatura_id" value={f.id} />
                    {!f.seguradora && (
                      <div>
                        <label className="mb-1 block text-xs text-gray-600 text-red-600">
                          Seguradora ⚠️ não identificada no documento
                        </label>
                        <select name="seguradora" required defaultValue="" className="rounded-lg border border-red-300 px-3 py-2 text-sm focus:border-o2-coral focus:outline-none">
                          <option value="" disabled>
                            Selecione...
                          </option>
                          {SEGURADORAS_CANONICAS.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="flex-1">
                      <label className="mb-1 block text-xs text-gray-600">
                        Imobiliária {f.confianca ? `(sugestão: confiança ${f.confianca})` : ""}
                      </label>
                      <SeletorImobiliaria
                        imobiliarias={imobiliarias}
                        defaultImobiliariaId={f.confianca === "baixa" ? null : f.imobiliaria_id}
                        listId={`imob-lista-${f.id}`}
                      />
                    </div>
                    <SubmitButton
                      className="rounded-full bg-o2-coral px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                      textoCarregando="Confirmando..."
                    >
                      Confirmar
                    </SubmitButton>
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
