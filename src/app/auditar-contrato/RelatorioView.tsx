import type { RelatorioAuditoria, StatusChecklist } from "@/lib/auditorContrato";

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

function LinhaChecklist({
  titulo,
  status,
  resumo,
}: {
  titulo: string;
  status: StatusChecklist | undefined;
  resumo: string | undefined;
}) {
  const statusFinal = status ?? "nao_avaliado";
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className={`mt-0.5 ${COR_ITEM[statusFinal]}`}>{ICONE_ITEM[statusFinal]}</span>
      <div>
        <span className="font-medium text-o2-navy">{titulo}: </span>
        <span className="text-gray-700">{resumo ?? "Não avaliado nesta auditoria."}</span>
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

// Versão intermediária do checklist (cada pilar era um objeto aninhado
// {status, resumo}) — mantida só pra continuar mostrando corretamente
// auditorias salvas nessa fase, antes do schema ser achatado.
type PilarAninhado = { status: StatusChecklist; resumo: string };
type RelatorioAninhado = {
  dados_cadastrais?: PilarAninhado;
  dados_locacao?: PilarAninhado;
  conferencia_cotacao?: PilarAninhado;
  clausulas_seguradora?: PilarAninhado;
  assinaturas?: PilarAninhado;
};

export default function RelatorioView({ relatorio }: { relatorio: RelatorioAuditoria }) {
  const semChecklist =
    !("dados_cadastrais_status" in relatorio) && !("dados_cadastrais" in relatorio);
  if (semChecklist) {
    return <RelatorioAntigoView relatorio={relatorio as unknown as RelatorioAntigo} />;
  }

  const aninhado = relatorio as unknown as RelatorioAninhado;
  const pilar = (chave: keyof RelatorioAninhado, statusPlano?: StatusChecklist, resumoPlano?: string) => ({
    status: statusPlano ?? aninhado[chave]?.status,
    resumo: resumoPlano ?? aninhado[chave]?.resumo,
  });

  const dadosCadastrais = pilar("dados_cadastrais", relatorio.dados_cadastrais_status, relatorio.dados_cadastrais_resumo);
  const dadosLocacao = pilar("dados_locacao", relatorio.dados_locacao_status, relatorio.dados_locacao_resumo);
  const conferenciaCotacao = pilar("conferencia_cotacao", relatorio.conferencia_cotacao_status, relatorio.conferencia_cotacao_resumo);
  const clausulasSeguradora = pilar("clausulas_seguradora", relatorio.clausulas_seguradora_status, relatorio.clausulas_seguradora_resumo);
  const assinaturas = pilar("assinaturas", relatorio.assinaturas_status, relatorio.assinaturas_resumo);

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
        <LinhaChecklist titulo="Dados cadastrais" status={dadosCadastrais.status} resumo={dadosCadastrais.resumo} />
        <LinhaChecklist titulo="Dados da locação" status={dadosLocacao.status} resumo={dadosLocacao.resumo} />
        <LinhaChecklist titulo="Conferência com a cotação" status={conferenciaCotacao.status} resumo={conferenciaCotacao.resumo} />
        <LinhaChecklist titulo="Cláusulas da seguradora" status={clausulasSeguradora.status} resumo={clausulasSeguradora.resumo} />
        <LinhaChecklist titulo="Assinaturas" status={assinaturas.status} resumo={assinaturas.resumo} />
      </div>

      {(relatorio.pontos_criticos?.length ?? 0) > 0 && (
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
