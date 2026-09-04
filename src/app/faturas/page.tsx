import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../actions";
import AppHeader from "@/components/AppHeader";
import SeletorCompetencia from "./SeletorCompetencia";
import { adicionarEsperada, excluirArquivoFatura } from "./actions";
import { SEGURADORAS_CANONICAS } from "@/lib/faturasIdentificacao";
import { IconCalendar, IconChecklist, IconUpload, IconInvoice, IconReceipt, IconChevron, IconTrash } from "./icons";
import { CheckboxSelecaoLinha, LinkDuplicata, SelecionarTodas } from "./LinhaInterativa";
import { SubmitButton } from "./SubmitButton";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SEGURADORAS_PADRAO = SEGURADORAS_CANONICAS;

const MESES_PT = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function formatarCompetencia(competencia: string): string {
  const [anoTexto, mesTexto] = competencia.split("-");
  const mes = Number(mesTexto);
  const nomeMes = MESES_PT[mes - 1];
  return nomeMes ? `${nomeMes} de ${anoTexto}` : competencia;
}

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
  aguardando_origem: 4,
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
  aguardando_origem: "Aguardando origem (SegImob/O2)",
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
  aguardando_origem: "bg-blue-100 text-blue-800",
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
  "aguardando_origem",
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

type ImobiliariaJoin = { nome: string; cnpj: string | null; email_faturas: string | null };

type EsperadaBrutaRow = {
  id: string;
  imobiliaria_id: string | null;
  nome_provisorio: string | null;
  seguradora: string;
  dia_vencimento: number | null;
  cnpj_o2: string | null;
  observacao: string | null;
  imobiliarias: ImobiliariaJoin | ImobiliariaJoin[] | null;
};

type EsperadaSeguradoraRow = {
  id: string;
  imobiliaria_id: string | null;
  nome_provisorio: string | null;
  dia_vencimento: number | null;
  cnpj_o2: string | null;
  observacao: string | null;
};

type FaturaCompetenciaRow = {
  imobiliaria_id: string | null;
  seguradora: string | null;
  origem: string | null;
  status: string;
};

type LinhaMestre = {
  chave: string;
  imobiliaria_id: string | null;
  nome_provisorio: string | null;
  nome: string;
  cnpj: string | null;
  email_faturas: string | null;
};

// Status "prontos pra enviar" -- só esses habilitam a caixinha de seleção.
const STATUS_PRONTO_PARA_ENVIO = ["fatura_carregada", "pronta_para_envio"];

// Quantas relações imobiliária+seguradora ainda precisam de alguma ação
// (upload, conferência ou envio) em cada seguradora -- pra mostrar um
// contador na aba, sem precisar clicar em cada uma pra saber se tem algo
// pendente ali. Reaproveita a mesma lógica de "qual fatura vale" usada no
// corpo da página, só que rodada pra todas as seguradoras de uma vez.
function contarPendentesPorSeguradora(
  seguradorasList: string[],
  esperadasTodas: EsperadaBrutaRow[],
  faturasCompetencia: FaturaCompetenciaRow[],
  idsNaListaMestre: Set<string>
): Map<string, number> {
  const contagem = new Map<string, number>();
  for (const seg of seguradorasList) {
    const esperadas = esperadasTodas.filter((e) => e.seguradora === seg);
    const faturasDaSeguradora = faturasCompetencia.filter((f) => f.seguradora === seg);

    const porChaveOrigem = new Map<string, FaturaCompetenciaRow>();
    const aguardandoOrigemPorImob = new Map<string, FaturaCompetenciaRow>();
    for (const f of faturasDaSeguradora) {
      if (!f.imobiliaria_id) continue;
      if (f.status === "aguardando_origem") {
        aguardandoOrigemPorImob.set(f.imobiliaria_id, f);
        continue;
      }
      const chave = `${f.imobiliaria_id}|${f.origem ?? ""}`;
      const atual = porChaveOrigem.get(chave);
      const prioridadeNova = PRIORIDADE_STATUS[f.status] ?? 99;
      const prioridadeAtual = atual ? (PRIORIDADE_STATUS[atual.status] ?? 99) : 100;
      if (!atual || prioridadeNova < prioridadeAtual) porChaveOrigem.set(chave, f);
    }

    let pendentes = 0;
    for (const e of esperadas) {
      if (!e.imobiliaria_id) {
        pendentes++;
        continue;
      }
      const chave = `${e.imobiliaria_id}|${e.cnpj_o2 ?? ""}`;
      const fatura = porChaveOrigem.get(chave) ?? aguardandoOrigemPorImob.get(e.imobiliaria_id);
      const status = fatura ? fatura.status : "aguardando_upload";
      if (status !== "enviada" && status !== "cancelada") pendentes++;
    }
    // Faturas de imobiliárias totalmente novas (ainda sem nenhum vínculo cadastrado).
    for (const f of faturasDaSeguradora) {
      if (f.imobiliaria_id && f.status !== "cancelada" && !idsNaListaMestre.has(f.imobiliaria_id)) pendentes++;
    }

    contagem.set(seg, pendentes);
  }
  return contagem;
}

