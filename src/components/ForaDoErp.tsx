"use client";

import { usePathname } from "next/navigation";

// O ERP O2 (/erp) é um aplicativo à parte: o rodapé e o botão de WhatsApp do Workspace (feitos para as
// imobiliárias parceiras) não aparecem dentro dele.
export default function ForaDoErp({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/erp" || pathname?.startsWith("/erp/")) return null;
  return <>{children}</>;
}
