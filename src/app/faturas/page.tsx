import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../actions";
import AppHeader from "@/components/AppHeader";
import SeletorCompetencia from "./SeletorCompetencia";
import { adicionarEsperada, vincularCnpjProvisoria } from "./actions";
import { SEGURADORAS_CANONICAS } from "@/lib/faturasIdentificacao";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SEGURADORAS_PADRAO = SEGURADORAS_CANONICAS;

// Prioridade pra decidir qual fatura "vale" quando existe mais de uma linha
// pra mesma imobiliária/seguradora/competência (não deveria mais acontecer
// depois da checagem de duplicidade por conteúdo no upload, mas se
// acontecer, não pode depender da ordem que o banco devolveu as linhas).
const PRIORIDADE_STATUS: Record<string, number> = {
  enviada: 0,
  pronta_para_envio: 1,
  fatura_carregada: 2,
  erro_no_envio: 3,
  aguardando_conferencia: 4,
  aguardando_identificacao: 5,
  duplicada: 6,
  cancelada: 7,
};

// Progressão: Imob com fatura aberta -> Pendente de envio -> Fatura
// enviada. O primeiro estágio não tem status próprio (é a ausência de
// linha em `faturas` pra essa competência), tratado à parte onde a tabela
// é montada — só aparece aqui quem já está ativo (tem fatura aberta com a
// seguradora, conforme a planilha), então esse é o "ainda não subiu o
// arquivo desse mês", não uma pendência de cadastro. Assim que carrega e
// identifica corretamente (fatura_carregada), já é "Pendente de envio" —
// não existe hoje nenhuma etapa real entre as duas (isso só passa a
// existir quando o envio de verdade for construído). Identificação
// incerta (precisa de conferência manual) é a única exceção com rótulo
// próprio.
const ROTULO_STATUS: Record<string, string> = {
  aguardando_upload: "Imob com fatura aberta",
  aguardando_identificacao: "Aguardando conferência",
  aguardando_conferencia: "Aguardando conferência",
  fatura_carregada: "Pendente de envio",
  pronta_para_envio: "Pendente de envio",
  enviada: "Fatura enviada",
  erro_no_envio: "Erro no envio",
  duplicada: "Duplicada",
  cancelada: "Cancelada",
};

const COR_STATUS: Record<string, string> = {
  aguardando_upload: "bg-gray-100 text-gray-700",
  aguardando_identificacao: "bg-yellow-100 text-yellow-800",
  aguardando_conferencia: "bg-yellow-100 text-yellow-800",
  fatura_carregada: "bg-green-100 text-green-700",
  pronta_para_envio: "bg-green-100 text-green-700",
  enviada: "bg-green-100 text-green-700",
  erro_no_envio: "bg-red-100 text-red-700",
  duplicada: "bg-red-100 text-red-700",
  cancelada: "bg-gray-100 text-gray-500",
};

// Opções do filtro de situação — "aguardando_upload" representa "sem
// fatura carregada ainda" (não tem status próprio na tabela faturas).
// "pronta_para_envio" fica fora da lista: hoje nenhuma fatura recebe esse
// status (fatura_carregada já é exibida como "Pendente de envio").
const OPCOES_STATUS_FILTRO = [
  "aguardando_upload",
  "aguardando_conferencia",
  "fatura_carregada",
  "enviada",
  "erro_no_envio",
  "duplicada",
  "cancelada",
];

const inputClass = "w-full rounded border border-gray-300 px-2 py-1 text-xs focus:border-o2-coral focus:outline-none";

function mesAtualDefault(): string {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
}

const POR_PAGINA = 20;

type EsperadaRow = {
  id: string;
  imobiliaria_id: string | null;
  dia_vencimento: number | null;
  cnpj_o2: string | null;
  observacao: string | null;
  nome_provisorio: string | null;
  imobiliarias: { nome: string; cnpj: string | null } | { nome: string; cnpj: string | null }[] | null;
};

