import Image from "next/image";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { emailAutorizado } from "@/lib/mcp/conectorLeitura";
import SubmitButton from "@/components/SubmitButton";
import { decidirAutorizacao } from "./actions";

// Tela de autorização do OAuth Server do Supabase (Authorization Path =
// /oauth/consent): aparece quando alguém conecta o Claude ao conector de
// leitura do Workspace. Só equipe O2 que esteja em mcp_autorizados consegue
// aprovar.
export default async function ConsentimentoPage({ searchParams }: { searchParams: Promise<{ authorization_id?: string }> }) {
  const { authorization_id: id } = await searchParams;
  if (!id) return <Aviso texto="Pedido de autorização inválido." />;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/oauth/consent?authorization_id=${id}`)}`);

  const email = (user.email ?? "").toLowerCase();
  if (!(isAdmin(email) || isColaboradorO2(email)) || !(await emailAutorizado(email))) {
    return <Aviso texto="Sua conta não está autorizada a usar o conector de leitura do Workspace. Fale com o Matheus." />;
  }

  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(id);
  if (error || !data) return <Aviso texto="Esse pedido de autorização expirou ou não é válido. Tente conectar de novo pelo Claude." />;
  if (!("authorization_id" in data) && "redirect_url" in data && data.redirect_url) redirect(data.redirect_url);
  const d = data as { client?: { name?: string; uri?: string }; redirect_uri?: string; scope?: string };

  return (
    <main className="mx-auto flex max-w-md flex-1 flex-col justify-center gap-5 p-8">
      <div className="flex justify-center">
        <Image src="/marca-o2/o2-logo-oficial.png" alt="O2 Seguros" width={140} height={77} priority />
      </div>
      <h1 className="text-center text-xl font-semibold text-o2-navy">Autorizar acesso de leitura</h1>
      <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
        <p>
          <b>{d.client?.name ?? "Aplicativo"}</b> quer consultar os dados do Workspace e do ERP O2 em nome de <b>{email}</b>.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Somente leitura: nada pode ser criado, alterado ou enviado.</li>
          <li>Só números e campos estruturados; sem dados pessoais de terceiros nem senhas.</li>
          <li>Cada consulta fica registrada em seu nome.</li>
        </ul>
        {d.redirect_uri && <p className="break-all text-xs text-gray-500">Retorno: {d.redirect_uri}</p>}
      </div>
      <form action={decidirAutorizacao} className="flex gap-3">
        <input type="hidden" name="authorization_id" value={id} />
        <button name="decisao" value="negar" className="flex-1 rounded-full border border-gray-300 px-4 py-2.5 font-medium text-gray-700 hover:bg-gray-50">
          Negar
        </button>
        <SubmitButton textoCarregando="Autorizando…" className="flex-1 rounded-full bg-o2-coral px-4 py-2.5 font-medium text-white hover:opacity-90">
          Aprovar
        </SubmitButton>
      </form>
    </main>
  );
}

function Aviso({ texto }: { texto: string }) {
  return (
    <main className="mx-auto flex max-w-md flex-1 flex-col justify-center gap-4 p-8 text-center">
      <h1 className="text-xl font-semibold text-o2-navy">Conector de leitura</h1>
      <p className="text-sm text-gray-600">{texto}</p>
    </main>
  );
}
