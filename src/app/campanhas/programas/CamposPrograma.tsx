import InfoLegenda from "@/components/InfoLegenda";
import { METRICAS_PROGRAMA, PRODUTOS_PROGRAMA, STATUS_PROGRAMA, type Programa } from "@/lib/campanhas/programas";

const inputClass = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-o2-coral focus:outline-none";
const rotuloClass = "mb-1 block text-xs font-medium text-gray-600";

// Campos do programa -- os mesmos na criação e na edição.
export default function CamposPrograma({ programa, emailPadrao }: { programa?: Programa; emailPadrao?: string | null }) {
  return (
    <div className="space-y-4">
      <div>
        <label className={rotuloClass}>Nome do programa</label>
        <input name="nome" required defaultValue={programa?.nome} placeholder="Ex: Clube Elite O2 — 4º trimestre" className={inputClass} />
      </div>

      <div>
        <label className={rotuloClass}>Objetivo (opcional)</label>
        <textarea
          name="objetivo"
          rows={2}
          defaultValue={programa?.objetivo ?? ""}
          placeholder="Ex: crescer até 40% nas novas contratações de Fiança + Capitalização até dezembro"
          className={inputClass}
        />
      </div>

      <div>
        <span className={rotuloClass}>
          Produtos que contam para a meta
          <InfoLegenda titulo="Produtos">
            A produção dos produtos marcados soma na meta. Automóvel não entra porque não tem imobiliária ligada ao card.
          </InfoLegenda>
        </span>
        <div className="flex flex-wrap gap-3">
          {PRODUTOS_PROGRAMA.map((p) => (
            <label key={p.valor} className="flex items-center gap-2 text-sm text-o2-navy">
              <input type="checkbox" name="produtos" value={p.valor} defaultChecked={programa?.produtos.includes(p.valor)} />
              {p.rotulo}
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className={rotuloClass}>
          O que a meta mede
          <InfoLegenda titulo="Métrica da meta">
            Contratações = cotações convertidas (Fiança convertida, Capitalização paga, Ramos Elementares efetivado), contadas no mês da efetivação. Cotações = cotações recebidas no período. Prêmio e comissão = soma das contratações do período.
          </InfoLegenda>
        </label>
        <select name="metrica" defaultValue={programa?.metrica ?? "contratacoes"} className={inputClass}>
          {METRICAS_PROGRAMA.map((m) => (
            <option key={m.valor} value={m.valor}>
              {m.rotulo}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className={rotuloClass}>Início</label>
          <input name="inicio" type="date" required defaultValue={programa?.inicio} className={inputClass} />
        </div>
        <div>
          <label className={rotuloClass}>Fim</label>
          <input name="fim" type="date" required defaultValue={programa?.fim} className={inputClass} />
        </div>
        <div>
          <label className={rotuloClass}>Apuração (opcional)</label>
          <input name="data_apuracao" type="date" defaultValue={programa?.data_apuracao ?? ""} className={inputClass} />
        </div>
      </div>

      <div>
        <label className={rotuloClass}>Premiação (opcional)</label>
        <textarea
          name="premiacao_descricao"
          rows={2}
          defaultValue={programa?.premiacao_descricao ?? ""}
          placeholder="Ex: troféu O2 Elite + vídeo de marketing de autoridade"
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className={rotuloClass}>
            Custo geral da premiação (R$)
            <InfoLegenda titulo="Custo geral">
              Custos do programa que não são de uma imobiliária só (ex: produção do troféu, evento). O custo de cada imobiliária vai na linha dela.
            </InfoLegenda>
          </label>
          <input name="custo_premiacao_geral" inputMode="decimal" defaultValue={programa ? String(programa.custo_premiacao_geral ?? 0).replace(".", ",") : ""} placeholder="0,00" className={inputClass} />
        </div>
        <div>
          <label className={rotuloClass}>Situação</label>
          <select name="status" defaultValue={programa?.status ?? "ativa"} className={inputClass}>
            {Object.entries(STATUS_PROGRAMA).map(([valor, rotulo]) => (
              <option key={valor} value={valor}>
                {rotulo}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={rotuloClass}>Responsável (e-mail)</label>
          <input name="responsavel_email" type="email" defaultValue={programa?.responsavel_email ?? emailPadrao ?? ""} className={inputClass} />
        </div>
      </div>
    </div>
  );
}
