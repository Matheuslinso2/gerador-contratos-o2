"use client";

import { useRef, useState } from "react";
import { formatarCEP, validarCEP, buscarEnderecoPorCep } from "@/lib/validacoesBr";

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none";
const inputErroClass =
  "w-full rounded-lg border border-red-400 px-3 py-2.5 focus:border-red-500 focus:outline-none";

// Campo de endereço com busca automática por CEP (ViaCEP) — usado tanto no
// endereço do escritório da imobiliária quanto no endereço do imóvel/das
// partes na geração de contrato.
export default function CampoEndereco({
  name,
  label,
  placeholder,
  defaultValue,
  required,
}: {
  name: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
  required?: boolean;
}) {
  const [cep, setCep] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState(false);
  const enderecoRef = useRef<HTMLInputElement>(null);

  async function aoSairDoCep() {
    setErro(false);
    if (!cep.trim()) return;
    if (!validarCEP(cep)) {
      setErro(true);
      return;
    }
    setBuscando(true);
    const endereco = await buscarEnderecoPorCep(cep);
    setBuscando(false);
    if (!endereco) {
      setErro(true);
      return;
    }
    if (enderecoRef.current) {
      const partes = [endereco.logradouro, endereco.bairro, `${endereco.localidade}/${endereco.uf}`, `CEP ${formatarCEP(cep)}`]
        .filter(Boolean)
        .join(", ");
      enderecoRef.current.value = partes;
    }
  }

  return (
    <div className="space-y-2">
      <div>
        <label className="text-sm text-gray-600">CEP (busca o endereço)</label>
        <input
          placeholder="CEP"
          value={cep}
          onChange={(e) => setCep(formatarCEP(e.target.value))}
          onBlur={aoSairDoCep}
          inputMode="numeric"
          className={erro ? inputErroClass : inputClass}
        />
        {buscando && <p className="mt-0.5 text-xs text-gray-500">Buscando endereço...</p>}
        {erro && <p className="mt-0.5 text-xs text-red-600">CEP não encontrado — preencha o endereço manualmente.</p>}
      </div>
      <div>
        <label className="text-sm text-gray-600">{label}</label>
        <input
          ref={enderecoRef}
          name={name}
          placeholder={placeholder ?? label}
          defaultValue={defaultValue ?? ""}
          required={required}
          className={inputClass}
        />
      </div>
    </div>
  );
}
