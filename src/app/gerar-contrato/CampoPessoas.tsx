"use client";

import { useRef, useState } from "react";
import { formatarCPF, validarCPF, formatarCEP, validarCEP, buscarEnderecoPorCep } from "@/lib/validacoesBr";
import { PROFISSOES } from "@/lib/profissoes";

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
  const [cep, setCep] = useState("");
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [cepErro, setCepErro] = useState(false);
  const [profissao, setProfissao] = useState("");
  const [profissaoOutra, setProfissaoOutra] = useState(false);
  const enderecoRef = useRef<HTMLInputElement>(null);

  const cpfInvalido = cpfTocado && cpf.trim() !== "" && !validarCPF(cpf);

  async function aoSairDoCep() {
    setCepErro(false);
    if (!cep.trim()) return;
    if (!validarCEP(cep)) {
      setCepErro(true);
      return;
    }
    setBuscandoCep(true);
    const endereco = await buscarEnderecoPorCep(cep);
    setBuscandoCep(false);
    if (!endereco) {
      setCepErro(true);
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
        <input name={`${fieldName}_nacionalidade`} placeholder="Nacionalidade (ex: brasileiro)" className={inputClass} />
        <input name={`${fieldName}_estado_civil`} placeholder="Estado civil" className={inputClass} />

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

        <div>
          <input
            placeholder="CEP (busca o endereço)"
            value={cep}
            onChange={(e) => setCep(formatarCEP(e.target.value))}
            onBlur={aoSairDoCep}
            inputMode="numeric"
            className={cepErro ? inputErroClass : inputClass}
          />
          {buscandoCep && <p className="mt-0.5 text-xs text-gray-500">Buscando endereço...</p>}
          {cepErro && <p className="mt-0.5 text-xs text-red-600">CEP não encontrado — preencha o endereço manualmente.</p>}
        </div>
        <input
          ref={enderecoRef}
          name={`${fieldName}_endereco`}
          placeholder="Endereço residencial (residente e domiciliado em)"
          className={inputClass}
        />
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
