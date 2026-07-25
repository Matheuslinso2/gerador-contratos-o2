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
    <header className="bg-o2-navy">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-3">
          <Image src="/o2-logo-white.png" alt="O2 Seguros" width={112} height={67} priority />
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
    </header>
  );
}
