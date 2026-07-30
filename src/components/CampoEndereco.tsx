"use client";

import { useEffect, useRef, useState } from "react";
import { formatarCEP, validarCEP, buscarEnderecoPorCep } from "@/lib/validacoesBr";

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-o2-coral focus:outline-none";
const inputErroClass =
  "w-full rounded-lg border border-red-400 px-3 py-2.5 text-sm focus:border-red-500 focus:outline-none";

// Campo de endereço completo (CEP com busca automática + logradouro, número,
// complemento, bairro, cidade/UF), montando o endereço final no mesmo
// formato usado nos contratos reais: "Logradouro, nº Número – Complemento –
// Bairro, Cidade/UF, CEP 00000-000". Usado no endereço do escritório da
// imobiliária, do imóvel e das partes na geração de contrato.
export default function CampoEndereco({
  name,
  label,
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
  const [erroCep, setErroCep] = useState(false);
  const [logradouro, setLogradouro] = useState("");
  const [numero, setNumero] = useState("");
  const [complemento, setComplemento] = useState("");
  const [bairro, setBairro] = useState("");
  const [cidade, setCidade] = useState("");
  const [uf, setUf] = useState("");
  const finalRef = useRef<HTMLInputElement>(null);

  function atualizarFinal(campos: Partial<{ logradouro: string; numero: string; complemento: string; bairro: string; cidade: string; uf: string; cep: string }>) {
    const l = campos.logradouro ?? logradouro;
    const n = campos.numero ?? numero;
    const c = campos.complemento ?? complemento;
    const b = campos.bairro ?? bairro;
    const ci = campos.cidade ?? cidade;
    const u = campos.uf ?? uf;
    const cp = campos.cep ?? cep;

    const partes = [
      l && n ? `${l}, nº ${n}` : l || (n ? `nº ${n}` : ""),
      c,
      b,
      ci && u ? `${ci}/${u}` : ci || u,
      cp && validarCEP(cp) ? `CEP ${formatarCEP(cp)}` : "",
    ].filter(Boolean);

    if (finalRef.current) finalRef.current.value = partes.join(" – ");
  }

  async function aoSairDoCep() {
    setErroCep(false);
    if (!cep.trim()) return;
    if (!validarCEP(cep)) {
      setErroCep(true);
      return;
    }
    setBuscando(true);
    const endereco = await buscarEnderecoPorCep(cep);
    setBuscando(false);
    if (!endereco) {
      setErroCep(true);
      return;
    }
    setLogradouro(endereco.logradouro);
    setBairro(endereco.bairro);
    setCidade(endereco.localidade);
    setUf(endereco.uf);
    atualizarFinal({
      logradouro: endereco.logradouro,
      bairro: endereco.bairro,
      cidade: endereco.localidade,
      uf: endereco.uf,
    });
  }

  // Endereço já salvo (edição de cadastro existente) — mostra pronto no
  // campo final, sem tentar quebrar em logradouro/número/etc.
  useEffect(() => {
    if (defaultValue && finalRef.current && !finalRef.current.value) {
      finalRef.current.value = defaultValue;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-2 rounded-lg border border-gray-200 p-3">
      <p className="text-sm font-medium text-o2-navy">{label}</p>

      <div>
        <label className="text-xs text-gray-500">CEP (busca o endereço)</label>
        <input
          placeholder="CEP"
          value={cep}
          onChange={(e) => setCep(formatarCEP(e.target.value))}
          onBlur={aoSairDoCep}
          inputMode="numeric"
          className={erroCep ? inputErroClass : inputClass}
        />
        {buscando && <p className="mt-0.5 text-xs text-gray-500">Buscando endereço...</p>}
        {erroCep && <p className="mt-0.5 text-xs text-red-600">CEP não encontrado — preencha manualmente abaixo.</p>}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <input
          placeholder="Logradouro (rua/av.)"
          value={logradouro}
          onChange={(e) => {
            setLogradouro(e.target.value);
            atualizarFinal({ logradouro: e.target.value });
          }}
          className={`${inputClass} col-span-2`}
        />
        <input
          placeholder="Número"
          value={numero}
          onChange={(e) => {
            setNumero(e.target.value);
            atualizarFinal({ numero: e.target.value });
          }}
          className={inputClass}
        />
      </div>

      <input
        placeholder="Complemento (bloco, apto, sala... opcional)"
        value={complemento}
        onChange={(e) => {
          setComplemento(e.target.value);
          atualizarFinal({ complemento: e.target.value });
        }}
        className={inputClass}
      />

      <div className="grid grid-cols-4 gap-2">
        <input
          placeholder="Bairro"
          value={bairro}
          onChange={(e) => {
            setBairro(e.target.value);
            atualizarFinal({ bairro: e.target.value });
          }}
          className={`${inputClass} col-span-2`}
        />
        <input
          placeholder="Cidade"
          value={cidade}
          onChange={(e) => {
            setCidade(e.target.value);
            atualizarFinal({ cidade: e.target.value });
          }}
          className={inputClass}
        />
        <input
          placeholder="UF"
          value={uf}
          maxLength={2}
          onChange={(e) => {
            setUf(e.target.value.toUpperCase());
            atualizarFinal({ uf: e.target.value.toUpperCase() });
          }}
          className={inputClass}
        />
      </div>

      <div>
        <label className="text-xs text-gray-500">Endereço final (pode ajustar manualmente)</label>
        <input ref={finalRef} name={name} required={required} className={inputClass} />
      </div>
    </div>
  );
}
