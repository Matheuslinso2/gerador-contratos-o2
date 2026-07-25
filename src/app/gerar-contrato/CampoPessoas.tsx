"use client";

import { useRef, useState } from "react";

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-o2-coral focus:outline-none";

export default function CampoPessoas({
  fieldName,
  placeholder,
}: {
  fieldName: string;
  placeholder: string;
}) {
  const nextId = useRef(1);
  const [ids, setIds] = useState<number[]>([0]);

  return (
    <div className="space-y-3">
      {ids.map((id, i) => (
        <div key={id} className="rounded-lg border border-gray-200 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-o2-navy">
              {placeholder} {ids.length > 1 ? i + 1 : ""}
            </p>
            {ids.length > 1 && (
              <button
                type="button"
                onClick={() => setIds((prev) => prev.filter((x) => x !== id))}
                className="text-sm text-gray-400 hover:text-red-600"
                aria-label={`Remover ${placeholder.toLowerCase()} ${i + 1}`}
              >
                Remover ×
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <input
              name={`${fieldName}_nome`}
              placeholder="Nome completo"
              required={i === 0}
              className={`${inputClass} col-span-2`}
            />
            <input name={`${fieldName}_nacionalidade`} placeholder="Nacionalidade (ex: brasileiro)" className={inputClass} />
            <input name={`${fieldName}_estado_civil`} placeholder="Estado civil" className={inputClass} />
            <input name={`${fieldName}_profissao`} placeholder="Profissão" className={inputClass} />
            <input name={`${fieldName}_cpf`} placeholder="CPF" className={inputClass} />
            <input name={`${fieldName}_rg`} placeholder="RG / Carteira de Identidade" className={inputClass} />
            <input name={`${fieldName}_rg_orgao`} placeholder="Órgão expedidor (ex: SSP/RJ)" className={inputClass} />
            <input
              name={`${fieldName}_endereco`}
              placeholder="Endereço residencial (residente e domiciliado em)"
              className={`${inputClass} col-span-2`}
            />
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => setIds((prev) => [...prev, nextId.current++])}
        className="text-sm font-medium text-o2-navy hover:underline"
      >
        + Adicionar outro {placeholder.toLowerCase()} (solidário)
      </button>
    </div>
  );
}
