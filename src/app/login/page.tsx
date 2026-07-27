import Image from "next/image";
import Link from "next/link";
import { signIn } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; aviso?: string }>;
}) {
  const { erro, aviso } = await searchParams;

  return (
    <main className="mx-auto flex max-w-sm flex-1 flex-col justify-center gap-5 p-8">
      <div className="flex justify-center">
        <Image src="/o2-logo-color.png" alt="O2 Seguros" width={140} height={83} priority />
      </div>
      <h1 className="text-center text-xl font-semibold text-o2-navy">Entrar</h1>

      {erro && (
        <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>
      )}
      {aviso && (
        <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-700">{aviso}</p>
      )}

      <form action={signIn} className="space-y-3">
        <input
          name="email"
          type="email"
          placeholder="E-mail"
          required
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
        />
        <input
          name="password"
          type="password"
          placeholder="Senha"
          required
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
        />
        <button
          className="w-full rounded-full bg-o2-coral px-4 py-2.5 font-medium text-white transition hover:opacity-90"
          type="submit"
        >
          Entrar
        </button>
      </form>

      <p className="text-center text-sm text-gray-600">
        <Link href="/esqueci-senha" className="font-medium text-o2-navy underline">
          Esqueci minha senha
        </Link>
      </p>

      <p className="text-center text-sm text-gray-600">
        Ainda não tem conta?{" "}
        <Link href="/signup" className="font-medium text-o2-navy underline">
          Criar conta
        </Link>
      </p>
    </main>
  );
}
