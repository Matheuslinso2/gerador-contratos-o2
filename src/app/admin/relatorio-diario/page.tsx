import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isEquipe, isMatheus } from "@/lib/admin";
import { signOut } from "../../actions";
import AppHeader from "@/components/AppHeader";
import BackLink from "@/components/BackLink";
import { montarRelatorioDiario, textoRelatorio, MODELO_WHATSAPP } from "@/lib/relatorioDiario/montar";
import { enviarTesteWhatsApp } from "./actions";

export const dynamic = "force-dynamic";

// Prévia do relatório diário do WhatsApp -- mostra exatamente o texto que
// vai sair (lido dos retratos salvos dos painéis), pra conferir antes
// de ligar o envio. `?data=YYYY-MM-DD` simula o relatório que sairia nesse
// dia (ex: uma segunda, pra ver o "sexta a domingo").
export default async function RelatorioDiarioPage({ searchParams }: { searchParams: Promise<{ data?: string; envio?: string; msg?: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isEquipe(user?.email)) redirect("/");

  const { data, envio, msg } = await searchParams;
  const agora = data && /^\d{4}-\d{2}-\d{2}$/.test(data) ? new Date(`${data}T08:00:00-03:00`) : new Date();

  const relatorio = await montarRelatorioDiario(agora);

  const falhas = (
    [
      ["Seguro Fiança", relatorio.fianca],
      ["Capitalização", relatorio.capitalizacao],
      ["Seguro Auto", relatorio.auto],
      ["Ramos Elementares", relatorio.ramos],
    ] as const
  ).filter(([, s]) => !s.ok);

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-3xl flex-1 space-y-6 p-8">
        <div className="space-y-2">
          <BackLink />
          <div>
            <h1 className="text-xl font-semibold text-o2-navy">Relatório diário (WhatsApp) — prévia</h1>
            <p className="text-sm text-gray-500">
              Cópia do que os painéis do Workspace salvaram (não consulta o Bitrix). Período: {relatorio.periodo.rotulo} · mês{" "}
              {relatorio.periodo.competenciaMes}.
            </p>
          </div>
        </div>

        <div className="max-w-md rounded-xl bg-[#d9fdd3] p-4 shadow-sm">
          <pre className="whitespace-pre-wrap font-sans text-sm text-gray-900">{textoRelatorio(relatorio)}</pre>
        </div>

        {isMatheus(user?.email) && (
          <div className="space-y-3 rounded-xl border border-o2-navy/10 bg-quadro p-4 text-sm">
            <form action={enviarTesteWhatsApp}>
              <button type="submit" className="rounded-lg bg-o2-navy px-4 py-2 font-medium text-white hover:opacity-90">
                Enviar teste para o meu WhatsApp
              </button>
            </form>
            {envio === "ok" && <p className="text-green-700">Enviado! Confira o WhatsApp (vem do número +1 555 180-0364).</p>}
            {envio === "erro" && <p className="text-red-700">Falhou: {msg}</p>}
            <details>
              <summary className="cursor-pointer text-gray-600">
                Texto do modelo pra cadastrar na Meta (nome: <code>{MODELO_WHATSAPP.nome}</code>, idioma Português (BR))
              </summary>
              <pre className="mt-2 whitespace-pre-wrap rounded bg-white p-3 font-mono text-xs text-gray-800">{MODELO_WHATSAPP.corpo}</pre>
            </details>
          </div>
        )}

        {falhas.length > 0 && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {falhas.map(([nome, s]) => (
              <p key={nome}>
                <strong>{nome}:</strong> {!s.ok && s.erro}
              </p>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
