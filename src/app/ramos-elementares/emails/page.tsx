import Link from "next/link";
import { redirect } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../../actions";
import styles from "../ramos-elementares.module.css";

export const dynamic = "force-dynamic";

type LinhaEmail = {
  id: string;
  recebido_em: string;
  remetente: string;
  assunto: string;
  tipo_confirmacao: "contratacao_confirmada" | "apolice_emitida" | "cancelamento_confirmado" | "outro" | "nao_identificado";
  seguradora: string | null;
  cliente_nome: string | null;
  ramo: string | null;
  numero_apolice: string | null;
  planilha_encontrada: boolean;
  planilha_aba: string | null;
  planilha_status: string | null;
  divergencia: boolean;
  divergencia_motivo: string | null;
};

const ROTULO_TIPO: Record<LinhaEmail["tipo_confirmacao"], string> = {
  contratacao_confirmada: "Contratação confirmada",
  apolice_emitida: "Apólice emitida",
  cancelamento_confirmado: "Cancelamento confirmado",
  outro: "Outro (relacionado)",
  nao_identificado: "Não identificado",
};

export default async function EmailsIncendioPage({
  searchParams,
}: {
  searchParams: Promise<{ divergencias?: string }>;
}) {
  const parametros = await searchParams;
  const somenteDivergencias = parametros.divergencias === "1";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  let consulta = supabase
    .from("incendio_emails_confirmacao")
    .select(
      "id, recebido_em, remetente, assunto, tipo_confirmacao, seguradora, cliente_nome, ramo, numero_apolice, planilha_encontrada, planilha_aba, planilha_status, divergencia, divergencia_motivo"
    )
    .order("recebido_em", { ascending: false })
    .limit(300);
  if (somenteDivergencias) consulta = consulta.eq("divergencia", true);

  const { data, error } = await consulta;
  const emails = (data ?? []) as LinhaEmail[];

  const { count: totalGeral } = await supabase.from("incendio_emails_confirmacao").select("id", { count: "exact", head: true });
  const { count: totalDivergencias } = await supabase
    .from("incendio_emails_confirmacao")
    .select("id", { count: "exact", head: true })
    .eq("divergencia", true);

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className={styles.wrap}>
        <div className={styles.topo}>
          <div>
            <div className={styles.eyebrow}>O2 Seguros · Uso interno · incendio@o2seguros.com.br</div>
            <h1>Verificação por E-mail</h1>
            <p>Confirmações de contratação, apólice emitida e cancelamento, cruzadas com a planilha de cotação diária do mês.</p>
          </div>
          <div className={styles.controles}>
            <Link href="/ramos-elementares">← Voltar pro painel de Ramos Elementares</Link>
          </div>
        </div>

        <div className={styles.kpis}>
          <div className={styles.kpi}>
            <div className={styles.kpiLabel}>E-mails processados</div>
            <div className={styles.kpiValue}>{totalGeral ?? 0}</div>
            <div className={styles.kpiNote}>desde que o monitoramento começou</div>
          </div>
          <div className={styles.kpi}>
            <div className={`${styles.kpiValue} ${totalDivergencias ? styles.danger : styles.ok}`}>{totalDivergencias ?? 0}</div>
            <div className={styles.kpiLabel}>Divergências em aberto</div>
            <div className={styles.kpiNote}>não encontradas na planilha, ou status não bate</div>
          </div>
        </div>

        <div className={styles.filtros}>
          <Link href="/ramos-elementares/emails" className={!somenteDivergencias ? styles.filtroAtivo : styles.filtro}>
            Todos
          </Link>
          <Link href="/ramos-elementares/emails?divergencias=1" className={somenteDivergencias ? styles.filtroAtivo : styles.filtro}>
            Só divergências
          </Link>
        </div>

        {error && <div className={styles.erroFonte}>Falha ao carregar: {error.message}</div>}

        {!error && emails.length === 0 && (
          <div className={styles.zeroState}>
            {somenteDivergencias ? "Nenhuma divergência em aberto — tudo confere." : "Nenhum e-mail processado ainda."}
          </div>
        )}

        {emails.length > 0 && (
          <div className={styles.panel}>
            <div className={styles.listaDados}>
              {emails.map((email) => (
                <div key={email.id} className={styles.listaLinha} style={{ gridTemplateColumns: "1fr" }}>
                  <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }}>
                    <strong>{email.cliente_nome ?? "(cliente não identificado)"}</strong>
                    <span className={email.divergencia ? styles.danger : styles.ok}>
                      {email.divergencia ? "⚠ Divergência" : "✓ Conferido"}
                    </span>
                  </div>
                  <div style={{ fontSize: "0.85em", color: "var(--muted, #666)" }}>
                    {new Date(email.recebido_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · {ROTULO_TIPO[email.tipo_confirmacao]}
                    {email.seguradora ? ` · ${email.seguradora}` : ""}
                    {email.ramo ? ` · ${email.ramo}` : ""}
                    {email.numero_apolice ? ` · Apólice ${email.numero_apolice}` : ""}
                  </div>
                  <div style={{ fontSize: "0.85em" }}>
                    <em>{email.assunto}</em>
                  </div>
                  <div style={{ fontSize: "0.85em" }}>
                    {email.planilha_encontrada ? (
                      <>
                        Encontrado na planilha (aba {email.planilha_aba}) — status: <strong>{email.planilha_status ?? "—"}</strong>
                      </>
                    ) : (
                      "Não encontrado na planilha do mês."
                    )}
                  </div>
                  {email.divergencia && email.divergencia_motivo && (
                    <div className={styles.danger} style={{ fontSize: "0.85em" }}>
                      {email.divergencia_motivo}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </>
  );
}
