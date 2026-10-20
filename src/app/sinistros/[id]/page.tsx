import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import SubmitButton from "@/components/SubmitButton";
import { IconShield } from "@/components/icons";
import {
  COBERTURAS,
  ETAPAS,
  PRAZO_SEGURADORA_DIAS,
  SLA_PRE_ANALISE_DIAS_UTEIS,
  TEXTO_CIENCIA,
  tituloTipo,
  calcularPrazoAviso,
  diasEntre,
  diasUteisDesde,
  formatarData,
  formatarReais,
  hojeSP,
  montarChecklist,
  validarEnvio,
  type Debito,
  type EtapaSinistro,
} from "@/lib/sinistros/regras";
import { signOut } from "../../actions";
import {
  assumirSinistro,
  cancelarRascunho,
  cancelarSinistroO2,
  devolverComPendencia,
  enviarSinistro,
  marcarAbertoNaSeguradora,
  salvarContrato,
  salvarProximaAcao,
} from "../actions";
import FormContrato from "../FormContrato";
import Abas from "../Abas";
import Passos from "../Passos";
import { Aviso, EtiquetaEtapa, botaoPrimario, botaoSecundario, cartao, enderecoCurto, inputClass, labelClass } from "../ui";
import PassoSituacao from "./PassoSituacao";
import EditorDebitos from "./EditorDebitos";
import { ChecklistDocumentos, Historico, type Documento, type RegistroHistorico } from "./blocos";

export const dynamic = "force-dynamic";