export default async function FaturasPage({
  searchParams,
}: {
  searchParams: Promise<{
    ok?: string;
    aviso?: string;
    erro?: string;
    competencia?: string;
    seguradora?: string;
    limite?: string;
    busca?: string;
    status?: string;
  }>;
}) {
  const {
    ok,
    aviso,
    erro,
    competencia: competenciaParam,
    seguradora: seguradoraParam,
    limite: limiteParam,
    busca: buscaParam,
    status: statusParam,
  } = await searchParams;
  const competencia = competenciaParam || mesAtualDefault();
  const limite = Math.max(POR_PAGINA, Number(limiteParam) || POR_PAGINA);
  const busca = (buscaParam ?? "").trim();
  const statusFiltro = (statusParam ?? "").trim();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const { data: seguradorasData } = await supabase
    .from("faturas_esperadas")
    .select("seguradora")
    .eq("ativo", true);
  const seguradorasCadastradas = Array.from(new Set((seguradorasData ?? []).map((s) => s.seguradora)));
  const seguradoras = seguradorasCadastradas.length
    ? Array.from(new Set([...SEGURADORAS_PADRAO.filter((s) => seguradorasCadastradas.includes(s)), ...seguradorasCadastradas]))
    : SEGURADORAS_PADRAO;
  const seguradora = seguradoraParam && seguradoras.includes(seguradoraParam) ? seguradoraParam : seguradoras[0];

  const [{ data: esperadasTodasData }, { data: faturasData }, { data: pendentesData }] = await Promise.all([
    supabase
      .from("faturas_esperadas")
      .select("id, imobiliaria_id, dia_vencimento, cnpj_o2, observacao, nome_provisorio, imobiliarias(nome, cnpj)")
      .eq("seguradora", seguradora)
      .eq("ativo", true)
      .order("id"),
    supabase
      .from("faturas")
      .select("id, imobiliaria_id, valor, vencimento, status, arquivo_nome")
      .eq("seguradora", seguradora)
      .eq("competencia", competencia),
    supabase.from("faturas").select("status").in("status", ["aguardando_identificacao", "aguardando_conferencia"]),
  ]);
  const esperadasTodas = (esperadasTodasData ?? []) as EsperadaRow[];

  // Uma linha por imobiliária, escolhendo a de status mais relevante quando
  // existir mais de uma pra mesma competência (ver PRIORIDADE_STATUS acima)
  // -- nunca deixa uma fatura "viva" ficar escondida atrás de outra por
  // causa da ordem em que o banco devolveu as linhas.
  const faturasPorImobiliaria = new Map<string, NonNullable<typeof faturasData>[number]>();
  const duplicatasPorImobiliaria = new Map<string, number>();
  for (const f of faturasData ?? []) {
    if (!f.imobiliaria_id) continue;
    if (f.status === "duplicada") {
      duplicatasPorImobiliaria.set(f.imobiliaria_id, (duplicatasPorImobiliaria.get(f.imobiliaria_id) ?? 0) + 1);
    }
    const atual = faturasPorImobiliaria.get(f.imobiliaria_id);
    if (!atual || (PRIORIDADE_STATUS[f.status] ?? 99) < (PRIORIDADE_STATUS[atual.status] ?? 99)) {
      faturasPorImobiliaria.set(f.imobiliaria_id, f);
    }
  }
  const pendentes = pendentesData?.length ?? 0;

  // Busca por nome e filtro de situação aplicados em memória — o total de
  // linhas por seguradora é pequeno (algumas centenas), não compensa a
  // complexidade de filtrar isso via join no banco.
  const buscaNormalizada = busca.toLowerCase();
  const esperadasFiltradas = esperadasTodas.filter((e) => {
    const imob = Array.isArray(e.imobiliarias) ? e.imobiliarias[0] : e.imobiliarias;
    const nome = (imob?.nome ?? e.nome_provisorio ?? "").toLowerCase();
    if (buscaNormalizada && !nome.includes(buscaNormalizada)) return false;
    if (statusFiltro) {
      const fatura = e.imobiliaria_id ? faturasPorImobiliaria.get(e.imobiliaria_id) : undefined;
      const statusChave = fatura ? fatura.status : "aguardando_upload";
      if (statusChave !== statusFiltro) return false;
    }
    return true;
  });
  const totalEsperadas = esperadasFiltradas.length;
  const esperadas = esperadasFiltradas.slice(0, limite);

  // Faturas carregadas nessa seguradora/competência mas cuja imobiliária
  // ainda não está na lista de esperadas (parceiro novo, ainda sem
  // registro fixo) — mostra também, marcado.
  const idsEsperadas = new Set(esperadasTodas.map((e) => e.imobiliaria_id));
  const extras = (faturasData ?? []).filter(
    (f) => f.imobiliaria_id && f.status !== "cancelada" && !idsEsperadas.has(f.imobiliaria_id)
  );

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-5xl flex-1 space-y-6 p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-o2-navy">Faturas mensais</h1>
            <p className="text-sm text-gray-500">
              Boletos de seguradora recebidos para reenvio às imobiliárias — uso interno O2.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <SeletorCompetencia competencia={competencia} />
            {pendentes > 0 && (
              <Link
                href="/faturas/conferencia"
                className="whitespace-nowrap rounded-full border border-o2-navy px-4 py-1.5 text-sm font-medium text-o2-navy transition hover:bg-o2-navy hover:text-white"
              >
                Conferência ({pendentes})
              </Link>
            )}
            <Link
              href="/faturas/upload"
              className="whitespace-nowrap rounded-full bg-o2-coral px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
            >
              Carregar fatura
            </Link>
          </div>
        </div>

        {ok && <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-700">{ok}</p>}
        {aviso && (
          <p className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">{aviso}</p>
        )}
        {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

        <div className="flex flex-wrap gap-1 border-b border-gray-200">
          {seguradoras.map((s) => (
            <Link
              key={s}
              href={`/faturas?competencia=${competencia}&seguradora=${encodeURIComponent(s)}`}
              className={`rounded-t-lg border border-b-0 px-3 py-1.5 text-sm font-medium ${
                s === seguradora
                  ? "border-gray-200 bg-white text-o2-navy"
                  : "border-transparent text-gray-500 hover:text-o2-navy"
              }`}
            >
              {s}
            </Link>
          ))}
        </div>

        <form className="flex flex-wrap items-end gap-2" action="/faturas">
          <input type="hidden" name="competencia" value={competencia} />
          <input type="hidden" name="seguradora" value={seguradora} />
          <div>
            <label className="mb-0.5 block text-xs text-gray-500">Buscar imobiliária</label>
            <input
              name="busca"
              defaultValue={busca}
              placeholder="Nome..."
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-o2-coral focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-0.5 block text-xs text-gray-500">Situação</label>
            <select
              name="status"
              defaultValue={statusFiltro}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-o2-coral focus:outline-none"
            >
              <option value="">Todas</option>
              {OPCOES_STATUS_FILTRO.map((s) => (
                <option key={s} value={s}>
                  {ROTULO_STATUS[s]}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="rounded-full border border-o2-navy px-4 py-1.5 text-sm font-medium text-o2-navy transition hover:bg-o2-navy hover:text-white"
          >
            Filtrar
          </button>
          {(busca || statusFiltro) && (
            <Link
              href={`/faturas?competencia=${competencia}&seguradora=${encodeURIComponent(seguradora)}`}
              className="text-sm text-gray-500 hover:text-o2-navy hover:underline"
            >
              Limpar filtro
            </Link>
          )}
        </form>

        <div className="overflow-x-auto rounded-xl rounded-tl-none border border-o2-navy/10 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-500">
                <th className="px-3 py-2 font-medium">Parceiro</th>
                <th className="px-3 py-2 font-medium">CNPJ</th>
                <th className="px-3 py-2 font-medium">Venc.</th>
                <th className="px-3 py-2 font-medium">CNPJ O2</th>
                <th className="px-3 py-2 font-medium">Observação</th>
                <th className="px-3 py-2 font-medium">Situação ({competencia})</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {esperadas.map((e) => {
                const imob = Array.isArray(e.imobiliarias) ? e.imobiliarias[0] : e.imobiliarias;
                const fatura = e.imobiliaria_id ? faturasPorImobiliaria.get(e.imobiliaria_id) : undefined;
                const pendente = !imob && !!e.nome_provisorio;
                return (
                  <tr key={e.id} className={`border-b border-gray-50 last:border-0 align-top ${pendente ? "bg-orange-50/40" : ""}`}>
                    <td className="px-3 py-2 text-gray-800">{imob?.nome ?? e.nome_provisorio ?? "—"}</td>
                    <td className="px-3 py-2 text-gray-500">
                      {imob?.cnpj ?? (
                        <form action={vincularCnpjProvisoria} className="flex items-center gap-1">
                          <input type="hidden" name="id" value={e.id} />
                          <input type="hidden" name="seguradora" value={seguradora} />
                          <input name="cnpj" placeholder="CNPJ" className={`${inputClass} w-28`} />
                          <button type="submit" className="whitespace-nowrap text-xs font-medium text-o2-navy hover:underline">
                            Vincular
                          </button>
                        </form>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-800">{e.dia_vencimento ?? "—"}</td>
                    <td className="px-3 py-2 text-gray-800">{e.cnpj_o2 ?? "—"}</td>
                    <td className="px-3 py-2 text-gray-800">{e.observacao ?? "—"}</td>
                    <td className="px-3 py-2">
                      {fatura ? (
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${COR_STATUS[fatura.status] ?? "bg-gray-100 text-gray-700"}`}>
                          {ROTULO_STATUS[fatura.status] ?? fatura.status}
                        </span>
                      ) : (
                        <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500">
                          Imob com fatura aberta
                        </span>
                      )}
                      {e.imobiliaria_id && (duplicatasPorImobiliaria.get(e.imobiliaria_id) ?? 0) > 0 && (
                        <Link
                          href="/faturas/conferencia"
                          className="ml-1.5 whitespace-nowrap text-xs font-medium text-orange-700 hover:underline"
                        >
                          +{duplicatasPorImobiliaria.get(e.imobiliaria_id)} possível duplicata
                        </Link>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {e.imobiliaria_id && (
                        <Link
                          href={`/faturas/imobiliaria/${e.imobiliaria_id}`}
                          className="text-xs font-medium text-o2-navy hover:underline"
                        >
                          Editar
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}

              {extras.map((f) => (
                <tr key={f.id} className="border-b border-gray-50 bg-amber-50/40 last:border-0">
                  <td className="px-3 py-2 text-gray-800" colSpan={4}>
                    Parceiro novo (não cadastrado ainda) — {f.arquivo_nome}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">Confirme na Conferência</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${COR_STATUS[f.status] ?? "bg-gray-100 text-gray-700"}`}>
                      {ROTULO_STATUS[f.status] ?? f.status}
                    </span>
                  </td>
                  <td />
                </tr>
              ))}

              {!esperadas.length && !extras.length && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-sm text-gray-500">
                    Nenhuma imobiliária cadastrada ainda pra {seguradora}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalEsperadas > esperadas.length && (
          <div className="text-center">
            <Link
              href={`/faturas?competencia=${competencia}&seguradora=${encodeURIComponent(seguradora)}&limite=${limite + POR_PAGINA}&busca=${encodeURIComponent(busca)}&status=${encodeURIComponent(statusFiltro)}`}
              className="text-sm font-medium text-o2-navy hover:underline"
            >
              Mostrar mais {Math.min(POR_PAGINA, totalEsperadas - esperadas.length)} (
              {esperadas.length} de {totalEsperadas})
            </Link>
          </div>
        )}

        <details className="rounded-xl border border-o2-navy/10 bg-white p-4 shadow-sm">
          <summary className="cursor-pointer text-sm font-medium text-o2-navy">+ Adicionar imobiliária</summary>
          <p className="mt-1 text-xs text-gray-500">
            Um cadastro só, marcando quais seguradoras essa imobiliária tem — não precisa repetir
            aba por aba.
          </p>
          <form action={adicionarEsperada} className="mt-3 space-y-3">
            <input type="hidden" name="voltar_para" value={`&competencia=${competencia}&seguradora=${encodeURIComponent(seguradora)}`} />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input name="nome" placeholder="Nome da imobiliária" required className={inputClass} />
              <input name="cnpj" placeholder="CNPJ" required className={inputClass} />
            </div>
            <div className="flex flex-wrap gap-3">
              {seguradoras.map((s) => (
                <label key={s} className="flex items-center gap-1.5 text-xs text-gray-700">
                  <input type="checkbox" name="seguradoras" value={s} defaultChecked={s === seguradora} />
                  {s}
                </label>
              ))}
            </div>
            <button
              type="submit"
              className="rounded-full bg-o2-coral px-4 py-1.5 text-xs font-medium text-white transition hover:opacity-90"
            >
              Adicionar
            </button>
          </form>
        </details>
      </main>
    </>
  );
}
