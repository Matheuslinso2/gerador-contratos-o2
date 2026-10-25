"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Menu do ERP O2 — aplicativo à parte do Workspace (decisão do Matheus, 25/10/2026:
// "como se eu tivesse que entrar em outro sistema do mesmo grupo"). Só telas do ERP aqui.
const ITENS = [
  { href: "/erp", label: "Início" },
  { href: "/erp/documentos", label: "Documentos" },
  { href: "/erp/baixas", label: "Baixas" },
  { href: "/erp/conferencia", label: "Conferência" },
  { href: "/erp/imobiliarias", label: "Imobiliárias" },
  { href: "/erp/seguradoras", label: "Seguradoras" },
];

export default function ErpNav() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-5 overflow-x-auto">
      {ITENS.map((i) => {
        const ativo = i.href === "/erp" ? pathname === "/erp" : pathname.startsWith(i.href);
        return (
          <Link
            key={i.href}
            href={i.href}
            className={`whitespace-nowrap border-b-2 px-1 py-2.5 text-sm font-medium transition ${
              ativo ? "border-o2-coral text-white" : "border-transparent text-white/60 hover:text-white"
            }`}
          >
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
