"use client";

import { useState } from "react";
import SubmitButton from "@/components/SubmitButton";
import { buscarEnderecoPorCep, formatarCEP } from "@/lib/validacoesBr";
import { SEGURADORAS, TIPOS, type TipoSinistro } from "@/lib/sinistros/regras";
import { botaoPrimario, inputClass, labelClass } from "./ui";
import BuscaApolice from "./BuscaApolice";

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
  imovel_cep?: string | null;
  imovel_logradouro?: string | null;
  imovel_numero?: string | null;
  imovel_complemento?: string | null;
  imovel_bairro?: string | null;
  imovel_cidade?: string | null;
  imovel_uf?: string | null;
};

// Passo 1 do assistente: tipo do sinistro + dados do contrato/apólice. Na
// Fase 1 tudo é digitado (a base de apólices ainda não tem nº de apólice,
// LMI nem endereço do imóvel -- ver plano, decisão 2); a O2 confere contra
// o contrato anexado no passo 4.
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
      {d.id && <input type="hidden" name="id" value={d.id} />}
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
        <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Qual é a situação?</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(TIPOS) as TipoSinistro[]).map((t) => (
            <label key={t} className="flex cursor-pointer gap-2 rounded-xl border border-gray-200 bg-white p-3 text-sm has-[:checked]:border-o2-coral has-[:checked]:bg-orange-50">
              <input type="radio" name="tipo" value={t} defaultChecked={d.tipo === t} className="mt-1 accent-o2-coral" />
              <span>
                <span className="block font-semibold text-o2-navy">{TIPOS[t].titulo}</span>
                <span className="text-xs text-gray-500">{TIPOS[t].descricao}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

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
            <input type="date" name="vigencia_inicio" defaultValue={d.vigencia_inicio ?? ""} onChange={(e) => setVig({ ...vig, ini: e.target.value })} className={inputClass} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>Fim da vigência</label>
            <input type="date" name="vigencia_fim" defaultValue={d.vigencia_fim ?? ""} onChange={(e) => setVig({ ...vig, fim: e.target.value })} className={inputClass} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>Data da ocorrência</label>
            <input type="date" name="data_ocorrencia" defaultValue={d.data_ocorrencia ?? ""} onChange={(e) => setVig({ ...vig, ocorrencia: e.target.value })} className={inputClass} />
          </div>
          {foraDaVigencia && (
            <p className="rounded-lg border border-orange-300 bg-orange-50 p-2 text-xs text-orange-900 sm:col-span-4">
              A data da ocorrência está fora da vigência da apólice. Confira se é a apólice certa (ou a renovação) antes de seguir.
            </p>
          )}
        </div>
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
            <input name="logradouro" value={end.logradouro} onChange={(e) => setEnd({ ...end, logradouro: e.target.value })} className={inputClass} />
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
            <input name="bairro" value={end.bairro} onChange={(e) => setEnd({ ...end, bairro: e.target.value })} className={inputClass} />
          </div>
          <div className="sm:col-span-4">
            <label className={labelClass}>Cidade</label>
            <input name="cidade" value={end.cidade} onChange={(e) => setEnd({ ...end, cidade: e.target.value })} className={inputClass} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>UF</label>
            <input name="uf" maxLength={2} value={end.uf} onChange={(e) => setEnd({ ...end, uf: e.target.value.toUpperCase() })} className={inputClass} />
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
