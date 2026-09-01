"use client";

import { useRef, useState } from "react";
import { formatarCNPJ, validarCNPJ } from "@/lib/validacoesBr";

export default function CampoCnpj({ defaultValue }: { defaultValue?: string }) {
  const [valor, setValor] = useState(defaultValue ?? "");
  const [tocado, setTocado] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const invalido = tocado && valor.trim() !== "" && !validarCNPJ(valor);

  // O aviso em vermelho era só visual -- não impedia o envio de verdade
  // (nem no navegador, nem no servidor), então um CNPJ com dígito
  // verificador errado passava direto pro banco. setCustomValidity() usa a
  // validação nativa do navegador pra bloquear o envio de fato (mesmo
  // mecanismo do "required"), além da checagem no servidor em actions.ts.
  function atualizarValidade(v: string) {
    inputRef.current?.setCustomValidity(v.trim() !== "" && !validarCNPJ(v) ? "CNPJ inválido — confira os números." : "");
  }

  return (
    <div>
      <input
        ref={inputRef}
        name="cnpj"
        placeholder="CNPJ"
        required
        value={valor}
        onChange={(e) => {
          const novo = formatarCNPJ(e.target.value);
          setValor(novo);
          atualizarValidade(novo);
        }}
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
