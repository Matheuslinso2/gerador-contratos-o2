import { redirect } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../actions";
import { competenciaAtual, competenciaValida, montarPainelCapitalizacao, type PainelCapitalizacao as PainelCapitalizacaoData } from "@/lib/capitalizacao/painel";
import PainelCapitalizacao from "./PainelCapitalizacao";
import SeletorCompetencia from "./SeletorCompetencia";
import styles from "./painel-capitalizacao.module.css";
import { BotaoExportarPainelPdf } from "@/components/ExportarQuadro";

export const dynamic = "force-dynamic";
// Analisar todos os títulos ao vivo pode demorar -- corta antes do limite da
// Vercel (60s) pra ainda dar tempo de cair no retrato salvo e responder, em
// vez de deixar a Vercel matar a função sem nenhum catch rodar.
export const maxDuration = 60;
const LIMITE_TEMPO_AO_VIVO_MS = 40_000;

function comLimiteDeTempo<T>(promessa: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const limite = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Tempo esgotado após ${Math.round(ms / 1000)}s buscando no Bitrix`)), ms);
  });
  return Promise.race([promessa, limite]).finally(() => clearTimeout(timer)) as Promise<T>;
}

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
  const competenciaHoje = competenciaAtual();
  const competencia = competenciaValida(parametros.competencia) ? parametros.competencia : competenciaHoje;
  const ehCompetenciaAtual = competencia === competenciaHoje;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  let dados: PainelCapitalizacaoData | null = null;
  let erro: string | null = null;
  let usandoRetratoSalvo = false;

  // Congelamento/herança (mesmo padrão do Seguro Fiança): competência
  // ATUAL busca ao vivo e salva um retrato pra virar fallback; competência
  // PASSADA só lê o retrato já congelado (por um cron, dia 1º de cada mês --
  // ver src/app/api/cron/congelar-paineis/route.ts), sem bater no Bitrix.
  if (ehCompetenciaAtual) {
    try {
      dados = await comLimiteDeTempo(montarPainelCapitalizacao(competencia), LIMITE_TEMPO_AO_VIVO_MS);
      const { error: erroUpsert } = await supabase
        .from("capitalizacao_snapshots")
        .upsert({ competencia, atualizado_em: dados.atualizadoEm, payload: dados }, { onConflict: "competencia" });
      if (erroUpsert) console.error("Falha ao salvar snapshot de Capitalização no Supabase:", erroUpsert);
    } catch (e) {
      erro = e instanceof Error ? e.message : "Falha ao ler os dados de Capitalização no Bitrix.";
      const { data } = await supabase
        .from("capitalizacao_snapshots")
        .select("payload")
        .eq("competencia", competencia)
        .maybeSingle();
      if (data) {
        dados = data.payload as PainelCapitalizacaoData;
        usandoRetratoSalvo = true;
      }
    }
  } else {
    const { data } = await supabase.from("capitalizacao_snapshots").select("payload").eq("competencia", competencia).maybeSingle();
    if (data) dados = data.payload as PainelCapitalizacaoData;
  }

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <div className={styles.wrap}>
        <div id="painel-capitalizacao-completo" className={styles.container}>
          <div className={styles.masthead}>
            <div>
              <div className={styles.eyebrow}>O2 Seguros · Central de Negócios · SPA Título de Capitalização</div>
              <h1 className={styles.title}>Painel Capitalização — {rotuloCompetencia(competencia)}</h1>
            </div>
            <div className={styles.meta}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end", marginBottom: 6 }}>
                <SeletorCompetencia competencia={competencia} />
                {dados && (
                  <BotaoExportarPainelPdf painelId="painel-capitalizacao-completo" nomeArquivo={`capitalizacao-painel-${competencia}`} />
                )}
              </div>
              {dados && <>Atualizado em {new Date(dados.atualizadoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</>}
            </div>
          </div>

          {erro && (
            <div className={`${styles.stampPanel} ${styles.stampPanelWarning}`} style={{ marginBottom: 24 }}>
              <div className={`${styles.stampBadge} ${styles.stampBadgeWarning}`}>ERRO</div>
              <div className={styles.stampList}>
                <div>
                  Não consegui buscar os dados do Bitrix agora: {erro}
                  {usandoRetratoSalvo && " — mostrando o último retrato salvo abaixo."}
                </div>
              </div>
            </div>
          )}

          {!dados && !erro && (
            <div className={styles.panelSub}>
              Nenhum retrato salvo pra esse mês ainda — a página nunca foi aberta durante essa competência.
            </div>
          )}

          {dados && <PainelCapitalizacao dados={dados} />}
        </div>
      </div>
    </>
  );
}
