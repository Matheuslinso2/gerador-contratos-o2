// Fonte única dos produtos com landing page pública de cotação. Usado em
// três lugares: tiles da home (src/app/page.tsx, categoria "Solicitação de
// Cotação"), dropdown "Solicitação de Cotação" do AppHeader, e a vitrine
// pública /cotacao (link único que a pessoa recebe e escolhe o produto).
//
// Ao criar uma landing page de produto novo, adicionar uma entrada aqui —
// os três lugares acima atualizam sozinhos, sem precisar mexer em mais
// nada. Isso NÃO afeta o Workspace interno (dropdown/painel continuam
// listando cada link separado, não há unificação lá dentro — só a vitrine
// pública /cotacao concentra tudo numa única URL pra compartilhar).
import type { ReactNode } from "react";

export type ProdutoLandingPage = {
  href: string;
  titulo: string;
  descricao: string;
  icone: ReactNode;
};

export const PRODUTOS_LANDING_PAGE: ProdutoLandingPage[] = [
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
  {
    href: "/seguro-celular",
    titulo: "Seguro Celular",
    descricao: "Ficha online para cotação de seguro celular",
    icone: (
      <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
        <rect x="7" y="2.5" width="10" height="19" rx="2" stroke="currentColor" strokeWidth="1.6" />
        <path d="M10.5 18.2h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/rcp",
    titulo: "RCP",
    descricao: "Ficha online para cotação de Responsabilidade Civil Profissional",
    icone: (
      <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
        <path
          d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path d="M9 12.2l1.9 1.9L15.5 9.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: "/condominio",
    titulo: "Condomínio",
    descricao: "Ficha online para cotação de seguro condomínio",
    icone: (
      <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
        <rect x="5" y="4" width="14" height="16.5" rx="1.2" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8.5 7.5h1.6M13.9 7.5h1.6M8.5 11h1.6M13.9 11h1.6M8.5 14.5h1.6M13.9 14.5h1.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M10 20.5v-3.2a2 2 0 014 0v3.2" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    ),
  },
];
