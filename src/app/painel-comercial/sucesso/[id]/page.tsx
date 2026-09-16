import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import { IconChart } from "@/components/icons";
import { signOut } from "../../../actions";
import { buscarDetalheCardSucesso } from "@/lib/bitrix/comercial";
import styles from "../../painel-comercial.module.css";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function fmtData(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function fmtMoeda(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function Campo({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.row}>
      <span>{label}</span>
      <span style={{ color: value && value !== "—" ? "var(--ink)" : "var(--ink-faint)" }}>{value || "—"}</span>
    </div>
  );
}

export default async function CardSucessoDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dealId = Number(id);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  if (!Number.isFinite(dealId) || dealId <= 0) notFound();

  const detalhe = await buscarDetalheCardSucesso(dealId).catch(() => null);
  if (!detalhe) notFound();

  const { deal, empresa } = detalhe;

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <div className={styles.wrap}>
        <div className={styles.container}>
          <div className={styles.masthead}>
            <PageHeader icon={<IconChart />} titulo={deal.titulo} subtitulo={`Sucesso do Cliente — ${deal.etapaNome}`} />
            <div className={styles.meta}>
              <Link href="/painel-comercial" style={{ color: "var(--accent-ink)" }}>
                ← Voltar pro painel Comercial
              </Link>
            </div>
          </div>

          <div className={styles.stampPanel} style={{ marginBottom: 24 }}>
            <div className={styles.stampBadge}>SOMENTE LEITURA</div>
            <div className={styles.stampList}>
              <div>Esta tela mostra os dados reais do card e da empresa no Bitrix. Nenhum campo aqui é editável — pra alterar algo, use o Bitrix diretamente.</div>
            </div>
          </div>

          <div className={styles.grid2}>
            <section className={styles.panel}>
              <h3>Dados do cliente</h3>
              <Campo label="Responsável atual" value={deal.responsavelNome} />
              <Campo label="Endereço da imobiliária" value={deal.enderecoImobiliaria} />
              <Campo label="Tomador de decisão" value={[deal.nomeDecisor, deal.cargoDecisor].filter(Boolean).join(" · ")} />
              <Campo label="Classificação da empresa" value={empresa?.classificacao ?? ""} />
              <Campo label="Imóveis administrados" value={empresa?.imoveisAdm != null ? String(empresa.imoveisAdm) : ""} />
              <Campo label="Ticket médio" value={empresa?.ticketMedio ?? ""} />
              <Campo label="Status de contato" value={empresa?.statusContato ?? ""} />
              <Campo label="Tipo de oportunidade" value={empresa?.tipoOportunidade ?? ""} />
              <Campo label="Motivo de entrada" value={deal.motivoEntradaNome} />
            </section>

            <section className={styles.panel}>
              <h3>Call ou visita presencial</h3>
              <Campo label="Formato da reunião" value={deal.formatoReuniao} />
              <Campo label="Status da reunião" value={deal.statusReuniao} />
              <Campo label="Data e horário atuais da reunião" value={deal.dataReuniaoAtual ? new Date(deal.dataReuniaoAtual).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : ""} />
              <Campo label="Data e horário da reunião realizada" value={deal.dataReuniaoRealizada ? new Date(deal.dataReuniaoRealizada).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : ""} />
              <Campo label="Data do primeiro agendamento" value={fmtData(deal.dataPrimeiroAgendamento)} />
              <Campo label="Motivo do cancelamento" value={deal.motivoCancelamento} />
            </section>
          </div>

          <section className={styles.panel} style={{ marginTop: 18 }}>
            <h3>Marcos do fluxo (data de entrada por etapa)</h3>
            <div className={styles.grid3}>
              <Campo label="Radar de Negócios" value={fmtData(deal.dtRadar)} />
              <Campo label="Contato em Andamento" value={fmtData(deal.dtContato)} />
              <Campo label="Análise Desemp. (Pré-Visita)" value={fmtData(deal.dtPrevisita)} />
              <Campo label="Oportunidade Comercial" value={fmtData(deal.dtOportunidade)} />
              <Campo label="Resultado Gerado" value={fmtData(deal.dtResultado)} />
            </div>
          </section>

          <div className={styles.grid2} style={{ marginTop: 18 }}>
            <section className={styles.panel}>
              <h3>Resultado financeiro</h3>
              <Campo label="Nº de cotações" value={empresa?.numCotacoes != null ? String(empresa.numCotacoes) : ""} />
              <Campo label="Nº de apólices geradas" value={empresa?.numApolices != null ? String(empresa.numApolices) : ""} />
              <Campo label="Comissão O2" value={empresa ? fmtMoeda(empresa.comissaoO2) : ""} />
              <Campo label="Prêmio Líquido" value={empresa ? fmtMoeda(empresa.premioLiquido) : ""} />
              <div className={styles.panelSub} style={{ marginTop: 10 }}>
                Esses 4 campos vêm do card da EMPRESA, não deste negócio — se a empresa tiver mais de um card ativo em Sucesso, o mesmo valor aparece em todos.
              </div>
            </section>

            <section className={styles.panel}>
              <h3>Próxima ação</h3>
              <Campo label="Próxima ação" value={deal.proximaAcao} />
              <Campo label="Responsável pela próxima ação" value={deal.responsavelProximaAcao} />
              <Campo label="Prazo da próxima ação" value={deal.prazoProximaAcao ? new Date(deal.prazoProximaAcao).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : ""} />
              <Campo label="Pendência principal" value={deal.pendenciaPrincipal} />
              <Campo label="Motivo de reciclagem" value={deal.motivoReciclagemNome} />
              <Campo label="Valor (OPPORTUNITY)" value={deal.valor > 0 ? fmtMoeda(deal.valor) : "Não preenchido"} />
              <Campo label="Data de término (CLOSEDATE)" value={fmtData(deal.dataTermino)} />
            </section>
          </div>

          <footer className={styles.footer}>Fonte: Bitrix24, Deal #{deal.id} e Empresa vinculada, via webhook de leitura. Campos vazios aparecem como &quot;—&quot;, não como zero.</footer>
        </div>
      </div>
    </>
  );
}
