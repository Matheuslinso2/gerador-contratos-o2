"use client";

import { useRef, useState } from "react";
import { formatarCPF, validarCPF } from "@/lib/validacoesBr";
import { PROFISSOES } from "@/lib/profissoes";
import { NACIONALIDADES } from "@/lib/nacionalidades";
import { ESTADOS_CIVIS } from "@/lib/estadosCivis";
import CampoEndereco from "@/components/CampoEndereco";

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-o2-coral focus:outline-none";
const inputErroClass =
  "w-full rounded-lg border border-red-400 px-3 py-2 text-sm focus:border-red-500 focus:outline-none";

function LinhaPessoa({
  fieldName,
  placeholder,
  numero,
  aoRemover,
}: {
  fieldName: string;
  placeholder: string;
  numero: number | null;
  aoRemover: (() => void) | null;
}) {
  const [cpf, setCpf] = useState("");
  const [cpfTocado, setCpfTocado] = useState(false);
  const [profissao, setProfissao] = useState("");
  const [profissaoOutra, setProfissaoOutra] = useState(false);
  const [nacionalidade, setNacionalidade] = useState("");
  const [nacionalidadeOutra, setNacionalidadeOutra] = useState(false);

  const cpfInvalido = cpfTocado && cpf.trim() !== "" && !validarCPF(cpf);

  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium text-o2-navy">
          {placeholder} {numero ?? ""}
        </p>
        {aoRemover && (
          <button
            type="button"
            onClick={aoRemover}
            className="text-sm text-gray-400 hover:text-red-600"
            aria-label={`Remover ${placeholder.toLowerCase()} ${numero}`}
          >
            Remover ×
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <input
          name={`${fieldName}_nome`}
          placeholder="Nome completo"
          required={numero === null || numero === 1}
          className={`${inputClass} col-span-2`}
        />
        {nacionalidadeOutra ? (
          <input
            name={`${fieldName}_nacionalidade`}
            placeholder="Nacionalidade"
            defaultValue=""
            className={inputClass}
            autoFocus
          />
        ) : (
          <select
            name={`${fieldName}_nacionalidade`}
            value={nacionalidade}
            onChange={(e) => {
              if (e.target.value === "Outra") {
                setNacionalidadeOutra(true);
                setNacionalidade("");
              } else {
                setNacionalidade(e.target.value);
              }
            }}
            className={inputClass}
          >
            <option value="">Nacionalidade...</option>
            {NACIONALIDADES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        )}

        <select name={`${fieldName}_estado_civil`} defaultValue="" className={inputClass}>
          <option value="">Estado civil...</option>
          {ESTADOS_CIVIS.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>

        {profissaoOutra ? (
          <input
            name={`${fieldName}_profissao`}
            placeholder="Profissão"
            defaultValue=""
            className={inputClass}
            autoFocus
          />
        ) : (
          <select
            name={`${fieldName}_profissao`}
            value={profissao}
            onChange={(e) => {
              if (e.target.value === "Outra") {
                setProfissaoOutra(true);
                setProfissao("");
              } else {
                setProfissao(e.target.value);
              }
            }}
            className={inputClass}
          >
            <option value="">Profissão...</option>
            {PROFISSOES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        )}

        <div>
          <input
            name={`${fieldName}_cpf`}
            placeholder="CPF"
            value={cpf}
            onChange={(e) => setCpf(formatarCPF(e.target.value))}
            onBlur={() => setCpfTocado(true)}
            inputMode="numeric"
            className={cpfInvalido ? inputErroClass : inputClass}
          />
          {cpfInvalido && <p className="mt-0.5 text-xs text-red-600">CPF inválido.</p>}
        </div>

        <input name={`${fieldName}_rg`} placeholder="RG / Carteira de Identidade" className={inputClass} />
        <input name={`${fieldName}_rg_orgao`} placeholder="Órgão expedidor (ex: SSP/RJ)" className={inputClass} />
      </div>

      <div className="mt-2">
        <CampoEndereco name={`${fieldName}_endereco`} label="Endereço residencial" />
      </div>
    </div>
  );
}

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
        <LinhaPessoa
          key={id}
          fieldName={fieldName}
          placeholder={placeholder}
          numero={ids.length > 1 ? i + 1 : null}
          aoRemover={ids.length > 1 ? () => setIds((prev) => prev.filter((x) => x !== id)) : null}
        />
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
