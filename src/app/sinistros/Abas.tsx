import Link from "next/link";

// Abas fixas do módulo (planejamento v2, seção 2): Dashboard · Gestão ·
// + Abrir sinistro. A imobiliária ainda não tem dashboard (Fase D) -- para ela
// a primeira aba é "Meus sinistros". `filtros` leva a query do dashboard
// para a Gestão (quem olhava uma imobiliária chega na gestão filtrado nela).
export default function Abas({
  atual,
  interno,
  filtros,
}: {
  atual: "dashboard" | "gestao" | "novo" | "ficha";
  interno: boolean;
  filtros?: string;
}) {
  const sufixo = filtros ? `?${filtros}` : "";
  const abas = [
    ...(interno ? [{ chave: "dashboard", rotulo: "Dashboard", href: `/sinistros${sufixo}` }] : []),
    { chave: "gestao", rotulo: interno ? "Gestão" : "Meus sinistros", href: `/sinistros/gestao${sufixo}` },
  ];
  return (
    <nav className="flex flex-wrap items-center gap-2 border-b border-gray-200 pb-2">
      {abas.map((a) => (
        <Link
          key={a.chave}
          href={a.href}
          className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
            atual === a.chave ? "bg-o2-navy text-white" : "text-o2-navy hover:bg-gray-100"
          }`}
        >
          {a.rotulo}
        </Link>
      ))}
      <Link
        href="/sinistros/novo"
        className={`ml-auto rounded-full px-4 py-1.5 text-sm font-semibold ${
          atual === "novo" ? "bg-o2-coral text-white" : "border border-o2-coral text-o2-coral hover:bg-o2-coral hover:text-white"
        }`}
      >
        + Abrir sinistro
      </Link>
    </nav>
  );
}
