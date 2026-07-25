import Image from "next/image";
import Link from "next/link";

export default function AppHeader({
  userEmail,
  logoutAction,
}: {
  userEmail?: string;
  logoutAction?: () => void;
}) {
  return (
    <header className="border-b border-o2-navy/10 bg-white">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-3">
          <Image src="/o2-logo-color.png" alt="O2 Seguros" width={100} height={60} priority />
          <div className="hidden border-l border-o2-navy/15 pl-3 sm:block">
            <p className="text-sm font-medium text-o2-navy">Gerador de Contratos</p>
            <p className="text-xs text-gray-500">Painel para imobiliárias</p>
          </div>
        </Link>

        {userEmail && (
          <form action={logoutAction}>
            <button type="submit" className="text-sm text-gray-500 hover:text-o2-navy hover:underline">
              {userEmail} · Sair
            </button>
          </form>
        )}
      </div>
    </header>
  );
}
