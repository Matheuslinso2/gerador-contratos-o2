import Image from "next/image";
import Link from "next/link";
import { lerConvite } from "@/lib/convites";
import { pedirCodigoConvite, criarSenhaConvite } from "./actions";
import CampoSenha from "@/components/CampoSenha";
import SubmitButton from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

// Primeiro acesso por convite da O2 (ver lib/convites.ts): 1) pedir o código no e-mail do convite; 2) digitar o código e criar a senha.
export default async function ConvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ erro?: string; enviado?: string }>;
}) {
  const { token } = await params;
  const { erro, enviado } = await searchParams;
  const r = await lerConvite(token);

  const topo = (
    <div className="flex justify-center">
      <Image src="/marca-o2/o2-logo-oficial.png" alt="O2 Seguros" width={140} height={77} priority />
    </div>
  );

  if ("erro" in r) {
    return (
      <main className="mx-auto flex max-w-sm flex-1 flex-col justify-center gap-5 p-8">
        {topo}
        <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">⚠️ {r.erro}</p>
        <p className="text-center text-sm text-gray-600">
          <Link href="/login" className="font-medium text-o2-navy underline">Ir para o login</Link>
        </p>
      </main>
    );
  }

  const { convite } = r;
  const mostrarSenha = !!enviado || convite.codigoEnviado;
  const mascarado = convite.email.replace(/^(.).*(@.*)$/, "$1•••$2");

  return (
    <main className="mx-auto flex max-w-sm flex-1 flex-col justify-center gap-5 p-8">
      {topo}
      <div className="text-center">
        <h1 className="text-xl font-semibold text-o2-navy">Primeiro acesso</h1>
        <p className="mt-1 text-sm text-gray-600">{convite.imobiliariaNome}</p>
      </div>

      {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">⚠️ {erro}</p>}

      {mostrarSenha ? (
        <>
          <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-700">
            ✅ Enviamos um código de 6 números para {mascarado}. Confira também o spam.
          </p>
          <form action={criarSenhaConvite} className="space-y-3">
            <input type="hidden" name="token" value={token} />
            <label htmlFor="codigo" className="sr-only">Código</label>
            <input
              id="codigo"
              name="codigo"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]{6,8}"
              maxLength={8}
              placeholder="Código de 6 números"
              required
              autoFocus
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-center text-lg tracking-[0.4em] focus:border-o2-coral focus:outline-none"
            />
            <label htmlFor="senha" className="sr-only">Nova senha</label>
            <CampoSenha id="senha" name="senha" placeholder="Crie sua senha (mín. 8 caracteres)" required minLength={8} autoComplete="new-password" />
            <label htmlFor="confirmar" className="sr-only">Repita a senha</label>
            <CampoSenha id="confirmar" name="confirmar" placeholder="Repita a senha" required minLength={8} autoComplete="new-password" />
            <SubmitButton textoCarregando="Criando acesso…" className="w-full rounded-full bg-o2-coral px-4 py-2.5 font-medium text-white transition hover:opacity-90">
              Criar senha e entrar
            </SubmitButton>
          </form>
          <form action={pedirCodigoConvite} className="text-center text-sm text-gray-600">
            <input type="hidden" name="token" value={token} />
            Não chegou?{" "}
            <button type="submit" className="font-medium text-o2-navy underline">Enviar outro código</button>
          </form>
        </>
      ) : (
        <form action={pedirCodigoConvite} className="space-y-3">
          <input type="hidden" name="token" value={token} />
          <p className="text-sm text-gray-600">
            Para sua segurança, vamos enviar um código de 6 números para <strong>{mascarado}</strong>, o e-mail que recebeu o convite.
          </p>
          <SubmitButton textoCarregando="Enviando…" className="w-full rounded-full bg-o2-coral px-4 py-2.5 font-medium text-white transition hover:opacity-90">
            Enviar código
          </SubmitButton>
        </form>
      )}
    </main>
  );
}
