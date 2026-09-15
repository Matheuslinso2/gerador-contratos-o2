import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../../actions";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import { IconMail } from "@/components/icons";
import { ROTULO_STATUS_CAMPANHA, COR_STATUS_CAMPANHA } from "@/lib/campanhas/rotulos";
import { CampanhaProgresso } from "./CampanhaProgresso";

export const dynamic = "force-dynamic";

export default async function CampanhaDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const { data: campanha } = await supabase.from("campanhas").select("*").eq("id", id).single();
  if (!campanha) redirect("/campanhas");
  if (campanha.status === "rascunho") redirect(`/campanhas/${id}/destinatarios`);

  const percentualEnviado = campanha.total_destinatarios
    ? Math.round(((campanha.total_enviados + campanha.total_falhas) / campanha.total_destinatarios) * 100)
    : 0;

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-3xl flex-1 space-y-6 p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <PageHeader icon={<IconMail />} titulo={campanha.nome} subtitulo={campanha.assunto} />
          <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${COR_STATUS_CAMPANHA[campanha.status] ?? "bg-gray-100 text-gray-600"}`}>
            {ROTULO_STATUS_CAMPANHA[campanha.status] ?? campanha.status}
          </span>
        </div>

        {campanha.valido_ate && (
          <p className="text-xs font-medium text-o2-coral">
            Oferta válida até {new Date(`${campanha.valido_ate}T00:00:00`).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
          </p>
        )}

        <CampanhaProgresso campanhaId={id} status={campanha.status} />

        <div className="grid grid-cols-3 gap-1 overflow-hidden rounded-xl border border-o2-navy/10 bg-gray-200 shadow-sm">
          <div className="bg-quadro p-4 text-center">
            <p className="text-2xl font-bold text-o2-navy">{campanha.total_destinatarios}</p>
            <p className="text-xs text-gray-500">Destinatários</p>
          </div>
          <div className="bg-quadro p-4 text-center">
            <p className="text-2xl font-bold text-green-700">{campanha.total_enviados}</p>
            <p className="text-xs text-gray-500">Enviados</p>
          </div>
          <div className="bg-quadro p-4 text-center">
            <p className="text-2xl font-bold text-red-600">{campanha.total_falhas}</p>
            <p className="text-xs text-gray-500">Falhas</p>
          </div>
        </div>

        {campanha.status === "enviando" && (
          <div className="h-2 overflow-hidden rounded-full bg-gray-200">
            <div className="h-full rounded-full bg-o2-coral transition-all" style={{ width: `${percentualEnviado}%` }} />
          </div>
        )}

        {campanha.disparada_em && (
          <p className="text-xs text-gray-500">
            Disparada em {new Date(campanha.disparada_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
            {campanha.concluida_em &&
              ` · Concluída em ${new Date(campanha.concluida_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`}
          </p>
        )}

        <Link href="/campanhas" className="text-sm font-medium text-o2-navy hover:underline">
          ← Voltar pra lista de campanhas
        </Link>
      </main>
    </>
  );
}
