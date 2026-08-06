import Link from "next/link";
import type { ReactNode } from "react";

// Cabeçalho padrão das subtelas de Faturas (upload, conferência, confirmar
// envio, cadastro de imobiliária) -- mesmo estilo de chip de ícone usado nos
// cards da tela inicial, pra dar uma identidade visual única ao módulo em
// vez do texto solto que cada tela tinha antes.
export default function FaturasSubHeader({
  icon,
  titulo,
  subtitulo,
  voltarHref = "/faturas",
  voltarTexto = "Voltar para Faturas",
}: {
  icon: ReactNode;
  titulo: string;
  subtitulo: string;
  voltarHref?: string;
  voltarTexto?: string;
}) {
  return (
    <div className="space-y-3">
      <Link
        href={voltarHref}
        className="inline-flex items-center gap-1 text-sm text-gray-500 transition hover:text-o2-navy hover:underline"
      >
        ← {voltarTexto}
      </Link>
      <div className="flex items-center gap-3">
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-o2-indigo to-o2-navy text-white shadow-sm">
          {icon}
        </span>
        <div>
          <h1 className="text-xl font-semibold text-o2-navy">{titulo}</h1>
          <p className="text-sm text-gray-500">{subtitulo}</p>
        </div>
      </div>
    </div>
  );
}
