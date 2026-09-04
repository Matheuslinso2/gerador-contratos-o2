import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { signOut } from "../../../actions";
import AppHeader from "@/components/AppHeader";
import VinculosFaturas, { type Vinculo } from "../../../faturas/VinculosFaturas";
import { atualizarImobiliariaAdmin, adicionarMembroImobiliariaAdmin, removerMembroImobiliariaAdmin } from "../actions";

export const dynamic = "force-dynamic";

const inputClass = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-o2-coral focus:outline-none";
const labelClass = "text-xs text-gray-500";

export default async function AdminImobiliariaDetalhePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erro?: string; sucesso?: string }>;
}) {
  const { id } = await params;
  const { erro, sucesso } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email)) redirect("/");

  const [{ data: imobiliaria }, { data: vinculosData }, { data: membros }, { count: contratos }, { count: auditorias }] =
    await Promise.all([
      supabase.from("imobiliarias").select("*").eq("id", id).maybeSingle(),
      supabase.from("faturas_esperadas").select("seguradora, ativo, dia_vencimento, cnpj_o2, observacao").eq("imobiliaria_id", id),
      supabase.from("imobiliaria_membros").select("id, email, criado_em").eq("imobiliaria_id", id).order("criado_em"),
      supabase.from("contratos").select("id", { count: "exact", head: true }).eq("imobiliaria_id", id),
      supabase.from("auditorias_contrato").select("id", { count: "exact", head: true }).eq("imobiliaria_id", id),
    ]);
  if (!imobiliaria) redirect("/admin/imobiliarias");

  const voltarPara = `/admin/imobiliarias/${id}`;

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-3xl flex-1 space-y-8 p-8">
        <div className="space-y-2">
          <Link href="/admin/imobiliarias" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-o2-navy hover:underline">
            ← Todas as imobiliárias
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-o2-navy">{imobiliaria.nome}</h1>
            <p className="text-sm text-gray-500">
              CNPJ {imobiliaria.cnpj || "não informado"} · login {imobiliaria.email || "sem login próprio"} ·{" "}
              {contratos ?? 0} contrato(s) · {auditorias ?? 0} auditoria(s)
            </p>
          </div>
        </div>

        {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
        {sucesso && <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-700">{sucesso}</p>}

        {imobiliaria.cadastro_incompleto && (
          <p className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">
            ⚠️ Registro criado automaticamente pelo Faturas — ainda não tem contrato-base/índice de reajuste
            configurados por completo.
          </p>
        )}

        <form action={atualizarImobiliariaAdmin} className="space-y-6">
          <input type="hidden" name="id" value={imobiliaria.id} />
          <input type="hidden" name="voltar_para" value={voltarPara} />

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Dados da imobiliária</h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Nome *</label>
                <input name="nome" required defaultValue={imobiliaria.nome} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>CNPJ</label>
                <input name="cnpj" defaultValue={imobiliaria.cnpj ?? ""} className={inputClass} />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <label className={labelClass}>CRECI</label>
                <input name="creci" defaultValue={imobiliaria.creci ?? ""} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Telefone</label>
                <input name="telefone" defaultValue={imobiliaria.telefone ?? ""} className={inputClass} />
              </div>
            </div>
            <div>
              <label className={labelClass}>Endereço</label>
              <input name="endereco" defaultValue={imobiliaria.endereco ?? ""} className={inputClass} />
            </div>
          </section>

          <section className="space-y-3 border-t border-gray-200 pt-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">
              Contrato-base <span className="font-normal normal-case text-gray-400">— usado em Gerar Contrato</span>
            </h2>
            <textarea
              name="texto_base_contrato"
              rows={6}
              defaultValue={imobiliaria.texto_base_contrato ?? ""}
              className={inputClass}
            />
            <div>
              <label className={labelClass}>Cláusula de Fiador</label>
              <textarea name="clausula_fiador" rows={3} defaultValue={imobiliaria.clausula_fiador ?? ""} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Cláusula de Caução</label>
              <textarea name="clausula_caucao" rows={3} defaultValue={imobiliaria.clausula_caucao ?? ""} className={inputClass} />
            </div>
          </section>

          <section className="space-y-3 border-t border-gray-200 pt-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">
              Financeiro e assinatura <span className="font-normal normal-case text-gray-400">— usado em Gerar Contrato</span>
            </h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Índice de reajuste</label>
                <select name="indice_reajuste" defaultValue={imobiliaria.indice_reajuste ?? ""} className={inputClass}>
                  <option value="">Selecione...</option>
                  <option value="IGPM">IGPM</option>
                  <option value="IPCA">IPCA</option>
                  <option value="IGP-DI">IGP-DI</option>
                  <option value="O maior entre IGPM e IPCA">O maior entre IGPM e IPCA</option>
                  <option value="Outro">Outro (ajustar depois)</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Plataforma de assinatura</label>
                <select name="plataforma_assinatura" defaultValue={imobiliaria.plataforma_assinatura ?? ""} className={inputClass}>
                  <option value="">Selecione...</option>
                  <option value="Clicksign">Clicksign</option>
                  <option value="D4Sign">D4Sign</option>
                  <option value="IntelliSign">IntelliSign</option>
                  <option value="Outro">Outra</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div>
                <label className={labelClass}>% multa por atraso</label>
                <input
                  name="percentual_multa_atraso"
                  type="number"
                  step="0.01"
                  defaultValue={imobiliaria.percentual_multa_atraso ?? ""}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>% juros de mora (ao mês)</label>
                <input
                  name="percentual_juros_mora"
                  type="number"
                  step="0.01"
                  defaultValue={imobiliaria.percentual_juros_mora ?? ""}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>% honorários advocatícios</label>
                <input
                  name="percentual_honorarios_advocaticios"
                  type="number"
                  step="0.01"
                  defaultValue={imobiliaria.percentual_honorarios_advocaticios ?? ""}
                  className={inputClass}
                />
              </div>
            </div>
          </section>

          <section className="space-y-2 rounded-xl border border-yellow-300 bg-yellow-50 p-4">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-yellow-900">
              🔒 Observação interna
              <span className="font-normal normal-case text-yellow-700">— só a equipe O2 vê isso</span>
            </h2>
            <p className="text-xs text-yellow-800">
              Nunca é enviada por e-mail nem aparece pra imobiliária, mesmo se ela tiver login próprio ou funcionário
              com acesso.
            </p>
            <textarea
              name="observacao_interna"
              rows={3}
              defaultValue={imobiliaria.observacao_interna ?? ""}
              placeholder="Ex: histórico de atraso, ponto de atenção, combinado verbal..."
              className="w-full rounded-lg border border-yellow-300 bg-white px-3 py-2 text-sm focus:border-o2-coral focus:outline-none"
            />
          </section>

          <button type="submit" className="rounded-full bg-o2-coral px-6 py-2.5 font-medium text-white transition hover:opacity-90">
            Salvar
          </button>
        </form>

        <section className="space-y-3 border-t border-gray-200 pt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">
            Faturas <span className="font-normal normal-case text-gray-400">— e-mail de envio e vínculos por seguradora</span>
          </h2>
          <VinculosFaturas
            imobiliariaId={imobiliaria.id}
            emailsFaturas={imobiliaria.email_faturas ?? []}
            vinculos={(vinculosData ?? []) as Vinculo[]}
            voltarPara={voltarPara}
          />
        </section>

        <section className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Funcionários com acesso</h2>
          <p className="text-xs text-gray-500">
            Quem estiver aqui vê e edita tudo por essa imobiliária (mesmo acesso do titular), assim que criar conta
            (ou já tiver uma) com esse e-mail exato.
          </p>
          <ul className="space-y-1">
            {(membros ?? []).length === 0 && <li className="text-sm text-gray-400">Nenhum funcionário adicionado.</li>}
            {(membros ?? []).map((m) => (
              <li key={m.id} className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
                <span className="text-o2-navy">{m.email}</span>
                <form action={removerMembroImobiliariaAdmin}>
                  <input type="hidden" name="imobiliaria_id" value={imobiliaria.id} />
                  <input type="hidden" name="membro_id" value={m.id} />
                  <button type="submit" className="text-xs font-medium text-red-600 hover:underline">
                    Remover
                  </button>
                </form>
              </li>
            ))}
          </ul>
          <form action={adicionarMembroImobiliariaAdmin} className="flex gap-2">
            <input type="hidden" name="imobiliaria_id" value={imobiliaria.id} />
            <input
              type="email"
              name="email"
              required
              placeholder="email@exemplo.com"
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-o2-coral focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-lg border border-o2-coral px-4 py-2 text-sm font-medium text-o2-coral transition hover:bg-o2-coral hover:text-white"
            >
              Adicionar
            </button>
          </form>
        </section>

        <Link href="/admin/imobiliarias" className="block text-sm text-gray-500 hover:underline">
          ← Voltar pra lista
        </Link>
      </main>
    </>
  );
}
