"use client";

import { useActionState, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { enviarFichaSeguroAuto, type EstadoEnvioSeguroAuto } from "./actions";

const O2_LARANJA = "#F8540D";
const O2_NAVY = "#01192e";
const BUCKET = "seguro-auto-anexos";

const inputClass = "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-[#F8540D] focus:outline-none";
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

function Campo({ name, label, type = "text", required, placeholder }: { name: string; label: string; type?: string; required?: boolean; placeholder?: string }) {
  return (
    <div>
      <label className={labelClass}>
        {label}
        {required && " *"}
      </label>
      <input name={name} type={type} required={required} placeholder={placeholder} className={inputClass} />
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
      <div className="mt-1 space-y-1.5">
        {opcoes.map((op) => (
          <label key={op} className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm has-[:checked]:border-[#F8540D] has-[:checked]:bg-orange-50">
            <input type="radio" name={`_${name}_ui`} checked={valor === op} onChange={() => aoMudar(op)} required={required} className="accent-[#F8540D]" />
            {op}
          </label>
        ))}
      </div>
    </div>
  );
}

type ArquivoStatus = { nome: string; estado: "enviando" | "ok" | "erro"; mensagem?: string };

// Upload direto do navegador pro Storage (não passa pela Server Action): o
// corpo de uma Server Action na Vercel tem teto de ~4,5MB, bem abaixo do
// limite de arquivo aqui. Mesmo espírito do upload de faturas (ver
// src/app/faturas/upload/UploadFaturaForm.tsx), mas sem login -- a política
// do bucket "seguro-auto-anexos" libera INSERT pro anon.
//
// Só 1 arquivo por campo -- os campos correspondentes na SPA do Bitrix
// (CNH/CRLV) são de arquivo único, não múltiplo, confirmado via
// crm.item.fields em 18/08/2026.
function CampoUpload({
  responseId,
  pasta,
  label,
  detalhe,
  maxMb,
  hiddenName,
  path,
  setPath,
}: {
  responseId: string;
  pasta: string;
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
    const novoPath = `${responseId}/${pasta}/${crypto.randomUUID()}.${extensao}`;
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
      <input type="file" accept=".pdf,.doc,.docx,image/*" onChange={aoSelecionar} className="mt-1.5 w-full text-sm" />
      {arquivo && (
        <p className={`mt-1.5 text-xs ${arquivo.estado === "erro" ? "text-red-600" : arquivo.estado === "ok" ? "text-green-700" : "text-gray-500"}`}>
          {arquivo.nome} — {arquivo.estado === "enviando" ? "enviando..." : arquivo.estado === "ok" ? "enviado ✅" : arquivo.mensagem}
        </p>
      )}
    </div>
  );
}

// Textos alinhados letra por letra com as opções já cadastradas na SPA do
// Bitrix (entityTypeId 1050, confirmado via crm.item.fields em 18/08/2026)
// -- o mapeamento de campo faz match pelo texto exato.
const UTILIZACAO_OPCOES = ["Passeio", "Trabalho (aplicativo, táxi ou entregas)", "Passeio e trabalho"] as const;
const USO_DETALHADO_OPCOES = ["Somente passeio", "Somente trabalho/faculdade", "Passeio e trabalho/faculdade"] as const;
const PORTAO_OPCOES = ["Manual", "Automático", "Não possui garagem"] as const;

function SeguroAutoFormInterno({ aoConcluirNova }: { aoConcluirNova: () => void }) {
  const [estado, formAction, enviando] = useActionState<EstadoEnvioSeguroAuto, FormData>(enviarFichaSeguroAuto, null);
  const [responseId] = useState(() => crypto.randomUUID());
  const [possuiGaragem, setPossuiGaragem] = useState("");
  const [portao, setPortao] = useState("");
  const [utilizacaoVeiculo, setUtilizacaoVeiculo] = useState("");
  const [usoCarroDetalhado, setUsoCarroDetalhado] = useState("");
  const [anexoCnh, setAnexoCnh] = useState("");
  const [anexoCrlv, setAnexoCrlv] = useState("");
  const [anexoApolice, setAnexoApolice] = useState("");

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
          <a href="mailto:auto@o2seguros.com.br" className="underline">
            auto@o2seguros.com.br
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

      <Secao numero={1} titulo="Seus dados">
        <div className="grid grid-cols-2 gap-2">
          <Campo name="nome_completo" label="Nome Completo" required placeholder="" />
          <Campo name="email" label="E-mail" type="email" required />
          <Campo name="telefone" label="Telefone" required />
          <Campo name="estado_civil" label="Estado Civil" required />
        </div>
      </Secao>

      <Secao numero={2} titulo="Endereço" subtitulo="Onde o veículo pernoita">
        <Campo name="endereco_residencial" label="Endereço Residencial (rua, número, complemento e CEP)" required />
      </Secao>

      <Secao numero={3} titulo="Garagem">
        <SeletorUnico name="possui_garagem" label="Possui garagem na residência?" required opcoes={["Sim", "Não"]} valor={possuiGaragem} aoMudar={setPossuiGaragem} />
        <SeletorUnico name="portao" label="Portão Manual ou Automático?" required opcoes={PORTAO_OPCOES} valor={portao} aoMudar={setPortao} />
      </Secao>

      <Secao numero={4} titulo="Uso do veículo">
        <SeletorUnico
          name="utilizacao_veiculo"
          label="Utilização do veículo:"
          required
          opcoes={UTILIZACAO_OPCOES}
          valor={utilizacaoVeiculo}
          aoMudar={setUtilizacaoVeiculo}
        />
        <p className="-mt-2 text-xs text-amber-600">⚠️ Marcar &quot;Trabalho&quot; somente se for motorista por aplicativo, táxi e/ou entregas.</p>
        <SeletorUnico
          name="uso_carro_detalhado"
          label="Utiliza o carro para passeio e para ir ao trabalho/faculdade?"
          required
          opcoes={USO_DETALHADO_OPCOES}
          valor={usoCarroDetalhado}
          aoMudar={setUsoCarroDetalhado}
        />
      </Secao>

      <Secao numero={5} titulo="Documentos" subtitulo="Se tiver dificuldade pra anexar, pode mandar por e-mail pra auto@o2seguros.com.br (com seu nome no assunto)">
        <CampoUpload
          responseId={responseId}
          pasta="cnh"
          label="Anexar CNH do condutor"
          detalhe="1 arquivo, PDF/imagem/documento, até 20MB."
          maxMb={20}
          hiddenName="anexo_cnh"
          path={anexoCnh}
          setPath={setAnexoCnh}
        />
        <CampoUpload
          responseId={responseId}
          pasta="crlv"
          label="Anexar CRLV do veículo"
          detalhe="1 arquivo, PDF/imagem/documento, até 10MB. Se o veículo for 0KM, mande a nota fiscal por e-mail."
          maxMb={10}
          hiddenName="anexo_crlv"
          path={anexoCrlv}
          setPath={setAnexoCrlv}
        />
        <CampoUpload
          responseId={responseId}
          pasta="apolice"
          label="Anexar apólice atual (se houver)"
          detalhe="Opcional — se já tem seguro auto vigente, anexar a apólice ajuda a agilizar a cotação."
          maxMb={20}
          hiddenName="anexo_apolice"
          path={anexoApolice}
          setPath={setAnexoApolice}
        />
      </Secao>

      <label className="flex items-start gap-2 text-sm text-gray-600">
        <input type="checkbox" name="aceite_lgpd" required className="mt-0.5" />
        <span>
          Confirmo que os dados informados são meus e autorizo a O2 Seguros a tratá-los conforme a{" "}
          <a href="/termos" target="_blank" className="font-medium underline" style={{ color: O2_NAVY }}>
            Política de Privacidade
          </a>
          , exclusivamente para cotação e contratação de seguro auto.
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

export default function SeguroAutoForm() {
  const [instancia, setInstancia] = useState(0);
  return <SeguroAutoFormInterno key={instancia} aoConcluirNova={() => setInstancia((n) => n + 1)} />;
}
