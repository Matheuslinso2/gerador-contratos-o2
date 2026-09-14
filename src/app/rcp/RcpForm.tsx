"use client";

import { useActionState, useState } from "react";
import { formatarCNPJ, validarCNPJ, apenasDigitos, formatarMoedaDigitada } from "@/lib/validacoesBr";
import { enviarFichaRcp, type EstadoEnvioRcp } from "./actions";

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

function CampoCnpj({ name, label, required }: { name: string; label: string; required?: boolean }) {
  const [valor, setValor] = useState("");
  const [tocado, setTocado] = useState(false);
  const invalido = tocado && apenasDigitos(valor) !== "" && !validarCNPJ(valor);

  return (
    <div>
      <label className={labelClass}>
        {label}
        {required && " *"}
      </label>
      <input
        name={name}
        value={valor}
        onChange={(e) => setValor(formatarCNPJ(e.target.value))}
        onBlur={() => setTocado(true)}
        inputMode="numeric"
        placeholder="00.000.000/0000-00"
        required={required}
        className={invalido ? inputErroClass : inputClass}
      />
      {invalido && <p className="mt-0.5 text-xs text-red-600">CNPJ inválido.</p>}
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

function RcpFormInterno({ aoConcluirNova }: { aoConcluirNova: () => void }) {
  const [estado, formAction, enviando] = useActionState<EstadoEnvioRcp, FormData>(enviarFichaRcp, null);
  const [responseId] = useState(() => crypto.randomUUID());

  if (estado?.ok) {
    return (
      <div className="rounded-xl border border-green-300 bg-green-50 p-6 text-center">
        <p className="text-lg font-semibold" style={{ color: O2_NAVY }}>
          Ficha enviada com sucesso! ✅
        </p>
        <p className="mt-1 text-sm text-gray-600">
          Recebemos os dados. Nossa equipe vai analisar e te enviar a proposta por e-mail. Qualquer dúvida, fale com a gente em{" "}
          <a href="mailto:comercial@o2seguros.com.br" className="underline">
            comercial@o2seguros.com.br
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

      <Secao numero={2} titulo="Empresa">
        <div className="grid grid-cols-2 gap-2">
          <Campo name="nome_empresa" label="Nome da empresa" required className="col-span-2" />
          <CampoCnpj name="cnpj" label="CNPJ" required />
        </div>
        <Campo name="atividade_empresa" label="Atividade da empresa" required />
        <Campo name="endereco" label="Endereço (rua, número, complemento, bairro, cidade/UF e CEP)" required />
      </Secao>

      <Secao numero={3} titulo="Cobertura">
        <CampoMoeda name="valor_cobertura" label="Valor de cobertura desejado" required />
      </Secao>

      <label className="flex items-start gap-2 text-sm text-gray-600">
        <input type="checkbox" name="aceite_lgpd" required className="mt-0.5" />
        <span>
          Confirmo que os dados informados estão corretos e autorizo a O2 Seguros a tratá-los conforme a{" "}
          <a href="/termos" target="_blank" className="font-medium underline" style={{ color: O2_NAVY }}>
            Política de Privacidade
          </a>
          , exclusivamente para cotação e contratação de seguro RCP.
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

export default function RcpForm() {
  const [instancia, setInstancia] = useState(0);
  return <RcpFormInterno key={instancia} aoConcluirNova={() => setInstancia((n) => n + 1)} />;
}
