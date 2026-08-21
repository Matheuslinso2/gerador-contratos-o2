import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "./actions";
import AppHeader from "@/components/AppHeader";
import PainelCategorias from "@/components/PainelCategorias";

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
          <Image src="/marca-o2/o2-logo-oficial.png" alt="O2 Seguros" width={168} height={93} priority />
          <div>
            <h1 className="text-2xl font-bold text-o2-navy">Workspace O2</h1>
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
    icone: ReactNode;
    pendente?: boolean;
  }[] = [
    {
      href: "/gerar-contrato",
      titulo: "Gerar contrato",
      descricao: "Monta o contrato final e exporta em Word",
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

  const solicitacaoCotacao: {
    href: string;
    titulo: string;
    descricao: string;
    icone: ReactNode;
  }[] = [
    {
      href: "/capitalizacao",
      titulo: "Capitalização",
      descricao: "Ficha online para dar entrada no título de capitalização",
      icone: (
        <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
          <ellipse cx="12" cy="7" rx="7" ry="3" stroke="currentColor" strokeWidth="1.6" />
          <path d="M5 7v4c0 1.66 3.13 3 7 3s7-1.34 7-3V7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M5 11v4c0 1.66 3.13 3 7 3s7-1.34 7-3v-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      href: "/ficha-fianca",
      titulo: "Ficha Fiança",
      descricao: "Ficha online para dar entrada na análise e cotação de fiança",
      icone: (
        <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
          <rect x="6" y="3.5" width="12" height="17" rx="2" stroke="currentColor" strokeWidth="1.6" />
          <path d="M9 3.5V3a1 1 0 011-1h4a1 1 0 011 1v.5" stroke="currentColor" strokeWidth="1.6" />
          <path d="M9 11.7l1.8 1.8L15.5 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M9 15.7h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      href: "/seguro-auto",
      titulo: "Seguro Auto",
      descricao: "Ficha online para dar entrada na cotação de seguro automóvel",
      icone: (
        <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
          <path
            d="M4.5 15.5l1.4-4.6a2 2 0 011.9-1.4h8.4a2 2 0 011.9 1.4l1.4 4.6"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <rect x="3.5" y="15.5" width="17" height="4" rx="1.4" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="7" cy="19.5" r="1.3" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="17" cy="19.5" r="1.3" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      ),
    },
    {
      href: "/seguro-incendio",
      titulo: "Seguro Incêndio",
      descricao: "Ficha online para cotação de incêndio residencial, empresarial ou imobiliário",
      icone: (
        <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
          <path
            d="M12 3.5c1 2 .3 3.2-.6 4.4-1 1.3-1.8 2.3-1.8 3.9a3 3 0 003 3c1.9 0 3-1.3 3-3.1 1.2 1 1.9 2.3 1.9 3.9a5.5 5.5 0 11-11 0c0-3 1.6-4.7 3-6.3 1.3-1.5 2.2-2.7 2.5-5.8z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ),
    },
    {
      href: "/rc-obras",
      titulo: "RC Obras",
      descricao: "Ficha online para cotação de Responsabilidade Civil de Obras",
      icone: (
        <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
          <path d="M4 20.5h16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M6 20.5V10l6-4.5 6 4.5v10.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M9.5 20.5v-5h5v5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M3 10l9-6.5L21 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
  ];

  const usoInterno = isAdmin(user.email) || isColaboradorO2(user.email);

  const aplicacoesInternas: {
    href: string;
    titulo: string;
    descricao: string;
    icone: ReactNode;
  }[] = [
    {
      href: "/producao",
      titulo: "Produção",
      descricao: "Dashboard de prêmio, comissão e volume da produção da corretora",
      icone: (
        <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
          <path d="M4 20V4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M4 20h16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <rect x="7" y="13" width="3" height="7" rx="0.8" stroke="currentColor" strokeWidth="1.6" />
          <rect x="12.5" y="9" width="3" height="11" rx="0.8" stroke="currentColor" strokeWidth="1.6" />
          <rect x="18" y="5.5" width="3" height="14.5" rx="0.8" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      ),
    },
    {
      href: "/faturas",
      titulo: "Faturas",
      descricao: "Boletos de seguradora recebidos, prontos pra reenviar às imobiliárias",
      icone: (
        <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
          <path
            d="M6 3.5h12v17l-2.2-1.5-2.2 1.5-2.1-1.5-2.1 1.5-2.2-1.5-1.2.8V3.5z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path d="M8.5 8h7M8.5 11.5h7M8.5 15h4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      href: "/seguro-fianca",
      titulo: "Seguro Fiança",
      descricao: "Acompanhamento das propostas de fiança em andamento",
      icone: (
        <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
          <path
            d="M12 3.5l7 2.5v5.2c0 4.6-3 7.9-7 9.3-4-1.4-7-4.7-7-9.3V6l7-2.5z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path d="M8.7 12l2.2 2.2 4.4-4.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      href: "/ramos-elementares",
      titulo: "Ramos Elementares",
      descricao: "Novos negócios, renovações, endossos e qualidade da produção",
      icone: (
        <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
          <path d="M4 19.5h16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M6.5 17V11M11 17V6M15.5 17V9M20 17V3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M5.5 8.5l4-3 4 1.8 5-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      href: "/painel-capitalizacao",
      titulo: "Painel Capitalização",
      descricao: "Funil, comissão e alertas dos títulos de capitalização",
      icone: (
        <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
          <ellipse cx="12" cy="7" rx="7" ry="3" stroke="currentColor" strokeWidth="1.6" />
          <path d="M5 7v4c0 1.66 3.13 3 7 3s7-1.34 7-3V7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M5 11v4c0 1.66 3.13 3 7 3s7-1.34 7-3v-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      href: "/painel-seguro-auto",
      titulo: "Painel Seguro Auto",
      descricao: "Funil, alertas e qualidade de preenchimento das fichas de seguro auto",
      icone: (
        <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
          <path
            d="M4.5 15.5l1.4-4.6a2 2 0 011.9-1.4h8.4a2 2 0 011.9 1.4l1.4 4.6"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <rect x="3.5" y="15.5" width="17" height="4" rx="1.4" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="7" cy="19.5" r="1.3" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="17" cy="19.5" r="1.3" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      ),
    },
    {
      href: "/social-media",
      titulo: "Social Media",
      descricao: "Notícias de mercado imobiliário e seguros, coletadas automaticamente",
      icone: (
        <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
          <rect x="4" y="4" width="16" height="16" rx="4" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="16.3" cy="7.7" r="0.9" fill="currentColor" />
        </svg>
      ),
    },
  ];

  const configuracoes: { href: string; titulo: string; descricao: string; icone: ReactNode }[] = [
    {
      href: "/imobiliaria",
      titulo: "Configuração da imobiliária",
      descricao: "Dados-base e variáveis de praxe",
      icone: (
        <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
          <path d="M5 20.5V6.5a1 1 0 011-1h5v15" stroke="currentColor" strokeWidth="1.6" />
          <path d="M14 20.5V10a1 1 0 011-1h3a1 1 0 011 1v10.5" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M8 8.5h.01M8 11.5h.01M8 14.5h.01M8 17.5h.01M17.5 13.5h.01M17.5 16.5h.01"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
          <path d="M3.5 20.5h17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      ),
    },
    ...(isAdmin(user.email)
      ? [
          {
            href: "/clausulas",
            titulo: "Biblioteca de cláusulas (admin)",
            descricao: "Seguradoras, produtos e coberturas adicionais",
            icone: (
              <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
                <path
                  d="M4 5.5c2-1 5-1 8 .5 3-1.5 6-1.5 8-.5v13c-2-1-5-1-8 .5-3-1.5-6-1.5-8-.5z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
                <path d="M12 6v13" stroke="currentColor" strokeWidth="1.6" />
              </svg>
            ),
          },
          {
            href: "/admin/imobiliarias",
            titulo: "Imobiliárias cadastradas (admin)",
            descricao: "Visão de todas as contas de imobiliária parceiras",
            icone: (
              <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
                <circle cx="9" cy="8.5" r="3" stroke="currentColor" strokeWidth="1.6" />
                <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                <circle cx="17" cy="9.5" r="2.3" stroke="currentColor" strokeWidth="1.6" />
                <path d="M15 19c0-2.2 1-3.9 3-4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            ),
          },
        ]
      : []),
  ];

  const categorias = [
    {
      id: "ferramentas",
      label: "Ferramentas úteis",
      accent: "navy" as const,
      itens: ferramentas,
      icone: (
        <svg viewBox="0 0 24 24" fill="none" className="h-full w-full" stroke="currentColor" strokeWidth="1.6">
          <path d="M7 3.5h7l4 4V19a1.5 1.5 0 01-1.5 1.5h-9.5A1.5 1.5 0 015.5 19V5A1.5 1.5 0 017 3.5z" />
        </svg>
      ),
    },
    {
      id: "cotacao",
      label: "Solicitação de Cotação",
      accent: "orange" as const,
      itens: solicitacaoCotacao,
      icone: (
        <svg viewBox="0 0 24 24" fill="none" className="h-full w-full" stroke="currentColor" strokeWidth="1.6">
          <ellipse cx="12" cy="7" rx="7" ry="3" />
          <path d="M5 7v4c0 1.66 3.13 3 7 3s7-1.34 7-3V7" />
          <path d="M5 11v4c0 1.66 3.13 3 7 3s7-1.34 7-3v-4" />
        </svg>
      ),
    },
    ...(usoInterno
      ? [
          {
            id: "interno",
            label: "Aplicações internas",
            accent: "blue" as const,
            itens: aplicacoesInternas,
            restrita: true,
            icone: (
              <svg viewBox="0 0 24 24" fill="none" className="h-full w-full" stroke="currentColor" strokeWidth="1.6">
                <path d="M12 3.5l7 2.5v5.2c0 4.6-3 7.9-7 9.3-4-1.4-7-4.7-7-9.3V6l7-2.5z" />
              </svg>
            ),
          },
        ]
      : []),
    {
      id: "config",
      label: "Configurações",
      accent: "gray" as const,
      itens: configuracoes,
      icone: (
        <svg viewBox="0 0 24 24" fill="none" className="h-full w-full" stroke="currentColor" strokeWidth="1.6">
          <path d="M5 20.5V6.5a1 1 0 011-1h5v15" />
          <path d="M14 20.5V10a1 1 0 011-1h3a1 1 0 011 1v10.5" />
        </svg>
      ),
    },
  ];

  return (
    <>
      <AppHeader userEmail={user.email} logoutAction={signOut} />
      <main className="mx-auto max-w-4xl flex-1 space-y-6 p-8">
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

        <PainelCategorias categorias={categorias} />
      </main>
    </>
  );
}
