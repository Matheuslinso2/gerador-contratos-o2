import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isMatheus } from "@/lib/admin";
import { signOut } from "../../actions";
import AppHeader from "@/components/AppHeader";
import BackLink from "@/components/BackLink";
import { adicionarContato, alternarCampo, excluirContato } from "./actions";

export const dynamic = "force-dynamic";

// Quem conversa com o Workspace pelo WhatsApp (08/10/2026). Equipe vê o
// Workspace inteiro pela IA; contato de imobiliária só vai poder ver os
// dados da própria imobiliária (Fase C -- até lá recebe uma resposta
// padrão de "em breve").

type Contato = {
  id: string;
  numero: string;
  nome: string;
  tipo: "equipe" | "imobiliaria";
  imobiliaria_id: string | null;
  recebe_relatorio: boolean;
  ativo: boolean;
  criado_em: string;
};

function fmtNumero(n: string): string {
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(n);
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : n;
}

export default async function WhatsappContatosPage({ searchParams }: { searchParams: Promise<{ erro?: string; sucesso?: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isMatheus(user?.email)) redirect("/");
  const { erro, sucesso } = await searchParams;

  const service = createServiceClient();
  const [{ data: contatos }, { data: imobiliarias }] = await Promise.all([
    service.from("whatsapp_contatos").select("*").order("criado_em", { ascending: true }),
    service.from("imobiliarias").select("id, nome").order("nome"),
  ]);
  const nomeImob = new Map((imobiliarias ?? []).map((i) => [i.id as string, i.nome as string]));
  const lista = (contatos ?? []) as Contato[];
  const grupos: [string, Contato[]][] = [
    ["Equipe O2", lista.filter((c) => c.tipo === "equipe")],
    ["Imobiliárias", lista.filter((c) => c.tipo === "imobiliaria")],
  ];

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-4xl flex-1 space-y-6 p-8">
        <div className="space-y-2">
          <BackLink />
          <h1 className="text-xl font-semibold text-o2-navy">WhatsApp — quem pode conversar com o Workspace</h1>
          <p className="text-sm text-gray-500">
            <strong>Equipe</strong> pergunta qualquer coisa do Workspace pela IA e pode receber o relatório das 8h.{" "}
            <strong>Imobiliária</strong> só vai ver os dados da própria imobiliária (em construção — por enquanto recebe uma
            resposta de &quot;em breve&quot;). Número fora desta lista é ignorado.
          </p>
          {lista.length === 0 && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              Lista vazia: enquanto não houver ninguém da equipe aqui, vale a lista antiga da Vercel
              (WHATSAPP_RELATORIO_DESTINATARIOS). Cadastre-se primeiro — o botão &quot;enviar teste&quot; do relatório manda
              pro primeiro da equipe.
            </p>
          )}
          <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
            Enquanto o WhatsApp estiver no número de teste da Meta (+1 555), cada número também precisa estar na lista de
            destinatários do painel da Meta (máximo 5). Com o número oficial da O2, esse limite some.
          </p>
        </div>

        {erro && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{erro}</p>}
        {sucesso && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{sucesso}</p>}

        <form action={adicionarContato} className="grid gap-3 rounded-xl border border-o2-navy/10 bg-quadro p-4 sm:grid-cols-2">
          <label className="text-sm">
            <span className="text-gray-600">Nome</span>
            <input name="nome" required className="mt-1 w-full rounded-lg border px-3 py-2" placeholder="Ex: Lucas (sócio)" />
          </label>
          <label className="text-sm">
            <span className="text-gray-600">WhatsApp (55 + DDD + número)</span>
            <input name="numero" required inputMode="numeric" className="mt-1 w-full rounded-lg border px-3 py-2" placeholder="5521999990000" />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="text-gray-600">Imobiliária (deixe em branco se for da equipe O2)</span>
            <select name="imobiliaria_id" defaultValue="" className="mt-1 w-full rounded-lg border px-3 py-2">
              <option value="">— Equipe O2 —</option>
              {(imobiliarias ?? []).map((i) => (
                <option key={i.id as string} value={i.id as string}>
                  {i.nome as string}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="recebe_relatorio" /> Recebe o relatório das 8h (só equipe)
          </label>
          <div className="sm:text-right">
            <button type="submit" className="rounded-lg bg-o2-navy px-4 py-2 text-sm font-medium text-white hover:opacity-90">
              Cadastrar
            </button>
          </div>
        </form>

        {grupos.map(([titulo, itens]) => (
          <section key={titulo} className="space-y-2">
            <h2 className="font-medium text-o2-navy">
              {titulo} <span className="text-sm font-normal text-gray-400">({itens.length})</span>
            </h2>
            {itens.length === 0 ? (
              <p className="text-sm text-gray-400">Ninguém cadastrado.</p>
            ) : (
              <div className="divide-y rounded-xl border border-o2-navy/10 bg-white">
                {itens.map((c) => (
                  <div key={c.id} className={`flex flex-wrap items-center gap-3 p-3 text-sm ${c.ativo ? "" : "opacity-50"}`}>
                    <div className="min-w-48 flex-1">
                      <p className="font-medium text-gray-900">{c.nome}</p>
                      <p className="text-gray-500">
                        {fmtNumero(c.numero)}
                        {c.imobiliaria_id && <> · {nomeImob.get(c.imobiliaria_id) ?? "imobiliária removida"}</>}
                      </p>
                    </div>
                    {c.tipo === "equipe" && (
                      <form action={alternarCampo}>
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="campo" value="recebe_relatorio" />
                        <input type="hidden" name="valor" value={String(!c.recebe_relatorio)} />
                        <button className="rounded-lg border px-3 py-1 hover:bg-gray-50">
                          {c.recebe_relatorio ? "📊 Recebe relatório" : "Sem relatório"}
                        </button>
                      </form>
                    )}
                    <form action={alternarCampo}>
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="campo" value="ativo" />
                      <input type="hidden" name="valor" value={String(!c.ativo)} />
                      <button className="rounded-lg border px-3 py-1 hover:bg-gray-50">{c.ativo ? "Ativo" : "Pausado"}</button>
                    </form>
                    <form action={excluirContato}>
                      <input type="hidden" name="id" value={c.id} />
                      <button className="rounded-lg border border-red-200 px-3 py-1 text-red-700 hover:bg-red-50">Remover</button>
                    </form>
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}
      </main>
    </>
  );
}
