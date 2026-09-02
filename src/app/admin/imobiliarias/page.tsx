import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { signOut } from "../../actions";
import AppHeader from "@/components/AppHeader";
import BackLink from "@/components/BackLink";
import { apenasDigitos } from "@/lib/pdfComSenha";
import { type ImobiliariaAdminRow } from "./ImobiliariaCard";
import MesclarDuplicidade, { type ImobiliariaDuplicadaLinha } from "./MesclarDuplicidade";
import ListaImobiliarias from "./ListaImobiliarias";

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
          "id, nome, cnpj, creci, telefone, email, endereco, indice_reajuste, plataforma_assinatura, created_at, cadastro_incompleto, user_id"
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

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-4xl flex-1 space-y-6 p-8">
        <div className="space-y-2">
          <BackLink />
          <div>
            <h1 className="text-xl font-semibold text-o2-navy">Imobiliárias cadastradas</h1>
            <p className="text-sm text-gray-500">
              {imobiliarias.length} conta(s) cadastrada(s)
              {duplicidades.length > 0 && ` · ${duplicidades.length} CNPJ(s) com cadastro duplicado`}
            </p>
          </div>
        </div>

        {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
        {sucesso && <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-700">{sucesso}</p>}

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
