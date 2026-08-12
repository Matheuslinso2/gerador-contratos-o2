"use client";

import { useActionState, useState } from "react";
import {
  formatarCPF,
  validarCPF,
  formatarCNPJ,
  validarCNPJ,
  formatarCEP,
  validarCEP,
  buscarEnderecoPorCep,
  formatarMoedaDigitada,
} from "@/lib/validacoesBr";
import { PROFISSOES } from "@/lib/profissoes";
import { ESTADOS_CIVIS } from "@/lib/estadosCivis";
import { enviarFormularioCapitalizacao, type EstadoEnvioCapitalizacao } from "./actions";

const O2_LARANJA = "#F8540D";
const O2_NAVY = "#01192e";

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-[#F8540D] focus:outline-none";
const inputErroClass =
  "w-full rounded-lg border border-red-400 px-3 py-2.5 text-sm focus:border-red-500 focus:outline-none";
const labelClass = "text-xs text-gray-500";

function Secao({
  numero,
  titulo,
  subtitulo,
  children,
}: {
  numero: number;
  titulo: string;
  subtitulo?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-xl border border-gray-200 p-4">
      <div className="flex items-center gap-2.5">
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
          style={{ background: O2_LARANJA }}
        >
          {numero}
        </span>
        <div>
          <h2 className="text-sm font-semibold" style={{ color: O2_NAVY }}>
            {titulo}
          </h2>
          {subtitulo && <p className="text-xs text-gray-500">{subtitulo}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function SeletorTipoPessoa({
  name,
  valor,
  aoMudar,
}: {
  name: string;
  valor: "PF" | "PJ";
  aoMudar: (v: "PF" | "PJ") => void;
}) {
  return (
    <div className="inline-flex rounded-full border border-gray-300 p-1 text-sm">
      {(["PF", "PJ"] as const).map((opcao) => (
        <label
          key={opcao}
          className="cursor-pointer rounded-full px-4 py-1.5 font-medium transition"
          style={valor === opcao ? { background: O2_LARANJA, color: "#fff" } : { color: "#6b7280" }}
        >
          <input
            type="radio"
            name={name}
            value={opcao}
            checked={valor === opcao}
            onChange={() => aoMudar(opcao)}
            className="sr-only"
          />
          {opcao === "PF" ? "Pessoa física" : "Pessoa jurídica"}
        </label>
      ))}
    </div>
  );
}

function Campo({
  name,
  label,
  type = "text",
  required,
  className,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className={labelClass}>
        {label}
        {required && " *"}
      </label>
      <input name={name} type={type} required={required} className={inputClass} />
    </div>
  );
}

function CampoMoeda({ name, label, required }: { name: string; label: string; required?: boolean }) {
  const [exibicao, setExibicao] = useState("");
  return (
    <div>
      <label className={labelClass}>
        {label}
        {required && " *"}
      </label>
      <input
        name={name}
        value={exibicao}
        onChange={(e) => setExibicao(formatarMoedaDigitada(e.target.value).exibicao)}
        placeholder="R$ 0,00"
        inputMode="numeric"
        required={required}
        className={inputClass}
      />
    </div>
  );
}

function CampoDocumento({
  name,
  label,
  tipo,
  required,
}: {
  name: string;
  label: string;
  tipo: "cpf" | "cnpj";
  required?: boolean;
}) {
  const [valor, setValor] = useState("");
  const [tocado, setTocado] = useState(false);
  const formatar = tipo === "cpf" ? formatarCPF : formatarCNPJ;
  const validar = tipo === "cpf" ? validarCPF : validarCNPJ;
  const invalido = tocado && valor.trim() !== "" && !validar(valor);
  return (
    <div>
      <label className={labelClass}>
        {label}
        {required && " *"}
      </label>
      <input
        name={name}
        value={valor}
        onChange={(e) => setValor(formatar(e.target.value))}
        onBlur={() => setTocado(true)}
        inputMode="numeric"
        required={required}
        className={invalido ? inputErroClass : inputClass}
      />
      {invalido && <p className="mt-0.5 text-xs text-red-600">{tipo.toUpperCase()} inválido.</p>}
    </div>
  );
}

function CampoProfissao({ name }: { name: string }) {
  const [valor, setValor] = useState("");
  const [outra, setOutra] = useState(false);
  if (outra) {
    return (
      <div>
        <label className={labelClass}>Profissão</label>
        <input name={name} placeholder="Profissão" className={inputClass} autoFocus />
      </div>
    );
  }
  return (
    <div>
      <label className={labelClass}>Profissão</label>
      <select
        name={name}
        value={valor}
        onChange={(e) => {
          if (e.target.value === "Outra") {
            setOutra(true);
            setValor("");
          } else {
            setValor(e.target.value);
          }
        }}
        className={inputClass}
      >
        <option value="">Selecione...</option>
        {PROFISSOES.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
        <option value="Outra">Outra</option>
      </select>
    </div>
  );
}

function CamposImovel() {
  const [cep, setCep] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [erroCep, setErroCep] = useState(false);
  const [logradouro, setLogradouro] = useState("");
  const [bairro, setBairro] = useState("");
  const [cidade, setCidade] = useState("");
  const [uf, setUf] = useState("");

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
  }

  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>CEP (busca o endereço automaticamente) *</label>
        <input
          name="imovel_cep"
          value={cep}
          onChange={(e) => setCep(formatarCEP(e.target.value))}
          onBlur={aoSairDoCep}
          inputMode="numeric"
          required
          className={erroCep ? inputErroClass : inputClass}
        />
        {buscando && <p className="mt-0.5 text-xs text-gray-500">Buscando endereço...</p>}
        {erroCep && <p className="mt-0.5 text-xs text-red-600">CEP não encontrado — preencha o endereço manualmente.</p>}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2">
          <label className={labelClass}>Logradouro (rua/av.) *</label>
          <input
            name="imovel_logradouro"
            value={logradouro}
            onChange={(e) => setLogradouro(e.target.value)}
            required
            className={inputClass}
          />
        </div>
        <Campo name="imovel_numero" label="Número" required />
      </div>
      <Campo name="imovel_complemento" label="Complemento (opcional)" />
      <div className="grid grid-cols-4 gap-2">
        <div className="col-span-2">
          <label className={labelClass}>Bairro *</label>
          <input name="imovel_bairro" value={bairro} onChange={(e) => setBairro(e.target.value)} required className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Cidade *</label>
          <input name="imovel_cidade" value={cidade} onChange={(e) => setCidade(e.target.value)} required className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>UF *</label>
          <input
            name="imovel_uf"
            value={uf}
            maxLength={2}
            onChange={(e) => setUf(e.target.value.toUpperCase())}
            required
            className={inputClass}
          />
        </div>
      </div>
    </div>
  );
}

function CamposPessoaFisica({ prefixo, comQualificacao }: { prefixo: string; comQualificacao?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Campo name={`${prefixo}_nome`} label="Nome completo" required className="col-span-2" />
      <CampoDocumento name={`${prefixo}_cpf`} label="CPF" tipo="cpf" required />
      <Campo name={`${prefixo}_nascimento`} label="Data de nascimento" type="date" required />
      <Campo name={`${prefixo}_rg`} label="RG / Carteira de identidade" required />
      <Campo name={`${prefixo}_rg_orgao`} label="Órgão expedidor (ex: SSP)" required />
      <Campo name={`${prefixo}_rg_uf`} label="UF de emissão" required />
      {comQualificacao && (
        <>
          <Campo name={`${prefixo}_rg_emissao`} label="Data de emissão do RG" type="date" required />
          <div>
            <label className={labelClass}>Estado civil *</label>
            <select name={`${prefixo}_estado_civil`} required defaultValue="" className={inputClass}>
              <option value="" disabled>
                Selecione...
              </option>
              {ESTADOS_CIVIS.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </div>
          <CampoProfissao name={`${prefixo}_profissao`} />
          <CampoMoeda name={`${prefixo}_renda`} label="Renda mensal" required />
        </>
      )}
    </div>
  );
}

function CamposPessoaJuridica({ prefixo, comTelefone, comRenda }: { prefixo: string; comTelefone?: boolean; comRenda?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Campo name={`${prefixo}_razao`} label="Razão social" required className="col-span-2" />
      <CampoDocumento name={`${prefixo}_cnpj`} label="CNPJ" tipo="cnpj" required />
      <Campo name={`${prefixo}_fundacao`} label="Data de fundação" type="date" required />
      <Campo name={`${prefixo}_inscricao`} label="Inscrição estadual" />
      <Campo name={`${prefixo}_socio`} label="Sócio responsável" required />
      <CampoDocumento name={`${prefixo}_socio_cpf`} label="CPF do sócio responsável" tipo="cpf" required />
      {comRenda && <CampoMoeda name={`${prefixo}_renda`} label="Faturamento mensal" required />}
      {comTelefone && <Campo name={`${prefixo}_telefone`} label="Telefone" required />}
    </div>
  );
}

export default function CapitalizacaoForm() {
  const [estado, formAction, enviando] = useActionState<EstadoEnvioCapitalizacao, FormData>(
    enviarFormularioCapitalizacao,
    null
  );
  const [quemAdministra, setQuemAdministra] = useState("");
  const [formaPagamento, setFormaPagamento] = useState("");
  const [tipoLocatario, setTipoLocatario] = useState<"PF" | "PJ">("PF");
  const [tipoLocador, setTipoLocador] = useState<"PF" | "PJ">("PF");

  if (estado?.ok) {
    return (
      <div className="rounded-xl border border-green-300 bg-green-50 p-6 text-center">
        <p className="text-lg font-semibold" style={{ color: O2_NAVY }}>
          Ficha enviada com sucesso! ✅
        </p>
        <p className="mt-1 text-sm text-gray-600">
          Recebemos os dados do Título de Capitalização e já criamos o registro na O2. Em breve entraremos em
          contato.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      {estado?.erro && (
        <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">⚠️ {estado.erro}</p>
      )}

      <Secao numero={1} titulo="Identificação" subtitulo="Quem está preenchendo esta ficha?">
        <Campo name="email_contato" label="E-mail de contato" type="email" required />
        <div>
          <label className={labelClass}>Quem administra o imóvel? *</label>
          <select
            name="quem_administra"
            value={quemAdministra}
            onChange={(e) => setQuemAdministra(e.target.value)}
            required
            className={inputClass}
          >
            <option value="" disabled>
              Selecione...
            </option>
            <option value="Imobiliária">Imobiliária</option>
            <option value="Corretor individual">Corretor individual</option>
            <option value="Proprietário">Proprietário(a) direto</option>
          </select>
        </div>
      </Secao>

      {quemAdministra === "Imobiliária" && (
        <Secao numero={2} titulo="Dados da imobiliária">
          <div className="grid grid-cols-2 gap-2">
            <Campo name="imobiliaria_nome" label="Nome da imobiliária" required />
            <Campo name="imobiliaria_email" label="E-mail da imobiliária" type="email" required />
          </div>
        </Secao>
      )}
      {quemAdministra === "Corretor individual" && (
        <Secao numero={2} titulo="Dados do corretor">
          <div className="grid grid-cols-2 gap-2">
            <Campo name="corretor_nome" label="Nome do corretor" required />
            <Campo name="corretor_email" label="E-mail do corretor" type="email" required />
          </div>
        </Secao>
      )}

      <Secao numero={3} titulo="Informações do título de capitalização">
        <div className="grid grid-cols-2 gap-2">
          <CampoMoeda name="valor_titulo" label="Valor do título" required />
          <div>
            <label className={labelClass}>Encargos considerados no cálculo? *</label>
            <select name="encargos_considerados" required defaultValue="" className={inputClass}>
              <option value="" disabled>
                Selecione...
              </option>
              <option value="Sim">Sim</option>
              <option value="Não">Não</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Prazo *</label>
            <select name="prazo" required defaultValue="" className={inputClass}>
              <option value="" disabled>
                Selecione...
              </option>
              {["12 meses", "15 meses", "18 meses", "24 meses", "30 meses"].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Forma de pagamento *</label>
            <select
              name="forma_pagamento"
              value={formaPagamento}
              onChange={(e) => setFormaPagamento(e.target.value)}
              required
              className={inputClass}
            >
              <option value="" disabled>
                Selecione...
              </option>
              <option value="Boleto">Boleto</option>
              <option value="Cartão">Cartão</option>
            </select>
          </div>
        </div>
        {formaPagamento === "Cartão" && (
          <div className="grid grid-cols-2 gap-2">
            <Campo name="titular_cartao" label="Titular(es) do cartão" required />
            <CampoDocumento name="cpf_cartao" label="CPF do titular do cartão" tipo="cpf" required />
          </div>
        )}
      </Secao>

      <Secao numero={4} titulo="Locatário" subtitulo="Quem vai morar no imóvel">
        <SeletorTipoPessoa name="tipo_locatario" valor={tipoLocatario} aoMudar={setTipoLocatario} />
        {tipoLocatario === "PF" ? (
          <CamposPessoaFisica prefixo="locat_pf" comQualificacao />
        ) : (
          <CamposPessoaJuridica prefixo="locat_pj" comRenda />
        )}
        <div className="grid grid-cols-2 gap-2">
          <Campo name="locat_email" label="E-mail do locatário" type="email" required />
          <Campo name="locat_telefone" label="Telefone do locatário" required />
        </div>
      </Secao>

      <Secao numero={5} titulo="Dados do imóvel">
        <CamposImovel />
      </Secao>

      <Secao numero={6} titulo="Locador" subtitulo="Dono(a) do imóvel">
        <SeletorTipoPessoa name="tipo_locador" valor={tipoLocador} aoMudar={setTipoLocador} />
        {tipoLocador === "PF" ? (
          <CamposPessoaFisica prefixo="locador_pf" />
        ) : (
          <CamposPessoaJuridica prefixo="locador_pj" comTelefone />
        )}
      </Secao>

      <label className="flex items-start gap-2 text-sm text-gray-600">
        <input type="checkbox" name="aceite_lgpd" required className="mt-0.5" />
        <span>
          Confirmo que tenho autorização das pessoas citadas nesta ficha para enviar seus dados à O2 Seguros, que os
          tratará conforme a{" "}
          <a href="/termos" target="_blank" className="font-medium underline" style={{ color: O2_NAVY }}>
            Política de Privacidade
          </a>
          , exclusivamente para a emissão do título de capitalização.
        </span>
      </label>

      <button
        type="submit"
        disabled={enviando}
        className="w-full rounded-full px-4 py-2.5 font-medium text-white transition hover:opacity-90 disabled:opacity-60"
        style={{ background: O2_LARANJA }}
      >
        {enviando ? "Enviando..." : "Enviar ficha"}
      </button>
    </form>
  );
}
