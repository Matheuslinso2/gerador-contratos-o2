"use client";

import { useState } from "react";
import { criarRelatorioProspeccao } from "./actions";
import { formatarCNPJ } from "@/lib/validacoesBr";

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none";

export default function ProspeccaoForm() {
  const [cnpj, setCnpj] = useState("");

  return (
    <form action={criarRelatorioProspeccao} className="space-y-4">
      <div>
        <label className="mb-1 block text-sm text-gray-600">Nome da imobiliária</label>
        <input name="nome" required placeholder="Nome da imobiliária a visitar" className={inputClass} />
      </div>

      <div>
        <label className="mb-1 block text-sm text-gray-600">CNPJ (se souber)</label>
        <input
          name="cnpj"
          placeholder="CNPJ"
          value={cnpj}
          onChange={(e) => setCnpj(formatarCNPJ(e.target.value))}
          inputMode="numeric"
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm text-gray-600">Site (se souber)</label>
          <input name="url_site" type="url" placeholder="https://..." className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-sm text-gray-600">Instagram (se souber)</label>
          <input name="url_instagram" type="url" placeholder="https://instagram.com/..." className={inputClass} />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm text-gray-600">Notas (o que você já sabe sobre ela)</label>
        <textarea
          name="notas_manuais"
          rows={4}
          placeholder="Ex: indicação de fulano, atua na região X, parece focar em imóveis populares..."
          className={inputClass}
        />
      </div>

      <button
        type="submit"
        className="rounded-full bg-o2-coral px-6 py-2.5 font-medium text-white transition hover:opacity-90"
      >
        Gerar relatório de preparação
      </button>
    </form>
  );
}
