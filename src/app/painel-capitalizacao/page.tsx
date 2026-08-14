import { redirect } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../actions";
import { competenciaAtual, competenciaValida, montarPainelCapitalizacao } from "@/lib/capitalizacao/painel";
import PainelCapitalizacao from "./PainelCapitalizacao";
import SeletorCompetencia from "./SeletorCompetencia";
import styles from "./painel-capitalizacao.module.css";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function rotuloCompetencia(competencia: string): string {
  const [ano, mes] = competencia.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, 1));
  const rotulo = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(data);
  return rotulo.charAt(0).toUpperCase() + rotulo.slice(1);
}

export default async function PainelCapitalizacaoPage({
  searchParams,
}: {
  searchParams: Promise<{ competencia?: string }>;
}) {
  const parametros = await searchParams;
  const competencia = competenciaValida(parametros.competencia) ? parametros.competencia : competenciaAtual();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  let erro: string | null = null;
  let dados: Awaited<ReturnType<typeof montarPainelCapitalizacao>> | null = null;
  try {
    dados = await montarPainelCapitalizacao(competencia);
  } catch (e) {
    erro = e instanceof Error ? e.message : "Falha ao ler os dados de Capitalização no Bitrix.";
  }

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <div className={styles.wrap}>
        <div className={styles.container}>
          <div className={styles.masthead}>
            <div>
              <div className={styles.eyebrow}>O2 Seguros · Central de Negócios · SPA Título de Capitalização</div>
              <h1 className={styles.title}>Painel Capitalização — {rotuloCompetencia(competencia)}</h1>
            </div>
            <div className={styles.meta}>
              <SeletorCompetencia competencia={competencia} />
              <br />
              {dados && <>Atualizado em {new Date(dados.atualizadoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</>}
            </div>
          </div>

          {erro && (
            <div className={`${styles.stampPanel} ${styles.stampPanelWarning}`} style={{ marginBottom: 24 }}>
              <div className={`${styles.stampBadge} ${styles.stampBadgeWarning}`}>ERRO</div>
              <div className={styles.stampList}>
                <div>Não consegui buscar os dados do Bitrix agora: {erro}</div>
              </div>
            </div>
          )}

          {dados && <PainelCapitalizacao dados={dados} />}
        </div>
      </div>
    </>
  );
}
