import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import { IconShield } from "@/components/icons";
import { rotuloProduto } from "@/lib/sinistros/produtos";
import { signOut } from "../../../actions";
import { salvarDadosCaso } from "../../operacao";
import FormContrato from "../../FormContrato";
import FormOutros from "../../FormOutros";
import Abas from "../../Abas";
import { Aviso, inputClass, labelClass } from "../../ui";

export const dynamic = "force-dynamic";

// Equipe O2 corrige/completa os dados do caso em qualquer etapa (21/10/2026).
export default async function EditarSinistroPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erro?: string; ctx?: string }>;
}) {
  const { id } = await params;
  const { erro, ctx } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect(`/sinistros/${id}`);

  const [{ data: s }, { data: imobs }] = await Promise.all([
    supabase.from("sinistros").select("*").eq("id", id).maybeSingle(),
    supabase.from("imobiliarias").select("id, nome, apelido").order("nome"),
  ]);
  if (!s) notFound();
  const imobiliarias = (imobs ?? []).map((i) => ({ id: i.id, nome: i.apelido ? `${i.nome} (${i.apelido})` : i.nome }));
  const voltar = `/sinistros/${id}?aba=dados${ctx ? `&ctx=${encodeURIComponent(ctx)}` : ""}`;
  const ocultos = (
    <>
      {ctx && <input type="hidden" name="ctx" value={ctx} />}
    </>
  );
  const fianca = (s.produto ?? "fianca") === "fianca";

  return (
    <>
      <AppHeader userEmail={user.email} logoutAction={signOut} />
      <main className="mx-auto max-w-4xl flex-1 space-y-6 p-8">
        <Abas atual="ficha" interno />
        <Link href={voltar} className="text-sm text-o2-blue hover:underline">
          ← voltar à ficha
        </Link>
        <PageHeader icon={<IconShield />} titulo={`Editar SIN-${s.codigo}`} subtitulo={`${rotuloProduto(s.produto)} · dados do caso`} />
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {fianca ? (
          <FormContrato
            action={salvarDadosCaso}
            dados={s}
            imobiliarias={imobiliarias}
            textoBotao="Salvar dados"
            extras={
              <>
                {ocultos}
                <section className="grid gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4 sm:grid-cols-4">
                  <div>
                    <label className={labelClass}>Nº do sinistro na seguradora</label>
                    <input name="numero_sinistro_seguradora" defaultValue={s.numero_sinistro_seguradora ?? ""} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Valor avisado (R$)</label>
                    <input name="valor_avisado" inputMode="decimal" defaultValue={s.valor_avisado ?? ""} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>LMI da apólice (R$)</label>
                    <input name="lmi" inputMode="decimal" defaultValue={s.lmi ?? ""} className={inputClass} />
                  </div>
                </section>
              </>
            }
          />
        ) : (
          <FormOutros action={salvarDadosCaso} dados={s} imobiliarias={imobiliarias} equipe={[]} novo={false} extras={ocultos} />
        )}
      </main>
    </>
  );
}
