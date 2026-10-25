"use client";

import { useState } from "react";
import SubmitButton from "@/components/SubmitButton";
import { buscarEnderecoPorCep, formatarCEP } from "@/lib/validacoesBr";
import { SEGURADORAS } from "@/lib/sinistros/regras";
import { botaoPrimario, inputClass, labelClass } from "./ui";
import BuscaApolice from "./BuscaApolice";
import RascunhoAutomatico from "@/components/RascunhoAutomatico";

export type DadosContrato = {
  id?: string;
  imobiliaria_id?: string | null;
  origem?: string | null;
  tipo?: string | null;
  seguradora?: string | null;
  numero_apolice?: string | null;
  vigencia_inicio?: string | null;
  vigencia_fim?: string | null;
  locador_nome?: string | null;
  locador_documento?: string | null;
  locatario_nome?: string | null;
  locatario_documento?: string | null;
  locatario_telefone?: string | null;
  locatario_email?: string | null;
  nosso_numero?: string | null;
  data_ocorrencia?: string | null;
  data_entrega_chaves?: string | null;
  imovel_cep?: string | null;
  imovel_logradouro?: string | null;
  imovel_numero?: string | null;
  imovel_complemento?: string | null;
  imovel_bairro?: string | null;
  imovel_cidade?: string | null;
  imovel_uf?: string | null;
};

