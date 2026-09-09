import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../../../actions";
import AppHeader from "@/components/AppHeader";
import { confirmarEnvioRepasse } from "../actions";
import { valoresBatem } from "@/lib/repassesIdentificacao";
import FaturasSubHeader from "../../../faturas/FaturasSubHeader";
import { IconSend } from "../../../faturas/icons";
import { SubmitButton } from "../../../faturas/SubmitButton";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const EMAIL_MODO_TESTE = "matheus@o2seguros.com.br";

type RepassePronto = {
  id: string;
  arquivo_nome: string;
  tipo_documento: string | null;
  valor: number | null;
};

function formatarValor(valor: number | null): string {
  if (valor === null) return "—";
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default async function ConfirmarEnvioRepassePage({
  searchParams,
}: {
  searchParams: Promise<{
    competencia?: string;
    imob?: string | string[];
    erro?: string;
    modo_teste?: string;
  }>;
}) {
  const { competencia, imob, erro, modo_teste } = await searchParams;
  const modoTeste = modo_teste === "1";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const imobiliariaIds = Array.isArray(imob) ? imob : imob ? [imob] : [];
  if (!competencia || !imobiliariaIds.length) redirect("/repasses");

  const [{ data: imobiliariasData }, { data: repassesData }] = await Promise.all([
    supabase.from("imobiliarias").select("id, nome, email_repasses").in("id", imobiliariaIds),
    supabase
      .from("repasses")
      .select("id, imobiliaria_id, arquivo_nome, tipo_documento, valor, status")
      .eq("competencia", competencia)
      .in("imobiliaria_id", imobiliariaIds)
      .eq("status", "identificado"),
  ]);

  const imobiliarias = imobiliariasData ?? [];
  const repassesPorImobiliaria = new Map<string, RepassePronto[]>();
  for (const r of repassesData ?? []) {
    if (!r.imobiliaria_id) continue;
    const lista = repassesPorImobiliaria.get(r.imobiliaria_id) ?? [];
    lista.push(r);
    repassesPorImobiliaria.set(r.imobiliaria_id, lista);
  }

  // Só entra na prévia quem tem e-mail cadastrado E o par completo
  // (1 relatório + 1 comprovante) com valores batendo -- mesma checagem
  // reconferida em confirmarEnvioRepasse antes de disparar de verdade.
  const prontas = imobiliarias.filter((i) => {
    if (!(i.email_repasses?.length ?? 0)) return false;
    const arquivos = repassesPorImobiliaria.get(i.id) ?? [];
    const relatorio = arquivos.find((a) => a.tipo_documento === "relatorio");
    const comprovante = arquivos.find((a) => a.tipo_documento === "comprovante");
    return !!relatorio && !!comprovante && valoresBatem(relatorio.valor, comprovante.valor);
  });

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-2xl flex-1 space-y-6 p-8">
        <FaturasSubHeader
          icon={<IconSend />}
          titulo="Confirmar envio de repasse"
          subtitulo={`Revise antes de enviar: ${prontas.length} e-mail(s) serão disparados agora, cada um pra 1 imobiliária.`}
          voltarHref={`/repasses?competencia=${competencia}`}
          voltarTexto="Voltar para Repasses"
        />

        {modoTeste && (
          <div className="flex items-start gap-3 rounded-xl border-2 border-o2-coral bg-orange-50 p-4">
            <span className="text-xl">🧪</span>
            <div>
              <p className="text-sm font-semibold text-o2-navy">Modo teste ativo</p>
              <p className="text-sm text-gray-700">
                Nenhum dos e-mails reais listados abaixo vai receber nada. Todos os {prontas.length} e-mail(s) vão
                pra <strong>{EMAIL_MODO_TESTE}</strong> (o seu), com o conteúdo/anexos reais de cada imobiliária.
              </p>
            </div>
          </div>
        )}

        {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">⚠️ {erro}</p>}

        {!prontas.length && (
          <p className="rounded-xl border border-o2-navy/10 bg-white p-6 text-center text-sm text-gray-500 shadow-sm">
            Nenhuma das selecionadas está pronta pra envio agora (verifique e-mail de repasse cadastrado, par
            relatório+comprovante completo e valores batendo).
          </p>
        )}

        <div className="space-y-3">
          {prontas.map((i) => {
            const arquivos = repassesPorImobiliaria.get(i.id) ?? [];
            const relatorio = arquivos.find((a) => a.tipo_documento === "relatorio");
            const paramModoTeste = modoTeste ? "&modo_teste=1" : "";
            const hrefSemEsta = `/repasses/enviar/confirmar?competencia=${competencia}${paramModoTeste}${prontas
              .filter((p) => p.id !== i.id)
              .map((p) => `&imob=${p.id}`)
              .join("")}`;
            return (
              <div key={i.id} className="rounded-xl border border-o2-navy/10 bg-white p-4 shadow-sm">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold leading-snug text-o2-navy">{i.nome}</p>
                  <Link
                    href={hrefSemEsta}
                    className="shrink-0 whitespace-nowrap text-xs font-medium text-gray-400 hover:text-red-600 hover:underline"
                  >
                    Remover da leva
                  </Link>
                </div>
                {modoTeste ? (
                  <p className="mb-2 text-xs text-gray-500">
                    <span className="line-through decoration-gray-400">{i.email_repasses?.join(", ")}</span>
                    {" → vai pra "}
                    <span className="font-medium text-o2-coral">{EMAIL_MODO_TESTE}</span>
                  </p>
                ) : (
                  <p className="mb-2 break-all text-xs text-gray-500">{i.email_repasses?.join(", ")}</p>
                )}
                <p className="mb-1 text-xs text-gray-500">Valor líquido {formatarValor(relatorio?.valor ?? null)}</p>
                <ul className="text-xs text-gray-600">
                  {arquivos.map((a) => (
                    <li key={a.id}>
                      📎 {a.arquivo_nome}
                      {a.tipo_documento ? ` (${a.tipo_documento})` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        {prontas.length > 0 && (
          <form action={confirmarEnvioRepasse} className="flex justify-end">
            <input type="hidden" name="competencia" value={competencia} />
            {modoTeste && <input type="hidden" name="modo_teste" value="1" />}
            {prontas.map((i) => (
              <input key={i.id} type="hidden" name="imob" value={i.id} />
            ))}
            <SubmitButton
              className="rounded-full bg-o2-coral px-6 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              textoCarregando="Enviando..."
            >
              {modoTeste
                ? `Confirmar e enviar ${prontas.length} e-mail(s) de teste`
                : `Confirmar e enviar ${prontas.length} e-mail(s)`}
            </SubmitButton>
          </form>
        )}
      </main>
    </>
  );
}
