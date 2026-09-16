import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { signOut } from "../../actions";
import AppHeader from "@/components/AppHeader";
import BackLink from "@/components/BackLink";
import SubmitButton from "@/components/SubmitButton";
import { apenasDigitos } from "@/lib/pdfComSenha";
import { type ImobiliariaAdminRow } from "./ImobiliariaCard";
import MesclarDuplicidade, { type ImobiliariaDuplicadaLinha } from "./MesclarDuplicidade";
import ListaImobiliarias from "./ListaImobiliarias";
import { autorizarImobiliaria } from "./actions";

export const dynamic = "force-dynamic";

function contarPorImobiliaria(linhas: { imobiliaria_id: string }[] | null): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const l of linhas ?? []) {
    mapa.set(l.imobiliaria_id, (mapa.get(l.imobiliaria_id) ?? 0) + 1);
  }
  return mapa;
}

export default async function AdminImobiliariasPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; sucesso?: string }>;
}) {
  const { erro, sucesso } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email)) redirect("/");

  const [{ data: imobiliariasData }, { data: contratosData }, { data: auditoriasData }, { data: faturasData }, { data: membrosData }] =
    await Promise.all([
      supabase
        .from("imobiliarias")
        .select(
          "id, nome, cnpj, creci, telefone, email, endereco, responsavel, indice_reajuste, plataforma_assinatura, created_at, cadastro_incompleto, user_id, autorizado, autorizado_em"
        )
        .order("created_at", { ascending: false }),
      supabase.from("contratos").select("imobiliaria_id"),
      supabase.from("auditorias_contrato").select("imobiliaria_id"),
      supabase.from("faturas_esperadas").select("imobiliaria_id"),
      supabase.from("imobiliaria_membros").select("imobiliaria_id"),
    ]);

  const contratosPorId = contarPorImobiliaria(contratosData);
  const auditoriasPorId = contarPorImobiliaria(auditoriasData);
  const faturasPorId = contarPorImobiliaria(faturasData);
  const membrosPorId = contarPorImobiliaria(membrosData);

  const imobiliarias: ImobiliariaAdminRow[] = (imobiliariasData ?? []).map((i) => ({
    ...i,
    contratos: contratosPorId.get(i.id) ?? 0,
    auditorias: auditoriasPorId.get(i.id) ?? 0,
    faturasEsperadas: faturasPorId.get(i.id) ?? 0,
    membros: membrosPorId.get(i.id) ?? 0,
  }));

  // Duplicidade = mesmo CNPJ (normalizado, só dígitos) em mais de um
  // registro -- ignora quem não tem CNPJ de verdade ainda (vazio ou o
  // placeholder "A definir" usado por quem cadastra sem CNPJ).
  const porCnpj = new Map<string, ImobiliariaAdminRow[]>();
  for (const i of imobiliarias) {
    const digitos = apenasDigitos(i.cnpj ?? "");
    if (digitos.length !== 14) continue;
    const lista = porCnpj.get(digitos) ?? [];
    lista.push(i);
    porCnpj.set(digitos, lista);
  }
  const duplicidades = [...porCnpj.entries()]
    .filter(([, linhas]) => linhas.length > 1)
    .sort((a, b) => b[1].length - a[1].length);

  // Autorização comercial (pedido do Matheus, 16/09/2026) -- quem criou
  // login (user_id preenchido) mas ainda não foi autorizado, ordenado do
  // mais antigo pro mais recente (quem está esperando há mais tempo primeiro).
  // Ver src/lib/autorizacaoImobiliaria.ts pro período de graça de 3 dias.
  const pendentesAutorizacao = imobiliarias
    .filter((i) => i.user_id && !i.autorizado)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-4xl flex-1 space-y-6 p-8">
        <div className="space-y-2">
          <BackLink />
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold text-o2-navy">Imobiliárias cadastradas</h1>
              <p className="text-sm text-gray-500">
                {imobiliarias.length} conta(s) cadastrada(s)
                {duplicidades.length > 0 && ` · ${duplicidades.length} CNPJ(s) com cadastro duplicado`}
              </p>
            </div>
            <Link
              href="/admin/imobiliarias/novo"
              className="whitespace-nowrap rounded-full bg-o2-coral px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
            >
              + Nova imobiliária
            </Link>
          </div>
        </div>

        {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
        {sucesso && <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-700">{sucesso}</p>}

        {pendentesAutorizacao.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">
              Pendentes de autorização ({pendentesAutorizacao.length})
            </h2>
            <p className="text-xs text-gray-500">
              Login criado, usando o Workspace no período de graça de 3 dias — autorize pra liberar acesso ilimitado às
              ferramentas de IA (Gerar Contrato, Auditor de Contrato), ou deixe como está até negociar.
            </p>
            <div className="space-y-2">
              {pendentesAutorizacao.map((i) => {
                const jaConhecida = i.contratos + i.auditorias + i.faturasEsperadas > 0;
                return (
                  <div key={i.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-yellow-300 bg-yellow-50 p-4">
                    <div className="min-w-0">
                      <Link href={`/admin/imobiliarias/${i.id}`} className="font-medium text-o2-navy hover:underline">
                        {i.nome}
                      </Link>
                      {jaConhecida && (
                        <span className="ml-2 rounded-full bg-o2-navy/10 px-2 py-0.5 text-xs text-o2-navy">
                          já tinha cadastro/movimento no sistema
                        </span>
                      )}
                      <p className="text-xs text-gray-600">
                        {i.cnpj && <>CNPJ/CPF {i.cnpj} · </>}
                        {i.email && <>{i.email} · </>}
                        {i.responsavel && <>responsável: {i.responsavel} · </>}
                        {i.endereco || "endereço não informado"}
                      </p>
                      <p className="text-xs text-gray-500">
                        Cadastro criado em {new Date(i.created_at).toLocaleDateString("pt-BR")}
                      </p>
                    </div>
                    <form action={autorizarImobiliaria}>
                      <input type="hidden" name="id" value={i.id} />
                      <SubmitButton
                        textoCarregando="Autorizando…"
                        className="whitespace-nowrap rounded-full bg-o2-coral px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
                      >
                        Autorizar
                      </SubmitButton>
                    </form>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {duplicidades.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Duplicidades encontradas</h2>
            {duplicidades.map(([cnpj, linhas]) => (
              <MesclarDuplicidade
                key={cnpj}
                cnpj={cnpj}
                linhas={linhas.map(
                  (l): ImobiliariaDuplicadaLinha => ({
                    id: l.id,
                    nome: l.nome,
                    email: l.email,
                    created_at: l.created_at,
                    contratos: l.contratos,
                    auditorias: l.auditorias,
                    faturasEsperadas: l.faturasEsperadas,
                    membros: l.membros,
                  })
                )}
              />
            ))}
          </section>
        )}

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Todos os cadastros</h2>
          <ListaImobiliarias imobiliarias={imobiliarias} />
        </section>
      </main>
    </>
  );
}
