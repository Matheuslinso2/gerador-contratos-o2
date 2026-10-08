import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isMatheus } from "@/lib/admin";
import { signOut } from "../../actions";
import AppHeader from "@/components/AppHeader";
import BackLink from "@/components/BackLink";
import Link from "next/link";
import { adicionarContato, alternarCampo, excluirContato } from "./actions";

export const dynamic = "force-dynamic";

// Quem da EQUIPE O2 conversa com o Workspace pelo WhatsApp (08/10/2026) --
// vê o Workspace inteiro pela IA. Contatos de imobiliária são cadastrados
// só no cadastro da própria imobiliária; aqui aparecem só pra consulta.

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
    service.from("imobiliarias").select("id, nome"),
  ]);
  const nomeImob = new Map((imobiliarias ?? []).map((i) => [i.id as string, i.nome as string]));
  const lista = (contatos ?? []) as Contato[];
  const equipe = lista.filter((c) => c.tipo === "equipe");
  const deImobiliarias = lista.filter((c) => c.tipo === "imobiliaria");

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-4xl flex-1 space-y-6 p-8">
        <div className="space-y-2">
          <BackLink />
          <h1 className="text-xl font-semibold text-o2-navy">WhatsApp — equipe O2</h1>
          <p className="text-sm text-gray-500">
            Quem está aqui pergunta qualquer coisa do Workspace pela IA e pode receber o relatório das 8h. O WhatsApp de
            imobiliária se cadastra no <strong>cadastro da própria imobiliária</strong> (seção &quot;Canais de contato e
            envio&quot;). Número fora do cadastro é ignorado.
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
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="recebe_relatorio" /> Recebe o relatório das 8h
          </label>
          <div className="sm:text-right">
            <button type="submit" className="rounded-lg bg-o2-navy px-4 py-2 text-sm font-medium text-white hover:opacity-90">
              Cadastrar
            </button>
          </div>
        </form>

        <section className="space-y-2">
          <h2 className="font-medium text-o2-navy">
            Equipe O2 <span className="text-sm font-normal text-gray-400">({equipe.length})</span>
          </h2>
          {equipe.length === 0 ? (
            <p className="text-sm text-gray-400">Ninguém cadastrado.</p>
          ) : (
            <div className="divide-y rounded-xl border border-o2-navy/10 bg-white">
              {equipe.map((c) => (
                <div key={c.id} className={`flex flex-wrap items-center gap-3 p-3 text-sm ${c.ativo ? "" : "opacity-50"}`}>
                  <div className="min-w-48 flex-1">
                    <p className="font-medium text-gray-900">{c.nome}</p>
                    <p className="text-gray-500">{fmtNumero(c.numero)}</p>
                  </div>
                  <form action={alternarCampo}>
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="campo" value="recebe_relatorio" />
                    <input type="hidden" name="valor" value={String(!c.recebe_relatorio)} />
                    <button className="rounded-lg border px-3 py-1 hover:bg-gray-50">
                      {c.recebe_relatorio ? "📊 Recebe relatório" : "Sem relatório"}
                    </button>
                  </form>
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

        {/* Só consulta: o WhatsApp de imobiliária se edita no cadastro dela. */}
        <section className="space-y-2">
          <h2 className="font-medium text-o2-navy">
            Imobiliárias <span className="text-sm font-normal text-gray-400">({deImobiliarias.length}) — só consulta</span>
          </h2>
          {deImobiliarias.length === 0 ? (
            <p className="text-sm text-gray-400">Nenhuma imobiliária com WhatsApp cadastrado.</p>
          ) : (
            <div className="divide-y rounded-xl border border-o2-navy/10 bg-white">
              {deImobiliarias.map((c) => (
                <div key={c.id} className={`flex flex-wrap items-center gap-3 p-3 text-sm ${c.ativo ? "" : "opacity-50"}`}>
                  <div className="min-w-48 flex-1">
                    <p className="font-medium text-gray-900">
                      {c.nome} · {nomeImob.get(c.imobiliaria_id ?? "") ?? "imobiliária removida"}
                    </p>
                    <p className="text-gray-500">
                      {fmtNumero(c.numero)}
                      {!c.ativo && " · pausado"}
                    </p>
                  </div>
                  <Link href={`/admin/imobiliarias/${c.imobiliaria_id}`} className="text-o2-navy hover:underline">
                    Editar no cadastro →
                  </Link>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