// Etapa 1 do assistente -- Identificação (especificação "Tela de abertura do
// sinistro", 22/10/2026): Seguradora > Apólice, data da ocorrência (primeira
// inadimplência) com conferência automática da vigência, e imóvel ocupado ou
// desocupado (desocupado abre a data da entrega das chaves).
export default function FormContrato({
  action,
  dados,
  imobiliarias,
  textoBotao,
  extras,
}: {
  action: (fd: FormData) => Promise<void>;
  dados?: DadosContrato;
  imobiliarias?: { id: string; nome: string }[];
  textoBotao: string;
  extras?: React.ReactNode;
}) {
  const d = dados ?? {};
  const [cep, setCep] = useState(d.imovel_cep ?? "");
  const [end, setEnd] = useState({
    logradouro: d.imovel_logradouro ?? "",
    bairro: d.imovel_bairro ?? "",
    cidade: d.imovel_cidade ?? "",
    uf: d.imovel_uf ?? "",
  });
  // Reunião 21/10/2026: ocorrência logo no passo 1, para validar a apólice no início.
  const [vig, setVig] = useState({ ini: d.vigencia_inicio ?? "", fim: d.vigencia_fim ?? "", ocorrencia: d.data_ocorrencia ?? "" });
  const foraDaVigencia = !!vig.ocorrencia && ((!!vig.ini && vig.ocorrencia < vig.ini) || (!!vig.fim && vig.ocorrencia > vig.fim));
  const vigenciaConferida = !!vig.ocorrencia && !!vig.ini && !!vig.fim && !foraDaVigencia;
  const [situacao, setSituacao] = useState<"" | "ocupado" | "desocupado">(
    d.tipo === "ocupado" ? "ocupado" : d.tipo ? "desocupado" : ""
  );
  const seguradoraConhecida = !d.seguradora || SEGURADORAS.includes(d.seguradora);

  async function aoMudarCep(valor: string) {
    const f = formatarCEP(valor);
    setCep(f);
    if (f.replace(/\D/g, "").length === 8) {
      const r = await buscarEnderecoPorCep(f);
      if (r) setEnd({ logradouro: r.logradouro ?? "", bairro: r.bairro ?? "", cidade: r.localidade ?? "", uf: r.uf ?? "" });
    }
  }

  return (
    <form action={action} className="space-y-6">
      <RascunhoAutomatico sufixo="contrato" />
      {d.id && <input type="hidden" name="id" value={d.id} />}
      <input type="hidden" name="tipo_atual" value={d.tipo ?? ""} />
      {extras}
      <BuscaApolice nossoNumeroInicial={d.nosso_numero} />

      {imobiliarias && (
        <section className="space-y-2 rounded-xl border border-blue-200 bg-blue-50 p-4">
          <p className="text-sm font-semibold text-o2-navy">Abrindo em nome da imobiliária (uso da equipe O2)</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Imobiliária</label>
              <select name="imobiliaria_id" className={inputClass} defaultValue={d.imobiliaria_id ?? ""}>
                <option value="">— definir depois —</option>
                {imobiliarias.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.nome}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Como o aviso chegou</label>
              <select name="origem" className={inputClass} defaultValue={d.origem ?? "email"}>
                <option value="email">E-mail (sinistro@)</option>
                <option value="workspace">Outro canal</option>
              </select>
            </div>
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Apólice</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <label className={labelClass}>Seguradora</label>
            <select name="seguradora" className={inputClass} defaultValue={seguradoraConhecida ? d.seguradora ?? "" : "Outra"}>
              <option value="">— não informada —</option>
              {SEGURADORAS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>Nº da apólice</label>
            <input name="numero_apolice" defaultValue={d.numero_apolice ?? ""} className={inputClass} placeholder="Se souber" />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>Início da vigência</label>
            <input type="date" name="vigencia_inicio" defaultValue={d.vigencia_inicio ?? ""} onChange={(e) => setVig((v0) => ({ ...v0, ini: e.target.value }))} className={inputClass} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>Fim da vigência</label>
            <input type="date" name="vigencia_fim" defaultValue={d.vigencia_fim ?? ""} onChange={(e) => setVig((v0) => ({ ...v0, fim: e.target.value }))} className={inputClass} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>Data da ocorrência – primeira inadimplência</label>
            <input type="date" name="data_ocorrencia" defaultValue={d.data_ocorrencia ?? ""} onChange={(e) => setVig((v0) => ({ ...v0, ocorrencia: e.target.value }))} className={inputClass} />
          </div>
          {foraDaVigencia && (
            <p className="rounded-lg border border-orange-300 bg-orange-50 p-2 text-xs text-orange-900 sm:col-span-4">
              A data da ocorrência está fora da vigência da apólice. Confira se é a apólice certa (ou a renovação) antes de seguir.
            </p>
          )}
          {vigenciaConferida && (
            <p className="rounded-lg border border-green-300 bg-green-50 p-2 text-xs text-green-900 sm:col-span-4">
              ✓ A data da ocorrência está dentro da vigência da apólice.
            </p>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">O imóvel está ocupado ou desocupado?</h2>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["ocupado", "Ocupado", "O locatário continua no imóvel."],
              ["desocupado", "Desocupado", "O locatário entregou as chaves."],
            ] as const
          ).map(([valor, rotulo, ajuda]) => (
            <label
              key={valor}
              className="flex min-w-56 flex-1 cursor-pointer gap-2 rounded-xl border border-gray-200 bg-white p-3 text-sm has-[:checked]:border-o2-coral has-[:checked]:bg-orange-50"
            >
              <input type="radio" name="situacao_imovel" value={valor} checked={situacao === valor} onChange={() => setSituacao(valor)} className="mt-1 accent-o2-coral" />
              <span>
                <span className="block font-semibold text-o2-navy">{rotulo}</span>
                <span className="text-xs text-gray-500">{ajuda}</span>
              </span>
            </label>
          ))}
        </div>
        {situacao === "desocupado" && (
          <div className="max-w-xs">
            <label className={labelClass}>Data da entrega das chaves</label>
            <input type="date" name="data_entrega_chaves" defaultValue={d.data_entrega_chaves ?? ""} className={inputClass} />
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Partes</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass}>Locador (segurado)</label>
            <input name="locador_nome" defaultValue={d.locador_nome ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>CPF/CNPJ do locador</label>
            <input name="locador_documento" defaultValue={d.locador_documento ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Locatário</label>
            <input name="locatario_nome" defaultValue={d.locatario_nome ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>CPF/CNPJ do locatário</label>
            <input name="locatario_documento" defaultValue={d.locatario_documento ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Telefone atualizado do locatário</label>
            <input name="locatario_telefone" defaultValue={d.locatario_telefone ?? ""} className={inputClass} placeholder="(21) 99999-9999" />
          </div>
          <div>
            <label className={labelClass}>E-mail atualizado do locatário</label>
            <input type="email" name="locatario_email" defaultValue={d.locatario_email ?? ""} className={inputClass} />
          </div>
        </div>
        <p className="text-xs text-gray-500">A seguradora exige ao menos um contato atualizado do locatário.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Imóvel</h2>
        <div className="grid gap-3 sm:grid-cols-6">
          <div className="sm:col-span-2">
            <label className={labelClass}>CEP</label>
            <input name="cep" value={cep} onChange={(e) => aoMudarCep(e.target.value)} className={inputClass} placeholder="00000-000" />
          </div>
          <div className="sm:col-span-4">
            <label className={labelClass}>Logradouro</label>
            <input name="logradouro" value={end.logradouro} onChange={(e) => setEnd((e0) => ({ ...e0, logradouro: e.target.value }))} className={inputClass} />
          </div>
          <div className="sm:col-span-1">
            <label className={labelClass}>Número</label>
            <input name="numero" defaultValue={d.imovel_numero ?? ""} className={inputClass} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>Complemento</label>
            <input name="complemento" defaultValue={d.imovel_complemento ?? ""} className={inputClass} />
          </div>
          <div className="sm:col-span-3">
            <label className={labelClass}>Bairro</label>
            <input name="bairro" value={end.bairro} onChange={(e) => setEnd((e0) => ({ ...e0, bairro: e.target.value }))} className={inputClass} />
          </div>
          <div className="sm:col-span-4">
            <label className={labelClass}>Cidade</label>
            <input name="cidade" value={end.cidade} onChange={(e) => setEnd((e0) => ({ ...e0, cidade: e.target.value }))} className={inputClass} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>UF</label>
            <input name="uf" maxLength={2} value={end.uf} onChange={(e) => setEnd((e0) => ({ ...e0, uf: e.target.value.toUpperCase() }))} className={inputClass} />
          </div>
        </div>
      </section>

      <div className="flex justify-end">
        <SubmitButton className={botaoPrimario} textoCarregando="Salvando…">
          {textoBotao}
        </SubmitButton>
      </div>
    </form>
  );
}
