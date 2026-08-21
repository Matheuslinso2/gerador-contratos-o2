"use client";

import { useActionState, useState } from "react";
import { formatarCPF, formatarCNPJ, validarCPF, validarCNPJ, formatarCEP, validarCEP, buscarEnderecoPorCep, apenasDigitos, formatarMoedaDigitada } from "@/lib/validacoesBr";
import { enviarFichaRcObras, type EstadoEnvioRcObras } from "./actions";
import { COBERTURAS_RC_OBRAS, type CoberturaRcObrasChave } from "@/lib/integracoes/rcObras";

const O2_LARANJA = "#F8540D";
const O2_NAVY = "#01192e";

const inputClass = "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-[#F8540D] focus:outline-none";
const inputErroClass = "w-full rounded-lg border border-red-400 px-3 py-2.5 text-sm focus:border-red-500 focus:outline-none";
const labelClass = "text-xs text-gray-500";

function Secao({ numero, titulo, subtitulo, children }: { numero: number; titulo: string; subtitulo?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-gray-200 p-4">
      <div className="flex items-center gap-2.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: O2_LARANJA }}>
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

function Campo({ name, label, type = "text", required, className }: { name: string; label: string; type?: string; required?: boolean; className?: string }) {
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

function CampoCpfCnpj({ name, label, required }: { name: string; label: string; required?: boolean }) {
  const [valor, setValor] = useState("");
  const [tocado, setTocado] = useState(false);
  const digitos = apenasDigitos(valor);
  const ehCnpj = digitos.length > 11;
  const invalido = tocado && digitos !== "" && (ehCnpj ? !validarCNPJ(valor) : digitos.length === 11 ? !validarCPF(valor) : true);

  return (
    <div>
      <label className={labelClass}>
        {label}
        {required && " *"}
      </label>
      <input
        name={name}
        value={valor}
        onChange={(e) => setValor(ehCnpj || apenasDigitos(e.target.value).length > 11 ? formatarCNPJ(e.target.value) : formatarCPF(e.target.value))}
        onBlur={() => setTocado(true)}
        inputMode="numeric"
        placeholder="CPF ou CNPJ"
        required={required}
        className={invalido ? inputErroClass : inputClass}
      />
      {invalido && <p className="mt-0.5 text-xs text-red-600">CPF/CNPJ inválido.</p>}
    </div>
  );
}

function SeletorUnico({
  name,
  label,
  opcoes,
  required,
  valor,
  aoMudar,
}: {
  name: string;
  label: string;
  opcoes: readonly string[];
  required?: boolean;
  valor: string;
  aoMudar: (v: string) => void;
}) {
  return (
    <div>
      <label className={labelClass}>
        {label}
        {required && " *"}
      </label>
      <input type="hidden" name={name} value={valor} />
      <div className="mt-1 flex flex-wrap gap-1.5">
        {opcoes.map((op) => (
          <label
            key={op}
            className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm has-[:checked]:border-[#F8540D] has-[:checked]:bg-orange-50"
          >
            <input type="radio" name={`_${name}_ui`} checked={valor === op} onChange={() => aoMudar(op)} required={required} className="accent-[#F8540D]" />
            {op}
          </label>
        ))}
      </div>
    </div>
  );
}

function CamposEnderecoObra() {
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
        <label className={labelClass}>CEP da obra (busca o endereço automaticamente) *</label>
        <input
          name="obra_cep"
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
          <input name="obra_logradouro" value={logradouro} onChange={(e) => setLogradouro(e.target.value)} required className={inputClass} />
        </div>
        <Campo name="obra_numero" label="Número" required />
      </div>
      <Campo name="obra_complemento" label="Complemento (opcional)" />
      <div className="grid grid-cols-4 gap-2">
        <div className="col-span-2">
          <label className={labelClass}>Bairro *</label>
          <input name="obra_bairro" value={bairro} onChange={(e) => setBairro(e.target.value)} required className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Cidade *</label>
          <input name="obra_cidade" value={cidade} onChange={(e) => setCidade(e.target.value)} required className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>UF *</label>
          <input name="obra_uf" value={uf} maxLength={2} onChange={(e) => setUf(e.target.value.toUpperCase())} required className={inputClass} />
        </div>
      </div>
    </div>
  );
}

function CampoCobertura({ chave, label }: { chave: CoberturaRcObrasChave; label: string }) {
  const [marcado, setMarcado] = useState(false);
  const [exibicao, setExibicao] = useState("");

  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <label className="flex cursor-pointer items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={marcado}
          onChange={(e) => {
            setMarcado(e.target.checked);
            if (!e.target.checked) setExibicao("");
          }}
          className="mt-0.5 accent-[#F8540D]"
        />
        <span style={{ color: O2_NAVY }}>{label}</span>
      </label>
      {marcado && (
        <div className="mt-2 pl-6">
          <input
            name={`cobertura_${chave}`}
            value={exibicao}
            onChange={(e) => setExibicao(formatarMoedaDigitada(e.target.value).exibicao)}
            placeholder="R$ 0,00"
            inputMode="numeric"
            required
            className={inputClass}
          />
        </div>
      )}
    </div>
  );
}

function RcObrasFormInterno({ aoConcluirNova }: { aoConcluirNova: () => void }) {
  const [estado, formAction, enviando] = useActionState<EstadoEnvioRcObras, FormData>(enviarFichaRcObras, null);
  const [responseId] = useState(() => crypto.randomUUID());
  const [tipoObra, setTipoObra] = useState("");
  const [reforcoEstrutural, setReforcoEstrutural] = useState("");
  const [evolucaoObra, setEvolucaoObra] = useState("");

  if (estado?.ok) {
    return (
      <div className="rounded-xl border border-green-300 bg-green-50 p-6 text-center">
        <p className="text-lg font-semibold" style={{ color: O2_NAVY }}>
          Ficha enviada com sucesso! ✅
        </p>
        <p className="mt-1 text-sm text-gray-600">
          Recebemos os dados. Nossa equipe vai analisar e entrar em contato. Qualquer dúvida, fale com a gente em{" "}
          <a href="mailto:incendio@o2seguros.com.br" className="underline">
            incendio@o2seguros.com.br
          </a>
          .
        </p>
        <button
          type="button"
          onClick={aoConcluirNova}
          className="mt-4 rounded-full border px-4 py-2 text-sm font-medium transition hover:bg-gray-50"
          style={{ borderColor: O2_LARANJA, color: O2_LARANJA }}
        >
          Preencher outra ficha
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="response_id" value={responseId} />
      {estado?.erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">⚠️ {estado.erro}</p>}

      <Secao numero={1} titulo="Contato" subtitulo="Pra onde enviamos a proposta">
        <div className="grid grid-cols-2 gap-2">
          <Campo name="email" label="Seu e-mail" type="email" required />
          <Campo name="telefone" label="Telefone" required />
        </div>
      </Secao>

      <Secao numero={2} titulo="Segurado">
        <div className="grid grid-cols-2 gap-2">
          <Campo name="nome_completo" label="Nome completo" required className="col-span-2" />
          <CampoCpfCnpj name="cpf_cnpj" label="CPF/CNPJ" required />
        </div>
      </Secao>

      <Secao numero={3} titulo="Local da obra">
        <CamposEnderecoObra />
      </Secao>

      <Secao numero={4} titulo="Dados da obra">
        <SeletorUnico name="tipo_obra" label="Reforma ou construção do zero?" required opcoes={["Reforma", "Construção do zero"]} valor={tipoObra} aoMudar={setTipoObra} />
        <SeletorUnico name="reforco_estrutural" label="A obra tem reforço estrutural?" required opcoes={["Sim", "Não"]} valor={reforcoEstrutural} aoMudar={setReforcoEstrutural} />
        <div className="grid grid-cols-2 gap-2">
          <Campo name="data_inicio" label="Data de início da obra" type="date" required />
          <Campo name="data_fim" label="Data do fim da obra" type="date" required />
        </div>
        <SeletorUnico
          name="evolucao_obra"
          label="Qual porcentagem de evolução da obra?"
          required
          opcoes={["0%", "Até 20%", "Até 30%", "Acima de 30%"]}
          valor={evolucaoObra}
          aoMudar={setEvolucaoObra}
        />
      </Secao>

      <Secao numero={5} titulo="Coberturas" subtitulo="Marque as que deseja contratar e informe o valor de cada uma">
        <div className="space-y-2">
          {COBERTURAS_RC_OBRAS.map((c) => (
            <CampoCobertura key={c.chave} chave={c.chave} label={c.label} />
          ))}
        </div>
      </Secao>

      <label className="flex items-start gap-2 text-sm text-gray-600">
        <input type="checkbox" name="aceite_lgpd" required className="mt-0.5" />
        <span>
          Confirmo que os dados informados estão corretos e autorizo a O2 Seguros a tratá-los conforme a{" "}
          <a href="/termos" target="_blank" className="font-medium underline" style={{ color: O2_NAVY }}>
            Política de Privacidade
          </a>
          , exclusivamente para cotação e contratação de seguro RC Obras.
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

export default function RcObrasForm() {
  const [instancia, setInstancia] = useState(0);
  return <RcObrasFormInterno key={instancia} aoConcluirNova={() => setInstancia((n) => n + 1)} />;
}
