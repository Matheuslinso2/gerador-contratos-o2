"use client";

import { useState } from "react";
import SubmitButton from "@/components/SubmitButton";
import { calcularPrazoAviso, coberturasDoTipo, formatarData, type TipoSinistro } from "@/lib/sinistros/regras";
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
  coberturas: string[];
  observacoes: string | null;
};

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

// "2026-03-10" -> "2026-04-10" (último dia do mês quando não existe o dia).
function maisUmMes(data: string) {
  const m = data.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ultimo = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  const d = new Date(Date.UTC(ano, mes, Math.min(dia, ultimo)));
  return d.toISOString().slice(0, 10);
}

export default function PassoSituacao({ dados }: { dados: Dados }) {
  const [datas, setDatas] = useState({
    data_primeiro_vencimento: dados.data_primeiro_vencimento ?? "",
    data_entrega_chaves: dados.data_entrega_chaves ?? "",
  });
  // Reunião 21/10/2026: a pergunta é "ocupado ou desocupado"; desocupado abre a
  // data da entrega das chaves (e se houve danos). Ocupado pede só o 1º
  // vencimento em aberto -- o 2º é sempre um mês depois.
  const [situacao, setSituacao] = useState<"" | "ocupado" | "desocupado">(
    dados.tipo === "ocupado" ? "ocupado" : dados.tipo ? "desocupado" : ""
  );
  const [danos, setDanos] = useState(dados.tipo === "chaves_com_danos");
  const [coberturas, setCoberturas] = useState<string[]>(dados.coberturas.length ? dados.coberturas : ["aluguel"]);
  const tipo: TipoSinistro | null = situacao === "ocupado" ? "ocupado" : situacao === "desocupado" ? (danos ? "chaves_com_danos" : "chaves_sem_danos") : null;
  const semTipo = !tipo;
  const ocupado = tipo === "ocupado";
  const segundo = maisUmMes(datas.data_primeiro_vencimento);
  const prazo = calcularPrazoAviso({ tipo, ...datas, data_segundo_vencimento: segundo });
  const pintura = coberturas.includes("pintura");

  function alternar(c: string) {
    setCoberturas((atual) => (atual.includes(c) ? atual.filter((x) => x !== c) : [...atual, c]));
  }

  return (
    <form action={salvarSituacao} className="space-y-6">
      <input type="hidden" name="id" value={dados.id} />
      <input type="hidden" name="tipo" value={tipo ?? ""} />
      <input type="hidden" name="data_segundo_vencimento" value={ocupado ? segundo : ""} />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">O imóvel está</h2>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["ocupado", "Ocupado", "O locatário continua no imóvel com aluguel em aberto."],
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

        {ocupado && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Vencimento do 1º aluguel em aberto</label>
              <input
                type="date"
                name="data_primeiro_vencimento"
                value={datas.data_primeiro_vencimento}
                onChange={(e) => setDatas({ ...datas, data_primeiro_vencimento: e.target.value })}
                className={inputClass}
              />
            </div>
            <p className="self-end pb-2 text-xs text-gray-500">{segundo ? `2º vencimento: ${formatarData(segundo)} (calculado)` : "O 2º vencimento é calculado: um mês depois."}</p>
          </div>
        )}
        {situacao === "desocupado" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Data da entrega das chaves</label>
              <input
                type="date"
                name="data_entrega_chaves"
                value={datas.data_entrega_chaves}
                onChange={(e) => setDatas({ ...datas, data_entrega_chaves: e.target.value })}
                className={inputClass}
              />
            </div>
            <fieldset className="space-y-1">
              <legend className="text-sm text-o2-navy">O imóvel ficou com danos (ou precisa de pintura)?</legend>
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="houve_danos" checked={danos} onChange={() => setDanos(true)} className="accent-o2-coral" /> Sim
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="houve_danos" checked={!danos} onChange={() => setDanos(false)} className="accent-o2-coral" /> Não
                </label>
              </div>
            </fieldset>
            <SimNao
              name="locatario_assinou_documentos"
              valor={dados.locatario_assinou_documentos}
              pergunta="O locatário assinou o termo de entrega de chaves e a vistoria final?"
            />
          </div>
        )}

        {prazo.bloqueio ? (
          !semTipo && (ocupado ? segundo : datas.data_entrega_chaves) && <Aviso tipo="alerta">{prazo.bloqueio}</Aviso>
        ) : prazo.prazo ? (
          prazo.foraDoPrazo ? (
            <Aviso tipo="alerta">
              <b>Prazo de aviso encerrado em {formatarData(prazo.prazo)}.</b> {prazo.explicacao} Você ainda pode avisar, mas vai
              precisar explicar o motivo do atraso — e a seguradora pode recusar a cobertura.
            </Aviso>
          ) : (
            <Aviso tipo="info">
              <b>
                Prazo de aviso: até {formatarData(prazo.prazo)} ({prazo.diasRestantes === 0 ? "é hoje" : `faltam ${prazo.diasRestantes} dia(s)`}).
              </b>{" "}
              {prazo.explicacao}
            </Aviso>
          )
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">O que está sendo cobrado?</h2>
        <p className="text-xs text-gray-500">Marque só o que foi contratado na apólice. Cada item marcado precisa aparecer na tabela de débitos.</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {coberturasDoTipo(tipo).map((c) => (
            <label key={c.chave} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm has-[:checked]:border-o2-coral">
              <input
                type="checkbox"
                name="coberturas"
                value={c.chave}
                checked={coberturas.includes(c.chave)}
                onChange={() => alternar(c.chave)}
                className="accent-o2-coral"
              />
              {c.titulo}
            </label>
          ))}
        </div>

        {pintura && (
          <div className="space-y-3 rounded-xl border border-orange-200 bg-orange-50 p-4">
            <p className="text-sm font-semibold text-o2-navy">Pintura — confira antes de cobrar</p>
            <p className="text-xs text-gray-600">
              A seguradora só indeniza pintura se o imóvel foi entregue com <b>pintura nova</b> e a vistoria inicial diz exatamente isso,
              sem ressalvas (&quot;boa&quot;, &quot;em bom estado&quot;, &quot;usada&quot;, manchas, furos ou infiltrações já derrubam a cobertura).
            </p>
            <SimNao name="pintura_vistoria_nova" valor={dados.pintura_vistoria_nova} pergunta='A vistoria inicial registra "pintura nova", sem nenhuma ressalva?' />
            <SimNao name="pintura_vistoria_assinada" valor={dados.pintura_vistoria_assinada} pergunta="A vistoria inicial está assinada pelo locador/representante e pelo locatário?" />
          </div>
        )}
      </section>

      <section className="space-y-2">
        <label className={labelClass}>Observações para a O2 (opcional)</label>
        <textarea name="observacoes" rows={3} defaultValue={dados.observacoes ?? ""} className={inputClass} placeholder="Ex.: locatário fez proposta de acordo, há ação judicial em curso…" />
      </section>

      <div className="flex justify-end">
        <SubmitButton className={botaoPrimario} textoCarregando="Salvando…">
          Salvar e continuar →
        </SubmitButton>
      </div>
    </form>
  );
}
