// Tela de espera de TODAS as páginas: aparece na hora do clique, enquanto o
// servidor monta a página (antes o clique parecia "não fazer nada" por alguns
// segundos). Cada página pode ter o próprio loading.tsx mais específico.
export default function Carregando() {
  return (
    <div className="flex flex-1 flex-col" role="status" aria-live="polite">
      <div className="h-[134px] w-full bg-o2-navy" />
      <main className="mx-auto w-full max-w-4xl flex-1 space-y-4 p-8">
        <div className="h-7 w-56 animate-pulse rounded-lg bg-gray-200" />
        <div className="h-4 w-80 max-w-full animate-pulse rounded bg-gray-200" />
        <div className="grid gap-3 pt-4 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-gray-200/70" />
          ))}
        </div>
        <div className="h-48 animate-pulse rounded-xl bg-gray-200/70" />
        <span className="sr-only">Carregando…</span>
      </main>
    </div>
  );
}
