import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../actions";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import { IconChecklist } from "@/components/icons";
import BackLink from "@/components/BackLink";
import AuditorForm from "./AuditorForm";
import AuditorFormPublico from "./AuditorFormPublico";
import ListaAuditorias from "./ListaAuditorias";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { garantirImobiliariaColaborador } from "@/lib/imobiliariaColaborador";
import { buscarImobiliariaDoUsuario } from "@/lib/imobiliariaDoUsuario";
import { ipDoVisitante, contarAuditoriasPublicas } from "./actions";
import { LIMITE_AUDITORIAS_PUBLICAS_POR_IP } from "./limitePublico";
import AvisoAutorizacaoImobiliaria from "@/components/AvisoAutorizacaoImobiliaria";

export const dynamic = "force-dynamic";
// Analisar PDF escaneado/imagem (a IA lendo direto das páginas) já demora
// mais que texto puro -- com MAIS de um documento anexado (contrato +
// cotação + certificado, cada um podendo ser escaneado) o tempo soma e
// passava de 60s, estourando o limite e a Vercel matava a função no meio
// (sem nem deixar a mensagem de erro do try/catch em actions.ts aparecer --
// timeout de plataforma não passa por catch nenhum). Dá mais fôlego.
export const maxDuration = 180;

export default async function AuditarContratoPage({
  searchParams,
}: {
  searchParams: Promise<{ ultimo?: string; erro?: string }>;
}) {
  const { ultimo, erro } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Ferramenta pública (liberada em src/proxy.ts, ROTAS_PUBLICAS) -- pedido
  // do Matheus, 16/09/2026. Visitante sem login nunca chega na lógica de
  // imobiliária/histórico abaixo (que é exclusiva de conta real); usa
  // auditarPublico() (actions.ts), limitado por IP, sem nada salvo.
  if (!user) {
    const ip = await ipDoVisitante();
    const usadas = ip ? await contarAuditoriasPublicas(ip) : LIMITE_AUDITORIAS_PUBLICAS_POR_IP;
    const restantes = Math.max(0, LIMITE_AUDITORIAS_PUBLICAS_POR_IP - usadas);

    return (
      <>
        <div className="flex justify-center border-b border-gray-100 bg-white py-4">
          <Image src="/marca-o2/o2-logo-horizontal.png" alt="O2 Seguros" width={140} height={33} priority />
        </div>
        <main className="mx-auto max-w-3xl flex-1 space-y-6 p-8">
          <PageHeader
            icon={<IconChecklist />}
            titulo="Auditar contrato"
            subtitulo="Analisa um contrato já pronto (colado, .docx, .doc ou .pdf) e aponta erros e inconsistências — não gera um contrato novo."
          />

          <p className="rounded-lg border-2 border-o2-coral/40 bg-o2-coral/5 p-4 text-sm text-o2-navy">
            ⚠️ Ferramenta gratuita e sem cadastro — limitada a <strong>{LIMITE_AUDITORIAS_PUBLICAS_POR_IP} análises por
            endereço de acesso</strong>. O resultado aparece só nesta tela e <strong>não fica salvo em lugar nenhum</strong>;
            feche a página e ele se perde. Esta análise é um apoio automatizado por IA e{" "}
            <strong>não substitui a revisão de um profissional</strong> — em caso de dúvida, fale com a O2 Seguros.
          </p>

          {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

          <div className="rounded-xl border border-o2-navy/10 bg-quadro p-5 shadow-sm">
            {restantes > 0 ? (
              <AuditorFormPublico restantes={restantes} />
            ) : (
              <div className="space-y-3 text-sm text-o2-navy">
                <p className="font-medium">
                  Você já usou as {LIMITE_AUDITORIAS_PUBLICAS_POR_IP} análises gratuitas disponíveis para este
                  endereço.
                </p>
                <p>
                  Crie um login gratuito no Workspace da O2 Seguros — leva menos de um minuto e você já volta a usar o
                  Auditor de Contrato na hora, enquanto a gente analisa seu cadastro.
                </p>
                <Link
                  href="/signup"
                  className="inline-block rounded-full bg-o2-coral px-5 py-2 text-sm font-medium text-white transition hover:opacity-90"
                >
                  Criar login no Workspace
                </Link>
              </div>
            )}
          </div>
        </main>
      </>
    );
  }

  // Admin/colaborador O2 veem as auditorias de TODAS as imobiliárias aqui
  // (achado 17/09/2026 -- o Matheus só via até 25/08 porque a lista ficava
  // presa ao id da imobiliária-colaborador dele mesmo, sem o bypass que
  // /contratos já tinha). Mesmo padrão já usado em
  // src/app/contratos/page.tsx.
  const vePermitidosDeTodos = isAdmin(user?.email) || isColaboradorO2(user?.email);

  let imobiliaria = await buscarImobiliariaDoUsuario(supabase, user);

  if (!imobiliaria && vePermitidosDeTodos) {
    imobiliaria = await garantirImobiliariaColaborador(supabase, user!.id, user?.email);
  }

  if (!imobiliaria) {
    return (
      <>
        <AppHeader userEmail={user?.email} logoutAction={signOut} />
        <main className="mx-auto max-w-3xl flex-1 space-y-4 p-8">
          <BackLink />
          <PageHeader icon={<IconChecklist />} titulo="Auditar contrato" />
          <p className="rounded-lg border border-yellow-400 bg-yellow-50 p-3 text-sm text-yellow-800">
            Antes de auditar contratos, complete o cadastro da sua imobiliária em{" "}
            <Link href="/imobiliaria" className="underline">
              /imobiliaria
            </Link>
            .
          </p>
        </main>
      </>
    );
  }

  let consultaAuditorias = supabase
    .from("auditorias_contrato")
    .select(
      "id, nome_arquivo, status_geral, tipo_garantia_identificada, locador_identificado, locatario_identificado, endereco_identificado, relatorio, created_at, imobiliarias(nome)"
    )
    .order("created_at", { ascending: false });
  if (!vePermitidosDeTodos) consultaAuditorias = consultaAuditorias.eq("imobiliaria_id", imobiliaria.id);
  const { data: auditorias } = await consultaAuditorias;

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-3xl flex-1 space-y-8 p-8">
        <div className="space-y-2">
          <BackLink />
          <PageHeader
            icon={<IconChecklist />}
            titulo="Auditar contrato"
            subtitulo="Analisa um contrato já pronto (colado, .docx, .doc ou .pdf) e aponta erros e inconsistências — não gera um contrato novo."
          />
        </div>

        {erro && (
          <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>
        )}

        <div className="rounded-xl border border-o2-navy/10 bg-quadro p-5 shadow-sm">
          <AvisoAutorizacaoImobiliaria
            imobiliaria={{ autorizado: imobiliaria.autorizado, created_at: imobiliaria.created_at }}
            bypass={vePermitidosDeTodos}
          >
            <AuditorForm userId={user!.id} ultimoId={ultimo} />
          </AvisoAutorizacaoImobiliaria>
        </div>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-o2-navy">Auditorias realizadas</h2>
          <ListaAuditorias auditorias={auditorias ?? []} destaque={ultimo} mostrarImobiliaria={vePermitidosDeTodos} />
        </section>
      </main>
    </>
  );
}
