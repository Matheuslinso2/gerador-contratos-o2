import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { IconChecklist, IconCalculator } from "@/components/icons";

export const dynamic = "force-dynamic";

// Identidade visual oficial da O2 (ver skill o2-marca-visual) -- mesmo
// padrão usado em /cotacao (a vitrine pública oficial): blur laranja atrás
// da logo, pill laranja, navy no título, ícone em círculo laranja nos
// cards.
const O2_LARANJA = "#F8540D";
const O2_NAVY = "#01192e";

export const metadata: Metadata = {
  title: "Ferramentas gratuitas — O2 Seguros",
  description: "Auditor de Contrato e Cálculo de Multa Rescisória — sem cadastro, sem custo.",
  openGraph: {
    title: "Ferramentas gratuitas — O2 Seguros",
    description: "Auditor de Contrato e Cálculo de Multa Rescisória — sem cadastro, sem custo.",
    images: ["/marca-o2/o2-logo-horizontal.png"],
  },
};

// Página inicial de quem chega pelo link público (pedido do Matheus,
// 18/09/2026) -- só alcançável com o cookie liberado em
// /acesso/[token]/route.ts (ver ROTAS_PUBLICAS_COM_COOKIE em
// src/lib/acessoPublico.ts). Mostra as 2 ferramentas liberadas como
// opção, em vez de cair direto numa delas -- cada ferramenta tem um link
// de volta pra cá.
export default function FerramentasPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6 sm:p-8">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="relative flex items-center justify-center">
          <div aria-hidden className="absolute h-24 w-40 rounded-full opacity-30 blur-2xl" style={{ background: O2_LARANJA }} />
          <Image src="/marca-o2/o2-logo-horizontal.png" alt="O2 Seguros" width={170} height={40} priority className="relative" />
        </div>
        <div>
          <span className="inline-block rounded-full px-3 py-1 text-xs font-semibold text-white" style={{ background: O2_LARANJA }}>
            Ferramentas gratuitas
          </span>
          <h1 className="mt-2 text-xl font-semibold" style={{ color: O2_NAVY }}>
            Qual ferramenta você quer usar?
          </h1>
          <p className="mt-1 text-sm text-gray-600">Escolha uma opção abaixo — sem cadastro, sem custo.</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          href="/auditar-contrato"
          className="group flex flex-col items-center gap-3 rounded-xl border border-gray-200 p-6 text-center transition hover:border-[#F8540D] hover:bg-orange-50"
        >
          <span
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white transition group-hover:scale-105"
            style={{ background: O2_LARANJA }}
          >
            <IconChecklist />
          </span>
          <div>
            <p className="text-sm font-semibold" style={{ color: O2_NAVY }}>
              Auditar contrato
            </p>
            <p className="mt-0.5 text-xs text-gray-500">
              Analisa um contrato já pronto e aponta erros e inconsistências antes da assinatura.
            </p>
          </div>
        </Link>

        <Link
          href="/multa-rescisoria"
          className="group flex flex-col items-center gap-3 rounded-xl border border-gray-200 p-6 text-center transition hover:border-[#F8540D] hover:bg-orange-50"
        >
          <span
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white transition group-hover:scale-105"
            style={{ background: O2_LARANJA }}
          >
            <IconCalculator />
          </span>
          <div>
            <p className="text-sm font-semibold" style={{ color: O2_NAVY }}>
              Calcular multa rescisória
            </p>
            <p className="mt-0.5 text-xs text-gray-500">
              Calcula o valor proporcional da multa quando o contrato é encerrado antes do prazo.
            </p>
          </div>
        </Link>
      </div>

      <p className="text-center text-xs text-gray-500">
        <a
          href="/manual-ferramentas-o2.pdf"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium hover:underline"
          style={{ color: O2_LARANJA }}
        >
          📄 Baixar manual das ferramentas (PDF)
        </a>
      </p>
    </main>
  );
}
