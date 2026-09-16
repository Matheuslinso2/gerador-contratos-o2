import Image from "next/image";
import Link from "next/link";
import { signUp } from "./actions";
import CampoSenha from "@/components/CampoSenha";
import SubmitButton from "@/components/SubmitButton";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const { erro } = await searchParams;

  return (
    <main className="mx-auto flex max-w-sm flex-1 flex-col justify-center gap-5 p-8">
      <div className="flex justify-center">
        <Image src="/marca-o2/o2-logo-oficial.png" alt="O2 Seguros" width={140} height={77} priority />
      </div>
      <div className="text-center">
        <h1 className="text-xl font-semibold text-o2-navy">Criar conta</h1>
        <p className="mt-1 text-sm text-gray-600">Cada conta representa uma imobiliária/administradora.</p>
      </div>

      {erro && (
        <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">⚠️ {erro}</p>
      )}

      <form action={signUp} className="space-y-3">
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
        <CampoSenha
          id="password"
          name="password"
          placeholder="Senha (mín. 6 caracteres)"
          required
          minLength={6}
          autoComplete="new-password"
        />

        <div className="border-t border-gray-100 pt-3">
          <p className="mb-2 text-xs text-gray-500">Dados da imobiliária/administradora</p>
          <div className="space-y-3">
            <label htmlFor="nome_imobiliaria" className="sr-only">Nome da imobiliária</label>
            <input
              id="nome_imobiliaria"
              name="nome_imobiliaria"
              type="text"
              placeholder="Nome da imobiliária"
              required
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
            />
            <label htmlFor="cnpj_cpf" className="sr-only">CPF ou CNPJ</label>
            <input
              id="cnpj_cpf"
              name="cnpj_cpf"
              type="text"
              placeholder="CPF ou CNPJ"
              required
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
            />
            <label htmlFor="endereco" className="sr-only">Endereço</label>
            <input
              id="endereco"
              name="endereco"
              type="text"
              placeholder="Endereço"
              required
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
            />
            <label htmlFor="responsavel" className="sr-only">Nome do responsável</label>
            <input
              id="responsavel"
              name="responsavel"
              type="text"
              placeholder="Nome do responsável pela imobiliária"
              required
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
            />
          </div>
        </div>

        <p className="rounded-lg border border-o2-coral/30 bg-o2-coral/5 p-3 text-xs text-o2-navy">
          Sua conta funciona livremente por 3 dias enquanto a O2 Seguros analisa o cadastro. Depois disso, ferramentas
          que usam IA (Auditor de Contrato, Gerador de Contrato, Assistente Fiança) ficam limitadas até a autorização —
          o resto do Workspace continua liberado normalmente.
        </p>

        <label className="flex items-start gap-2 text-sm text-gray-600">
          <input type="checkbox" name="aceite_termos" required className="mt-0.5" />
          <span>
            Li e aceito os{" "}
            <Link href="/termos" target="_blank" className="font-medium text-o2-navy underline">
              Termos de Uso e a Política de Privacidade
            </Link>
            , incluindo o tratamento de dados de locadores e locatários conforme a LGPD.
          </span>
        </label>

        <SubmitButton
          textoCarregando="Criando conta…"
          className="w-full rounded-full bg-o2-coral px-4 py-2.5 font-medium text-white transition hover:opacity-90"
        >
          Criar conta
        </SubmitButton>
      </form>

      <p className="text-center text-sm text-gray-600">
        Já tem conta?{" "}
        <Link href="/login" className="font-medium text-o2-navy underline">
          Entrar
        </Link>
      </p>
    </main>
  );
}
