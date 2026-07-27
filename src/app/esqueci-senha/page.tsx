import Image from "next/image";
import Link from "next/link";
import { esqueciSenha } from "../login/actions";

export default async function EsqueciSenhaPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const { erro } = await searchParams;

  return (
    <main className="mx-auto flex max-w-sm flex-1 flex-col justify-center gap-5 p-8">
      <div className="flex justify-center">
        <Image src="/o2-logo-color.png" alt="O2 Seguros" width={140} height={83} priority />
      </div>
      <div className="text-center">
        <h1 className="text-xl font-semibold text-o2-navy">Esqueci minha senha</h1>
        <p className="mt-1 text-sm text-gray-600">
          Informe seu e-mail de cadastro e enviaremos um link para você criar uma nova senha.
        </p>
      </div>

      {erro && (
        <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>
      )}

      <form action={esqueciSenha} className="space-y-3">
        <input
          name="email"
          type="email"
          placeholder="E-mail"
          required
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
        />
        <button
          className="w-full rounded-full bg-o2-coral px-4 py-2.5 font-medium text-white transition hover:opacity-90"
          type="submit"
        >
          Enviar link
        </button>
      </form>

      <p className="text-center text-sm text-gray-600">
        <Link href="/login" className="font-medium text-o2-navy underline">
          Voltar para o login
        </Link>
      </p>
    </main>
  );
}
