import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { buscarImobiliariaDoUsuario } from "@/lib/imobiliariaDoUsuario";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import { IconShield } from "@/components/icons";
import { PRODUTOS, rotuloProduto } from "@/lib/sinistros/produtos";
import { signOut } from "../../actions";
import { criarRascunho } from "../actions";
import { criarSinistroOutros } from "../operacao";
import FormContrato from "../FormContrato";
import FormOutros from "../FormOutros";
import Passos from "../Passos";
import { Aviso } from "../ui";
import Abas from "../Abas";

export const dynamic = "force-dynamic";

// Abrir sinistro. Equipe O2 escolhe o produto: Fiança segue o assistente de
// 5 passos (com checklist e débitos); os demais produtos usam um formulário
// único. A imobiliária abre Fiança (21/10/2026).
export default async function NovoSinistroPage({ searchParams }: { searchParams: Promise<{ erro?: string; produto?: string }> }) {
  const { erro, produto } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const interno = isAdmin(user.email) || isColaboradorO2(user.email);

  let imobiliarias: { id: string; nome: string }[] | undefined;
  let equipe: { chave: string; nome: string }[] = [];
  if (interno) {
    const [{ data }, { data: membros }] = await Promise.all([
      supabase.from("imobiliarias").select("id, nome, apelido").order("nome"),
      supabase.from("sinistros_equipe").select("chave, nome").eq("ativo", true).order("nome"),
    ]);
    imobiliarias = (data ?? []).map((i) => ({ id: i.id, nome: i.apelido ? `${i.nome} (${i.apelido})` : i.nome }));
    equipe = membros ?? [];
  } else {
    const imob = await buscarImobiliariaDoUsuario(supabase, user);
    if (!imob) redirect("/imobiliaria");
  }

  const escolhido = interno ? produto : "fianca";

  return (
    <>
      <AppHeader userEmail={user.email} logoutAction={signOut} />
      <main className="mx-auto max-w-4xl flex-1 space-y-6 p-8">
        <Abas atual="novo" interno={interno} />
        <PageHeader
          icon={<IconShield />}
          titulo="Abrir sinistro"
          subtitulo={
            !escolhido
              ? "Escolha o produto"
              : escolhido === "fianca"
                ? "Seguro Fiança · leva uns 10 minutos com os documentos em mãos"
                : `${rotuloProduto(escolhido)} · formulário único`
          }
        />
        {erro && <Aviso tipo="erro">{erro}</Aviso>}

        {!escolhido && (
          <div className="grid gap-3 sm:grid-cols-3">
            {PRODUTOS.filter((p) => !["outros"].includes(p.chave)).map((p) => (
              <Link
                key={p.chave}
                href={`/sinistros/novo?produto=${p.chave}`}
                className={`rounded-xl border bg-white p-4 hover:border-o2-coral hover:bg-orange-50 ${p.chave === "fianca" ? "border-o2-coral sm:col-span-3" : "border-gray-200"}`}
              >
                <span className="block font-semibold text-o2-navy">{p.rotulo}</span>
                <span className="text-xs text-gray-500">
                  {p.chave === "fianca" ? "Assistente em 5 etapas: identificação, coberturas, documentos, favorecido e resumo do aviso." : "Formulário único com os dados do caso."}
                </span>
              </Link>
            ))}
          </div>
        )}

        {escolhido === "fianca" && (
          <>
            {interno && (
              <Link href="/sinistros/novo" className="text-sm text-o2-blue hover:underline">
                ← trocar o produto
              </Link>
            )}
            <Passos atual={1} />
            <FormContrato action={criarRascunho} imobiliarias={imobiliarias} textoBotao="Salvar e continuar →" />
          </>
        )}

        {escolhido && escolhido !== "fianca" && (
          <>
            <Link href="/sinistros/novo" className="text-sm text-o2-blue hover:underline">
              ← trocar o produto
            </Link>
            <FormOutros action={criarSinistroOutros} imobiliarias={imobiliarias ?? []} equipe={equipe} novo produtoInicial={escolhido} />
          </>
        )}
      </main>
    </>
  );
}
