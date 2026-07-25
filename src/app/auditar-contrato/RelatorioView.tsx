import type { ItemAuditoria, RelatorioAuditoria } from "@/lib/auditorContrato";

const STATUS_ESTILO: Record<RelatorioAuditoria["status_geral"], string> = {
  APROVADO: "border-green-300 bg-green-50 text-green-700",
  REQUER_AJUSTES: "border-yellow-300 bg-yellow-50 text-yellow-800",
  ALERTA_CRITICO: "border-red-300 bg-red-50 text-red-700",
};

const STATUS_ROTULO: Record<RelatorioAuditoria["status_geral"], string> = {
  APROVADO: "Aprovado",
  REQUER_AJUSTES: "Requer ajustes",
  ALERTA_CRITICO: "Alerta crítico",
};

function ListaItens({ titulo, itens }: { titulo: string; itens: ItemAuditoria[] }) {
  if (!itens.length) return null;
  return (
    <div>
      <p className="mb-1.5 font-semibold text-o2-navy">{titulo}</p>
      <ul className="space-y-2">
        {itens.map((item, i) => (
          <li key={i} className="rounded-lg border border-gray-200 bg-white p-2.5 text-sm">
            <span className="font-medium text-gray-800">{item.secao}: </span>
            <span className="text-gray-700">{item.problema}</span>
            <div className="mt-1 text-o2-navy">
              <span className="font-medium">Correção sugerida: </span>
              {item.correcao}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function RelatorioView({ relatorio }: { relatorio: RelatorioAuditoria }) {
  const semProblemas =
    !relatorio.inconsistencias_criticas.length &&
    !relatorio.divergencias.length &&
    !relatorio.erros_formatacao.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-3 py-1 text-sm font-semibold ${STATUS_ESTILO[relatorio.status_geral]}`}>
          {STATUS_ROTULO[relatorio.status_geral]}
        </span>
        <span className="rounded-full border border-gray-300 bg-gray-50 px-3 py-1 text-sm text-gray-700">
          Garantia identificada: {relatorio.tipo_garantia_identificada}
        </span>
      </div>

      {semProblemas && (
        <p className="text-sm text-gray-600">Nenhuma inconsistência ou divergência encontrada.</p>
      )}

      <ListaItens titulo="🚨 Inconsistências críticas" itens={relatorio.inconsistencias_criticas} />
      <ListaItens titulo="⚠️ Divergências e incoerências de dados" itens={relatorio.divergencias} />
      <ListaItens titulo="✏️ Erros de digitação, formatação e sequência" itens={relatorio.erros_formatacao} />

      {relatorio.observacoes.length > 0 && (
        <div>
          <p className="mb-1.5 font-semibold text-o2-navy">💡 Observações e recomendações</p>
          <ul className="list-inside list-disc space-y-1 text-sm text-gray-700">
            {relatorio.observacoes.map((obs, i) => (
              <li key={i}>{obs}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
