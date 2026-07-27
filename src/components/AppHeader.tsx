import Image from "next/image";
import Link from "next/link";
import { isAdmin } from "@/lib/admin";
import NavLink from "./NavLink";
import NavDropdown from "./NavDropdown";

export default function AppHeader({
  userEmail,
  logoutAction,
}: {
  userEmail?: string;
  logoutAction?: () => void;
}) {
  return (
    <header className="bg-o2-navy">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-3">
          <Image src="/o2-logo-navy.png" alt="O2 Seguros" width={100} height={60} priority />
          <div className="hidden border-l border-white/20 pl-3 sm:block">
            <p className="text-sm font-medium text-white">Gerador de Contratos</p>
            <p className="text-xs text-white/50">Painel para imobiliárias</p>
          </div>
        </Link>

        {userEmail && (
          <form action={logoutAction}>
            <button type="submit" className="text-sm text-white/70 hover:text-white hover:underline">
              {userEmail} · Sair
            </button>
          </form>
        )}
      </div>

      {userEmail && (
        <nav className="border-t border-white/10">
          <div className="mx-auto flex max-w-4xl items-center gap-4 px-6">
            <NavLink href="/" label="Início" />
            <NavDropdown
              label="Ferramentas úteis"
              items={[
                { href: "/gerar-contrato", label: "Gerar contrato" },
                { href: "/auditar-contrato", label: "Auditar contrato" },
                { href: "/multa-rescisoria", label: "Cálculo de multa rescisória" },
              ]}
            />
            <NavLink href="/contratos" label="Contratos realizados" />
            <NavDropdown
              label="Configurações"
              items={[
                { href: "/imobiliaria", label: "Imobiliária" },
                ...(isAdmin(userEmail) ? [{ href: "/clausulas", label: "Cláusulas (admin)" }] : []),
                ...(isAdmin(userEmail)
                  ? [{ href: "/admin/imobiliarias", label: "Imobiliárias cadastradas (admin)" }]
                  : []),
              ]}
            />
          </div>
        </nav>
      )}
    </header>
  );
}
