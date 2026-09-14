"use client";

import { useActionState, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { formatarCPF, validarCPF, apenasDigitos } from "@/lib/validacoesBr";
import { enviarFichaSeguroCelular, type EstadoEnvioSeguroCelular } from "./actions";

const O2_LARANJA = "#F8540D";
const O2_NAVY = "#01192e";
const BUCKET = "seguro-celular-anexos";

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

function Campo({ name, label, type = "text", required, placeholder, className }: { name: string; label: string; type?: string; required?: boolean; placeholder?: string; className?: string }) {
  return (
    <div className={className}>
      <label className={labelClass}>
        {label}
        {required && " *"}
      </label>
      <input name={name} type={type} required={required} placeholder={placeholder} className={inputClass} />
    </div>
  );
}

function CampoCpf({ name, label, required }: { name: string; label: string; required?: boolean }) {
  const [valor, setValor] = useState("");
  const [tocado, setTocado] = useState(false);
  const invalido = tocado && apenasDigitos(valor) !== "" && !validarCPF(valor);

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
        placeholder="000.000.000-00"
        required={required}
        className={invalido ? inputErroClass : inputClass}
      />
      {invalido && <p className="mt-0.5 text-xs text-red-600">CPF inválido.</p>}
    </div>
  );
}

type ArquivoStatus = { nome: string; estado: "enviando" | "ok" | "erro"; mensagem?: string };

// Upload direto do navegador pro Storage (não passa pela Server Action):
// mesmo espírito de src/app/seguro-auto/SeguroAutoForm.tsx.
function CampoUpload({
  responseId,
  label,
  detalhe,
  maxMb,
  hiddenName,
  path,
  setPath,
}: {
  responseId: string;
  label: string;
  detalhe: string;
  maxMb: number;
  hiddenName: string;
  path: string;
  setPath: (v: string) => void;
}) {
  const [arquivo, setArquivo] = useState<ArquivoStatus | null>(null);

  async function aoSelecionar(e: React.ChangeEvent<HTMLInputElement>) {
    const selecionado = e.target.files?.[0];
    e.target.value = "";
    if (!selecionado) return;

    if (selecionado.size > maxMb * 1024 * 1024) {
      setArquivo({ nome: selecionado.name, estado: "erro", mensagem: `Maior que ${maxMb}MB` });
      return;
    }
    setArquivo({ nome: selecionado.name, estado: "enviando" });
    const extensao = selecionado.name.split(".").pop()?.toLowerCase() || "bin";
    const novoPath = `${responseId}/${crypto.randomUUID()}.${extensao}`;
    const supabase = createClient();
    const { error } = await supabase.storage.from(BUCKET).upload(novoPath, selecionado, { contentType: selecionado.type || "application/octet-stream" });
    if (error) {
      setArquivo({ nome: selecionado.name, estado: "erro", mensagem: "Falha no envio" });
      return;
    }
    setArquivo({ nome: selecionado.name, estado: "ok" });
    setPath(novoPath);
  }

  return (
    <div>
      <label className={labelClass}>{label}</label>
      <p className="mt-0.5 text-xs text-gray-500">{detalhe}</p>
      <input type="hidden" name={hiddenName} value={path} />
      <input type="file" accept=".pdf,image/*" onChange={aoSelecionar} className="mt-1.5 w-full text-sm" />
      {arquivo && (
        <p className={`mt-1.5 text-xs ${arquivo.estado === "erro" ? "text-red-600" : arquivo.estado === "ok" ? "text-green-700" : "text-gray-500"}`}>
          {arquivo.nome} — {arquivo.estado === "enviando" ? "enviando..." : arquivo.estado === "ok" ? "enviado ✅" : arquivo.mensagem}
        </p>
      )}
    </div>
  );
}

function SeguroCelularFormInterno({ aoConcluirNova }: { aoConcluirNova: () => void }) {
  const [estado, formAction, enviando] = useActionState<EstadoEnvioSeguroCelular, FormData>(enviarFichaSeguroCelular, null);
  const [responseId] = useState(() => crypto.randomUUID());
  const [anexoNotaFiscal, setAnexoNotaFiscal] = useState("");

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

      <Secao numero={2} titulo="Segurado">
        <div className="grid grid-cols-2 gap-2">
          <Campo name="nome_completo" label="Nome completo" required className="col-span-2" />
          <CampoCpf name="cpf" label="CPF" required />
        </div>
        <Campo name="endereco" label="Endereço (rua, número, complemento, bairro, cidade/UF e CEP)" required />
      </Secao>

      <Secao numero={3} titulo="Aparelho">
        <div className="grid grid-cols-2 gap-2">
          <Campo name="numero_linha" label="Número de telefone utilizado no aparelho" required />
          <Campo name="idade_aparelho" label="Idade do aparelho" required placeholder="ex: 6 meses, 1 ano, 2 anos" />
        </div>
        <CampoUpload
          responseId={responseId}
          label="Anexar nota fiscal"
          detalhe="1 arquivo, PDF ou imagem, até 20MB."
          maxMb={20}
          hiddenName="anexo_nota_fiscal"
          path={anexoNotaFiscal}
          setPath={setAnexoNotaFiscal}
        />
      </Secao>

      <label className="flex items-start gap-2 text-sm text-gray-600">
        <input type="checkbox" name="aceite_lgpd" required className="mt-0.5" />
        <span>
          Confirmo que os dados informados são meus e autorizo a O2 Seguros a tratá-los conforme a{" "}
          <a href="/termos" target="_blank" className="font-medium underline" style={{ color: O2_NAVY }}>
            Política de Privacidade
          </a>
          , exclusivamente para cotação e contratação de seguro celular.
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

export default function SeguroCelularForm() {
  const [instancia, setInstancia] = useState(0);
  return <SeguroCelularFormInterno key={instancia} aoConcluirNova={() => setInstancia((n) => n + 1)} />;
}
