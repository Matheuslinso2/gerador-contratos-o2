"use client";

import { useState } from "react";
import { formatarCNPJ, validarCNPJ } from "@/lib/validacoesBr";

export default function CampoCnpj({ defaultValue }: { defaultValue?: string }) {
  const [valor, setValor] = useState(defaultValue ?? "");
  const [tocado, setTocado] = useState(false);
  const invalido = tocado && valor.trim() !== "" && !validarCNPJ(valor);

  return (
    <div>
      <input
        name="cnpj"
        placeholder="CNPJ"
        required
        value={valor}
        onChange={(e) => setValor(formatarCNPJ(e.target.value))}
        onBlur={() => setTocado(true)}
        inputMode="numeric"
        className={`w-full rounded-lg border px-3 py-2.5 focus:outline-none ${
          invalido ? "border-red-400 focus:border-red-500" : "border-gray-300 focus:border-o2-coral"
        }`}
      />
      {invalido && <p className="mt-0.5 text-xs text-red-600">CNPJ inválido.</p>}
    </div>
  );
}
