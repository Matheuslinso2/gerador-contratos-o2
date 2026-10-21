import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { buscarImobiliariaDoUsuario } from "@/lib/imobiliariaDoUsuario";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import BackLink from "@/components/BackLink";
import { IconShield } from "@/components/icons";
import {
  ETAPAS,
  PRAZO_SEGURADORA_DIAS,
  SLA_PRE_ANALISE_DIAS_UTEIS,
  tituloTipo,
  calcularPrazoAviso,
  diasEntre,
  diasUteisDesde,
  formatarData,
  formatarReais,
  hojeSP,
  type EtapaSinistro,
} from "@/lib/sinistros/regras";
import { signOut } from "../../actions";
import { Aviso, EtiquetaEtapa, enderecoCurto } from "../ui";
import Abas from "../Abas";
import { filtrosDashboard, lista } from "@/lib/sinistros/periodo";
import { PRODUTOS, rotuloProduto } from "@/lib/sinistros/produtos";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any -- linhas do Supabase sem tipos gerados */

const CAMPOS =
  "id, codigo, produto, origem, locador_nome, data_abertura_seguradora, tipo, etapa, seguradora, numero_apolice, locatario_nome, imovel_logradouro, imovel_numero, imovel_complemento, data_primeiro_vencimento, data_segundo_vencimento, data_entrega_chaves, prazo_aviso, aviso_fora_prazo, valor_avisado, responsavel_o2, pre_analise_desde, pendencia_prazo, documentacao_completa_em, numero_sinistro_seguradora, proxima_acao_em, proxima_acao_descricao, proxima_acao_responsavel, updated_at, imobiliarias(nome, apelido)";

