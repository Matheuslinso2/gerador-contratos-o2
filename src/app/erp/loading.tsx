// Esqueleto de espera do ERP O2 (mesma premissa do Workspace, src/app/loading.tsx): aparece na hora do clique,
// dentro do cabeçalho do ERP, enquanto o servidor monta a tela.
export default function CarregandoErp() {
  return (
    <main className="mx-auto w-full max-w-[1200px] flex-1 animate-pulse space-y-4 p-8" aria-busy="true" aria-label="Carregando">
      <div className="h-6 w-56 rounded bg-gray-300/70" />
      <div className="h-4 w-96 rounded bg-gray-300/50" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 rounded-xl bg-white" />
        ))}
      </div>
      <div className="h-64 rounded-xl bg-white" />
    </main>
  );
}
