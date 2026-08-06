import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../../../actions";
import AppHeader from "@/components/AppHeader";
import { confirmarEnvio } from "../actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STATUS_PRONTO_PARA_ENVIO = ["fatura_carregada", "pronta_para_envio"];

type FaturaPronta = {
  id: string;
  arquivo_nome: string;
  tipo_documento: string | null;
  vencimento: string | null;
  valor: number | null;
  senha_pdf: string | null;
};

function formatarValor(valor: number | null): string {
  if (valor === null) return "—";
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Prévia obrigatória antes de qualquer envio de verdade -- mostra
// destinatário e os arquivos exatos que vão junto, pra nunca disparar um
// e-mail real pra imobiliária sem revisar antes.
export default async function ConfirmarEnvioPage({
  searchParams,
}: {
  searchParams: Promise<{ seguradora?: string; competencia?: string; imob?: string | string[]; erro?: string }>;
}) {
  const { seguradora, competencia, imob, erro } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const imobiliariaIds = Array.isArray(imob) ? imob : imob ? [imob] : [];
  if (!seguradora || !competencia || !imobiliariaIds.length) redirect("/faturas");

  const [{ data: imobiliariasData }, { data: faturasData }] = await Promise.all([
    supabase.from("imobiliarias").select("id, nome, email_faturas").in("id", imobiliariaIds),
    supabase
      .from("faturas")
      .select("id, imobiliaria_id, arquivo_nome, tipo_documento, vencimento, valor, status, senha_pdf")
      .eq("seguradora", seguradora)
      .eq("competencia", competencia)
      .in("imobiliaria_id", imobiliariaIds)
      .in("status", STATUS_PRONTO_PARA_ENVIO),
  ]);

  const imobiliarias = imobiliariasData ?? [];
  const faturasPorImobiliaria = new Map<string, FaturaPronta[]>();
  for (const f of faturasData ?? []) {
    if (!f.imobiliaria_id) continue;
    const lista = faturasPorImobiliaria.get(f.imobiliaria_id) ?? [];
    lista.push(f);
    faturasPorImobiliaria.set(f.imobiliaria_id, lista);
  }

  // Só entra na prévia quem realmente tem e-mail + pelo menos 1 arquivo
  // pronto -- se algo mudou entre a tela anterior e agora (ex: alguém já
  // editou), essa imobiliária simplesmente não aparece aqui.
  const prontas = imobiliarias.filter((i) => i.email_faturas && (faturasPorImobiliaria.get(i.id)?.length ?? 0) > 0);

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-2xl flex-1 space-y-6 p-8">
        <div className="space-y-1">
          <Link
            href={`/faturas?seguradora=${encodeURIComponent(seguradora)}&competencia=${competencia}`}
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-o2-navy hover:underline"
          >
            ← Voltar para Faturas
          </Link>
          <h1 className="text-xl font-semibold text-o2-navy">Confirmar envio — {seguradora}</h1>
          <p className="text-sm text-gray-500">
            Revise antes de enviar: {prontas.length} e-mail(s) serão disparados agora, cada um pra 1 imobiliária.
          </p>
        </div>

        {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">⚠️ {erro}</p>}

        {!prontas.length && (
          <p className="rounded-xl border border-o2-navy/10 bg-white p-6 text-center text-sm text-gray-500 shadow-sm">
            Nenhuma das selecionadas está pronta pra envio agora (verifique e-mail cadastrado e status).
          </p>
        )}

        <div className="space-y-3">
          {prontas.map((i) => {
            const arquivos = faturasPorImobiliaria.get(i.id) ?? [];
            const referencia = arquivos.find((a) => a.tipo_documento === "boleto") ?? arquivos[0];
            const senha = arquivos.map((a) => a.senha_pdf).find(Boolean) ?? null;
            return (
              <div key={i.id} className="rounded-xl border border-o2-navy/10 bg-white p-4 shadow-sm">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-semibold text-o2-navy">{i.nome}</p>
                  <p className="text-xs text-gray-500">{i.email_faturas}</p>
                </div>
                <p className="mb-1 text-xs text-gray-500">
                  Vencimento {referencia?.vencimento ?? "—"} · {formatarValor(referencia?.valor ?? null)}
                </p>
                {senha && (
                  <p className="mb-1 text-xs font-medium text-o2-coral">Senha do PDF que vai no e-mail: {senha}</p>
                )}
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
          <form action={confirmarEnvio} className="flex justify-end">
            <input type="hidden" name="seguradora" value={seguradora} />
            <input type="hidden" name="competencia" value={competencia} />
            {prontas.map((i) => (
              <input key={i.id} type="hidden" name="imob" value={i.id} />
            ))}
            <button
              type="submit"
              className="rounded-full bg-o2-coral px-6 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
            >
              Confirmar e enviar {prontas.length} e-mail(s)
            </button>
          </form>
        )}
      </main>
    </>
  );
}