export default async function SinistrosPage({
  searchParams,
}: {
  searchParams: Promise<{ sucesso?: string; resp?: string; q?: string; encerrados?: string; como?: string; imob?: string; [k: string]: string | string[] | undefined }>;
}) {
  const parametros = await searchParams;
  const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const [sucesso, resp, q, encerrados, como, imob] = [parametros.sucesso, parametros.resp, parametros.q, parametros.encerrados, parametros.como, parametros.imob].map(um);
  // Mesmos filtros do dashboard (produto, seguradora, imobiliária): a contagem
  // de abertos aqui = "Em aberto" do dashboard (21/10/2026).
  const produtos = lista(parametros.prod);
  const seguradoras = lista(parametros.seg);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const equipeO2 = isAdmin(user.email) || isColaboradorO2(user.email);
  // Pré-visualização da tela da imobiliária pra equipe O2 (mostra todos os
  // sinistros, mas no formato que a imobiliária enxerga os dela).
  const interno = equipeO2 && como !== "imobiliaria";
  if (!equipeO2) {
    const imob = await buscarImobiliariaDoUsuario(supabase, user);
    if (!imob) redirect("/imobiliaria");
  }

  let consulta = supabase.from("sinistros").select(CAMPOS).order("updated_at", { ascending: false }).limit(500);
  if (encerrados !== "1") consulta = consulta.neq("etapa", "cancelado");
  if (interno && produtos.length) consulta = consulta.in("produto", produtos);
  if (interno && seguradoras.length) consulta = consulta.in("seguradora", seguradoras);
  // Filtro de imobiliária/grupo vindo do dashboard (chave de sinistros_kpi_grupos):
  // i:<imobiliaria_id> · g:<grupo_id> · t:<texto do Corp> (sem sinistro no módulo).
  let nomeFiltroImob: string | null = null;
  if (interno && imob) {
    const { data: g } = await supabase.from("sinistros_kpi_grupos").select("nome").eq("chave", imob).maybeSingle();
    nomeFiltroImob = g?.nome ?? imob;
    if (imob.startsWith("i:")) consulta = consulta.eq("imobiliaria_id", imob.slice(2));
    else if (imob.startsWith("g:")) {
      const { data: membros } = await supabase.from("imobiliarias").select("id").eq("grupo_id", imob.slice(2));
      consulta = consulta.in("imobiliaria_id", (membros ?? []).map((m) => m.id).concat("00000000-0000-0000-0000-000000000000"));
    } else consulta = consulta.eq("imobiliaria_id", "00000000-0000-0000-0000-000000000000");
  }
  const { data } = await consulta;
  let sinistros = (data ?? []) as any[];
  if (q) {
    const termo = q.toLowerCase();
    sinistros = sinistros.filter((s) =>
      [s.locatario_nome, s.numero_apolice, s.numero_sinistro_seguradora, `sin-${s.codigo}`, enderecoCurto(s), s.imobiliarias?.nome, s.imobiliarias?.apelido]
        .filter(Boolean)
        .some((v: string) => v.toLowerCase().includes(termo))
    );
  }
  if (interno && resp === "meus") sinistros = sinistros.filter((s) => s.responsavel_o2 === user.email);
  const opcoesSeguradoras = [...new Set(sinistros.map((s) => s.seguradora).filter(Boolean))].sort() as string[];
  const abertos = sinistros.filter((s) => COLUNAS.includes(s.etapa)).length;
  const filtros = filtrosDashboard(parametros);

  return (
    <>
      <AppHeader userEmail={user.email} logoutAction={signOut} />
      <main className={`mx-auto flex-1 space-y-6 p-8 ${interno ? "max-w-7xl" : "max-w-5xl"}`}>
        <BackLink />
        <PageHeader
          icon={<IconShield />}
          titulo={interno ? "Sinistros — gestão" : "Sinistros"}
          subtitulo={interno ? "Fila do Setor de Garantias · sinistros abertos pelo Workspace" : "Seguro Fiança"}
        />
        <Abas atual="gestao" interno={interno} filtros={filtros} />
        {nomeFiltroImob && (
          <div className="flex items-center gap-2 text-sm">
            <span className="rounded-full bg-blue-100 px-3 py-1 font-semibold text-blue-800">Imobiliária: {nomeFiltroImob}</span>
            <Link href="/sinistros/gestao" className="text-gray-500 hover:underline">× limpar</Link>
          </div>
        )}
        {sucesso && <Aviso tipo="sucesso">{sucesso}</Aviso>}

        <form className="flex flex-wrap items-center gap-3 text-sm">
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder={interno ? "Buscar locatário, apólice, nº, imobiliária…" : "Buscar locatário, endereço, apólice ou nº do sinistro…"}
            className="min-w-64 flex-1 rounded-lg border border-gray-300 px-3 py-2"
          />
          {imob && <input type="hidden" name="imob" value={imob} />}
          {interno && (
            <select name="prod" defaultValue={produtos[0] ?? ""} className="rounded-lg border border-gray-300 px-2 py-2">
              <option value="">Todos os produtos</option>
              {PRODUTOS.map((p) => (
                <option key={p.chave} value={p.chave}>
                  {p.rotulo}
                </option>
              ))}
            </select>
          )}
          {interno && (
            <select name="seg" defaultValue={seguradoras[0] ?? ""} className="rounded-lg border border-gray-300 px-2 py-2">
              <option value="">Todas as seguradoras</option>
              {opcoesSeguradoras.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
          {interno && (
            <select name="resp" defaultValue={resp ?? ""} className="rounded-lg border border-gray-300 px-2 py-2">
              <option value="">Todos os responsáveis</option>
              <option value="meus">Só os meus</option>
            </select>
          )}
          <label className="flex items-center gap-1 text-gray-600">
            <input type="checkbox" name="encerrados" value="1" defaultChecked={encerrados === "1"} /> incluir cancelados
          </label>
          <button className="rounded-full bg-o2-navy px-4 py-2 font-semibold text-white">Filtrar</button>
        </form>

        {interno && (
          <p className="text-sm text-gray-600">
            <b className="text-o2-navy">{abertos} em aberto</b> nas colunas abaixo
            {produtos.length ? ` · ${produtos.map(rotuloProduto).join(", ")}` : " · todos os produtos"} — o mesmo número do card &quot;Em aberto&quot; do{" "}
            <Link href={`/sinistros?${filtros}`} className="text-o2-blue underline">
              dashboard
            </Link>{" "}
            com estes filtros.
          </p>
        )}
        {interno ? <Fila sinistros={sinistros} /> : <ListaImobiliaria sinistros={sinistros} />}
      </main>
    </>
  );
}

// ---------- Imobiliária ----------

function proximoPasso(s: any): { texto: string; urgente: boolean } {
  const hoje = hojeSP();
  switch (s.etapa as EtapaSinistro) {
    case "rascunho": {
      const p = calcularPrazoAviso(s);
      if (p.prazo)
        return {
          texto: p.foraDoPrazo ? `Terminar e enviar — prazo encerrado em ${formatarData(p.prazo)}` : `Terminar e enviar até ${formatarData(p.prazo)}`,
          urgente: true,
        };
      return { texto: "Terminar o preenchimento e enviar", urgente: true };
    }
    case "pendencia_imobiliaria":
      return {
        texto: `Resolver a pendência até ${formatarData(s.pendencia_prazo)}${s.pendencia_prazo && diasEntre(hoje, s.pendencia_prazo) < 0 ? " (atrasada)" : ""}`,
        urgente: true,
      };
    case "pre_analise":
      return { texto: "Aguardando a conferência da O2", urgente: false };
    case "na_seguradora":
      return { texto: "Aguardando o retorno da seguradora", urgente: false };
    default:
      return { texto: "—", urgente: false };
  }
}

function ListaImobiliaria({ sinistros }: { sinistros: any[] }) {
  const precisa = sinistros.filter((s) => s.etapa === "rascunho" || s.etapa === "pendencia_imobiliaria");
  const analise = sinistros.filter((s) => s.etapa === "pre_analise" || s.etapa === "na_seguradora");
  const indenizacao = sinistros.filter((s) => s.etapa === "em_indenizacao" || s.etapa === "acordo_judicial");
  const encerrados = sinistros.filter((s) => s.etapa === "encerrado");
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-4">
        <Contador titulo="Precisa de você" valor={precisa.length} destaque={precisa.length > 0} />
        <Contador titulo="Em análise" valor={analise.length} subtitulo="O2 ou seguradora" />
        <Contador titulo="Em indenização" valor={indenizacao.length} />
        <Contador titulo="Encerrados" valor={encerrados.length} />
      </div>
      {sinistros.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          Nenhum sinistro por aqui. Quando o locatário tiver o <b>2º mês em aberto</b> (ou entregar as chaves com débitos/danos), use{" "}
          <b>Abrir sinistro</b>.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-o2-navy text-left text-xs text-white">
              <tr>
                <th className="px-3 py-2">Locatário / imóvel</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Etapa</th>
                <th className="px-3 py-2">Próximo passo</th>
                <th className="px-3 py-2 text-right">Avisado</th>
              </tr>
            </thead>
            <tbody>
              {[...precisa, ...sinistros.filter((s) => !precisa.includes(s))].map((s) => {
                const p = proximoPasso(s);
                return (
                  <tr key={s.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <Link href={`/sinistros/${s.id}`} className="font-semibold text-o2-navy hover:underline">
                        {s.locatario_nome || s.locador_nome || "Locatário não informado"}
                      </Link>
                      <div className="text-xs text-gray-500">
                        SIN-{s.codigo} · {enderecoCurto(s)}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">{tituloTipo(s.tipo)}</td>
                    <td className="px-3 py-2">
                      <EtiquetaEtapa etapa={s.etapa} visao="imobiliaria" />
                    </td>
                    <td className={`px-3 py-2 text-xs ${p.urgente ? "font-semibold text-orange-800" : "text-gray-600"}`}>{p.texto}</td>
                    <td className="px-3 py-2 text-right text-xs">{s.valor_avisado ? formatarReais(s.valor_avisado) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Contador({ titulo, valor, subtitulo, destaque, perigo }: { titulo: string; valor: number; subtitulo?: string; destaque?: boolean; perigo?: boolean }) {
  const cor = perigo && valor > 0 ? "border-red-300 text-red-700" : destaque ? "border-o2-coral text-o2-coral" : "border-gray-200 text-o2-navy";
  return (
    <div className={`rounded-xl border bg-white p-4 ${cor}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{titulo}</p>
      <p className="text-3xl font-bold">{valor}</p>
      {subtitulo && <p className="text-xs text-gray-500">{subtitulo}</p>}
    </div>
  );
}

// ---------- O2: fila por etapa ----------

const COLUNAS: EtapaSinistro[] = ["pre_analise", "pendencia_imobiliaria", "na_seguradora", "em_indenizacao", "acordo_judicial"];

function alertaDo(s: any): { texto: string; nivel: "vermelho" | "laranja" | null } {
  const hoje = hojeSP();
  if (s.etapa === "pre_analise" && s.pre_analise_desde) {
    const d = diasUteisDesde(s.pre_analise_desde);
    if (d > SLA_PRE_ANALISE_DIAS_UTEIS) return { texto: `pré-análise há ${d} dias úteis`, nivel: "vermelho" };
    return { texto: d === 0 ? "chegou hoje" : `há ${d} dia útil`, nivel: null };
  }
  if (s.etapa === "pendencia_imobiliaria" && s.pendencia_prazo) {
    const r = diasEntre(hoje, s.pendencia_prazo);
    if (r < 0) return { texto: `imob. atrasada ${-r} dia(s)`, nivel: "vermelho" };
    return { texto: `imob. responde em ${r} dia(s)`, nivel: r <= 2 ? "laranja" : null };
  }
  if (s.etapa === "na_seguradora") {
    if (!s.documentacao_completa_em && s.origem === "corp") return { texto: `aviso em ${formatarData(s.data_abertura_seguradora)}`, nivel: null };
    if (!s.documentacao_completa_em) return { texto: "doc. incompleta na seguradora", nivel: "laranja" };
    const d = diasEntre(s.documentacao_completa_em, hoje);
    return { texto: `seguradora dia ${d}/${PRAZO_SEGURADORA_DIAS}`, nivel: d > PRAZO_SEGURADORA_DIAS ? "vermelho" : null };
  }
  return { texto: "", nivel: null };
}

function Fila({ sinistros }: { sinistros: any[] }) {
  const ativos = sinistros.filter((s) => COLUNAS.includes(s.etapa));
  const alertas = ativos.map((s) => ({ s, a: alertaDo(s) }));
  const preAtrasada = alertas.filter(({ s, a }) => s.etapa === "pre_analise" && a.nivel === "vermelho").length;
  const pendAtrasada = alertas.filter(({ s, a }) => s.etapa === "pendencia_imobiliaria" && a.nivel === "vermelho").length;
  const segAtrasada = alertas.filter(({ s, a }) => s.etapa === "na_seguradora" && a.nivel === "vermelho").length;
  const foraPrazo = ativos.filter((s) => s.aviso_fora_prazo).length;
  const rascunhos = sinistros.filter((s) => s.etapa === "rascunho");
  const encerrados = sinistros.filter((s) => s.etapa === "encerrado" || s.etapa === "cancelado");
  const hoje = hojeSP();
  // Agenda de próxima ação da equipe O2 (inclui rascunhos abertos pela O2).
  const agenda = sinistros
    .filter((s) => s.etapa !== "encerrado" && s.etapa !== "cancelado" && (s.proxima_acao_em || s.proxima_acao_descricao))
    .sort((x, y) => (x.proxima_acao_em ?? "9999").localeCompare(y.proxima_acao_em ?? "9999"));
  const acoesVencidas = agenda.filter((s) => s.proxima_acao_em && s.proxima_acao_em <= hoje).length;
  const semAgenda = [...ativos, ...rascunhos].filter((s) => !s.proxima_acao_em && !s.proxima_acao_descricao).length;

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Agenda de próximas ações</h2>
          <p className="text-xs text-gray-500">
            <span className={acoesVencidas ? "font-semibold text-red-700" : ""}>{acoesVencidas} para hoje ou atrasada(s)</span> · {semAgenda} em andamento sem
            próxima ação
          </p>
        </div>
        {agenda.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-300 bg-white p-4 text-center text-xs text-gray-500">
            Nenhuma próxima ação agendada. Abra um sinistro e preencha o quadro &quot;Próxima ação&quot;.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2">Quando</th>
                  <th className="px-3 py-2">O que fazer</th>
                  <th className="px-3 py-2">Sinistro</th>
                  <th className="px-3 py-2">Etapa</th>
                  <th className="px-3 py-2">Responsável</th>
                </tr>
              </thead>
              <tbody>
                {agenda.map((s) => {
                  const quando: string | null = s.proxima_acao_em;
                  const atrasada = !!quando && quando < hoje;
                  const ehHoje = quando === hoje;
                  return (
                    <tr key={s.id} className={`border-t border-gray-100 ${atrasada ? "bg-red-50" : ehHoje ? "bg-orange-50" : ""}`}>
                      <td className={`whitespace-nowrap px-3 py-2 text-xs ${atrasada ? "font-semibold text-red-700" : ehHoje ? "font-semibold text-orange-800" : "text-o2-navy"}`}>
                        {quando ? formatarData(quando) : "sem data"}
                        {atrasada && <span className="ml-1">({diasEntre(quando!, hoje)}d atrasada)</span>}
                        {ehHoje && <span className="ml-1">(hoje)</span>}
                      </td>
                      <td className="px-3 py-2 text-xs">{s.proxima_acao_descricao || "—"}</td>
                      <td className="px-3 py-2 text-xs">
                        <Link href={`/sinistros/${s.id}`} className="font-semibold text-o2-navy hover:underline">
                          {s.locatario_nome || s.locador_nome || "Locatário não informado"}
                        </Link>
                        <span className="text-gray-500"> · SIN-{s.codigo} · {s.imobiliarias?.apelido || s.imobiliarias?.nome || "imob. não definida"}</span>
                      </td>
                      <td className="px-3 py-2">
                        <EtiquetaEtapa etapa={s.etapa} visao="o2" />
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-600">{(s.proxima_acao_responsavel || s.responsavel_o2 || "—").split("@")[0]}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid gap-3 sm:grid-cols-4">
        <Contador titulo="Pré-análise atrasada" valor={preAtrasada} perigo subtitulo={`SLA ${SLA_PRE_ANALISE_DIAS_UTEIS} dia útil`} />
        <Contador titulo="Pendência vencida" valor={pendAtrasada} perigo subtitulo="imobiliária passou dos 5 dias" />
        <Contador titulo="Seguradora > 30 dias" valor={segAtrasada} perigo subtitulo="desde a doc. completa" />
        <Contador titulo="Avisos fora do prazo" valor={foraPrazo} subtitulo="em andamento" />
      </div>

      <div className="grid gap-3 lg:grid-cols-5">
        {COLUNAS.map((etapa) => {
          const lista = alertas
            .filter(({ s }) => s.etapa === etapa)
            .sort((x, y) => (x.a.nivel === "vermelho" ? -1 : 0) - (y.a.nivel === "vermelho" ? -1 : 0));
          return (
            <div key={etapa} className="max-h-[75vh] overflow-y-auto rounded-xl bg-gray-100 p-2">
              <p className="mb-2 px-1 text-xs font-semibold text-o2-navy">
                {ETAPAS[etapa].titulo} ({lista.length})
              </p>
              <div className="space-y-2">
                {lista.map(({ s, a }) => (
                  <Link
                    key={s.id}
                    href={`/sinistros/${s.id}`}
                    className={`block rounded-lg border-l-4 bg-white p-2 text-xs shadow-sm hover:shadow ${
                      a.nivel === "vermelho" ? "border-red-600" : a.nivel === "laranja" ? "border-o2-coral" : "border-o2-blue"
                    }`}
                  >
                    <p className="font-semibold text-o2-navy">{s.locatario_nome || s.locador_nome || "Locatário não informado"}</p>
                    <p className="text-gray-500">{s.imobiliarias?.apelido || s.imobiliarias?.nome}</p>
                    <p className="text-gray-500">
                      {rotuloProduto(s.produto)} · {s.seguradora || "seguradora?"}
                      {s.produto === "fianca" && s.tipo ? ` · ${tituloTipo(s.tipo).split(" — ")[0]}` : ""}
                      {s.origem === "corp" && <span className="ml-1 rounded bg-gray-200 px-1 text-[10px] text-gray-600">Corp</span>}
                    </p>
                    {a.texto && <p className={a.nivel === "vermelho" ? "font-semibold text-red-700" : a.nivel === "laranja" ? "font-semibold text-orange-700" : "text-gray-500"}>{a.texto}</p>}
                    {s.proxima_acao_em && (
                      <p className={s.proxima_acao_em < hoje ? "font-semibold text-red-700" : s.proxima_acao_em === hoje ? "font-semibold text-orange-700" : "text-o2-blue"}>
                        ▸ {formatarData(s.proxima_acao_em)} {s.proxima_acao_descricao ?? ""}
                      </p>
                    )}
                    <p className="text-gray-400">{s.responsavel_o2 ? s.responsavel_o2.split("@")[0] : "sem responsável"}</p>
                  </Link>
                ))}
                {lista.length === 0 && <p className="px-1 text-xs text-gray-400">—</p>}
              </div>
            </div>
          );
        })}
      </div>

      {rascunhos.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold text-o2-navy">Rascunhos ainda não enviados ({rascunhos.length})</summary>
          <ul className="mt-2 space-y-1">
            {rascunhos.map((s) => (
              <li key={s.id}>
                <Link href={`/sinistros/${s.id}`} className="text-o2-blue hover:underline">
                  {s.locatario_nome || s.locador_nome || "Locatário não informado"}
                </Link>{" "}
                · {s.imobiliarias?.apelido || s.imobiliarias?.nome || "imob. não definida"} · prazo {formatarData(s.prazo_aviso)}
              </li>
            ))}
          </ul>
        </details>
      )}
      {encerrados.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold text-o2-navy">Encerrados / cancelados ({encerrados.length})</summary>
          <ul className="mt-2 space-y-1">
            {encerrados.map((s) => (
              <li key={s.id}>
                <Link href={`/sinistros/${s.id}`} className="text-o2-blue hover:underline">
                  {s.locatario_nome || s.locador_nome || "Locatário não informado"}
                </Link>{" "}
                · {s.imobiliarias?.apelido || s.imobiliarias?.nome} · {ETAPAS[s.etapa as EtapaSinistro].titulo}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
