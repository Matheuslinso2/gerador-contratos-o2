import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../../../../actions";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import SubmitButton from "@/components/SubmitButton";
import { IconMail } from "@/components/icons";
import { FiltroProducao } from "@/app/campanhas/[id]/FiltroProducao";
import {
  statusDoEnvio,
  normalizarBusca,
  ROTULO_STATUS_ENVIO,
  COR_STATUS_ENVIO,
  type ChaveStatusEnvio,
  type DetalheEmail,
} from "@/lib/campanhas/producaoStatus";
import { enviarParaQuemFaltou } from "./actions";

export const dynamic = "force-dynamic";
// enviarParaQuemFaltou manda um e-mail por pessoa e roda sob o limite desta página.
export const maxDuration = 60;

function formatarDataHora(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

// Pedido do Matheus, 07/10/2026: aviso interno também controla quem abriu e
// quem não abriu -- não faz sentido deixar a equipe da O2 de fora do
// controle que as campanhas já têm.
export default async function AvisoEnviadoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; erro?: string }>;
}) {
  const { id } = await params;
  const { ok, erro } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const [{ data: aviso }, { data: enviosData }] = await Promise.all([
    supabase.from("avisos_internos_historico").select("id, assunto, titulo, html, created_at, criado_por_email").eq("id", id).single(),
    supabase
      .from("avisos_internos_envios")
      .select("email, status, enviado_em, aberto_em, clicado_em, erro_detalhe")
      .eq("aviso_id", id)
      .order("email", { ascending: true }),
  ]);
  if (!aviso) redirect("/campanhas/avisos-internos");

  const linhas = (enviosData ?? []).map((e) => {
    const detalhe: DetalheEmail = {
      email: e.email,
      chave: statusDoEnvio(e),
      enviadoEm: e.enviado_em,
      abertoEm: e.aberto_em,
      clicadoEm: e.clicado_em,
      erro: e.erro_detalhe,
    };
    return detalhe;
  });

  const total = linhas.length;
  const enviados = linhas.filter((l) => l.chave === "abriu" || l.chave === "nao_abriu").length;
  const abriram = linhas.filter((l) => l.chave === "abriu").length;
  const naoAbriram = linhas.filter((l) => l.chave === "nao_abriu").length;
  const faltam = linhas.filter((l) => l.chave === "na_fila" || l.chave === "falhou").length;
  const taxaAbertura = enviados ? (abriram / enviados) * 100 : 0;

  const opcoesStatus = (Object.keys(ROTULO_STATUS_ENVIO) as ChaveStatusEnvio[])
    .map((chave) => ({ valor: chave, rotulo: ROTULO_STATUS_ENVIO[chave], total: linhas.filter((l) => l.chave === chave).length }))
    .filter((o) => o.total > 0);

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-4xl flex-1 space-y-6 p-8">
        <Link href="/campanhas/avisos-internos" className="text-sm font-medium text-o2-navy hover:underline">
          ← Voltar pros avisos internos
        </Link>

        <PageHeader
          icon={<IconMail />}
          titulo={aviso.titulo}
          subtitulo={`Assunto: ${aviso.assunto} · enviado em ${formatarDataHora(aviso.created_at)}${aviso.criado_por_email ? ` por ${aviso.criado_por_email}` : ""}`}
        />

        {ok && <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-700">{ok}</p>}
        {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

        <div className="grid grid-cols-2 gap-1 overflow-hidden rounded-xl border border-o2-navy/10 bg-gray-200 shadow-sm sm:grid-cols-5">
          <div className="bg-quadro p-4 text-center">
            <p className="text-2xl font-bold text-o2-navy">{total}</p>
            <p className="text-xs text-gray-500">Destinatários</p>
          </div>
          <div className="bg-quadro p-4 text-center">
            <p className="text-2xl font-bold text-green-700">{abriram}</p>
            <p className="text-xs text-gray-500">Abriram</p>
          </div>
          <div className="bg-quadro p-4 text-center">
            <p className="text-2xl font-bold text-orange-600">{naoAbriram}</p>
            <p className="text-xs text-gray-500">Não abriram</p>
          </div>
          <div className="bg-quadro p-4 text-center">
            <p className="text-2xl font-bold text-o2-coral">{taxaAbertura.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</p>
            <p className="text-xs text-gray-500">Taxa de abertura</p>
          </div>
          <div className="bg-quadro p-4 text-center">
            <p className="text-2xl font-bold text-gray-600">{faltam}</p>
            <p className="text-xs text-gray-500">Sem receber</p>
          </div>
        </div>

        {faltam > 0 && (
          <form action={enviarParaQuemFaltou} className="flex flex-wrap items-center gap-3 rounded-xl border border-yellow-300 bg-yellow-50 p-3">
            <input type="hidden" name="aviso_id" value={aviso.id} />
            <p className="flex-1 text-sm text-yellow-800">{faltam} pessoa(s) ainda não receberam este aviso (envio falhou ou não deu tempo).</p>
            <SubmitButton
              className="rounded-full bg-o2-coral px-5 py-2 text-sm font-medium text-white transition hover:opacity-90"
              textoCarregando="Enviando..."
            >
              Enviar para quem faltou
            </SubmitButton>
          </form>
        )}

        <p className="text-xs text-gray-500">
          Abertura é medida por uma imagem do e-mail — quem bloqueia imagens pode ter lido e aparecer como &quot;Não abriu&quot;.
        </p>

        <FiltroProducao
          quadroId="quadro-aviso-envios"
          linhas={linhas.map((l) => ({ nomeNormalizado: normalizarBusca(l.email), status: l.chave }))}
          opcoesStatus={opcoesStatus}
          rotuloBusca="Buscar pessoa"
          placeholderBusca="E-mail ou nome..."
          textoVazio="Ninguém encontrado com esse filtro."
        />

        <div id="quadro-aviso-envios" className="overflow-x-auto rounded-2xl border border-o2-navy/10 bg-white shadow-sm">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-o2-navy/10 bg-quadro text-xs uppercase tracking-wide text-o2-navy">
                <th className="p-3 text-left">Pessoa</th>
                <th className="p-3 text-left">Status</th>
                <th className="p-3 text-left">Enviado em</th>
                <th className="p-3 text-left">Abriu em</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {linhas.map((l) => (
                <tr key={l.email} data-filtro-nome={normalizarBusca(l.email)} data-filtro-status={l.chave}>
                  <td className="p-3 align-top">
                    <span className="block break-all font-semibold text-o2-navy">{l.email}</span>
                    {l.erro && <span className="block text-[11px] text-red-500">Erro: {l.erro}</span>}
                  </td>
                  <td className="p-3 align-top">
                    <div className="flex flex-wrap items-center gap-1">
                      <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${COR_STATUS_ENVIO[l.chave]}`}>
                        {ROTULO_STATUS_ENVIO[l.chave]}
                      </span>
                      {l.clicadoEm && (
                        <span className="whitespace-nowrap rounded-full bg-o2-navy/10 px-2 py-0.5 text-xs font-medium text-o2-navy">Clicou</span>
                      )}
                    </div>
                  </td>
                  <td className="p-3 align-top text-xs text-gray-500">{l.enviadoEm ? formatarDataHora(l.enviadoEm) : "—"}</td>
                  <td className="p-3 align-top text-xs text-gray-500">{l.abertoEm ? formatarDataHora(l.abertoEm) : "—"}</td>
                </tr>
              ))}
              {!linhas.length && (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-sm text-gray-500">
                    Nenhum destinatário registrado neste aviso.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <details className="rounded-xl border border-o2-navy/10 bg-quadro p-3">
          <summary className="cursor-pointer select-none text-sm font-semibold text-o2-navy">Ver o e-mail enviado</summary>
          <div className="mt-3 max-h-[560px] overflow-y-auto rounded-lg border border-o2-navy/10 bg-white" dangerouslySetInnerHTML={{ __html: aviso.html }} />
        </details>
      </main>
    </>
  );
}
