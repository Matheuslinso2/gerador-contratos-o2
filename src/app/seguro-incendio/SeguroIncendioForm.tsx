"use client";

import { useActionState, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import {
  formatarCPF,
  validarCPF,
  formatarCEP,
  validarCEP,
  buscarEnderecoPorCep,
  formatarMoedaDigitada,
} from "@/lib/validacoesBr";
import { enviarFichaSeguroIncendio, type EstadoEnvioSeguroIncendio } from "./actions";
import type { ModalidadeIncendio } from "@/lib/integracoes/seguroIncendio";

const O2_LARANJA = "#F8540D";
const O2_NAVY = "#01192e";
const BUCKET = "seguro-incendio-anexos";

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

function Campo({
  name,
  label,
  type = "text",
  required,
  className,
  min,
  step,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  className?: string;
  min?: string | number;
  step?: string | number;
}) {
  return (
    <div className={className}>
      <label className={labelClass}>
        {label}
        {required && " *"}
      </label>
      <input name={name} type={type} required={required} min={min} step={step} className={inputClass} />
    </div>
  );
}

// Quando exigirMaiorQueZero, bloqueia o envio de verdade (não só um aviso)
// via setCustomValidity nativo do navegador -- "0,00" preenchido conta como
// valor ausente pro negócio (ex: aluguel de imóvel alugado não existe a R$
// 0), então não basta exigir presença do campo.
function CampoMoeda({
  name,
  label,
  required,
  exigirMaiorQueZero,
}: {
  name: string;
  label: string;
  required?: boolean;
  exigirMaiorQueZero?: boolean;
}) {
  const [exibicao, setExibicao] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function aoMudar(valorDigitado: string) {
    const { exibicao: novaExibicao, numero } = formatarMoedaDigitada(valorDigitado);
    setExibicao(novaExibicao);
    if (inputRef.current) {
      const invalido = exigirMaiorQueZero && novaExibicao !== "" && numero <= 0;
      inputRef.current.setCustomValidity(invalido ? "Informe um valor maior que R$ 0,00." : "");
    }
  }

  return (
    <div>
      <label className={labelClass}>
        {label}
        {required && " *"}
      </label>
      <input
        ref={inputRef}
        name={name}
        value={exibicao}
        onChange={(e) => aoMudar(e.target.value)}
        placeholder="R$ 0,00"
        inputMode="numeric"
        required={required}
        className={inputClass}
      />
    </div>
  );
}

function CampoCpf({ name, label, required }: { name: string; label: string; required?: boolean }) {
  const [valor, setValor] = useState("");
  const [tocado, setTocado] = useState(false);
  const invalido = tocado && valor.trim() !== "" && !validarCPF(valor);
  return (
    <div>
      <label className={labelClass}>
        {label}
        {required && " *"}
      </label>
      <input
        name={name}
        value={valor}
        onChange={(e) => setValor(formatarCPF(e.target.value))}
        onBlur={() => setTocado(true)}
        inputMode="numeric"
        required={required}
        className={invalido ? inputErroClass : inputClass}
      />
      {invalido && <p className="mt-0.5 text-xs text-red-600">CPF inválido.</p>}
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

function SeletorModalidade({ valor, aoMudar }: { valor: ModalidadeIncendio; aoMudar: (v: ModalidadeIncendio) => void }) {
  const opcoes: { valor: ModalidadeIncendio; label: string }[] = [
    { valor: "Residencial", label: "Individual Residencial" },
    { valor: "Empresarial", label: "Individual Empresarial" },
    { valor: "Imobiliario", label: "Imobiliário" },
  ];
  return (
    <div className="inline-flex flex-wrap rounded-full border border-gray-300 p-1 text-sm">
      {opcoes.map((op) => (
        <label key={op.valor} className="cursor-pointer rounded-full px-4 py-1.5 font-medium transition" style={valor === op.valor ? { background: O2_LARANJA, color: "#fff" } : { color: "#6b7280" }}>
          <input type="radio" name="modalidade" value={op.valor} checked={valor === op.valor} onChange={() => aoMudar(op.valor)} className="sr-only" />
          {op.label}
        </label>
      ))}
    </div>
  );
}

function CamposImovel() {
  const [cep, setCep] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [erroCep, setErroCep] = useState(false);
  const [endereco, setEndereco] = useState("");
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
    const resultado = await buscarEnderecoPorCep(cep);
    setBuscando(false);
    if (!resultado) {
      setErroCep(true);
      return;
    }
    setBairro(resultado.bairro);
    setCidade(resultado.localidade);
    setUf(resultado.uf);
    setEndereco(resultado.logradouro);
  }

  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>CEP do imóvel (busca o endereço automaticamente) *</label>
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
      <div>
        <label className={labelClass}>Endereço completo do imóvel (rua, número, complemento) *</label>
        <input value={endereco} onChange={(e) => setEndereco(e.target.value)} required className={inputClass} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <input value={bairro} onChange={(e) => setBairro(e.target.value)} placeholder="Bairro" className={inputClass} />
        <input value={cidade} onChange={(e) => setCidade(e.target.value)} placeholder="Cidade" className={inputClass} />
        <input value={uf} maxLength={2} onChange={(e) => setUf(e.target.value.toUpperCase())} placeholder="UF" className={inputClass} />
      </div>
      <input
        type="hidden"
        name="imovel_endereco"
        value={[endereco, bairro && cidade && uf ? `${bairro}, ${cidade}/${uf}` : ""].filter(Boolean).join(" – ")}
      />
    </div>
  );
}

type ArquivoStatus = { nome: string; estado: "enviando" | "ok" | "erro"; mensagem?: string };

function IconeUpload() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 16V4" />
      <path d="M7 9l5-5 5 5" />
      <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

function CampoUploadPlanilha({ responseId, path, setPath, nome, setNome }: { responseId: string; path: string; setPath: (v: string) => void; nome: string; setNome: (v: string) => void }) {
  const [arquivo, setArquivo] = useState<ArquivoStatus | null>(null);

  async function aoSelecionar(e: React.ChangeEvent<HTMLInputElement>) {
    const selecionado = e.target.files?.[0];
    e.target.value = "";
    if (!selecionado) return;

    const maxMb = 20;
    if (selecionado.size > maxMb * 1024 * 1024) {
      setArquivo({ nome: selecionado.name, estado: "erro", mensagem: `Maior que ${maxMb}MB` });
      return;
    }
    setArquivo({ nome: selecionado.name, estado: "enviando" });
    const extensao = selecionado.name.split(".").pop()?.toLowerCase() || "bin";
    const novoPath = `${responseId}/planilha/${crypto.randomUUID()}.${extensao}`;
    const supabase = createClient();
    const { error } = await supabase.storage.from(BUCKET).upload(novoPath, selecionado, { contentType: selecionado.type || "application/octet-stream" });
    if (error) {
      setArquivo({ nome: selecionado.name, estado: "erro", mensagem: "Falha no envio" });
      return;
    }
    setArquivo({ nome: selecionado.name, estado: "ok" });
    setPath(novoPath);
    setNome(selecionado.name);
  }

  return (
    <div>
      <label className={labelClass}>Planilha com os itens (endereços, aluguel, m²) *</label>
      <p className="mt-0.5 text-xs text-gray-500">1 arquivo, Excel/CSV/PDF, até 20MB.</p>
      <input type="hidden" name="anexo_planilha" value={path} />
      <input type="hidden" name="anexo_planilha_nome" value={nome} />
      <label
        className="mt-1.5 inline-flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
        style={{ background: O2_LARANJA }}
      >
        <IconeUpload />
        {nome ? "Trocar planilha" : "Selecionar planilha"}
        <input type="file" accept=".xlsx,.xls,.csv,.ods,.pdf" onChange={aoSelecionar} className="sr-only" />
      </label>
      {arquivo && (
        <p className={`mt-1.5 text-xs ${arquivo.estado === "erro" ? "text-red-600" : arquivo.estado === "ok" ? "text-green-700" : "text-gray-500"}`}>
          {arquivo.nome} — {arquivo.estado === "enviando" ? "enviando..." : arquivo.estado === "ok" ? "enviado ✅" : arquivo.mensagem}
        </p>
      )}
    </div>
  );
}

function SeguroIncendioFormInterno({ aoConcluirNova }: { aoConcluirNova: () => void }) {
  const [estado, formAction, enviando] = useActionState<EstadoEnvioSeguroIncendio, FormData>(enviarFichaSeguroIncendio, null);
  const [responseId] = useState(() => crypto.randomUUID());
  const [modalidade, setModalidade] = useState<ModalidadeIncendio>("Residencial");
  const [solicitante, setSolicitante] = useState("");
  const [finsLocacao, setFinsLocacao] = useState("");
  const [administradoPorImobiliaria, setAdministradoPorImobiliaria] = useState("");
  const [anexoPlanilha, setAnexoPlanilha] = useState("");
  const [anexoPlanilhaNome, setAnexoPlanilhaNome] = useState("");

  // Inquilino e Imobiliária/Administradora só solicitam cotação de imóvel
  // alugado, por definição. Só o Proprietário pode estar segurando o
  // próprio imóvel (sem aluguel envolvido) -- por isso só nesse caso a
  // pergunta extra decide se pede metragem/valor do aluguel.
  const precisaDadosAluguel =
    solicitante === "Inquilino" || solicitante === "Imobiliária/Administradora" || (solicitante === "Proprietário" && finsLocacao === "Sim");

  if (estado?.ok) {
    return (
      <div className="rounded-xl border border-green-300 bg-green-50 p-6 text-center">
        <p className="text-lg font-semibold" style={{ color: O2_NAVY }}>
          Ficha enviada com sucesso! ✅
        </p>
        <p className="mt-1 text-sm text-gray-600">
          {estado.pendente
            ? "Recebemos os dados e nossa equipe já está com eles."
            : "Recebemos os dados. Nossa equipe vai analisar e te enviar a proposta por e-mail."}{" "}
          Qualquer dúvida, fale com a gente em{" "}
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

      <Secao numero={1} titulo="Modalidade" subtitulo="Qual tipo de seguro incêndio você quer cotar?">
        <SeletorModalidade valor={modalidade} aoMudar={setModalidade} />
      </Secao>

      {modalidade === "Imobiliario" ? (
        <Secao numero={2} titulo="Dados da imobiliária e planilha">
          <div className="grid grid-cols-2 gap-2">
            <Campo name="nome_imobiliaria" label="Nome da imobiliária" required className="col-span-2" />
            <Campo name="email" label="E-mail de contato" type="email" required />
            <Campo name="telefone" label="Telefone" required />
            <Campo name="qtd_enderecos" label="Quantidade de endereços na planilha" type="number" />
          </div>
          <CampoUploadPlanilha responseId={responseId} path={anexoPlanilha} setPath={setAnexoPlanilha} nome={anexoPlanilhaNome} setNome={setAnexoPlanilhaNome} />
        </Secao>
      ) : (
        <>
          <Secao numero={2} titulo="Quem está solicitando?">
            <SeletorUnico
              name="solicitante"
              label="Você é"
              required
              opcoes={["Proprietário", "Inquilino", "Imobiliária/Administradora"]}
              valor={solicitante}
              aoMudar={(v) => {
                setSolicitante(v);
                if (v !== "Proprietário") setFinsLocacao("");
              }}
            />
            {solicitante === "Proprietário" && (
              <SeletorUnico
                name="fins_locacao"
                label="A cotação é para fins de locação a terceiros?"
                required
                opcoes={["Sim", "Não"]}
                valor={finsLocacao}
                aoMudar={setFinsLocacao}
              />
            )}
          </Secao>

          <Secao numero={3} titulo="Dados do proprietário">
            <div className="grid grid-cols-2 gap-2">
              <Campo name="nome_proprietario" label="Nome completo do proprietário" required className="col-span-2" />
              <CampoCpf name="cpf_proprietario" label="CPF do proprietário" required />
              <Campo name="email" label="E-mail" type="email" required />
              <Campo name="telefone" label="Telefone" required />
              {modalidade === "Empresarial" && (
                <Campo
                  name="atividade_comercial"
                  label="Atividade do imóvel comercial (ex: padaria, escritório de contabilidade)"
                  required
                  className="col-span-2"
                />
              )}
            </div>
          </Secao>

          <Secao numero={4} titulo="Imóvel">
            <CamposImovel />
            {precisaDadosAluguel && (
              <div className="grid grid-cols-2 gap-2">
                <Campo name="metragem" label="Metragem do imóvel (m²)" type="number" min="1" step="1" required />
                <CampoMoeda name="valor_aluguel" label="Valor do aluguel" required exigirMaiorQueZero />
              </div>
            )}
          </Secao>

          <Secao numero={5} titulo="Administração">
            <SeletorUnico
              name="administrado_por_imobiliaria"
              label="Será administrado por imobiliária?"
              required
              opcoes={["Sim", "Não"]}
              valor={administradoPorImobiliaria}
              aoMudar={setAdministradoPorImobiliaria}
            />
            {administradoPorImobiliaria === "Sim" && <Campo name="nome_imobiliaria" label="Nome da imobiliária/administradora" required />}
            <div>
              <label className={labelClass}>Preferências (cobertura específica, assistência 24h, etc. — opcional)</label>
              <textarea name="preferencias" rows={2} className={inputClass} />
            </div>
          </Secao>
        </>
      )}

      <label className="flex items-start gap-2 text-sm text-gray-600">
        <input type="checkbox" name="aceite_lgpd" required className="mt-0.5" />
        <span>
          Confirmo que os dados informados estão corretos e autorizo a O2 Seguros a tratá-los conforme a{" "}
          <a href="/termos" target="_blank" className="font-medium underline" style={{ color: O2_NAVY }}>
            Política de Privacidade
          </a>
          , exclusivamente para cotação e contratação de seguro incêndio.
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

export default function SeguroIncendioForm() {
  const [instancia, setInstancia] = useState(0);
  return <SeguroIncendioFormInterno key={instancia} aoConcluirNova={() => setInstancia((n) => n + 1)} />;
}
