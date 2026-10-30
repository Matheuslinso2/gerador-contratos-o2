import Image from "next/image";
import Link from "next/link";
import { signIn, entrarComGoogle } from "./actions";
import CampoSenha from "@/components/CampoSenha";
import SubmitButton from "@/components/SubmitButton";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; aviso?: string; next?: string }>;
}) {
  const { erro, aviso, next } = await searchParams;
  const campoNext = next ? <input type="hidden" name="next" value={next} /> : null;

  return (
    <main className="mx-auto flex max-w-sm flex-1 flex-col justify-center gap-5 p-8">
      <div className="flex justify-center">
        <Image src="/marca-o2/o2-logo-oficial.png" alt="O2 Seguros" width={140} height={77} priority />
      </div>
      <h1 className="text-center text-xl font-semibold text-o2-navy">Entrar</h1>

      {erro && (
        <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">⚠️ {erro}</p>
      )}
      {aviso && (
        <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-700">✅ {aviso}</p>
      )}

      <form action={signIn} className="space-y-3">
        {campoNext}
        <label htmlFor="email" className="sr-only">E-mail</label>
        <input
          id="email"
          name="email"
          type="email"
          placeholder="E-mail"
          required
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
        />
        <label htmlFor="password" className="sr-only">Senha</label>
        <CampoSenha id="password" name="password" placeholder="Senha" required autoComplete="current-password" />
        <SubmitButton
          textoCarregando="Entrando…"
          className="w-full rounded-full bg-o2-coral px-4 py-2.5 font-medium text-white transition hover:opacity-90"
        >
          Entrar
        </SubmitButton>
      </form>

      <p className="text-center text-sm text-gray-600">
        <Link href="/esqueci-senha" className="font-medium text-o2-navy underline">
          Esqueci minha senha
        </Link>
      </p>

      <div className="flex items-center gap-3 text-xs text-gray-400">
        <span className="h-px flex-1 bg-gray-200" />
        ou entre sem senha
        <span className="h-px flex-1 bg-gray-200" />
      </div>

      <form action={entrarComGoogle}>
        {campoNext}
        <SubmitButton
          textoCarregando="Abrindo o Google…"
          className="flex w-full items-center justify-center gap-2 rounded-full border border-gray-300 bg-white px-4 py-2.5 font-medium text-gray-700 transition hover:bg-gray-50"
        >
          <svg aria-hidden="true" viewBox="0 0 48 48" className="h-5 w-5">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
            <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
          </svg>
          Equipe O2: entrar com Google
        </SubmitButton>
      </form>

      <Link
        href={next ? `/login/codigo?next=${encodeURIComponent(next)}` : "/login/codigo"}
        className="block w-full rounded-full border border-gray-300 bg-white px-4 py-2.5 text-center font-medium text-gray-700 transition hover:bg-gray-50"
      >
        ✉️ Receber código por e-mail
      </Link>

      <p className="text-center text-sm text-gray-600">
        Ainda não tem conta?{" "}
        <Link href="/signup" className="font-medium text-o2-navy underline">
          Criar conta
        </Link>
      </p>
    </main>
  );
}
