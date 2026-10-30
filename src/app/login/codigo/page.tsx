import Image from "next/image";
import Link from "next/link";
import { enviarCodigo, confirmarCodigo } from "../actions";
import SubmitButton from "@/components/SubmitButton";

// Login por código de 6 números enviado por e-mail (ver login/actions.ts).
// Passo 1: e-mail. Passo 2 (?enviado=1): o código.
export default async function LoginCodigoPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; enviado?: string }>;
}) {
  const { erro, enviado } = await searchParams;

  return (
    <main className="mx-auto flex max-w-sm flex-1 flex-col justify-center gap-5 p-8">
      <div className="flex justify-center">
        <Image src="/marca-o2/o2-logo-oficial.png" alt="O2 Seguros" width={140} height={77} priority />
      </div>
      <h1 className="text-center text-xl font-semibold text-o2-navy">Entrar com código por e-mail</h1>

      {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">⚠️ {erro}</p>}

      {enviado ? (
        <>
          <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-700">
            ✅ Se o e-mail tiver cadastro, enviamos um código de 6 números. Confira também a caixa de spam.
          </p>
          <form action={confirmarCodigo} className="space-y-3">
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
            <SubmitButton
              textoCarregando="Entrando…"
              className="w-full rounded-full bg-o2-coral px-4 py-2.5 font-medium text-white transition hover:opacity-90"
            >
              Entrar
            </SubmitButton>
          </form>
          <p className="text-center text-sm text-gray-600">
            Não chegou?{" "}
            <Link href="/login/codigo" className="font-medium text-o2-navy underline">
              Pedir outro código
            </Link>
          </p>
        </>
      ) : (
        <form action={enviarCodigo} className="space-y-3">
          <label htmlFor="email" className="sr-only">E-mail</label>
          <input
            id="email"
            name="email"
            type="email"
            placeholder="E-mail cadastrado"
            required
            autoFocus
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
          />
          <SubmitButton
            textoCarregando="Enviando…"
            className="w-full rounded-full bg-o2-coral px-4 py-2.5 font-medium text-white transition hover:opacity-90"
          >
            Enviar código
          </SubmitButton>
        </form>
      )}

      <p className="text-center text-sm text-gray-600">
        <Link href="/login" className="font-medium text-o2-navy underline">
          Voltar e entrar com senha
        </Link>
      </p>
    </main>
  );
}
