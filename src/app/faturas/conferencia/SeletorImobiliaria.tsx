"use client";

import { useState } from "react";

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-o2-coral focus:outline-none";

// Combobox com busca (datalist) em vez de <select> comum -- com a lista de
// imobiliárias podendo ter centenas de nomes, rolar um dropdown gigante é
// lento; aqui digita e o navegador filtra sozinho, mesmo padrão já usado em
// ProspeccaoForm.tsx.
export default function SeletorImobiliaria({
  imobiliarias,
  defaultImobiliariaId,
  listId,
}: {
  imobiliarias: { id: string; nome: string }[];
  defaultImobiliariaId?: string | null;
  listId: string;
}) {
  const nomeInicial = imobiliarias.find((i) => i.id === defaultImobiliariaId)?.nome ?? "";
  const [texto, setTexto] = useState(nomeInicial);
  const idResolvido = imobiliarias.find((i) => i.nome === texto)?.id ?? "";

  return (
    <div className="flex-1">
      <input
        list={listId}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Digite pra buscar pelo nome..."
        autoComplete="off"
        className={inputClass}
      />
      <datalist id={listId}>
        {imobiliarias.map((i) => (
          <option key={i.id} value={i.nome} />
        ))}
      </datalist>
      <input type="hidden" name="imobiliaria_id" value={idResolvido} />
      {texto && !idResolvido && (
        <p className="mt-1 text-xs text-orange-600">
          Nenhuma imobiliária encontrada com esse nome exato — confira a digitação ou escolha uma sugestão da lista.
        </p>
      )}
    </div>
  );
}
