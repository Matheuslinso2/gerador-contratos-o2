import type { ItemChecklist, RelatorioAuditoria, StatusChecklist } from "@/lib/auditorContrato";

const STATUS_ESTILO: Record<string, string> = {
  APROVADO: "border-green-300 bg-green-50 text-green-700",
  APROVADO_RESSALVAS: "border-yellow-300 bg-yellow-50 text-yellow-800",
  REPROVADO: "border-red-300 bg-red-50 text-red-700",
  // rótulos antigos, de auditorias feitas antes desta versão do checklist
  REQUER_AJUSTES: "border-yellow-300 bg-yellow-50 text-yellow-800",
  ALERTA_CRITICO: "border-red-300 bg-red-50 text-red-700",
};

const STATUS_ROTULO: Record<string, string> = {
  APROVADO: "✅ Aprovado",
  APROVADO_RESSALVAS: "⚠️ Aprovado com ressalvas",
  REPROVADO: "❌ Reprovado",
  REQUER_AJUSTES: "⚠️ Aprovado com ressalvas",
  ALERTA_CRITICO: "❌ Reprovado",
};

const ICONE_ITEM: Record<StatusChecklist, string> = {
  ok: "✅",
  atencao: "⚠️",
  problema: "❌",
  nao_avaliado: "➖",
};

const COR_ITEM: Record<StatusChecklist, string> = {
  ok: "text-green-700",
  atencao: "text-yellow-800",
  problema: "text-red-700",
  nao_avaliado: "text-gray-400",
};

function LinhaChecklist({ titulo, item }: { titulo: string; item: ItemChecklist }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className={`mt-0.5 ${COR_ITEM[item.status]}`}>{ICONE_ITEM[item.status]}</span>
      <div>
        <span className="font-medium text-o2-navy">{titulo}: </span>
        <span className="text-gray-700">{item.resumo}</span>
      </div>
    </div>
  );
}

// Formato antigo (antes do checklist resumido) — mantido só pra continuar
// mostrando corretamente auditorias já salvas no banco.
type RelatorioAntigo = {
  status_geral: string;
  tipo_garantia_identificada: string;
  inconsistencias_criticas: { secao: string; problema: string; correcao: string }[];
  divergencias: { secao: string; problema: string; correcao: string }[];
  erros_formatacao: { secao: string; problema: string; correcao: string }[];
  observacoes: string[];
};

function RelatorioAntigoView({ relatorio }: { relatorio: RelatorioAntigo }) {
  const grupos = [
    { titulo: "🚨 Inconsistências críticas", itens: relatorio.inconsistencias_criticas },
    { titulo: "⚠️ Divergências e incoerências de dados", itens: relatorio.divergencias },
    { titulo: "✏️ Erros de digitação, formatação e sequência", itens: relatorio.erros_formatacao },
  ];
  const semProblemas = grupos.every((g) => !g.itens.length);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-3 py-1 text-sm font-semibold ${STATUS_ESTILO[relatorio.status_geral] ?? "border-gray-300 bg-gray-50 text-gray-700"}`}>
          {STATUS_ROTULO[relatorio.status_geral] ?? relatorio.status_geral}
        </span>
        <span className="rounded-full border border-gray-300 bg-gray-50 px-3 py-1 text-sm text-gray-700">
          Garantia identificada: {relatorio.tipo_garantia_identificada}
        </span>
      </div>

      {semProblemas && (
        <p className="text-sm text-gray-600">Nenhuma inconsistência ou divergência encontrada.</p>
      )}

      {grupos.map(
        (g) =>
          g.itens.length > 0 && (
            <div key={g.titulo}>
              <p className="mb-1.5 font-semibold text-o2-navy">{g.titulo}</p>
              <ul className="space-y-2">
                {g.itens.map((item, i) => (
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
          )
      )}

      {relatorio.observacoes?.length > 0 && (
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

export default function RelatorioView({ relatorio }: { relatorio: RelatorioAuditoria }) {
  if (!("dados_cadastrais" in relatorio)) {
    return <RelatorioAntigoView relatorio={relatorio as unknown as RelatorioAntigo} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-3 py-1 text-sm font-semibold ${STATUS_ESTILO[relatorio.status_geral] ?? "border-gray-300 bg-gray-50 text-gray-700"}`}>
          {STATUS_ROTULO[relatorio.status_geral] ?? relatorio.status_geral}
        </span>
        <span className="rounded-full border border-gray-300 bg-gray-50 px-3 py-1 text-sm text-gray-700">
          Garantia identificada: {relatorio.tipo_garantia_identificada}
        </span>
      </div>

      <div className="space-y-1.5 rounded-lg border border-gray-200 bg-white p-3">
        <LinhaChecklist titulo="Dados cadastrais" item={relatorio.dados_cadastrais} />
        <LinhaChecklist titulo="Dados da locação" item={relatorio.dados_locacao} />
        <LinhaChecklist titulo="Conferência com a cotação" item={relatorio.conferencia_cotacao} />
        <LinhaChecklist titulo="Cláusulas da seguradora" item={relatorio.clausulas_seguradora} />
        <LinhaChecklist titulo="Assinaturas" item={relatorio.assinaturas} />
      </div>

      {relatorio.pontos_criticos.length > 0 && (
        <div>
          <p className="mb-1.5 font-semibold text-o2-navy">Pontos de atenção</p>
          <ul className="list-inside list-disc space-y-1 text-sm text-gray-700">
            {relatorio.pontos_criticos.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
