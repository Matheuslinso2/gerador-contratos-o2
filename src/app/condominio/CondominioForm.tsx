"use client";

import { useActionState, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { formatarCNPJ, validarCNPJ, apenasDigitos } from "@/lib/validacoesBr";
import { enviarFichaCondominio, type EstadoEnvioCondominio } from "./actions";

const O2_LARANJA = "#F8540D";
const O2_NAVY = "#01192e";
const BUCKET = "condominio-anexos";

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

function CondominioFormInterno({ aoConcluirNova }: { aoConcluirNova: () => void }) {
  const [estado, formAction, enviando] = useActionState<EstadoEnvioCondominio, FormData>(enviarFichaCondominio, null);
  const [responseId] = useState(() => crypto.randomUUID());
  const [tipoEdificacao, setTipoEdificacao] = useState("");
  const [possuiElevador, setPossuiElevador] = useState("");
  const [anexoApolice, setAnexoApolice] = useState("");

  if (estado?.ok) {
    return (
      <div className="rounded-xl border border-green-300 bg-green-50 p-6 text-center">
        <p className="text-lg font-semibold" style={{ color: O2_NAVY }}>
          Ficha enviada com sucesso! ✅
        </p>
        <p className="mt-1 text-sm text-gray-600">
          Recebemos os dados. Nossa equipe vai analisar e entrar em contato. Qualquer dúvida, fale com a gente em{" "}
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

      <Secao numero={1} titulo="Condomínio">
        <div className="grid grid-cols-2 gap-2">
          <Campo name="nome_condominio" label="Nome do condomínio" required className="col-span-2" />
          <CampoCnpj name="cnpj" label="CNPJ" required />
        </div>
        <Campo name="endereco" label="Endereço (rua, número, complemento, bairro, cidade/UF e CEP)" required />
        <SeletorUnico name="tipo_edificacao" label="Vertical ou horizontal?" required opcoes={["Vertical", "Horizontal"]} valor={tipoEdificacao} aoMudar={setTipoEdificacao} />
        <SeletorUnico
          name="possui_elevador"
          label="Possui elevador?"
          required
          opcoes={["Sim", "Não"]}
          valor={possuiElevador}
          aoMudar={setPossuiElevador}
        />
        {possuiElevador === "Sim" && <Campo name="quantidade_elevadores" label="Quantos elevadores?" type="number" required />}
        <Campo name="quantidade_andares" label="Quantos andares?" type="number" required />
      </Secao>

      <Secao numero={2} titulo="Contato do síndico">
        <div className="grid grid-cols-2 gap-2">
          <Campo name="sindico_telefone" label="Telefone do síndico" required />
          <Campo name="sindico_email" label="E-mail do síndico" type="email" required />
        </div>
      </Secao>

      <Secao numero={3} titulo="Apólice anterior">
        <CampoUpload
          responseId={responseId}
          label="Anexar apólice anterior (se houver)"
          detalhe="Opcional — 1 arquivo, PDF ou imagem, até 20MB."
          maxMb={20}
          hiddenName="anexo_apolice_anterior"
          path={anexoApolice}
          setPath={setAnexoApolice}
        />
      </Secao>

      <label className="flex items-start gap-2 text-sm text-gray-600">
        <input type="checkbox" name="aceite_lgpd" required className="mt-0.5" />
        <span>
          Confirmo que os dados informados estão corretos e autorizo a O2 Seguros a tratá-los conforme a{" "}
          <a href="/termos" target="_blank" className="font-medium underline" style={{ color: O2_NAVY }}>
            Política de Privacidade
          </a>
          , exclusivamente para cotação e contratação de seguro condomínio.
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

export default function CondominioForm() {
  const [instancia, setInstancia] = useState(0);
  return <CondominioFormInterno key={instancia} aoConcluirNova={() => setInstancia((n) => n + 1)} />;
}
