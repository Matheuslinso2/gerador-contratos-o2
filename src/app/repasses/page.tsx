import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../actions";
import AppHeader from "@/components/AppHeader";
import SeletorCompetenciaRepasses from "./SeletorCompetenciaRepasses";
import SeletorImobiliaria from "../faturas/conferencia/SeletorImobiliaria";
import { confirmarIdentificacaoRepasse, excluirArquivoRepasse } from "./actions";
import { valoresBatem } from "@/lib/repassesIdentificacao";
import { IconCalendar, IconUpload, IconReceipt, IconTrash, IconMail } from "../faturas/icons";
import { SubmitButton } from "../faturas/SubmitButton";
import { SelecionarTodas } from "../faturas/LinhaInterativa";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MESES_PT = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function formatarCompetencia(competencia: string): string {
  const [ano, mes] = competencia.split("-");
  const nomeMes = MESES_PT[Number(mes) - 1];
  return nomeMes ? `${nomeMes} de ${ano}` : competencia;
}

function formatarValor(valor: number | null): string {
  if (valor === null) return "—";
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function mesAtualDefault(): string {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
}

type RepasseRow = {
  id: string;
  imobiliaria_id: string | null;
  competencia: string;
  tipo_documento: string | null;
  arquivo_nome: string;
  arquivo_bucket_path: string;
  valor: number | null;
  status: string;
  confianca: string | null;
  texto_bruto_extraido: string | null;
  codigo_produtor_corp: string | null;
};

export default async function RepassesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; erro?: string; aviso?: string; competencia?: string; busca?: string }>;
}) {
  const { ok, erro, aviso, competencia: competenciaParam, busca: buscaParam } = await searchParams;
  const competencia = competenciaParam || mesAtualDefault();
  const busca = (buscaParam ?? "").trim().toLowerCase();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const [{ data: repassesData }, { data: imobiliariasData }] = await Promise.all([
    supabase
      .from("repasses")
      .select(
        "id, imobiliaria_id, competencia, tipo_documento, arquivo_nome, arquivo_bucket_path, valor, status, confianca, texto_bruto_extraido, codigo_produtor_corp"
      )
      .eq("competencia", competencia)
      .neq("status", "cancelada")
      .order("created_at", { ascending: false }),
    supabase.from("imobiliarias").select("id, nome").order("nome"),
  ]);

  const repasses = (repassesData ?? []) as RepasseRow[];
  const imobiliariasTodas = imobiliariasData ?? [];

  const { data: imobiliariasDetalheData } = await supabase
    .from("imobiliarias")
    .select("id, nome, email_repasses")
    .in("id", Array.from(new Set(repasses.map((r) => r.imobiliaria_id).filter(Boolean) as string[])));
  const detalhePorImobiliaria = new Map((imobiliariasDetalheData ?? []).map((i) => [i.id, i]));

  const PENDENTES_CONFERENCIA = ["aguardando_identificacao", "aguardando_conferencia", "duplicada"];
  const pendentes = repasses.filter((r) => PENDENTES_CONFERENCIA.includes(r.status));

  const identificados = repasses.filter((r) => r.imobiliaria_id && ["identificado", "enviada"].includes(r.status));
  const porImobiliaria = new Map<string, RepasseRow[]>();
  for (const r of identificados) {
    const lista = porImobiliaria.get(r.imobiliaria_id!) ?? [];
    lista.push(r);
    porImobiliaria.set(r.imobiliaria_id!, lista);
  }

  type Par = {
    imobiliariaId: string;
    nome: string;
    emails: string[];
    relatorio: RepasseRow | null;
    comprovante: RepasseRow | null;
    estado: "enviado" | "pronto" | "divergente" | "aguardando_comprovante" | "aguardando_relatorio";
  };
  const pares: Par[] = [];
  for (const [imobiliariaId, linhas] of porImobiliaria) {
    const detalhe = detalhePorImobiliaria.get(imobiliariaId);
    const nome = detalhe?.nome ?? "—";
    if (busca && !nome.toLowerCase().includes(busca)) continue;
    const relatorio = linhas.find((l) => l.tipo_documento === "relatorio") ?? null;
    const comprovante = linhas.find((l) => l.tipo_documento === "comprovante") ?? null;
    const estado: Par["estado"] =
      relatorio?.status === "enviada" || comprovante?.status === "enviada"
        ? "enviado"
        : !relatorio
          ? "aguardando_relatorio"
          : !comprovante
            ? "aguardando_comprovante"
            : valoresBatem(relatorio.valor, comprovante.valor)
              ? "pronto"
              : "divergente";
    pares.push({ imobiliariaId, nome, emails: detalhe?.email_repasses ?? [], relatorio, comprovante, estado });
  }
  pares.sort((a, b) => {
    const prioridade: Record<Par["estado"], number> = {
      pronto: 0,
      divergente: 1,
      aguardando_comprovante: 2,
      aguardando_relatorio: 2,
      enviado: 3,
    };
    return prioridade[a.estado] - prioridade[b.estado] || a.nome.localeCompare(b.nome, "pt-BR");
  });

  const prontosParaEnvio = pares.filter((p) => p.estado === "pronto" && p.emails.length > 0);

  const caminhos = repasses.map((r) => r.arquivo_bucket_path);
  const urlPorCaminho = new Map<string, string>();
  if (caminhos.length) {
    const { data: assinados } = await supabase.storage.from("repasses").createSignedUrls(caminhos, 300);
    for (const item of assinados ?? []) {
      if (item.signedUrl && item.path) urlPorCaminho.set(item.path, item.signedUrl);
    }
  }

  const ROTULO_ESTADO: Record<Par["estado"], string> = {
    enviado: "Repasse enviado",
    pronto: "Pronto pra envio",
    divergente: "Valores não batem",
    aguardando_comprovante: "Aguardando comprovante",
    aguardando_relatorio: "Aguardando relatório",
  };
  const COR_ESTADO: Record<Par["estado"], string> = {
    enviado: "bg-green-100 text-green-700",
    pronto: "bg-green-100 text-green-700",
    divergente: "bg-red-100 text-red-700",
    aguardando_comprovante: "bg-yellow-100 text-yellow-800",
    aguardando_relatorio: "bg-yellow-100 text-yellow-800",
  };

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-[1100px] flex-1 space-y-6 p-8">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-o2-coral to-orange-400 text-white shadow-sm">
            <IconReceipt />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-o2-navy">Repasses de comissão</h1>
            <p className="text-sm text-gray-500">
              Relatório do Corp + comprovante de pagamento pra imobiliária/produtor — uso interno O2.
            </p>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-o2-indigo to-o2-navy p-5 text-white shadow-md sm:p-6">
          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15">
                <IconCalendar />
              </span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-white/60">Competência</p>
                <p className="mb-1 text-lg font-semibold text-white">{formatarCompetencia(competencia)}</p>
                <SeletorCompetenciaRepasses competencia={competencia} />
              </div>
            </div>
            <Link
              href="/repasses/upload"
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-white px-4 py-1.5 text-sm font-medium text-o2-navy shadow-sm transition hover:bg-white/90"
            >
              <IconUpload className="h-4 w-4" />
              Carregar repasse
            </Link>
          </div>
        </div>

        {ok && <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-700">{ok}</p>}
        {aviso && (
          <p className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">{aviso}</p>
        )}
        {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

        {pendentes.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-o2-navy">Precisa de conferência ({pendentes.length})</h2>
            {pendentes.map((r) => (
              <div key={r.id} className="rounded-xl border border-yellow-200 bg-yellow-50/50 p-4 shadow-sm">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium text-o2-navy">{r.arquivo_nome}</p>
                  <form action={excluirArquivoRepasse.bind(null, r.id, `&competencia=${competencia}`)}>
                    <SubmitButton
                      className="text-gray-400 transition hover:text-red-600"
                      textoCarregando="…"
                      confirmarAntes={`Excluir "${r.arquivo_nome}"? Some da lista.`}
                    >
                      <IconTrash className="h-3.5 w-3.5" />
                    </SubmitButton>
                  </form>
                </div>
                {r.status === "duplicada" ? (
                  <p className="rounded-lg border border-orange-200 bg-orange-50 p-2 text-xs text-orange-800">
                    Parece duplicata de um repasse já carregado nessa competência — confira e exclua se for
                    mesmo repetido.
                  </p>
                ) : (
                  <>
                    {!r.texto_bruto_extraido && (
                      <p className="mb-2 text-xs text-red-600">⚠️ Não conseguimos abrir esse PDF.</p>
                    )}
                    {r.confianca === "baixa" && (
                      <p className="mb-2 rounded-lg border border-yellow-200 bg-yellow-50 p-2 text-xs text-yellow-800">
                        ⚠️ Mais de uma imobiliária parecida com o nome no documento — confira antes de escolher.
                      </p>
                    )}
                    <form action={confirmarIdentificacaoRepasse} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="repasse_id" value={r.id} />
                      {!r.tipo_documento && (
                        <div>
                          <label className="mb-1 block text-xs text-red-600">Tipo ⚠️ não identificado</label>
                          <select name="tipo_documento" required defaultValue="" className="rounded-lg border border-red-300 px-3 py-2 text-sm focus:border-o2-coral focus:outline-none">
                            <option value="" disabled>Selecione...</option>
                            <option value="relatorio">Relatório de repasse</option>
                            <option value="comprovante">Comprovante de pagamento</option>
                          </select>
                        </div>
                      )}
                      <SeletorImobiliaria
                        imobiliarias={imobiliariasTodas}
                        defaultImobiliariaId={r.confianca === "baixa" ? null : r.imobiliaria_id}
                        listId={`imob-lista-${r.id}`}
                      />
                      <SubmitButton
                        className="rounded-full bg-o2-coral px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                        textoCarregando="Confirmando..."
                      >
                        Confirmar
                      </SubmitButton>
                    </form>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        <form action="/repasses" className="flex flex-wrap items-end gap-2 rounded-xl border border-o2-navy/10 bg-white p-3 shadow-sm">
          <input type="hidden" name="competencia" value={competencia} />
          <div>
            <label className="mb-0.5 block text-xs text-gray-500">Buscar imobiliária</label>
            <input
              name="busca"
              defaultValue={busca}
              placeholder="Nome..."
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-o2-coral focus:outline-none"
            />
          </div>
          <SubmitButton
            className="rounded-full border border-o2-navy px-4 py-1.5 text-sm font-medium text-o2-navy transition hover:bg-o2-navy hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            textoCarregando="Filtrando..."
          >
            Filtrar
          </SubmitButton>
          {busca && (
            <Link href={`/repasses?competencia=${competencia}`} className="text-sm text-gray-500 hover:text-o2-navy hover:underline">
              Limpar filtro
            </Link>
          )}
        </form>

        <form action="/repasses/enviar/confirmar" className="space-y-2">
          <input type="hidden" name="competencia" value={competencia} />
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              {prontosParaEnvio.length > 0
                ? `${prontosParaEnvio.length} pronto(s) pra envio (já marcados abaixo).`
                : "Nenhum repasse pronto pra envio no momento."}
            </p>
            <div className="flex items-center gap-3">
              {prontosParaEnvio.length > 1 && <SelecionarTodas />}
              <label className="flex items-center gap-1.5 text-xs text-gray-600">
                <input type="checkbox" name="modo_teste" value="1" />
                Modo teste — manda tudo só pro meu e-mail
              </label>
              <SubmitButton
                disabled={!prontosParaEnvio.length}
                className="whitespace-nowrap rounded-full bg-o2-navy px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                textoCarregando="Abrindo prévia..."
              >
                Enviar selecionados
              </SubmitButton>
            </div>
          </div>

          <div className="space-y-2">
            {pares.map((p) => {
              const arquivos = [p.relatorio, p.comprovante].filter(Boolean) as RepasseRow[];
              const podeSelecionar = p.estado === "pronto" && p.emails.length > 0;
              return (
                <div key={p.imobiliariaId} className="overflow-hidden rounded border border-gray-300 bg-white">
                  <div className="flex items-center justify-between gap-2 border-b border-gray-300 bg-gray-100 px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      {podeSelecionar ? (
                        <input type="checkbox" name="imob" value={p.imobiliariaId} defaultChecked />
                      ) : p.estado === "pronto" && !p.emails.length ? (
                        <span title="Sem e-mail de repasse cadastrado" className="text-red-500">⚠</span>
                      ) : null}
                      <span className="text-sm font-semibold text-gray-800">{p.nome}</span>
                    </div>
                    <span className={`rounded-sm px-2 py-0.5 text-[11px] font-medium ${COR_ESTADO[p.estado]}`}>
                      {ROTULO_ESTADO[p.estado]}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-xs text-gray-600">
                    <span>
                      Relatório: {p.relatorio ? formatarValor(p.relatorio.valor) : <span className="text-gray-300">—</span>}
                    </span>
                    <span>
                      Comprovante: {p.comprovante ? formatarValor(p.comprovante.valor) : <span className="text-gray-300">—</span>}
                    </span>
                    <span className="flex items-center gap-1">
                      <IconMail className="h-3 w-3" />
                      {p.emails.length ? p.emails.join(", ") : "sem e-mail de repasse"}
                    </span>
                    <span className="ml-auto flex items-center gap-2">
                      {arquivos.map((a) =>
                        urlPorCaminho.get(a.arquivo_bucket_path) ? (
                          <a
                            key={a.id}
                            href={urlPorCaminho.get(a.arquivo_bucket_path)}
                            target="_blank"
                            rel="noreferrer"
                            title={a.arquivo_nome}
                            className="inline-flex items-center gap-1 text-o2-navy/70 transition hover:text-o2-coral"
                          >
                            <IconReceipt className="h-3.5 w-3.5" />
                            {a.tipo_documento}
                          </a>
                        ) : null
                      )}
                    </span>
                  </div>
                </div>
              );
            })}

            {!pares.length && (
              <p className="rounded border border-gray-300 bg-white px-3 py-8 text-center text-sm text-gray-500">
                Nenhum repasse identificado nessa competência ainda.
              </p>
            )}
          </div>
        </form>
      </main>
    </>
  );
}