function chaveDe(imobiliariaId: string | null, nomeProvisorio: string | null): string {
  return imobiliariaId ?? `prov:${nomeProvisorio}`;
}

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

  const [{ data: esperadasTodasData }, { data: faturasCompetenciaData }, { data: pendentesData }] =
    await Promise.all([
      // TODAS as relações imobiliária+seguradora ativas, de todas as
      // seguradoras -- serve tanto pra montar a lista mestre (congelada à
      // esquerda ao trocar de aba) quanto pros dados da seguradora
      // selecionada e pro contador de pendentes de cada aba.
      supabase
        .from("faturas_esperadas")
        .select("id, imobiliaria_id, nome_provisorio, seguradora, dia_vencimento, cnpj_o2, observacao, imobiliarias(nome, cnpj, email_faturas)")
        .eq("ativo", true),
      // Faturas dessa competência em TODAS as seguradoras -- idem, serve
      // pra tela detalhada da seguradora selecionada e pro contador das abas.
      supabase
        .from("faturas")
        .select("id, imobiliaria_id, valor, vencimento, status, arquivo_nome, arquivo_bucket_path, tipo_documento, origem, seguradora")
        .eq("competencia", competencia),
      supabase
        .from("faturas")
        .select("status")
        .in("status", ["aguardando_identificacao", "aguardando_conferencia", "aguardando_origem"]),
    ]);

  const esperadasTodas = (esperadasTodasData ?? []) as EsperadaBrutaRow[];
  const esperadasSeguradoraData = esperadasTodas.filter((e) => e.seguradora === seguradora);
  const faturasCompetencia = (faturasCompetenciaData ?? []) as FaturaCompetenciaRow[];
  const faturasData = (faturasCompetenciaData ?? []).filter((f) => f.seguradora === seguradora);

  // Dedup pra lista mestre -- uma imobiliária pode ter várias linhas em
  // faturas_esperadas (uma por seguradora), aqui só interessa 1 por
  // imobiliária/provisório, ordenada por nome.
  const mestrePorChave = new Map<string, LinhaMestre>();
  for (const e of esperadasTodas) {
    const imob = Array.isArray(e.imobiliarias) ? e.imobiliarias[0] : e.imobiliarias;
    const chave = chaveDe(e.imobiliaria_id, e.nome_provisorio);
    if (!mestrePorChave.has(chave)) {
      mestrePorChave.set(chave, {
        chave,
        imobiliaria_id: e.imobiliaria_id,
        nome_provisorio: e.nome_provisorio,
        nome: imob?.nome ?? e.nome_provisorio ?? "—",
        cnpj: imob?.cnpj ?? null,
        email_faturas: imob?.email_faturas ?? null,
      });
    }
  }
  const listaMestre = Array.from(mestrePorChave.values()).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const idsNaListaMestre = new Set(listaMestre.map((m) => m.imobiliaria_id).filter(Boolean));

  const pendentesPorSeguradora = contarPendentesPorSeguradora(
    seguradoras,
    esperadasTodas,
    faturasCompetencia,
    idsNaListaMestre as Set<string>
  );

  // Uma imobiliária pode ter mais de 1 relação com a MESMA seguradora --
  // ex: Tokio via O2 Seguros e via SegImob, cada uma com vencimento
  // próprio -- por isso é uma lista, não um valor único.
  const esperadaSeguradoraPorChave = new Map<string, EsperadaSeguradoraRow[]>();
  for (const e of esperadasSeguradoraData as EsperadaSeguradoraRow[]) {
    const chave = chaveDe(e.imobiliaria_id, e.nome_provisorio);
    const lista = esperadaSeguradoraPorChave.get(chave) ?? [];
    lista.push(e);
    esperadaSeguradoraPorChave.set(chave, lista);
  }

  // Uma fatura só sabe a qual ORIGEM pertence depois de resolvida (ver
  // status aguardando_origem) -- por isso duas estruturas: uma por
  // imobiliária+origem exata, outra pra quem ainda não foi respondida (fica
  // "flutuando" em todas as linhas de origem daquela imobiliária até
  // alguém escolher na Conferência).
  const faturasPorImobiliariaOrigem = new Map<string, NonNullable<typeof faturasData>[number]>();
  const faturasAguardandoOrigemPorImobiliaria = new Map<string, NonNullable<typeof faturasData>[number]>();
  const duplicatasPorImobiliaria = new Map<string, { qtd: number; primeiraId: string }>();
  // Todos os arquivos vivos (não duplicada/cancelada) por imobiliária+origem
  // -- pra mostrar os ícones de download de boleto/fatura por linha, sem
  // depender de qual dos dois "venceu" a prioridade de status acima.
  const arquivosPorImobiliariaOrigem = new Map<string, NonNullable<typeof faturasData>>();
  const STATUS_ARQUIVO_VISIVEL = ["aguardando_conferencia", "aguardando_origem", "fatura_carregada", "pronta_para_envio", "enviada"];
  for (const f of faturasData ?? []) {
    if (!f.imobiliaria_id) continue;
    if (f.status === "duplicada") {
      const atual = duplicatasPorImobiliaria.get(f.imobiliaria_id);
      duplicatasPorImobiliaria.set(f.imobiliaria_id, {
        qtd: (atual?.qtd ?? 0) + 1,
        primeiraId: atual?.primeiraId ?? f.id,
      });
    }
    if (STATUS_ARQUIVO_VISIVEL.includes(f.status)) {
      const chaveArquivo = `${f.imobiliaria_id}|${f.status === "aguardando_origem" ? "" : f.origem ?? ""}`;
      const lista = arquivosPorImobiliariaOrigem.get(chaveArquivo) ?? [];
      lista.push(f);
      arquivosPorImobiliariaOrigem.set(chaveArquivo, lista);
    }
    if (f.status === "aguardando_origem") {
      faturasAguardandoOrigemPorImobiliaria.set(f.imobiliaria_id, f);
      continue;
    }
    const chave = `${f.imobiliaria_id}|${f.origem ?? ""}`;
    const atual = faturasPorImobiliariaOrigem.get(chave);
    const prioridadeNova = PRIORIDADE_STATUS[f.status] ?? 99;
    const prioridadeAtual = atual ? (PRIORIDADE_STATUS[atual.status] ?? 99) : 100;
    // Em empate de status (ex: boleto e demonstrativo os dois
    // fatura_carregada), o boleto é quem manda no vencimento/valor
    // exibido -- o demonstrativo é só o anexo de apoio.
    const empateFavoreceBoleto = prioridadeNova === prioridadeAtual && f.tipo_documento === "boleto" && atual?.tipo_documento !== "boleto";
    if (!atual || prioridadeNova < prioridadeAtual || empateFavoreceBoleto) {
      faturasPorImobiliariaOrigem.set(chave, f);
    }
  }
  const pendentes = pendentesData?.length ?? 0;

  // Fatura dessa linha específica (imobiliária + origem daquela relação) --
  // prioriza o match exato de origem; se ainda não tiver origem definida
  // (aguardando_origem), aparece em todas as linhas de origem dessa
  // imobiliária até ser resolvida.
  function faturaDaLinha(m: LinhaMestre, esperada: EsperadaSeguradoraRow) {
    if (!m.imobiliaria_id) return undefined;
    const chave = `${m.imobiliaria_id}|${esperada.cnpj_o2 ?? ""}`;
    return faturasPorImobiliariaOrigem.get(chave) ?? faturasAguardandoOrigemPorImobiliaria.get(m.imobiliaria_id);
  }

  // Arquivos vivos dessa linha específica -- separa por tipo_documento pra
  // mostrar 2 ícones (Boleto / Fatura) em vez de uma lista genérica.
  function arquivosDaLinha(m: LinhaMestre, esperada: EsperadaSeguradoraRow) {
    if (!m.imobiliaria_id) return [];
    const chave = `${m.imobiliaria_id}|${esperada.cnpj_o2 ?? ""}`;
    const proprios = arquivosPorImobiliariaOrigem.get(chave) ?? [];
    const flutuantes = arquivosPorImobiliariaOrigem.get(`${m.imobiliaria_id}|`) ?? [];
    return esperada.cnpj_o2 ? [...proprios, ...flutuantes.filter((f) => f.status === "aguardando_origem")] : proprios;
  }

  // Expande 1 linha por RELAÇÃO (imobiliária + origem), não por
  // imobiliária -- uma mesma imobiliária pode ter 2 linhas na mesma
  // seguradora (ex: Tokio via O2 Seguros e via SegImob), cada uma com seu
  // próprio vencimento/origem/observação/status.
  type LinhaExibicao = {
    m: LinhaMestre;
    esperada: EsperadaSeguradoraRow;
    fatura: NonNullable<typeof faturasData>[number] | undefined;
    statusChave: string;
    arquivos: NonNullable<typeof faturasData>;
  };
  const buscaNormalizada = busca.toLowerCase();
  const linhasExpandidas: LinhaExibicao[] = [];
  for (const m of listaMestre) {
    const esperadas = esperadaSeguradoraPorChave.get(m.chave);
    if (!esperadas) continue;
    if (buscaNormalizada && !m.nome.toLowerCase().includes(buscaNormalizada)) continue;
    for (const esperada of esperadas) {
      const fatura = faturaDaLinha(m, esperada);
      const statusChave = fatura ? fatura.status : "aguardando_upload";
      if (statusFiltro && statusChave !== statusFiltro) continue;
      linhasExpandidas.push({ m, esperada, fatura, statusChave, arquivos: arquivosDaLinha(m, esperada) });
    }
  }

  // Quem precisa de alguma ação (upload, conferência, envio) sobe pro
  // topo; quem já foi enviado desce pro final -- dentro de cada grupo
  // mantém a ordem alfabética.
  const PRIORIDADE_EXIBICAO: Record<string, number> = { enviada: 5, cancelada: 6 };
  const linhasOrdenadas = [...linhasExpandidas].sort(
    (a, b) => (PRIORIDADE_EXIBICAO[a.statusChave] ?? 0) - (PRIORIDADE_EXIBICAO[b.statusChave] ?? 0)
  );

  const totalLinhas = linhasOrdenadas.length;
  const linhas = linhasOrdenadas.slice(0, limite);
  const prontasParaEnvio = linhas.filter(
    ({ m, statusChave }) => STATUS_PRONTO_PARA_ENVIO.includes(statusChave) && m.email_faturas
  );

  // Link de download por arquivo -- só pra quem está sendo exibido nessa
  // página (não vale a pena gerar link assinado pra tudo, só pro que o
  // usuário está vendo agora), pra conferir visualmente que o arquivo
  // certo está na imobiliária certa.
  const caminhosNaPagina = Array.from(
    new Set(linhas.flatMap((l) => l.arquivos.map((a) => a.arquivo_bucket_path)))
  );
  const urlPorCaminho = new Map<string, string>();
  if (caminhosNaPagina.length) {
    const { data: assinados } = await supabase.storage.from("faturas").createSignedUrls(caminhosNaPagina, 300);
    for (const item of assinados ?? []) {
      if (item.signedUrl && item.path) urlPorCaminho.set(item.path, item.signedUrl);
    }
  }

  // Faturas carregadas nessa seguradora/competência mas cuja imobiliária
  // ainda não está na lista mestre (parceiro totalmente novo) — mostra
  // também, marcado.
  const extras = (faturasData ?? []).filter(
    (f) => f.imobiliaria_id && f.status !== "cancelada" && !idsNaListaMestre.has(f.imobiliaria_id)
  );
  const temPendenteCnpj = linhas.some((l) => !l.m.imobiliaria_id && !!l.m.nome_provisorio);

  // Agrupa as linhas por imobiliária pra exibição em cartão -- nome/CNPJ
  // aparecem 1x no cabeçalho do cartão mesmo quando a imobiliária tem mais
  // de 1 relação nessa seguradora (multi-origem, ex: Tokio via O2 Seguros e
  // via SegImob). A posição do cartão na lista segue a da sua 1ª linha, que
  // já vem ordenada por prioridade (pendente sobe, enviada desce).
  //
  // Alguns pares/trios de CNPJ são a MESMA empresa de verdade (confirmado
  // manualmente durante a conciliação -- CNPJ antigo com fatura ainda
  // vigente + CNPJ novo com produção nova, ou pessoa física + jurídica da
  // mesma pessoa) mas continuam sendo 2+ registros DISTINTOS em
  // `imobiliarias` de propósito (cada um com seu e-mail/vencimento, e o
  // envio de fatura é por CNPJ) -- só a exibição aqui agrupa num cartão só,
  // pra não parecer duplicidade na lista. GRUPOS_VISUAIS mapeia cnpj ->
  // chave do grupo; nada disso afeta banco, e-mail ou envio.
  const GRUPOS_VISUAIS: Record<string, string> = {
    "37460218000139": "visual:ACESSE_RJ",
    "02038854000192": "visual:ACESSE_RJ",
  };
  function chaveVisual(m: LinhaMestre): string {
    const cnpj = m.cnpj?.trim();
    return (cnpj && GRUPOS_VISUAIS[cnpj]) || m.chave;
  }
  type GrupoImobiliaria = { m: LinhaMestre; pendenteCnpj: boolean; linhas: typeof linhas };
  const gruposPorChave = new Map<string, GrupoImobiliaria>();
  const grupos: GrupoImobiliaria[] = [];
  for (const linha of linhas) {
    const chave = chaveVisual(linha.m);
    let grupo = gruposPorChave.get(chave);
    if (!grupo) {
      grupo = { m: linha.m, pendenteCnpj: !linha.m.imobiliaria_id && !!linha.m.nome_provisorio, linhas: [] };
      gruposPorChave.set(chave, grupo);
      grupos.push(grupo);
    }
    grupo.linhas.push(linha);
  }

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-[1400px] flex-1 space-y-6 p-8">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-o2-coral to-orange-400 text-white shadow-sm">
            <IconInvoice />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-o2-navy">Faturas mensais</h1>
            <p className="text-sm text-gray-500">
              Boletos de seguradora recebidos para reenvio às imobiliárias — uso interno O2.
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
                <p className="text-xs font-semibold uppercase tracking-wide text-white/60">
                  Mês que você está vendo/fechando
                </p>
                <p className="mb-1 text-lg font-semibold text-white">{formatarCompetencia(competencia)}</p>
                <SeletorCompetencia competencia={competencia} />
                <p className="mt-1 text-xs text-white/50">
                  Refere-se ao mês de vencimento da fatura, não ao mês de upload.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {pendentes > 0 && (
                <Link
                  href="/faturas/conferencia"
                  className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-white/30 bg-white/10 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-white/20"
                >
                  <IconChecklist className="h-4 w-4" />
                  Conferência ({pendentes})
                </Link>
              )}
              <Link
                href="/faturas/upload"
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-white px-4 py-1.5 text-sm font-medium text-o2-navy shadow-sm transition hover:bg-white/90"
              >
                <IconUpload className="h-4 w-4" />
                Carregar fatura
              </Link>
            </div>
          </div>
        </div>

        {ok && <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-700">{ok}</p>}
        {aviso && (
          <p className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">{aviso}</p>
        )}
        {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

        <div className="flex flex-wrap gap-1.5 rounded-full bg-o2-gray/60 p-1.5">
          {seguradoras.map((s) => {
            const pendentesAba = pendentesPorSeguradora.get(s) ?? 0;
            return (
              <Link
                key={s}
                href={`/faturas?competencia=${competencia}&seguradora=${encodeURIComponent(s)}`}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                  s === seguradora
                    ? "bg-o2-navy text-white shadow-sm"
                    : "text-gray-600 hover:bg-white/70 hover:text-o2-navy"
                }`}
              >
                {s}
                {pendentesAba > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ${
                      s === seguradora ? "bg-o2-coral text-white" : "bg-o2-navy/10 text-o2-navy"
                    }`}
                  >
                    {pendentesAba}
                  </span>
                )}
              </Link>
            );
          })}
        </div>

        {(pendentesPorSeguradora.get(seguradora) ?? 0) === 0 && (
          <p className="rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
            ✅ Tudo em dia em {seguradora} nesse mês — nenhuma fatura pendente de upload, conferência ou envio.
          </p>
        )}

        <form
          className="flex flex-wrap items-end gap-2 rounded-xl border border-o2-navy/10 bg-white p-3 shadow-sm"
          action="/faturas"
        >
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
            <label className="mb-0.5 block text-xs text-gray-500">Situação em {seguradora}</label>
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
          <SubmitButton
            className="rounded-full border border-o2-navy px-4 py-1.5 text-sm font-medium text-o2-navy transition hover:bg-o2-navy hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            textoCarregando="Filtrando..."
          >
            Filtrar
          </SubmitButton>
          {(busca || statusFiltro) && (
            <Link
              href={`/faturas?competencia=${competencia}&seguradora=${encodeURIComponent(seguradora)}`}
              className="text-sm text-gray-500 hover:text-o2-navy hover:underline"
            >
              Limpar filtro
            </Link>
          )}
        </form>

        <form action="/faturas/enviar/confirmar" className="space-y-2">
          <input type="hidden" name="seguradora" value={seguradora} />
          <input type="hidden" name="competencia" value={competencia} />
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              {prontasParaEnvio.length > 0
                ? `${prontasParaEnvio.length} pronta(s) pra envio em ${seguradora} (já marcadas abaixo).`
                : `Nenhuma pronta pra envio em ${seguradora} no momento.`}
            </p>
            <div className="flex items-center gap-3">
              {prontasParaEnvio.length > 1 && <SelecionarTodas />}
              <label className="flex items-center gap-1.5 text-xs text-gray-600">
                <input type="checkbox" name="modo_teste" value="1" />
                Modo teste — manda tudo só pro meu e-mail
              </label>
              <SubmitButton
                disabled={!prontasParaEnvio.length}
                className="whitespace-nowrap rounded-full bg-o2-navy px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                textoCarregando="Abrindo prévia..."
              >
                Enviar selecionadas
              </SubmitButton>
            </div>
          </div>
          {temPendenteCnpj && (
            <p className="flex items-center gap-1.5 text-xs text-gray-500">
              <span className="inline-block h-3 w-3 rounded-sm bg-orange-50 ring-1 ring-orange-200" />
              Cartão destacado = imobiliária ainda sem CNPJ/CPF vinculado (abra e clique em &quot;Editar&quot; pra completar)
            </p>
          )}
          <div className="space-y-2">
            {grupos.map((grupo) => {
              const { m, pendenteCnpj } = grupo;
              // Um grupo visual (GRUPOS_VISUAIS) pode juntar linhas de MAIS
              // DE 1 imobiliária/CNPJ debaixo do mesmo cartão -- por isso
              // cada linha usa o `m` DELA (linha.m), nunca o `m` do grupo
              // (que é só a 1ª linha encontrada), pra checkbox/e-mail/editar
              // nunca apontar pra imobiliária errada.
              const distintos = Array.from(new Map(grupo.linhas.map((l) => [l.m.chave, l.m])).values());
              const multiplasImobs = distintos.length > 1;
              return (
                <div
                  key={m.chave}
                  className={`overflow-hidden rounded border ${
                    pendenteCnpj ? "border-orange-300 bg-orange-50/40" : "border-gray-300 bg-white"
                  }`}
                >
                  <div className="border-b border-gray-300 bg-gray-100 px-3 py-1.5">
                    {multiplasImobs ? (
                      <div className="space-y-0.5">
                        {distintos.map((mi) => (
                          <div key={mi.chave} className="flex flex-wrap items-baseline gap-x-3">
                            <span className="text-sm font-semibold text-gray-800">{mi.nome}</span>
                            <span className="font-mono text-[11px] text-gray-500">{mi.cnpj ?? "CNPJ/CPF não vinculado"}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                        <span className="text-sm font-semibold text-gray-800">{m.nome}</span>
                        <span className="font-mono text-[11px] text-gray-500">{m.cnpj ?? "CNPJ/CPF não vinculado"}</span>
                      </div>
                    )}
                  </div>
                  <div className="divide-y divide-gray-200">
                    {grupo.linhas.map(({ m: linhaM, esperada, fatura, statusChave, arquivos }) => {
                      const boleto = arquivos.find((a) => a.tipo_documento === "boleto");
                      const demonstrativo = arquivos.find((a) => a.tipo_documento === "demonstrativo");
                      const voltarParaAqui = `&competencia=${competencia}&seguradora=${encodeURIComponent(seguradora)}`;
                      const pronta = STATUS_PRONTO_PARA_ENVIO.includes(statusChave);
                      const duplicata = linhaM.imobiliaria_id ? duplicatasPorImobiliaria.get(linhaM.imobiliaria_id) : undefined;
                      const editarHref = linhaM.imobiliaria_id
                        ? `/faturas/imobiliaria/${linhaM.imobiliaria_id}`
                        : `/faturas/imobiliaria/novo?nome=${encodeURIComponent(linhaM.nome_provisorio ?? "")}`;
                      return (
                        <details key={esperada.id} className="group/linha">
                          <summary className="grid cursor-pointer list-none grid-cols-[22px_92px_1fr_auto_20px] items-stretch text-xs hover:bg-[#e8f0fe] [&::-webkit-details-marker]:hidden">
                            <span className="flex items-center justify-center border-r border-gray-200 py-1.5">
                              {pronta && linhaM.imobiliaria_id && linhaM.email_faturas ? (
                                <CheckboxSelecaoLinha imobiliariaId={linhaM.imobiliaria_id} />
                              ) : pronta && linhaM.imobiliaria_id && !linhaM.email_faturas ? (
                                <span title="Sem e-mail cadastrado — edite a imobiliária" className="text-red-500">
                                  ⚠
                                </span>
                              ) : null}
                            </span>
                            <span className="flex flex-col justify-center border-r border-gray-200 px-2 py-1 font-mono text-gray-600">
                              <span>{esperada.cnpj_o2 || "—"}</span>
                              {multiplasImobs && <span className="text-[10px] text-gray-400">{linhaM.cnpj}</span>}
                            </span>
                            <span className="flex items-center gap-2 border-r border-gray-200 px-2 py-1.5">
                              {fatura ? (
                                <span className={`rounded-sm px-2 py-0.5 text-[11px] font-medium ${COR_STATUS[fatura.status] ?? "bg-gray-100 text-gray-700"}`}>
                                  {ROTULO_STATUS[fatura.status] ?? fatura.status}
                                </span>
                              ) : (
                                <span className="rounded-sm bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
                                  Imob com fatura aberta
                                </span>
                              )}
                            </span>
                            <span className="flex items-center border-r border-gray-200 px-2 py-1.5">
                              {duplicata && (
                                <LinkDuplicata
                                  href={`/faturas/conferencia#fatura-${duplicata.primeiraId}`}
                                  className="whitespace-nowrap text-[11px] font-medium text-orange-700 hover:underline"
                                >
                                  +{duplicata.qtd} possível duplicata
                                </LinkDuplicata>
                              )}
                            </span>
                            <span className="flex items-center justify-center">
                              <IconChevron className="h-3.5 w-3.5 shrink-0 text-gray-400 transition group-open/linha:rotate-180" />
                            </span>
                          </summary>
                          <div className="grid grid-cols-1 gap-px border-t border-gray-200 bg-gray-200 text-xs text-gray-700 sm:grid-cols-2">
                            <div className="bg-[#f8f9fa] px-3 py-1.5">
                              <span className="block text-[10px] uppercase tracking-wide text-gray-400">E-mail de faturas</span>
                              {linhaM.email_faturas ?? "—"}
                            </div>
                            <div className="bg-[#f8f9fa] px-3 py-1.5">
                              <span className="block text-[10px] uppercase tracking-wide text-gray-400">
                                Vencimento ({seguradora})
                              </span>
                              <span className="font-mono">{esperada.dia_vencimento ?? "—"}</span>
                            </div>
                            <div className="bg-[#f8f9fa] px-3 py-1.5 sm:col-span-2">
                              <span className="block text-[10px] uppercase tracking-wide text-gray-400">Observação</span>
                              {esperada.observacao ?? "—"}
                            </div>
                            <div className="flex items-center gap-4 bg-[#f8f9fa] px-3 py-1.5">
                              <span className="flex items-center gap-1.5">
                                <span className="text-[10px] uppercase tracking-wide text-gray-400">Boleto</span>
                                {boleto && urlPorCaminho.get(boleto.arquivo_bucket_path) ? (
                                  <>
                                    <a
                                      href={urlPorCaminho.get(boleto.arquivo_bucket_path)}
                                      target="_blank"
                                      rel="noreferrer"
                                      title={boleto.arquivo_nome}
                                      className="inline-flex text-o2-navy/70 transition hover:text-o2-coral"
                                    >
                                      <IconInvoice className="h-4 w-4" />
                                    </a>
                                    <SubmitButton
                                      formAction={excluirArquivoFatura.bind(null, boleto.id, voltarParaAqui)}
                                      className="inline-flex text-gray-300 transition hover:text-red-600"
                                      textoCarregando=""
                                      confirmarAntes={`Excluir o boleto "${boleto.arquivo_nome}"? Vai sumir da lista de envio.`}
                                    >
                                      <IconTrash className="h-3.5 w-3.5" />
                                    </SubmitButton>
                                  </>
                                ) : (
                                  <span className="text-gray-300">—</span>
                                )}
                              </span>
                              <span className="flex items-center gap-1.5">
                                <span className="text-[10px] uppercase tracking-wide text-gray-400">Fatura</span>
                                {demonstrativo && urlPorCaminho.get(demonstrativo.arquivo_bucket_path) ? (
                                  <>
                                    <a
                                      href={urlPorCaminho.get(demonstrativo.arquivo_bucket_path)}
                                      target="_blank"
                                      rel="noreferrer"
                                      title={demonstrativo.arquivo_nome}
                                      className="inline-flex text-o2-navy/70 transition hover:text-o2-coral"
                                    >
                                      <IconReceipt className="h-4 w-4" />
                                    </a>
                                    <SubmitButton
                                      formAction={excluirArquivoFatura.bind(null, demonstrativo.id, voltarParaAqui)}
                                      className="inline-flex text-gray-300 transition hover:text-red-600"
                                      textoCarregando=""
                                      confirmarAntes={`Excluir a fatura "${demonstrativo.arquivo_nome}"? Vai sumir da lista de envio.`}
                                    >
                                      <IconTrash className="h-3.5 w-3.5" />
                                    </SubmitButton>
                                  </>
                                ) : (
                                  <span className="text-gray-300">—</span>
                                )}
                              </span>
                            </div>
                            <div className="flex items-center justify-end bg-[#f8f9fa] px-3 py-1.5">
                              <Link href={editarHref} className="font-medium text-o2-navy hover:underline">
                                Editar
                              </Link>
                            </div>
                          </div>
                        </details>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {extras.map((f) => (
              <div key={f.id} className="rounded border border-amber-300 bg-amber-50/50 px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-gray-800">Parceiro novo (não cadastrado ainda) — {f.arquivo_nome}</span>
                  <span className={`rounded-sm px-2 py-0.5 text-xs font-medium ${COR_STATUS[f.status] ?? "bg-gray-100 text-gray-700"}`}>
                    {ROTULO_STATUS[f.status] ?? f.status}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-gray-500">Confirme na Conferência</p>
              </div>
            ))}

            {!linhas.length && !extras.length && (
              <p className="rounded border border-gray-300 bg-white px-3 py-8 text-center text-sm text-gray-500">
                Nenhuma imobiliária cadastrada ainda.
              </p>
            )}
          </div>
        </form>

        {totalLinhas > linhas.length && (
          <div className="text-center">
            <Link
              href={`/faturas?competencia=${competencia}&seguradora=${encodeURIComponent(seguradora)}&limite=${limite + POR_PAGINA}&busca=${encodeURIComponent(busca)}&status=${encodeURIComponent(statusFiltro)}`}
              className="text-sm font-medium text-o2-navy hover:underline"
            >
              Mostrar mais {Math.min(POR_PAGINA, totalLinhas - linhas.length)} (
              {linhas.length} de {totalLinhas})
            </Link>
          </div>
        )}

        <details className="rounded-2xl border border-o2-navy/10 bg-white p-5 shadow-sm">
          <summary className="cursor-pointer text-sm font-medium text-o2-navy">+ Adicionar imobiliária</summary>
          <p className="mt-1 text-xs text-gray-500">
            Um cadastro só, marcando quais seguradoras essa imobiliária tem — não precisa repetir
            aba por aba. Se o dia de vencimento variar entre seguradoras, ajuste depois em cada uma
            pelo &quot;Editar&quot;.
          </p>
          <form action={adicionarEsperada} className="mt-3 space-y-3">
            <input type="hidden" name="voltar_para" value={`&competencia=${competencia}&seguradora=${encodeURIComponent(seguradora)}`} />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input name="nome" placeholder="Nome da imobiliária" required className={inputClass} />
              <input name="cnpj" placeholder="CNPJ ou CPF" required className={inputClass} />
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <label className="mb-0.5 block text-xs text-gray-500">Dia de vencimento (todas as marcadas abaixo)</label>
                <input name="dia_vencimento" type="number" min={1} max={31} placeholder="Ex: 10" required className={inputClass} />
              </div>
              <div>
                <label className="mb-0.5 block text-xs text-gray-500">E-mail de faturas (opcional agora, mas necessário pra enviar)</label>
                <input name="email_faturas" type="email" placeholder="financeiro@imobiliaria.com.br" className={inputClass} />
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              {seguradoras.map((s) => (
                <label key={s} className="flex items-center gap-1.5 text-xs text-gray-700">
                  <input type="checkbox" name="seguradoras" value={s} defaultChecked={s === seguradora} />
                  {s}
                </label>
              ))}
            </div>
            <SubmitButton
              className="rounded-full bg-o2-coral px-4 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              textoCarregando="Salvando..."
            >
              Adicionar
            </SubmitButton>
          </form>
        </details>
      </main>
    </>
  );
}
