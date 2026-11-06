import Link from "next/link";

// Abas do painel de campanhas (06/11/2026): Campanhas × Avisos internos. Usada nas duas telas.
export function AbasCampanhas({ ativa }: { ativa: "campanhas" | "avisos" }) {
  const base = "whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition";
  const ligada = "border-o2-coral text-o2-navy";
  const desligada = "border-transparent text-gray-500 hover:text-o2-navy";
  return (
    <nav className="flex gap-2 border-b border-o2-navy/10" aria-label="Painel de campanhas">
      <Link href="/campanhas" className={`${base} ${ativa === "campanhas" ? ligada : desligada}`} aria-current={ativa === "campanhas" ? "page" : undefined}>
        Campanhas
      </Link>
      <Link href="/campanhas/avisos-internos" className={`${base} ${ativa === "avisos" ? ligada : desligada}`} aria-current={ativa === "avisos" ? "page" : undefined}>
        Avisos internos
      </Link>
    </nav>
  );
}