export default async function SinistroPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ passo?: string; erro?: string; sucesso?: string; como?: string }>;
}) {
  const { id } = await params;
  const { passo: passoParam, erro, sucesso, como } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const equipeO2 = isAdmin(user.email) || isColaboradorO2(user.email);
  // "Ver como a imobiliária vê" (suporte da equipe O2): só muda a tela; as
  // ações continuam checando o perfil real no servidor.
  const comoImobiliaria = equipeO2 && como === "imobiliaria";
  const interno = equipeO2 && !comoImobiliaria;

  const { data: s } = await supabase.from("sinistros").select("*, imobiliarias(nome, apelido)").eq("id", id).maybeSingle();
  if (!s) notFound();

  const [{ data: debitos }, { data: docsBrutos }, { data: historico }] = await Promise.all([
    supabase.from("sinistro_debitos").select("*").eq("sinistro_id", id).order("ordem"),
    supabase.from("sinistro_documentos").select("*").eq("sinistro_id", id).neq("situacao", "substituido").order("enviado_em"),
    supabase.from("sinistro_historico").select("*").eq("sinistro_id", id).order("criado_em", { ascending: false }),
  ]);

  // Links temporários (1h) pros arquivos do bucket privado.
  const docs: Documento[] = docsBrutos ?? [];
  if (docs.length) {
    const { data: urls } = await supabase.storage.from("sinistros").createSignedUrls(
      docs.map((d) => (d as unknown as { arquivo_path: string }).arquivo_path),
      3600
    );
    docs.forEach((d, i) => (d.url = urls?.[i]?.signedUrl ?? null));
  }

  // Equipe O2 pode definir/trocar a imobiliária no passo 1.
  let imobiliarias: { id: string; nome: string }[] | undefined;
  if (interno && s.etapa === "rascunho") {
    const { data } = await supabase.from("imobiliarias").select("id, nome, apelido").order("nome");
    imobiliarias = (data ?? []).map((i) => ({ id: i.id, nome: i.apelido ? `${i.nome} (${i.apelido})` : i.nome }));
  }

  const etapa = s.etapa as EtapaSinistro;
  const imobNome = s.imobiliarias?.apelido || s.imobiliarias?.nome || (s.imobiliaria_id ? "Imobiliária" : "Imobiliária não definida");
  const checklist = montarChecklist(s);
  const listaDebitos = (debitos ?? []) as Debito[];

  const modoAssistente = etapa === "rascunho" || (etapa === "pendencia_imobiliaria" && !interno);
  const passoPadrao = etapa === "pendencia_imobiliaria" ? 4 : 2;
  const passo = Math.min(5, Math.max(1, Number(passoParam) || passoPadrao));

  return (
    <>
      <AppHeader userEmail={user.email} logoutAction={signOut} />
      <main className="mx-auto max-w-5xl flex-1 space-y-6 p-8">
        <Abas atual="ficha" interno={interno} />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <PageHeader
            icon={<IconShield />}
            titulo={s.locatario_nome || "Locatário não informado"}
            subtitulo={
              <>
                SIN-{s.codigo} · {tituloTipo(s.tipo)} · {s.seguradora || "seguradora não informada"}
                {interno && <> · {imobNome}</>}
              </>
            }
          />
          <EtiquetaEtapa etapa={etapa} visao={interno ? "o2" : "imobiliaria"} />
        </div>

        {comoImobiliaria && (
          <Aviso tipo="info">
            Você está vendo esta tela como a imobiliária vê.{" "}
            <Link href={`/sinistros/${id}`} className="font-semibold underline">
              Voltar à visão O2
            </Link>
          </Aviso>
        )}
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {sucesso && <Aviso tipo="sucesso">{sucesso}</Aviso>}

        {interno && modoAssistente && <ProximaAcao s={s} />}

        {modoAssistente ? (
          <Assistente s={s} passo={passo} debitos={listaDebitos} docs={docs} checklist={checklist} historico={historico ?? []} imobiliarias={imobiliarias} />
        ) : interno ? (
          <VisaoO2 s={s} debitos={listaDebitos} docs={docs} checklist={checklist} historico={historico ?? []} />
        ) : (
          <VisaoImobiliaria s={s} debitos={listaDebitos} docs={docs} checklist={checklist} historico={historico ?? []} />
        )}
      </main>
    </>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any -- linha do Supabase sem tipos gerados */
type Props = {
  s: any;
  debitos: Debito[];
  docs: Documento[];
  checklist: ReturnType<typeof montarChecklist>;
  historico: RegistroHistorico[];
};

// ---------- Assistente (rascunho / pendência) ----------

function Assistente({ s, passo, debitos, docs, checklist, historico, imobiliarias }: Props & { passo: number; imobiliarias?: { id: string; nome: string }[] }) {
  const pendencia = s.etapa === "pendencia_imobiliaria";
  const ultimaPendencia = historico.find((h) => h.texto.startsWith("Pendência para a imobiliária"));
  return (
    <div className="space-y-6">
      {pendencia && (
        <Aviso tipo="alerta">
          <p className="font-semibold">A O2 pediu ajustes — responda até {formatarData(s.pendencia_prazo)}.</p>
          {ultimaPendencia && <p className="mt-1 whitespace-pre-wrap">{ultimaPendencia.texto.replace(/^Pendência para a imobiliária[^:]*:\n?/, "")}</p>}
          <p className="mt-2 text-xs">Corrija o que for preciso nos passos abaixo e, no passo 5, clique em &quot;Responder pendência&quot;.</p>
        </Aviso>
      )}
      <Passos atual={passo} id={s.id} />

      {passo === 1 && <FormContrato action={salvarContrato} dados={s} imobiliarias={imobiliarias} textoBotao="Salvar e continuar →" />}

      {passo === 2 && <PassoSituacao dados={s} />}

      {passo === 3 && (
        <EditorDebitos
          id={s.id}
          iniciais={debitos.map((d) => ({ ...d, valor: Number(d.valor), multa: Number(d.multa), acrescimos: Number(d.acrescimos) }))}
          coberturas={s.coberturas}
          editavel
        />
      )}

      {passo === 4 && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Lista montada a partir do tipo de sinistro e do que está sendo cobrado. Pode enviar PDF, foto ou planilha (até 50 MB cada). Os modelos de
            Declaração de Débitos e Procuração Ad Judicia de cada seguradora estão com a equipe de sinistro da O2.
          </p>
          <ChecklistDocumentos id={s.id} itens={checklist} documentos={docs} modo="imobiliaria" editavel passo={4} />
          <div className="flex justify-end">
            <Link href={`/sinistros/${s.id}?passo=5`} className={botaoPrimario}>
              Continuar →
            </Link>
          </div>
        </div>
      )}

      {passo === 5 && <PassoEnviar s={s} debitos={debitos} docs={docs} />}
    </div>
  );
}

function PassoEnviar({ s, debitos, docs }: { s: any; debitos: Debito[]; docs: Documento[] }) {
  const pendencia = s.etapa === "pendencia_imobiliaria";
  const validacao = validarEnvio(s, debitos, docs, true);
  const prazo = calcularPrazoAviso(s);
  // Fase de testes: nada impede o envio; o que faltar aparece como aviso e
  // vai pro histórico do sinistro.
  const bloqueiosDeOutrosPassos = validacao.bloqueios.filter((b) => !b.includes("favorecido") && !b.includes("fora do prazo"));

  return (
    <form action={enviarSinistro} className="space-y-6">
      <input type="hidden" name="id" value={s.id} />

      <section className={cartao}>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-o2-navy">Resumo</h2>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Item rotulo="Tipo" valor={tituloTipo(s.tipo)} />
          <Item rotulo="Seguradora / apólice" valor={[s.seguradora, s.numero_apolice].filter(Boolean).join(" · ")} />
          <Item rotulo="Locador" valor={s.locador_nome} />
          <Item rotulo="Imóvel" valor={enderecoCurto(s)} />
          <Item rotulo="Cobranças" valor={COBERTURAS.filter((c) => s.coberturas.includes(c.chave)).map((c) => c.titulo).join(", ") || "—"} />
          <Item rotulo="Total avisado" valor={formatarReais(debitos.reduce((t, d) => t + Number(d.valor) + Number(d.multa) + Number(d.acrescimos), 0))} />
          <Item rotulo="Prazo de aviso" valor={prazo.prazo ? `${formatarData(prazo.prazo)}${prazo.foraDoPrazo ? " (encerrado)" : ""}` : "—"} />
        </dl>
      </section>

      {bloqueiosDeOutrosPassos.length > 0 && (
        <Aviso tipo="alerta">
          <p className="font-semibold">Ainda incompleto (dá pra enviar assim mesmo — fica registrado no histórico):</p>
          <ul className="ml-5 list-disc">
            {bloqueiosDeOutrosPassos.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </Aviso>
      )}
      {validacao.alertas.length > 0 && (
        <Aviso tipo="alerta">
          <ul className="ml-5 list-disc space-y-1">
            {validacao.alertas.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
          {validacao.documentosFaltando.length > 0 && (
            <p className="mt-2 text-xs">Faltando: {validacao.documentosFaltando.map((d) => d.titulo).join(" · ")}</p>
          )}
        </Aviso>
      )}

      {prazo.foraDoPrazo && (
        <section className="space-y-1">
          <label className={labelClass}>Por que o aviso está sendo feito fora do prazo?</label>
          <textarea name="justificativa_fora_prazo" rows={2} defaultValue={s.justificativa_fora_prazo ?? ""} className={inputClass} />
        </section>
      )}

      <section className={`${cartao} space-y-3`}>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Quem recebe a indenização</h2>
        <fieldset className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="radio" name="favorecido_eh_segurado" value="sim" defaultChecked={s.favorecido_eh_segurado === true} className="accent-o2-coral" />
            O próprio locador (segurado)
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" name="favorecido_eh_segurado" value="nao" defaultChecked={s.favorecido_eh_segurado === false} className="accent-o2-coral" />
            A imobiliária ou outra pessoa
          </label>
        </fieldset>
        <p className="text-xs text-gray-500">
          Se não for o locador, a seguradora exige o contrato de administração ou a procuração ao favorecido (já pedidos no passo 4).
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo nome="favorecido_nome" rotulo="Nome do favorecido" valor={s.favorecido_nome} />
          <Campo nome="favorecido_documento" rotulo="CPF/CNPJ do favorecido" valor={s.favorecido_documento} />
          <Campo nome="favorecido_banco" rotulo="Banco" valor={s.favorecido_banco} />
          <div className="grid grid-cols-2 gap-3">
            <Campo nome="favorecido_agencia" rotulo="Agência" valor={s.favorecido_agencia} />
            <Campo nome="favorecido_conta" rotulo="Conta" valor={s.favorecido_conta} />
          </div>
        </div>
      </section>

      {!s.ciencia_aceita_em ? (
        <section className={`${cartao} space-y-3 border-orange-200 bg-orange-50`}>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Atenção às regras do sinistro</h2>
          <ol className="ml-5 list-decimal space-y-1 text-sm text-gray-800">
            {TEXTO_CIENCIA.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
          <label className="flex items-start gap-2 text-sm font-semibold text-o2-navy">
            <input type="checkbox" name="ciencia" className="mt-1 accent-o2-coral" />
            Li e estou ciente destas regras.
          </label>
        </section>
      ) : (
        <p className="text-xs text-gray-500">
          Termo de ciência aceito em {new Date(s.ciencia_aceita_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} por {s.ciencia_aceita_por}.
        </p>
      )}

      <section className="space-y-1">
        <label className={labelClass}>{pendencia ? "Mensagem para a O2 sobre os ajustes" : "Mensagem para a O2 (opcional)"}</label>
        <textarea name="mensagem" rows={2} className={inputClass} />
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {!pendencia ? (
          <button formAction={cancelarRascunho} formNoValidate className="text-sm text-red-600 hover:underline">
            Descartar rascunho
          </button>
        ) : (
          <span />
        )}
        <SubmitButton className={botaoPrimario} textoCarregando="Enviando…">
          {pendencia ? "Responder pendência" : "Enviar aviso de sinistro à O2"}
        </SubmitButton>
      </div>
    </form>
  );
}

function Campo({ nome, rotulo, valor }: { nome: string; rotulo: string; valor: string | null }) {
  return (
    <div>
      <label className={labelClass}>{rotulo}</label>
      <input name={nome} defaultValue={valor ?? ""} className={inputClass} />
    </div>
  );
}

function Item({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{rotulo}</dt>
      <dd className="text-o2-navy">{valor || "—"}</dd>
    </div>
  );
}

function Dados({ s, interno }: { s: any; interno: boolean }) {
  const prazo = calcularPrazoAviso(s);
  return (
    <section className={cartao}>
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
        <Item rotulo="Seguradora" valor={s.seguradora} />
        <Item rotulo="Apólice" valor={s.numero_apolice} />
        <Item rotulo="Vigência" valor={s.vigencia_inicio || s.vigencia_fim ? `${formatarData(s.vigencia_inicio)} a ${formatarData(s.vigencia_fim)}` : "—"} />
        <Item rotulo="Locador (segurado)" valor={[s.locador_nome, s.locador_documento].filter(Boolean).join(" · ")} />
        <Item rotulo="Locatário" valor={[s.locatario_nome, s.locatario_documento].filter(Boolean).join(" · ")} />
        <Item rotulo="Contato do locatário" valor={[s.locatario_telefone, s.locatario_email].filter(Boolean).join(" · ")} />
        <Item
          rotulo="Imóvel"
          valor={`${enderecoCurto(s)}${s.imovel_bairro ? ` — ${s.imovel_bairro}` : ""}${s.imovel_cidade ? `, ${s.imovel_cidade}/${s.imovel_uf ?? ""}` : ""}`}
        />
        {s.tipo === "ocupado" ? (
          <Item rotulo="Vencimentos em aberto" valor={`1º ${formatarData(s.data_primeiro_vencimento)} · 2º ${formatarData(s.data_segundo_vencimento)}`} />
        ) : (
          <Item
            rotulo="Entrega das chaves"
            valor={`${formatarData(s.data_entrega_chaves)}${s.locatario_assinou_documentos === false ? " · locatário NÃO assinou" : ""}`}
          />
        )}
        <Item
          rotulo="Prazo de aviso"
          valor={
            <>
              {formatarData(s.prazo_aviso ?? prazo.prazo)} · enviado {s.enviado_em ? formatarData(s.enviado_em.slice(0, 10)) : "—"}
              {s.aviso_fora_prazo && <span className="ml-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">fora do prazo</span>}
            </>
          }
        />
        <Item rotulo="Cobranças" valor={COBERTURAS.filter((c) => s.coberturas.includes(c.chave)).map((c) => c.titulo).join(", ")} />
        {s.coberturas.includes("pintura") && (
          <Item
            rotulo="Pintura na vistoria inicial"
            valor={`"pintura nova" sem ressalva: ${s.pintura_vistoria_nova ? "sim" : "não/não informado"} · assinada: ${
              s.pintura_vistoria_assinada ? "sim" : "não/não informado"
            }`}
          />
        )}
        <Item rotulo="Valor avisado" valor={formatarReais(s.valor_avisado)} />
        {s.numero_sinistro_seguradora && <Item rotulo="Nº na seguradora" valor={`${s.numero_sinistro_seguradora} · ${formatarData(s.data_abertura_seguradora)}`} />}
        {interno && (
          <Item
            rotulo="Favorecido"
            valor={[s.favorecido_nome, s.favorecido_documento, s.favorecido_banco && `${s.favorecido_banco} ag ${s.favorecido_agencia} cc ${s.favorecido_conta}`]
              .filter(Boolean)
              .join(" · ")}
          />
        )}
      </dl>
      {s.justificativa_fora_prazo && <p className="mt-3 text-sm text-orange-900">Justificativa do atraso: {s.justificativa_fora_prazo}</p>}
      {s.observacoes && <p className="mt-3 whitespace-pre-wrap text-sm text-gray-700">Observações: {s.observacoes}</p>}
    </section>
  );
}

// ---------- Imobiliária: acompanhamento ----------

function VisaoImobiliaria({ s, debitos, docs, checklist, historico }: Props) {
  const etapa = s.etapa as EtapaSinistro;
  const explicacao: Partial<Record<EtapaSinistro, string>> = {
    pre_analise: "A equipe de sinistro da O2 está conferindo os dados e os documentos antes de abrir na seguradora.",
    na_seguradora: `O sinistro foi aberto na ${s.seguradora ?? "seguradora"}. A seguradora tem até ${PRAZO_SEGURADORA_DIAS} dias, a contar da documentação completa, para dar retorno.`,
    em_indenizacao: "A seguradora começou a indenizar. Envie os boletos de cada mês enquanto o locatário estiver no imóvel.",
    acordo_judicial: "O caso está em acordo ou em cobrança judicial conduzida pela seguradora.",
    encerrado: `Sinistro encerrado${s.motivo_encerramento ? `: ${s.motivo_encerramento}` : "."}`,
    cancelado: `Cancelado${s.motivo_encerramento ? `: ${s.motivo_encerramento}` : "."}`,
  };
  return (
    <div className="space-y-6">
      <Aviso tipo="info">
        <b>{ETAPAS[etapa].tituloImobiliaria}.</b> {explicacao[etapa]}
      </Aviso>
      {(etapa === "na_seguradora" || etapa === "em_indenizacao") && (
        <Aviso tipo="alerta">
          <ul className="ml-5 list-disc">
            {TEXTO_CIENCIA.slice(0, 3).map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </Aviso>
      )}
      <Dados s={s} interno={false} />
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Andamento</h2>
        <Historico id={s.id} registros={historico} modo="imobiliaria" />
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Débitos avisados</h2>
        <EditorDebitos id={s.id} iniciais={debitos} coberturas={s.coberturas} editavel={false} />
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Documentos</h2>
        <ChecklistDocumentos id={s.id} itens={checklist} documentos={docs} modo="imobiliaria" editavel={false} />
      </section>
    </div>
  );
}

// ---------- O2: pré-análise / ficha ----------

function VisaoO2({ s, debitos, docs, checklist, historico }: Props) {
  const etapa = s.etapa as EtapaSinistro;
  const hoje = hojeSP();
  // Item com arquivo recusado conta como "recusado", não como "faltando".
  const comArquivo = new Set(docs.map((d) => d.tipo));
  const faltando = checklist.filter((c) => c.obrigatorio && !comArquivo.has(c.chave));
  const recusados = docs.filter((d) => d.situacao === "recusado");
  const emAnalise = docs.filter((d) => d.situacao === "enviado");
  const tudoAprovado = faltando.length === 0 && recusados.length === 0 && emAnalise.length === 0;
  const atrasoPre = etapa === "pre_analise" && s.pre_analise_desde ? diasUteisDesde(s.pre_analise_desde) : 0;
  const diasSeguradora = etapa === "na_seguradora" && s.documentacao_completa_em ? diasEntre(s.documentacao_completa_em, hoje) : null;
  const podeTriar = etapa === "pre_analise" || etapa === "pendencia_imobiliaria";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <form action={assumirSinistro} className="flex items-center gap-2">
          <input type="hidden" name="id" value={s.id} />
          <span className="text-gray-500">Responsável:</span>
          <input name="responsavel" defaultValue={s.responsavel_o2 ?? ""} placeholder="e-mail @o2seguros" className="w-56 rounded border border-gray-300 px-2 py-1" />
          <SubmitButton className="rounded-full border border-o2-navy px-3 py-1 text-xs font-semibold text-o2-navy" textoCarregando="…">
            {s.responsavel_o2 ? "Trocar" : "Assumir"}
          </SubmitButton>
        </form>
        <Link href={`/sinistros/${s.id}?como=imobiliaria`} className="text-xs text-o2-blue underline">
          Ver como a imobiliária vê
        </Link>
        {etapa === "pre_analise" && atrasoPre > SLA_PRE_ANALISE_DIAS_UTEIS && (
          <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">pré-análise há {atrasoPre} dias úteis (SLA {SLA_PRE_ANALISE_DIAS_UTEIS})</span>
        )}
        {etapa === "pendencia_imobiliaria" && s.pendencia_prazo && (
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${diasEntre(hoje, s.pendencia_prazo) < 0 ? "bg-red-100 text-red-700" : "bg-orange-100 text-orange-800"}`}
          >
            imobiliária responde até {formatarData(s.pendencia_prazo)}
          </span>
        )}
        {diasSeguradora !== null && (
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${diasSeguradora > PRAZO_SEGURADORA_DIAS ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-700"}`}
          >
            seguradora: dia {diasSeguradora} de {PRAZO_SEGURADORA_DIAS}
          </span>
        )}
      </div>

      <ProximaAcao s={s} />

      <Dados s={s} interno />

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">
          Documentos <span className="font-normal normal-case text-gray-500">— {emAnalise.length} para revisar · {recusados.length} recusado(s) · {faltando.length} faltando</span>
        </h2>
        <ChecklistDocumentos id={s.id} itens={checklist} documentos={docs} modo="o2" editavel={false} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Débitos (Declaração)</h2>
        <EditorDebitos id={s.id} iniciais={debitos} coberturas={s.coberturas} editavel={false} />
      </section>

      {podeTriar && (
        <section className="grid gap-4 md:grid-cols-2">
          <form action={devolverComPendencia} className={`${cartao} space-y-2`}>
            <input type="hidden" name="id" value={s.id} />
            <h3 className="font-semibold text-o2-navy">Devolver com pendências</h3>
            <p className="text-xs text-gray-500">
              Vai para a imobiliária a lista automática: {recusados.length} recusado(s) e {faltando.length} faltando, com prazo de 5 dias. Escreva abaixo o que
              mais precisar.
            </p>
            <textarea name="mensagem" rows={3} className={inputClass} placeholder="Ex.: o valor do condomínio de setembro não bate com o boleto." />
            <SubmitButton className={botaoSecundario} textoCarregando="Devolvendo…">
              Devolver à imobiliária
            </SubmitButton>
          </form>
          <form action={marcarAbertoNaSeguradora} className={`${cartao} space-y-2`}>
            <input type="hidden" name="id" value={s.id} />
            <h3 className="font-semibold text-o2-navy">Aberto na seguradora</h3>
            {!tudoAprovado && <p className="text-xs text-orange-700">Ainda há documentos sem aprovação. Pode abrir assim mesmo se a seguradora aceitar.</p>}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelClass}>Nº do sinistro</label>
                <input name="numero_sinistro_seguradora" className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Data da abertura</label>
                <input type="date" name="data_abertura_seguradora" defaultValue={hoje} className={inputClass} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="documentacao_completa" defaultChecked={tudoAprovado} className="accent-o2-coral" />
              Documentação completa enviada (começa o prazo de 30 dias)
            </label>
            <SubmitButton className={botaoPrimario} textoCarregando="Salvando…">
              Marcar como aberto
            </SubmitButton>
          </form>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Histórico</h2>
        <Historico id={s.id} registros={historico} modo="o2" />
      </section>

      {etapa !== "cancelado" && etapa !== "encerrado" && (
        <details className="text-sm">
          <summary className="cursor-pointer text-red-600">Cancelar sinistro</summary>
          <form action={cancelarSinistroO2} className="mt-2 flex gap-2">
            <input type="hidden" name="id" value={s.id} />
            <input name="motivo" required placeholder="Motivo (ex.: imobiliária desistiu, duplicado)" className={`${inputClass} max-w-md`} />
            <SubmitButton className="rounded-full bg-red-600 px-4 py-1.5 text-sm font-semibold text-white" textoCarregando="…">
              Cancelar
            </SubmitButton>
          </form>
        </details>
      )}
    </div>
  );
}

// ---------- O2: agenda de próxima ação ----------

function ProximaAcao({ s }: { s: any }) {
  const hoje = hojeSP();
  const quando: string | null = s.proxima_acao_em;
  const atrasada = !!quando && quando < hoje;
  const ehHoje = quando === hoje;
  const cor = atrasada ? "border-red-200 bg-red-50" : ehHoje ? "border-orange-200 bg-orange-50" : "border-blue-200 bg-blue-50";
  return (
    <section className={`rounded-xl border p-4 ${cor} space-y-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Próxima ação (agenda O2)</h2>
        {quando && (
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              atrasada ? "bg-red-100 text-red-700" : ehHoje ? "bg-orange-100 text-orange-800" : "bg-white text-o2-navy"
            }`}
          >
            {atrasada ? `atrasada desde ${formatarData(quando)}` : ehHoje ? "é hoje" : `em ${formatarData(quando)} · faltam ${diasEntre(hoje, quando)} dia(s)`}
          </span>
        )}
      </div>
      <form action={salvarProximaAcao} className="grid gap-3 sm:grid-cols-[10rem_1fr_14rem_auto] sm:items-end">
        <input type="hidden" name="id" value={s.id} />
        <div>
          <label className={labelClass}>Data</label>
          <input type="date" name="proxima_acao_em" defaultValue={quando ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>O que fazer</label>
          <input
            name="proxima_acao_descricao"
            defaultValue={s.proxima_acao_descricao ?? ""}
            placeholder="Ex.: cobrar boleto de outubro da imobiliária"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Responsável</label>
          <input name="proxima_acao_responsavel" defaultValue={s.proxima_acao_responsavel ?? s.responsavel_o2 ?? ""} placeholder="e-mail @o2seguros" className={inputClass} />
        </div>
        <div className="flex gap-2">
          <SubmitButton className={botaoPrimario} textoCarregando="Salvando…">
            Salvar
          </SubmitButton>
          {(quando || s.proxima_acao_descricao) && (
            <button name="limpar" value="1" className={botaoSecundario}>
              Concluída
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
