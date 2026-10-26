import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import PageHeader from "@/components/PageHeader";
import { IconReport } from "@/components/icons";
import { formatarData, formatarReais } from "@/lib/sinistros/regras";
import { buscarDocumentos, nomeTipoDocumento, SITUACOES, TIPOS_DOCUMENTO } from "@/lib/erp/documentos";
import { lerFiltros } from "@/lib/erp/filtros";
import FiltrosErp from "../FiltrosErp";


// ERP O2 — Fase 0: tela mínima de consulta de documentos (só leitura), para o
// Matheus conferir a carga do espelho do Corp contra o próprio Corp. Mesma
// busca da "Consulta de Documentos" do Corp: Nosso Nº, apólice, cliente ou
// imobiliária. Entrada ainda fora do menu (vínculo ao dropdown fica para o fim).


const COR_SITUACAO: Record<string, string> = {
  vigente: "bg-green-100 text-green-800",
  digitado: "bg-yellow-100 text-yellow-800",
  emitido: "bg-blue-100 text-blue-800",
  vencido: "bg-gray-100 text-gray-600",
  cancelado: "bg-red-100 text-red-700",
  devolvido: "bg-red-100 text-red-700",
};


// Lista de documentos reaproveitada pelas etapas do processo (Matheus 26/10: uma tela por etapa, sem telas
// redundantes): Apólices (/erp/documentos) e Emissão (/erp/emissao) são a mesma busca com filtro padrão diferente.
export default async function ListaDocumentos({
  searchParams,
  caminho = "/erp/documentos",
  titulo = "ERP O2 — Apólices",
  subtitulo = "Apólices, endossos e faturas carregados do Corp. Busque pelo Código O2, pelo nosso número do Corp, nº da apólice, cliente ou imobiliária.",
  padrao = {},
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  caminho?: string;
  titulo?: string;
  subtitulo?: string;
  /** filtros aplicados quando a URL não traz o parâmetro (ex.: Emissão = situação "efetivada · em emissão") */
  padrao?: Record<string, string>;
}) {
  const sp = { ...padrao, ...(await searchParams) };
  const f = lerFiltros(sp);
  const limite = typeof sp.limite === "string" ? sp.limite : undefined;
  const situacao = f.situacao;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const busca = f.q ?? "";
  const { linhas, total } = await buscarDocumentos(supabase, {
    busca,
    situacao,
    seguradora: f.seguradora,
    produto: f.produto,
    tipo: f.tipo,
    imobiliaria: f.imobiliaria,
    forma: f.forma,
    canal: f.canal,
    de: f.de,
    ate: f.ate,
    inquilino: f.inquilino,
    proprietario: f.proprietario,
    imovel: f.imovel,
    limite: Number(limite) || 50,
  });
  const paramsMais = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]);
  paramsMais.set("limite", String(linhas.length + 50));

  return (
    <>
      <main className="mx-auto w-full max-w-[1200px] flex-1 space-y-6 p-8">
        <PageHeader
          icon={<IconReport />}
          titulo={titulo}
          subtitulo={subtitulo}
        />

        <FiltrosErp
          caminho={caminho}
          campos={["busca", "seguradora", "produto", "situacao", "imobiliaria", "inquilino", "periodo", "proprietario", "imovel", "tipo", "forma_pagamento", "canal"]}
          avancados={["proprietario", "imovel", "tipo", "forma_pagamento", "canal"]}
          valores={f}
          placeholderBusca="133632 · 0004640286 · Mario Imares"
          rotuloPeriodo="Início de vigência"
          situacoes={SITUACOES}
          tipos={TIPOS_DOCUMENTO}
          resumo={
            <>
              {total !== null ? `${total.toLocaleString("pt-BR")} documento(s)` : `os ${linhas.length} mais recentes (use os filtros para localizar)`}
              {total !== null && total > linhas.length ? ` · mostrando ${linhas.length}` : ""}
            </>
          }
        />

        {linhas.length === 0 ? (
          <p className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">Nenhum documento encontrado.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2">Código O2</th>
                  <th className="px-3 py-2">Nº Corp</th>
                  <th className="px-3 py-2">Situação</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Cliente</th>
                  <th className="px-3 py-2">Imobiliária</th>
                  <th className="px-3 py-2">Seg.</th>
                  <th className="px-3 py-2">Ramo</th>
                  <th className="px-3 py-2">Apólice</th>
                  <th className="px-3 py-2">Início vig.</th>
                  <th className="px-3 py-2">Fim vig.</th>
                  <th className="px-3 py-2 text-right">Pr. líquido</th>
                  <th className="px-3 py-2 text-right">Comissão</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {linhas.map((d) => (
                  <tr key={d.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium">
                      <Link href={`/erp/documentos/${d.id}`} className="text-o2-navy hover:underline">
                        {d.nosso_numero}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-gray-500">{d.nosso_numero_corp ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${COR_SITUACAO[d.situacao] ?? "bg-gray-100"}`}>
                        {SITUACOES[d.situacao] ?? d.situacao}
                      </span>
                    </td>
                    <td className="px-3 py-2" title={`${d.tipo} · ${TIPOS_DOCUMENTO[d.tipo] ?? d.tipo}`}>
                      <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ${nomeTipoDocumento(d.tipo, d.tipo_corp).cor}`}>{nomeTipoDocumento(d.tipo, d.tipo_corp).nome}</span>
                    </td>
                    <td className="px-3 py-2">{d.cliente ?? <span className="text-gray-400">sem cliente ligado</span>}</td>
                    <td className="px-3 py-2">
                      {d.imobiliaria_id ? (
                        <Link href={`/admin/imobiliarias/${d.imobiliaria_id}`} className="hover:underline">
                          {d.imobiliaria}
                        </Link>
                      ) : (
                        <span className="text-gray-400">{d.canal_venda ?? "—"}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">{d.seguradora ?? "—"}</td>
                    <td className="px-3 py-2">{d.ramo ?? "—"}</td>
                    <td className="px-3 py-2">{d.numero_apolice ?? <span className="text-gray-400">0</span>}</td>
                    <td className="px-3 py-2">{formatarData(d.vigencia_inicio)}</td>
                    <td className="px-3 py-2">{formatarData(d.vigencia_fim)}</td>
                    <td className="px-3 py-2 text-right">{formatarReais(d.premio_liquido)}</td>
                    <td className="px-3 py-2 text-right">{formatarReais(d.comissao_valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total !== null && total > linhas.length && (
          <Link
            href={`${caminho}?${paramsMais.toString()}`}
            className="inline-block rounded-full border border-o2-navy px-3 py-1 text-xs font-medium text-o2-navy hover:bg-o2-navy hover:text-white"
          >
            Mostrar mais
          </Link>
        )}
        <p className="text-xs text-gray-500">
          Conferência contra o Corp: <Link href="/erp/conferencia" className="underline">mês × ramo × seguradora</Link>.
        </p>
      </main>
    </>
  );
}
