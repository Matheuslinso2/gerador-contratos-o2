import { validarTokenDescadastro } from "@/lib/campanhas/unsubscribeToken";
import { confirmarDescadastro } from "./actions";
import SubmitButton from "@/components/SubmitButton";
import { IconMail } from "@/components/icons";

// Pública, sem gate de auth (igual às landing pages) -- quem clica no
// rodapé de um e-mail de campanha não necessariamente tem login no
// Workspace. Ver src/lib/campanhas/unsubscribeToken.ts pro mecanismo do
// token e src/app/campanhas/descadastro/actions.ts pra por que o opt-out só
// acontece na confirmação, nunca neste GET.
export default async function DescadastroPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; token?: string; campanha_id?: string; ok?: string; erro?: string }>;
}) {
  const { email, token, campanha_id, ok, erro } = await searchParams;
  const valido = !!email && !!token && validarTokenDescadastro(email, token);

  return (
    <main className="flex min-h-screen items-center justify-center bg-o2-gray/40 p-6">
      <div className="w-full max-w-md rounded-2xl border border-o2-navy/10 bg-white p-8 text-center shadow-sm">
        <span className="mx-auto mb-4 inline-flex h-11 w-11 items-center justify-center rounded-full bg-o2-coral text-white shadow-sm">
          <IconMail />
        </span>
        <h1 className="mb-2 text-lg font-semibold text-o2-navy">Descadastro de campanhas</h1>

        {ok === "1" && email ? (
          <p className="text-sm text-gray-600">
            Pronto — <strong>{email}</strong> não vai mais receber e-mails de campanhas comerciais da O2 Seguros.
          </p>
        ) : erro === "1" || !valido ? (
          <p className="text-sm text-gray-600">
            Link inválido ou expirado. Se você não pediu esse descadastro, pode ignorar esta página.
          </p>
        ) : (
          <>
            <p className="mb-5 text-sm text-gray-600">
              Confirma que <strong>{email}</strong> não deve mais receber e-mails de campanhas comerciais da O2
              Seguros?
            </p>
            <form action={confirmarDescadastro}>
              <input type="hidden" name="email" value={email} />
              <input type="hidden" name="token" value={token} />
              {campanha_id && <input type="hidden" name="campanha_id" value={campanha_id} />}
              <SubmitButton
                className="rounded-full bg-o2-navy px-6 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
                textoCarregando="Confirmando..."
              >
                Confirmar descadastro
              </SubmitButton>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
