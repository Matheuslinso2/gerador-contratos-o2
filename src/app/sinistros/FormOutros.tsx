import SubmitButton from "@/components/SubmitButton";
import { SEGURADORAS, hojeSP } from "@/lib/sinistros/regras";
import { PRODUTOS } from "@/lib/sinistros/produtos";
import BuscaApolice from "./BuscaApolice";
import { botaoPrimario, inputClass, labelClass } from "./ui";
import RascunhoAutomatico from "@/components/RascunhoAutomatico";

/* eslint-disable @typescript-eslint/no-explicit-any -- linha do Supabase sem tipos gerados */

// Sinistro de Capitalização, Incêndio, Residencial, Condomínio, Auto e demais
// produtos: um formulário único (sem o assistente de Fiança), usado para abrir
// e para editar. Nada é obrigatório.
export default function FormOutros({
  action,
  dados,
  imobiliarias,
  equipe,
  novo,
  produtoInicial,
  extras,
}: {
  action: (fd: FormData) => Promise<void>;
  dados?: any;
  imobiliarias: { id: string; nome: string }[];
  equipe: { chave: string; nome: string }[];
  novo: boolean;
  produtoInicial?: string;
  extras?: React.ReactNode;
}) {
  const d = dados ?? {};
  const secao = "text-sm font-semibold uppercase tracking-wide text-o2-navy";
  return (
    <form action={action} className="space-y-6">
      <RascunhoAutomatico sufixo="outros" />
      {d.id && <input type="hidden" name="id" value={d.id} />}
      {extras}
      <BuscaApolice nossoNumeroInicial={d.nosso_numero} />

      <section className="space-y-3">
        <h2 className={secao}>Caso</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={labelClass}>Produto</label>
            <select name="produto" defaultValue={d.produto ?? produtoInicial ?? "capitalizacao"} className={inputClass}>
              {PRODUTOS.filter((p) => p.chave !== "fianca").map((p) => (
                <option key={p.chave} value={p.chave}>
                  {p.rotulo}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>Imobiliária</label>
            <select name="imobiliaria_id" defaultValue={d.imobiliaria_id ?? ""} className={inputClass}>
              <option value="">— sem imobiliária / definir depois —</option>
              {imobiliarias.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.nome}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Seguradora</label>
            <input name="seguradora" list="seguradoras-sinistro" defaultValue={d.seguradora ?? ""} className={inputClass} />
            <datalist id="seguradoras-sinistro">
              {SEGURADORAS.map((s) => (
                <option key={s} value={s} />
              ))}
              <option value="BRASILCAP (BANCO DO BRASIL)" />
              <option value="ICATU" />
            </datalist>
          </div>
          <div>
            <label className={labelClass}>Nº da apólice / título</label>
            <input name="numero_apolice" defaultValue={d.numero_apolice ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Nº do aviso (seguradora)</label>
            <input name="numero_sinistro_seguradora" defaultValue={d.numero_sinistro_seguradora ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Data da ocorrência</label>
            <input type="date" name="data_ocorrencia" defaultValue={d.data_ocorrencia ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Valor avisado (R$)</label>
            <input name="valor_avisado" inputMode="decimal" defaultValue={d.valor_avisado ?? ""} placeholder="0,00" className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>LMI da apólice (R$)</label>
            <input name="lmi" inputMode="decimal" defaultValue={d.lmi ?? ""} placeholder="0,00" className={inputClass} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass}>Vigência de</label>
              <input type="date" name="vigencia_inicio" defaultValue={d.vigencia_inicio ?? ""} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>até</label>
              <input type="date" name="vigencia_fim" defaultValue={d.vigencia_fim ?? ""} className={inputClass} />
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className={secao}>Pessoas</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass}>Segurado / proprietário</label>
            <input name="locador_nome" defaultValue={d.locador_nome ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>CPF/CNPJ do segurado</label>
            <input name="locador_documento" defaultValue={d.locador_documento ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Locatário / titular do título</label>
            <input name="locatario_nome" defaultValue={d.locatario_nome ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>CPF/CNPJ</label>
            <input name="locatario_documento" defaultValue={d.locatario_documento ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Telefone</label>
            <input name="locatario_telefone" defaultValue={d.locatario_telefone ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>E-mail</label>
            <input type="email" name="locatario_email" defaultValue={d.locatario_email ?? ""} className={inputClass} />
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <label className={labelClass}>O que aconteceu</label>
        <textarea
          name="observacoes"
          rows={3}
          defaultValue={d.observacoes ?? ""}
          className={inputClass}
          placeholder="Ex.: resgate por execução, incêndio na cozinha em 10/10, colisão…"
        />
      </section>

      {novo && (
        <section className="grid gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4 sm:grid-cols-4">
          <div>
            <label className={labelClass}>Começa em</label>
            <select name="etapa" defaultValue="pre_analise" className={inputClass}>
              <option value="pre_analise">Pré-análise O2</option>
              <option value="na_seguradora">Já está na seguradora</option>
              <option value="em_indenizacao">Já em indenização</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Responsável</label>
            <select name="responsavel_o2" defaultValue="" className={inputClass}>
              <option value="">— ninguém —</option>
              {equipe.map((m) => (
                <option key={m.chave} value={m.chave}>
                  {m.nome}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Próxima ação em</label>
            <input type="date" name="proxima_acao_em" defaultValue={hojeSP()} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>O que fazer</label>
            <input name="proxima_acao_descricao" placeholder="Ex.: pedir documentos" className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Como chegou</label>
            <select name="origem" defaultValue="email" className={inputClass}>
              <option value="email">E-mail (sinistro@)</option>
              <option value="workspace">Outro canal</option>
            </select>
          </div>
        </section>
      )}

      <div className="flex justify-end">
        <SubmitButton className={botaoPrimario} textoCarregando="Salvando…">
          {novo ? "Abrir sinistro" : "Salvar dados"}
        </SubmitButton>
      </div>
    </form>
  );
}
