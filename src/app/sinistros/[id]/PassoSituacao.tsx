"use client";

import { useState } from "react";
import Link from "next/link";
import SubmitButton from "@/components/SubmitButton";
import { COBERTURAS, calcularPrazoAviso, formatarData, type TipoSinistro } from "@/lib/sinistros/regras";
import { salvarSituacao } from "../actions";
import { Aviso, botaoPrimario, inputClass, labelClass } from "../ui";

type Dados = {
  id: string;
  tipo: TipoSinistro | null;
  data_primeiro_vencimento: string | null;
  data_segundo_vencimento: string | null;
  data_entrega_chaves: string | null;
  locatario_assinou_documentos: boolean | null;
  pintura_vistoria_nova: boolean | null;
  pintura_vistoria_assinada: boolean | null;
  incluir_parcelas_fianca: boolean | null;
  coberturas: string[];
  observacoes: string | null;
};

// Especificação "Tela de abertura do sinistro" (22/10/2026), Etapa 2.
const AVISO_OCUPADO =
  "Importante: No caso de o imóvel estar ocupado o acionamento do seguro deverá ser comunicado imediatamente após 2º vencimento não pago e as contas de consumo que estão pendentes só serão analisadas se estiverem em nome do segurado.";
const DE_LOCACAO = ["aluguel", "condominio", "iptu", "agua", "luz", "gas"];
const DE_DESOCUPACAO = ["danos", "pintura", "multa_rescisoria"];
const titulo = (chave: string) => COBERTURAS.find((c) => c.chave === chave)?.titulo ?? chave;

function SimNao({ name, valor, pergunta }: { name: string; valor: boolean | null; pergunta: string }) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm text-o2-navy">{pergunta}</legend>
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="radio" name={name} value="sim" defaultChecked={valor === true} className="accent-o2-coral" /> Sim
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" name={name} value="nao" defaultChecked={valor === false} className="accent-o2-coral" /> Não
        </label>
      </div>
    </fieldset>
  );
}

// Etapa 2 -- Coberturas. Ocupado ou desocupado já foi respondido na Etapa 1.
export default function PassoSituacao({ dados }: { dados: Dados }) {
  const desocupado = dados.tipo === "chaves_sem_danos" || dados.tipo === "chaves_com_danos";
  const [coberturas, setCoberturas] = useState<string[]>(dados.coberturas.length ? dados.coberturas : ["aluguel"]);
  const [incluirFianca, setIncluirFianca] = useState(dados.incluir_parcelas_fianca === true);
  const danos = coberturas.includes("danos") || coberturas.includes("pintura");
  const tipo: TipoSinistro | null = !dados.tipo ? null : desocupado ? (danos ? "chaves_com_danos" : "chaves_sem_danos") : "ocupado";
  const prazo = calcularPrazoAviso({ ...dados, tipo });

  if (!dados.tipo)
    return (
      <Aviso tipo="alerta">
        Volte à{" "}
        <Link href={`/sinistros/${dados.id}?passo=1`} className="font-semibold underline">
          Etapa 1 (Identificação)
        </Link>{" "}
        e responda se o imóvel está ocupado ou desocupado — as coberturas dependem disso.
      </Aviso>
    );

  function alternar(c: string) {
    setCoberturas((atual) => (atual.includes(c) ? atual.filter((x) => x !== c) : [...atual, c]));
  }
  const caixa = (c: string) => (
    <div key={c} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm has-[:checked]:border-o2-coral">
      <label className="flex items-center gap-2 font-semibold text-o2-navy">
        <input type="checkbox" name="coberturas" value={c} checked={coberturas.includes(c)} onChange={() => alternar(c)} className="accent-o2-coral" />
        {titulo(c).toUpperCase()}
      </label>
      {c === "aluguel" && coberturas.includes("aluguel") && (
        <label className="mt-1 flex items-center gap-2 pl-6 text-xs text-gray-700">
          <input type="checkbox" name="incluir_parcelas_fianca" checked={incluirFianca} onChange={(e) => setIncluirFianca(e.target.checked)} className="accent-o2-coral" />
          Incluir seguro fiança?
        </label>
      )}
    </div>
  );

  return (
    <form action={salvarSituacao} className="space-y-6">
      <input type="hidden" name="id" value={dados.id} />
      <input type="hidden" name="tipo" value={tipo ?? ""} />

      {!desocupado && <Aviso tipo="alerta">{AVISO_OCUPADO}</Aviso>}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Agora selecione as coberturas que deseja acionar:</h2>
        <p className="text-xs text-gray-500">Imóvel {desocupado ? "desocupado" : "ocupado"} (Etapa 1).</p>
        {desocupado && <p className="text-xs font-semibold text-gray-600">Débitos até a entrega das chaves</p>}
        <div className="grid gap-2 sm:grid-cols-3">{DE_LOCACAO.map(caixa)}</div>
        {desocupado && (
          <>
            <p className="text-xs font-semibold text-gray-600">Desocupação</p>
            <div className="grid gap-2 sm:grid-cols-3">{DE_DESOCUPACAO.map(caixa)}</div>
          </>
        )}

        {desocupado && (
          <SimNao
            name="locatario_assinou_documentos"
            valor={dados.locatario_assinou_documentos}
            pergunta="O locatário assinou o termo de entrega de chaves e a vistoria final?"
          />
        )}

        {coberturas.includes("pintura") && (
          <div className="space-y-3 rounded-xl border border-orange-200 bg-orange-50 p-4">
            <p className="text-sm font-semibold text-o2-navy">Pintura — confira antes de acionar</p>
            <p className="text-xs text-gray-600">
              A seguradora só indeniza pintura se o imóvel foi entregue com <b>pintura nova</b> e a vistoria inicial diz exatamente isso,
              sem ressalvas (&quot;boa&quot;, &quot;em bom estado&quot;, &quot;usada&quot;, manchas, furos ou infiltrações já derrubam a cobertura).
            </p>
            <SimNao name="pintura_vistoria_nova" valor={dados.pintura_vistoria_nova} pergunta='A vistoria inicial registra "pintura nova", sem nenhuma ressalva?' />
            <SimNao name="pintura_vistoria_assinada" valor={dados.pintura_vistoria_assinada} pergunta="A vistoria inicial está assinada pelo locador/representante e pelo locatário?" />
          </div>
        )}

        {prazo.prazo &&
          (prazo.foraDoPrazo ? (
            <Aviso tipo="alerta">
              <b>Prazo de aviso encerrado em {formatarData(prazo.prazo)}.</b> {prazo.explicacao} Você ainda pode avisar, mas vai precisar explicar o
              motivo do atraso — e a seguradora pode recusar a cobertura.
            </Aviso>
          ) : (
            <Aviso tipo="info">
              <b>Prazo de aviso: até {formatarData(prazo.prazo)} ({prazo.diasRestantes === 0 ? "é hoje" : `faltam ${prazo.diasRestantes} dia(s)`}).</b>{" "}
              {prazo.explicacao}
            </Aviso>
          ))}
      </section>

      <section className="space-y-2">
        <label className={labelClass}>Observações para a O2 (opcional)</label>
        <textarea name="observacoes" rows={3} defaultValue={dados.observacoes ?? ""} className={inputClass} />
      </section>

      <div className="flex justify-end">
        <SubmitButton className={botaoPrimario} textoCarregando="Salvando…">
          Salvar e continuar →
        </SubmitButton>
      </div>
    </form>
  );
}
