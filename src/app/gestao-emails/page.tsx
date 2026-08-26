import { redirect } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { isMatheus } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../actions";
import { listarMensagens, QUERY_PADRAO_CAIXA_EXECUTIVA } from "@/lib/gestaoEmails/gmail";
import { classificarEmailsExecutivos } from "@/lib/gestaoEmails/classificador";
import { listarIdsPendentes } from "@/lib/gestaoEmails/pendentes";
import PainelGestaoEmails, { type ItemPainelEmail } from "./PainelGestaoEmails";

// Chama Gmail + IA a cada acesso -- não faz sentido cachear uma caixa de
// entrada. maxDuration mais folgado que o padrão porque lê e classifica
// dezenas de e-mails em série (leitura em lotes + 1-2 chamadas à IA).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// O header "From" cru vem como `"Nome" <email>` ou `Nome <email>` -- exibir
// isso de uma vez só faz o nome e o e-mail competirem pela mesma ênfase
// visual no card. Separa os dois pra a tela decidir o peso de cada um.
function separarRemetente(remetente: string): { nome: string; email: string } {
  const match = /^"?([^"<]*)"?\s*<([^>]+)>\s*$/.exec(remetente.trim());
  if (match) {
    const nome = match[1].trim();
    return { nome: nome || match[2], email: match[2] };
  }
  return { nome: remetente, email: remetente };
}

function formatarData(dataHeader: string): string {
  const data = new Date(dataHeader);
  if (Number.isNaN(data.getTime())) return dataHeader;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(data);
}

export default async function GestaoEmailsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isMatheus(user?.email)) redirect("/");

  let itens: ItemPainelEmail[] = [];
  let erro: string | null = null;

  try {
    const [mensagens, idsPendentes] = await Promise.all([
      listarMensagens({ query: QUERY_PADRAO_CAIXA_EXECUTIVA, maxResultados: 50 }),
      listarIdsPendentes(),
    ]);
    const classificacoes = await classificarEmailsExecutivos(mensagens);
    const porId = new Map(mensagens.map((m) => [m.id, m]));

    itens = classificacoes.flatMap((c): ItemPainelEmail[] => {
      if (c.categoria === "ruido") return [];
      const mensagem = porId.get(c.messageId);
      if (!mensagem) return [];
      const { nome: remetenteNome, email: remetenteEmail } = separarRemetente(mensagem.remetente);
      return [
        {
          id: mensagem.id,
          threadId: mensagem.threadId,
          remetenteNome,
          remetenteEmail,
          assunto: mensagem.assunto,
          dataFormatada: formatarData(mensagem.data),
          categoria: c.categoria,
          status: c.status,
          resumoExecutivo: c.resumoExecutivo,
          acaoExigida: c.acaoExigida,
          pendente: idsPendentes.has(mensagem.id),
        },
      ];
    });
  } catch (e) {
    erro = e instanceof Error ? e.message : "Falha ao carregar a caixa de e-mails.";
  }

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-4xl flex-1 space-y-6 p-8">
        <div>
          <h1 className="text-xl font-semibold text-o2-navy">Gestão de E-mails</h1>
          <p className="text-sm text-gray-500">
            Filtro executivo da sua caixa: gestão macro, API seguradoras, contábil PF e demandas diretas.
          </p>
        </div>

        {erro ? (
          <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{erro}</p>
        ) : (
          <PainelGestaoEmails itens={itens} />
        )}
      </main>
    </>
  );
}
