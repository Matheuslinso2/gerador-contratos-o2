import { ABAS } from "./_corp/comum";

// Espera do painel "Power BI - O2 Seguros": aparece na hora do clique (aba,
// filtro, troca de quadro) já com o título e as abas no lugar, enquanto o
// servidor lê a tela pronta — o clique responde na hora em vez de "travar".
export default function CarregandoPainel() {
  return (
    <div className="flex flex-1 flex-col" role="status" aria-live="polite">
      <div className="h-[134px] w-full bg-o2-navy" />
      <main className="mx-auto w-full max-w-7xl flex-1 space-y-5 p-8">
        <div>
          <p className="text-xl font-bold text-o2-navy">Power BI - O2 Seguros</p>
          <div className="mt-1 h-4 w-72 animate-pulse rounded bg-gray-200" />
        </div>
        <nav className="flex flex-wrap gap-1 border-b border-gray-200">
          {ABAS.map((a) => (
            <span key={a.href} className="px-4 py-2 text-sm font-medium text-gray-400">
              {a.rotulo}
            </span>
          ))}
        </nav>
        <div className="h-16 animate-pulse rounded-xl bg-gray-200/70" />
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-gray-200/70" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="h-56 animate-pulse rounded-xl bg-gray-200/70" />
          <div className="h-56 animate-pulse rounded-xl bg-gray-200/70" />
        </div>
        <span className="sr-only">Carregando…</span>
      </main>
    </div>
  );
}
