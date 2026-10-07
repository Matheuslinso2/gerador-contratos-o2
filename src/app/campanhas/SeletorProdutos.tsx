import { PRODUTOS_CAMPANHA } from "@/lib/campanhas/produtos";

// Pedido do Matheus, 07/10/2026: escolher mais de um produto na campanha
// (antes era um <select> de opção única). Cada produto é um checkbox em
// formato de "pílula" -- mais fácil de marcar vários do que um <select
// multiple>, que exige Ctrl+clique. Todos usam name="produtos"; o servidor
// lê com formData.getAll("produtos") (ver lerProdutosDoFormulario).
export function SeletorProdutos({ selecionados = [] }: { selecionados?: string[] }) {
  const marcados = new Set(selecionados);

  return (
    <fieldset>
      <legend className="mb-1 block text-xs font-medium text-gray-600">Produtos (marque um ou mais)</legend>
      <div className="flex flex-wrap gap-2">
        {PRODUTOS_CAMPANHA.map((p) => (
          <label key={p.valor} className="cursor-pointer">
            <input type="checkbox" name="produtos" value={p.valor} defaultChecked={marcados.has(p.valor)} className="peer sr-only" />
            <span className="inline-block select-none rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-600 transition peer-checked:border-o2-navy peer-checked:bg-o2-navy peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-o2-coral">
              {p.rotulo}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
