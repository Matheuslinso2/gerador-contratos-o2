import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import { IconChart } from "@/components/icons";
import { signOut } from "../../actions";
import { Abas, dataHora, FonteDados, num, Quadro, reais, rotuloMes } from "../_corp/comum";
import { abrirPainel } from "../_corp/dados";

export const dynamic = "force-dynamic";

// Power BI - O2 Seguros › Inconsistências ("CHECK DE INCONSISTÊNCIAS" do
// Power BI): Nosso Nº que continuam repetidos depois da regra de prioridade
// e produtores do Corp que não estão no cadastro de produtores do SharePoint
// (a produção deles fica fora das contas). Mais dois checks do Workspace:
// nomes do cadastro com espaço sobrando (o Power BI compara o texto exato e
// deixa essa produção de fora) e alterações que a fonte trouxe para meses já
// fechados (mês fechado congela; a diferença fica registrada aqui).

type Inc = {
  duplicidades: { nosso_numero: number; produtor: string; ramo: string; ini_vig: string; pr_liquido: number; vl_com: number }[];
  ausentes: { produtor: string; agente: string | null; linhas: number; ultima_vigencia: string | null }[];
  nomes_com_espaco: { nome: string; classe: string | null }[];
};
type Alteracao = { id: number; assunto: string; mes: string; detectado_em: string; resumo: { congelado: Record<string, number>; fonte_atual: Record<string, number> } };

function Total({ rotulo, valor, bom }: { rotulo: string; valor: number; bom: boolean }) {
  return (
    <div className="mb-3">
      <p className="text-xs font-semibold text-gray-600">{rotulo}</p>
      <p className={`text-2xl font-bold tabular-nums ${bom ? "text-green-700" : "text-red-700"}`}>{num(valor)}</p>
    </div>
  );
}

const ROTULOS: Record<string, string> = {
  documentos: "Documentos",
  pr_liquido: "Prêmio líquido",
  vl_com: "Comissão corretora",
  cancelados: "Cancelados",
  vl_com_prod: "Comissão produtor",
  casos: "Casos",
  vl_inden: "Indenização",
  vl_despesas: "Despesas",
};

