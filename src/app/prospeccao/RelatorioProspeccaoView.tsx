"use client";

import type { FichaImobiliaria } from "@/lib/prospeccaoIA";
import type { NumerosO2 } from "@/lib/numerosO2";
import type { HistoricoCotacoes, ComparativoRegional } from "@/lib/prospeccaoDados";
import type { TicketPorLocal } from "@/lib/prospeccaoEstatisticas";

type Relatorio = {
  nome_imobiliaria: string;
  cnpj_imobiliaria: string | null;
  url_site: string | null;
  url_instagram: string | null;
  notas_manuais: string | null;
  ficha: FichaImobiliaria;
  numeros_o2: NumerosO2;
  historico_cotacoes?: Partial<HistoricoCotacoes> | null;
  comparativo_regional?: Partial<ComparativoRegional> | null;
  ticket_por_faixa?: TicketPorLocal | null;
  created_at: string;
};

const ROTULO_NIVEL: Record<string, string> = {
  bairro: "bairro selecionado",
  regiao: "região mais ampla",
  cidade: "cidade toda",
};

const cardClass = "rounded-xl border border-o2-navy/10 bg-white p-4 shadow-sm";

function formatarReais(valor: number | null | undefined): string | null {
  if (valor === null || valor === undefined) return null;
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function RelatorioProspeccaoView({ relatorio }: { relatorio: Relatorio }) {
  const { ficha, numeros_o2 } = relatorio;
  const historico = relatorio.historico_cotacoes;
  const regional = relatorio.comparativo_regional;
  const ticketPorFaixa = relatorio.ticket_por_faixa;
  const temTicketPorFaixa =
    !!ticketPorFaixa &&
    [...(ticketPorFaixa.incendio_por_faixa ?? []), ...(ticketPorFaixa.fianca_por_faixa ?? [])].some(
      (f) => f.ticket_medio !== null
    );
  const temHistorico =
    !!historico && ((historico.incendio_total_encontradas ?? 0) > 0 || (historico.fianca_total_encontradas ?? 0) > 0);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 print:hidden">
        <p className="text-sm text-gray-500">
          Gerado em {new Date(relatorio.created_at).toLocaleString("pt-BR")}
        </p>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-full border border-o2-navy px-4 py-1.5 text-sm font-medium text-o2-navy transition hover:bg-o2-navy hover:text-white"
        >
          Imprimir / Baixar PDF
        </button>
      </div>

      <div className={cardClass}>
        <h2 className="text-lg font-semibold text-o2-navy">{relatorio.nome_imobiliaria}</h2>
        <p className="text-sm text-gray-500">
          {relatorio.cnpj_imobiliaria && <>CNPJ: {relatorio.cnpj_imobiliaria} · </>}
          {relatorio.url_site && (
            <>
              Site: {relatorio.url_site} ·{" "}
            </>
          )}
          {relatorio.url_instagram && <>Instagram: {relatorio.url_instagram}</>}
        </p>
      </div>

      <div className={cardClass}>
        <h3 className="mb-2 font-semibold text-o2-navy">Ficha da imobiliária</h3>
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="font-medium text-gray-600">Porte estimado</dt>
            <dd className="text-gray-800">{ficha.porte_estimado}</dd>
          </div>
          <div>
            <dt className="font-medium text-gray-600">Presença digital</dt>
            <dd className="text-gray-800">{ficha.presenca_digital_resumo}</dd>
          </div>
          <div>
            <dt className="font-medium text-gray-600">Público-alvo estimado</dt>
            <dd className="text-gray-800">{ficha.publico_alvo_estimado}</dd>
          </div>
          <div>
            <dt className="font-medium text-gray-600">Resumo geral</dt>
            <dd className="text-gray-800">{ficha.resumo_geral}</dd>
          </div>
        </dl>
      </div>

      <div className={cardClass}>
        <h3 className="mb-2 font-semibold text-o2-navy">Pontos de abordagem sugeridos</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm text-gray-800">
          {ficha.pontos_de_abordagem.map((ponto, i) => (
            <li key={i}>{ponto}</li>
          ))}
        </ul>
      </div>

      {relatorio.notas_manuais && (
        <div className={cardClass}>
          <h3 className="mb-2 font-semibold text-o2-navy">Suas notas</h3>
          <p className="whitespace-pre-wrap text-sm text-gray-800">{relatorio.notas_manuais}</p>
        </div>
      )}

      <div className={cardClass}>
        <h3 className="mb-2 font-semibold text-o2-navy">Histórico com a O2</h3>
        {temHistorico ? (
          <div className="space-y-3 text-sm">
            {(historico!.incendio_total_encontradas ?? 0) > 0 && (
              <p className="text-gray-800">
                <strong>{historico!.incendio_total_encontradas}</strong> cotação(ões) de seguro incêndio
                encontrada(s) com essa imobiliária, sendo <strong>{historico!.incendio_efetivadas}</strong>{" "}
                efetivada(s).
              </p>
            )}
            {(historico!.fianca_total_encontradas ?? 0) > 0 && (
              <p className="text-gray-800">
                <strong>{historico!.fianca_total_encontradas}</strong> cotação(ões) de seguro fiança
                encontrada(s) com essa imobiliária.
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-500">
            Nenhuma cotação encontrada com essa imobiliária nas planilhas da O2 — parece ser um contato novo.
          </p>
        )}
      </div>

      {temTicketPorFaixa && (
        <div className={cardClass}>
          <h3 className="mb-1 font-semibold text-o2-navy">Ticket médio por faixa de aluguel</h3>
          <p className="mb-3 text-xs text-gray-500">
            {ticketPorFaixa!.bairro_informado
              ? `Baseado em: ${ticketPorFaixa!.bairro_informado}`
              : ticketPorFaixa!.cidade_informada
                ? `Baseado na cidade: ${ticketPorFaixa!.cidade_informada}`
                : ""}
          </p>

          <div className="space-y-3 text-sm">
            <div>
              <p className="mb-1 font-medium text-o2-navy">Seguro incêndio</p>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-gray-500">
                    <th className="pb-1 font-medium">Faixa de aluguel</th>
                    <th className="pb-1 font-medium">Ticket médio</th>
                    <th className="pb-1 font-medium">Base</th>
                  </tr>
                </thead>
                <tbody>
                  {ticketPorFaixa!.incendio_por_faixa.map((f) => (
                    <tr key={f.faixa} className="border-t border-gray-100">
                      <td className="py-1 text-gray-800">{f.faixa}</td>
                      <td className="py-1 text-gray-800">
                        {f.ticket_medio !== null ? formatarReais(f.ticket_medio) : "sem dados"}
                      </td>
                      <td className="py-1 text-gray-500">
                        {f.nivel ? `${ROTULO_NIVEL[f.nivel]} (${f.quantidade})` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <p className="mb-1 font-medium text-o2-navy">Seguro fiança</p>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-gray-500">
                    <th className="pb-1 font-medium">Faixa de aluguel</th>
                    <th className="pb-1 font-medium">Ticket médio</th>
                    <th className="pb-1 font-medium">Base</th>
                  </tr>
                </thead>
                <tbody>
                  {ticketPorFaixa!.fianca_por_faixa.map((f) => (
                    <tr key={f.faixa} className="border-t border-gray-100">
                      <td className="py-1 text-gray-800">{f.faixa}</td>
                      <td className="py-1 text-gray-800">
                        {f.ticket_medio !== null ? formatarReais(f.ticket_medio) : "sem dados"}
                      </td>
                      <td className="py-1 text-gray-500">
                        {f.nivel ? `${ROTULO_NIVEL[f.nivel]} (${f.quantidade})` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {regional &&
        ((regional.total_cotacoes_incendio_analisadas ?? 0) > 0 ||
          regional.ticket_medio_fianca_geral != null) && (
          <div className={cardClass}>
            <h3 className="mb-2 font-semibold text-o2-navy">Comparativo regional</h3>
            <div className="space-y-1 text-sm text-gray-800">
              {regional.cidade_da_imobiliaria && (
                <p>
                  Na cidade de <strong>{regional.cidade_da_imobiliaria}</strong>, a O2 já tem{" "}
                  <strong>{regional.cotacoes_incendio_na_mesma_cidade}</strong> cotação(ões) de incêndio
                  registrada(s).
                </p>
              )}
              {regional.cidade_com_mais_cotacoes && (
                <p>
                  No geral, a cidade com mais cotações de incêndio é{" "}
                  <strong>{regional.cidade_com_mais_cotacoes}</strong> (
                  {regional.cotacoes_na_cidade_mais_frequente} cotações).
                </p>
              )}

              <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {formatarReais(regional.ticket_medio_incendio_geral) && (
                  <div>
                    <p className="text-lg font-semibold text-o2-coral">
                      {formatarReais(regional.ticket_medio_incendio_geral)}
                    </p>
                    <p className="text-xs text-gray-500">Ticket médio incêndio (geral)</p>
                  </div>
                )}
                {formatarReais(regional.ticket_medio_incendio_na_cidade) && (
                  <div>
                    <p className="text-lg font-semibold text-o2-coral">
                      {formatarReais(regional.ticket_medio_incendio_na_cidade)}
                    </p>
                    <p className="text-xs text-gray-500">Ticket médio incêndio ({regional.cidade_da_imobiliaria})</p>
                  </div>
                )}
                {formatarReais(regional.ticket_medio_fianca_geral) && (
                  <div>
                    <p className="text-lg font-semibold text-o2-coral">
                      {formatarReais(regional.ticket_medio_fianca_geral)}
                    </p>
                    <p className="text-xs text-gray-500">Ticket médio fiança (geral)</p>
                  </div>
                )}
                {formatarReais(regional.ticket_medio_fianca_na_cidade) && (
                  <div>
                    <p className="text-lg font-semibold text-o2-coral">
                      {formatarReais(regional.ticket_medio_fianca_na_cidade)}
                    </p>
                    <p className="text-xs text-gray-500">Ticket médio fiança ({regional.cidade_da_imobiliaria})</p>
                  </div>
                )}
              </div>

              <p className="mt-2 text-xs text-gray-500">{regional.observacao}</p>
            </div>
          </div>
        )}

      <div className={cardClass}>
        <h3 className="mb-2 font-semibold text-o2-navy">Números da O2</h3>
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div>
            <p className="text-2xl font-semibold text-o2-coral">{numeros_o2.total_contratos}</p>
            <p className="text-gray-500">Contratos gerados</p>
          </div>
          <div>
            <p className="text-2xl font-semibold text-o2-coral">{numeros_o2.contratos_ultimos_12_meses}</p>
            <p className="text-gray-500">Nos últimos 12 meses</p>
          </div>
          <div>
            <p className="text-2xl font-semibold text-o2-coral">{numeros_o2.total_imobiliarias_parceiras}</p>
            <p className="text-gray-500">Imobiliárias parceiras</p>
          </div>
          <div>
            <p className="text-2xl font-semibold text-o2-coral">{numeros_o2.total_seguradoras_parceiras}</p>
            <p className="text-gray-500">Seguradoras parceiras</p>
          </div>
          <div>
            <p className="text-2xl font-semibold text-o2-coral">{numeros_o2.total_produtos_ativos}</p>
            <p className="text-gray-500">Produtos ativos</p>
          </div>
        </div>
      </div>
    </div>
  );
}
