"use client";

// Marca/desmarca de uma vez todas as caixinhas "imob" visíveis -- mesmo
// padrão de src/app/faturas/LinhaInterativa.tsx (SelecionarTodas).
export function SelecionarTodas() {
  function alternar(e: React.ChangeEvent<HTMLInputElement>) {
    const marcado = e.target.checked;
    document.querySelectorAll<HTMLInputElement>('input[name="imob"]').forEach((cb) => {
      cb.checked = marcado;
    });
  }
  return (
    <label className="flex items-center gap-1.5 text-xs font-medium text-gray-700">
      <input type="checkbox" defaultChecked onChange={alternar} />
      Selecionar todas
    </label>
  );
}