export default async function InconsistenciasPage() {
  const { supabase, user, opcoes } = await abrirPainel();
  const [{ data, error }, { data: alt }] = await Promise.all([
    supabase.rpc("corp_painel_inconsistencias"),
    supabase.from("corp_alteracoes_pos_fechamento").select("id, assunto, mes, detectado_em, resumo").order("detectado_em", { ascending: false }).limit(100),
  ]);
  const inc = data as Inc | null;
  const alteracoes = (alt ?? []) as Alteracao[];
  const porNosso = new Map<number, Inc["duplicidades"]>();
  for (const d of inc?.duplicidades ?? []) porNosso.set(d.nosso_numero, [...(porNosso.get(d.nosso_numero) ?? []), d]);

  return (
    <>
      <AppHeader userEmail={user.email} logoutAction={signOut} />
      <main className="mx-auto max-w-7xl flex-1 space-y-5 p-8">
        <PageHeader icon={<IconChart />} titulo="Power BI - O2 Seguros" subtitulo="Check de inconsistências" />
        <Abas ativa="/producao/inconsistencias" />
        <FonteDados importadoEm={opcoes.importado_em} arquivoEm={opcoes.arquivo_modificado_em} />
        {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">Não foi possível calcular ({error.message}).</p>}

        {inc && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Quadro titulo="Duplicidades de cadastro" legenda="Nosso Nº que ficaram com mais de uma linha na conta da corretora depois da regra ENTRA > TRATAR N1 > TRATAR N2 — acontece quando dois produtores da mesma apólice estão marcados como ENTRA. Ajuste no cadastro de produtores do SharePoint.">
              <Total rotulo="Total de duplicidades" valor={porNosso.size} bom={porNosso.size === 0} />
              {porNosso.size ? (
                <table className="w-full text-right text-xs tabular-nums">
                  <thead className="border-b border-o2-coral/40 text-[11px] uppercase text-gray-500">
                    <tr>
                      <th className="py-1 text-left">Nosso Nº</th>
                      <th className="text-left">Produtor</th>
                      <th>Ramo</th>
                      <th>Ini. vig.</th>
                      <th>Pr. líquido</th>
                      <th>Vl. com.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...porNosso.values()].flat().map((d, i) => (
                      <tr key={i} className="border-b border-gray-100">
                        <td className="py-1 text-left">{d.nosso_numero}</td>
                        <td className="text-left">{d.produtor}</td>
                        <td>{d.ramo}</td>
                        <td>{d.ini_vig?.split("-").reverse().join("/")}</td>
                        <td>{reais(d.pr_liquido)}</td>
                        <td>{reais(d.vl_com)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-gray-500">Nenhuma apólice contada duas vezes.</p>
              )}
            </Quadro>

            <Quadro titulo="Produtores ausentes" legenda="Produtores que aparecem nas extrações do Corp mas não estão no cadastro de produtores do SharePoint. Enquanto não forem cadastrados (com ENTRA / TRATAR / NÃO ENTRA), a produção deles fica fora das contas.">
              <Total rotulo="Total de produtores" valor={inc.ausentes.length} bom={inc.ausentes.length === 0} />
              {inc.ausentes.length ? (
                <table className="w-full text-right text-xs tabular-nums">
                  <thead className="border-b border-o2-coral/40 text-[11px] uppercase text-gray-500">
                    <tr>
                      <th className="py-1 text-left">Produtor</th>
                      <th>Agente</th>
                      <th>Linhas</th>
                      <th>Última vigência</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inc.ausentes.map((a) => (
                      <tr key={a.produtor} className="border-b border-gray-100">
                        <td className="py-1 text-left">{a.produtor}</td>
                        <td>{a.agente}</td>
                        <td>{num(a.linhas)}</td>
                        <td>{a.ultima_vigencia?.split("-").reverse().join("/")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-gray-500">Todos os produtores do Corp estão no cadastro.</p>
              )}
            </Quadro>

            <Quadro titulo="Nomes com espaço sobrando no cadastro" legenda="O Power BI compara o nome do produtor exatamente como está escrito. Com um espaço a mais no fim, o produtor não é encontrado e a produção dele some do Power BI (o Workspace limpa o espaço e conta). Basta apagar o espaço no cadastro de produtores do SharePoint.">
              <Total rotulo="Nomes para corrigir" valor={inc.nomes_com_espaco.length} bom={inc.nomes_com_espaco.length === 0} />
              {inc.nomes_com_espaco.length > 0 && (
                <ul className="columns-1 space-y-0.5 text-xs sm:columns-2">
                  {inc.nomes_com_espaco.map((n) => (
                    <li key={n.nome} className="break-inside-avoid">
                      <span className="rounded bg-gray-100 px-1 font-mono">&quot;{n.nome}&quot;</span> <span className="text-gray-400">{n.classe ?? "sem classe"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Quadro>

            <Quadro titulo="Alterações em meses fechados" legenda="Mês encerrado fica congelado no Workspace. Quando uma nova extração do Corp traz números diferentes para um mês já fechado (cancelamento retroativo, sinistro que mudou de situação…), a diferença fica registrada aqui e o mês NÃO é reescrito.">
              <Total rotulo="Registros" valor={alteracoes.length} bom={alteracoes.length === 0} />
              {alteracoes.length ? (
                <table className="w-full text-right text-xs tabular-nums">
                  <thead className="border-b border-o2-coral/40 text-[11px] uppercase text-gray-500">
                    <tr>
                      <th className="py-1 text-left">Mês</th>
                      <th className="text-left">Assunto</th>
                      <th className="text-left">Indicador</th>
                      <th>Congelado</th>
                      <th>Fonte atual</th>
                      <th>Detectado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alteracoes.flatMap((a) =>
                      Object.keys(a.resumo.fonte_atual)
                        .filter((k) => Number(a.resumo.fonte_atual[k]) !== Number(a.resumo.congelado?.[k]))
                        .map((k) => (
                          <tr key={`${a.id}-${k}`} className="border-b border-gray-100">
                            <td className="py-1 text-left">{rotuloMes(a.mes)}</td>
                            <td className="text-left">{a.assunto === "producao" ? "Produção" : "Sinistros"}</td>
                            <td className="text-left">{ROTULOS[k] ?? k}</td>
                            <td>{num(a.resumo.congelado?.[k])}</td>
                            <td>{num(a.resumo.fonte_atual[k])}</td>
                            <td>{dataHora(a.detectado_em)}</td>
                          </tr>
                        ))
                    )}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-gray-500">Nenhum mês fechado mudou na fonte.</p>
              )}
            </Quadro>
          </div>
        )}
      </main>
    </>
  );
}
