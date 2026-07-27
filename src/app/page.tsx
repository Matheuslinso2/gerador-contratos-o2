import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "./actions";
import AppHeader from "@/components/AppHeader";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <>
        <AppHeader />
        <main className="mx-auto flex max-w-xl flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
          <Image src="/o2-logo-color.png" alt="O2 Seguros" width={168} height={100} priority />
          <div>
            <h1 className="text-2xl font-bold text-o2-navy">Gerador de Contratos de Locação</h1>
            <p className="mt-1 text-sm text-gray-600">Painel para imobiliárias parceiras da O2 Seguros</p>
          </div>
          <div className="flex gap-3">
            <Link
              href="/login"
              className="rounded-full bg-o2-coral px-6 py-2.5 font-medium text-white transition hover:opacity-90"
            >
              Entrar
            </Link>
            <Link
              href="/signup"
              className="rounded-full border border-o2-navy px-6 py-2.5 font-medium text-o2-navy transition hover:bg-white"
            >
              Criar conta
            </Link>
          </div>
        </main>
      </>
    );
  }

  const { data: imobiliaria } = await supabase
    .from("imobiliarias")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  const cadastroCompleto = !!imobiliaria || isAdmin(user.email) || isColaboradorO2(user.email);

  const ferramentas: {
    href: string;
    titulo: string;
    descricao: string;
    gradiente: string;
    icone: ReactNode;
    pendente?: boolean;
  }[] = [
    {
      href: "/gerar-contrato",
      titulo: "Gerar contrato",
      descricao: "Monta o contrato final e exporta em Word",
      gradiente: "from-o2-coral to-orange-400",
      pendente: !cadastroCompleto,
      icone: (
        <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
          <path
            d="M7 3.5h7l4 4V19a1.5 1.5 0 01-1.5 1.5h-9.5A1.5 1.5 0 015.5 19V5A1.5 1.5 0 017 3.5z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path d="M14 3.5V8h4.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M8.5 12.5h7M8.5 15.5h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      href: "/auditar-contrato",
      titulo: "Auditar contrato",
      descricao: "Analisa um contrato pronto e aponta erros e inconsistências",
      gradiente: "from-o2-indigo to-o2-navy",
      pendente: !cadastroCompleto,
      icone: (
        <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
          <circle cx="10.5" cy="10.5" r="6" stroke="currentColor" strokeWidth="1.6" />
          <path d="M15 15l4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M8 10.5l1.7 1.7L13.5 8.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      href: "/contratos",
      titulo: "Contratos realizados",
      descricao: "Busca contratos gerados e auditorias por CPF, nome ou endereço",
      gradiente: "from-o2-navy to-slate-700",
      icone: (
        <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
          <rect x="4" y="5" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
          <path d="M7.5 9.5h9M7.5 13h9M7.5 16.5h5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      href: "/multa-rescisoria",
      titulo: "Multa rescisória",
      descricao: "Calculadora rápida de consulta, sem cadastro necessário",
      gradiente: "from-o2-coral to-o2-indigo",
      icone: (
        <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
          <rect x="5" y="3.5" width="14" height="17" rx="2" stroke="currentColor" strokeWidth="1.6" />
          <path d="M8.5 7.5h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path
            d="M8.5 11h.01M12 11h.01M15.5 11h.01M8.5 14.5h.01M12 14.5h.01M15.5 14.5h.01M8.5 18h.01M12 18h.01"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        </svg>
      ),
    },
  ];

  const configuracoes: { href: string; titulo: string; descricao: string }[] = [
    ...(isAdmin(user.email)
      ? [
          {
            href: "/clausulas",
            titulo: "Biblioteca de cláusulas (admin)",
            descricao: "Seguradoras, produtos e coberturas adicionais",
          },
          {
            href: "/admin/imobiliarias",
            titulo: "Imobiliárias cadastradas (admin)",
            descricao: "Visão de todas as contas de imobiliária parceiras",
          },
        ]
      : []),
    {
      href: "/imobiliaria",
      titulo: "Configuração da imobiliária",
      descricao: "Dados-base e variáveis de praxe",
    },
  ];

  return (
    <>
      <AppHeader userEmail={user.email} logoutAction={signOut} />
      <main className="mx-auto max-w-2xl flex-1 space-y-8 p-8">
        <h1 className="text-xl font-semibold text-o2-navy">Painel</h1>

        {!cadastroCompleto && (
          <Link
            href="/imobiliaria"
            className="block rounded-xl border border-yellow-400 bg-yellow-50 p-4 text-sm text-yellow-800 transition hover:bg-yellow-100"
          >
            <span className="font-medium">Complete o cadastro da sua imobiliária</span> para
            poder gerar e auditar contratos. Clique aqui para começar →
          </Link>
        )}

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Ferramentas úteis</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {ferramentas.map((f) => (
              <Link
                key={f.href}
                href={f.href}
                className={`group relative overflow-hidden rounded-2xl bg-gradient-to-br p-5 text-white shadow-md transition duration-200 hover:-translate-y-0.5 hover:shadow-xl ${f.gradiente}`}
              >
                <div className="mb-3 flex items-center justify-between">
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-white/15">
                    {f.icone}
                  </span>
                  {f.pendente && (
                    <span className="rounded-full bg-white/90 px-2 py-0.5 text-xs font-medium text-yellow-800">
                      cadastro pendente
                    </span>
                  )}
                </div>
                <p className="font-semibold">{f.titulo}</p>
                <p className="mt-1 text-sm text-white/80">{f.descricao}</p>
                <svg
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="absolute bottom-4 right-4 h-5 w-5 text-white/40 transition group-hover:translate-x-1 group-hover:text-white/80"
                >
                  <path
                    fillRule="evenodd"
                    d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                    clipRule="evenodd"
                  />
                </svg>
              </Link>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Configurações</h2>
          <div className="flex flex-col gap-3">
            {configuracoes.map((c) => (
              <Link
                key={c.href}
                href={c.href}
                className="rounded-xl border border-o2-navy/10 bg-white p-4 shadow-sm transition hover:shadow-md"
              >
                <p className="font-medium text-o2-navy">{c.titulo}</p>
                <p className="text-sm text-gray-500">{c.descricao}</p>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
