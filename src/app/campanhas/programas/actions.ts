"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase/service";
import {
  METRICAS_PROGRAMA,
  PRODUTOS_PROGRAMA,
  STATUS_PROGRAMA,
  montarDesempenhoPrograma,
  type ParticipanteRow,
  type Programa,
} from "@/lib/campanhas/programas";
import { montarEmailParcial } from "@/lib/campanhas/parcialPrograma";
import { limparNomeRemetente } from "@/lib/campanhas/remetente";

async function exigirEquipe() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");
  return { supabase, email: user.email ?? null };
}

function numero(valor: FormDataEntryValue | null): number | null {
  const texto = String(valor ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(/R\$/i, "");
  if (!texto) return null;
  // Aceita "1.234,56" e "1234.56".
  const normal = texto.includes(",") ? texto.replace(/\./g, "").replace(",", ".") : texto;
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

function lerCampos(formData: FormData) {
  const produtos = formData
    .getAll("produtos")
    .map(String)
    .filter((p) => PRODUTOS_PROGRAMA.some((x) => x.valor === p));
  const metrica = String(formData.get("metrica") ?? "contratacoes");
  const status = String(formData.get("status") ?? "ativa");
  return {
    nome: String(formData.get("nome") ?? "").trim(),
    objetivo: String(formData.get("objetivo") ?? "").trim() || null,
    produtos,
    metrica: METRICAS_PROGRAMA.some((m) => m.valor === metrica) ? metrica : "contratacoes",
    inicio: String(formData.get("inicio") ?? "").trim(),
    fim: String(formData.get("fim") ?? "").trim(),
    data_apuracao: String(formData.get("data_apuracao") ?? "").trim() || null,
    premiacao_descricao: String(formData.get("premiacao_descricao") ?? "").trim() || null,
    custo_premiacao_geral: numero(formData.get("custo_premiacao_geral")) ?? 0,
    status: status in STATUS_PROGRAMA ? status : "ativa",
    responsavel_email: String(formData.get("responsavel_email") ?? "").trim() || null,
  };
}

function validar(c: ReturnType<typeof lerCampos>): string | null {
  if (!c.nome) return "Dê um nome ao programa.";
  if (!c.produtos.length) return "Marque ao menos um produto.";
  if (!c.inicio || !c.fim) return "Informe o início e o fim da campanha.";
  if (c.fim < c.inicio) return "O fim não pode ser antes do início.";
  return null;
}

export async function criarPrograma(formData: FormData) {
  const { supabase, email } = await exigirEquipe();
  const campos = lerCampos(formData);
  const erro = validar(campos);
  if (erro) redirect(`/campanhas/programas/nova?erro=${encodeURIComponent(erro)}`);
  const { data, error } = await supabase
    .from("campanhas_programas")
    .insert({ ...campos, responsavel_email: campos.responsavel_email ?? email, criado_por_email: email })
    .select("id")
    .single();
  if (error || !data) redirect(`/campanhas/programas/nova?erro=${encodeURIComponent("Não consegui salvar o programa. Tente de novo.")}`);
  redirect(`/campanhas/programas/${data.id}`);
}

export async function atualizarPrograma(programaId: string, formData: FormData) {
  const { supabase } = await exigirEquipe();
  const campos = lerCampos(formData);
  const erro = validar(campos);
  if (erro) redirect(`/campanhas/programas/${programaId}?erro=${encodeURIComponent(erro)}`);
  const { error } = await supabase
    .from("campanhas_programas")
    .update({ ...campos, updated_at: new Date().toISOString() })
    .eq("id", programaId);
  if (error) redirect(`/campanhas/programas/${programaId}?erro=${encodeURIComponent("Não consegui salvar as alterações.")}`);
  redirect(`/campanhas/programas/${programaId}`);
}

export async function arquivarPrograma(programaId: string, arquivar: boolean) {
  const { supabase } = await exigirEquipe();
  await supabase
    .from("campanhas_programas")
    .update({ arquivado_em: arquivar ? new Date().toISOString() : null })
    .eq("id", programaId);
  revalidatePath("/campanhas/programas");
  redirect(arquivar ? "/campanhas/programas" : `/campanhas/programas/${programaId}`);
}

export async function excluirPrograma(programaId: string) {
  const { supabase } = await exigirEquipe();
  await supabase.from("campanhas_programas").delete().eq("id", programaId);
  redirect("/campanhas/programas");
}

// Participantes: chamadas direto do componente (sem redirect), lançam erro
// com mensagem clara que a tela mostra.
export async function adicionarParticipante(programaId: string, tipo: "imobiliaria" | "grupo", alvoId: string) {
  const { supabase } = await exigirEquipe();
  const { data: atuais } = await supabase
    .from("campanhas_programas_participantes")
    .select("imobiliaria_id, grupo_id")
    .eq("programa_id", programaId);
  const imobsAtuais = (atuais ?? []).filter((p) => p.imobiliaria_id).map((p) => p.imobiliaria_id as string);
  const gruposAtuais = (atuais ?? []).filter((p) => p.grupo_id).map((p) => p.grupo_id as string);

  // Não deixar a mesma produção contar duas vezes (unidade + grupo dela).
  if (tipo === "imobiliaria") {
    if (imobsAtuais.includes(alvoId)) throw new Error("Essa imobiliária já está no programa.");
    const { data: imob } = await supabase.from("imobiliarias").select("grupo_id").eq("id", alvoId).maybeSingle();
    if (imob?.grupo_id && gruposAtuais.includes(imob.grupo_id))
      throw new Error("Essa imobiliária já entra pelo grupo dela, que está no programa. Tire o grupo para acompanhar por unidade.");
  } else {
    if (gruposAtuais.includes(alvoId)) throw new Error("Esse grupo já está no programa.");
    if (imobsAtuais.length) {
      const { data: membros } = await supabase.from("imobiliarias").select("id").eq("grupo_id", alvoId);
      const repetidas = (membros ?? []).filter((m) => imobsAtuais.includes(m.id)).length;
      if (repetidas)
        throw new Error(`${repetidas} unidade(s) desse grupo já estão no programa individualmente. Tire as unidades para acompanhar pelo grupo inteiro.`);
    }
  }

  const { error } = await supabase
    .from("campanhas_programas_participantes")
    .insert({ programa_id: programaId, imobiliaria_id: tipo === "imobiliaria" ? alvoId : null, grupo_id: tipo === "grupo" ? alvoId : null });
  if (error) throw new Error("Não consegui adicionar. Tente de novo.");
}

export async function atualizarParticipante(
  participanteId: string,
  dados: { meta: string; custo: string; observacao: string }
) {
  const { supabase } = await exigirEquipe();
  const meta = numero(dados.meta);
  const custo = numero(dados.custo) ?? 0;
  if (meta !== null && meta < 0) throw new Error("A meta não pode ser negativa.");
  if (custo < 0) throw new Error("O custo não pode ser negativo.");
  // Sem revalidatePath: a tela chama router.refresh() (mesmo padrão de
  // GerenciarDestinatarios) -- com os dois juntos a atualização travava.
  const { error } = await supabase
    .from("campanhas_programas_participantes")
    .update({ meta, custo_premiacao: custo, observacao: dados.observacao.trim() || null, updated_at: new Date().toISOString() })
    .eq("id", participanteId);
  if (error) throw new Error("Não consegui salvar. Tente de novo.");
}

export async function removerParticipante(participanteId: string) {
  const { supabase } = await exigirEquipe();
  const { error } = await supabase.from("campanhas_programas_participantes").delete().eq("id", participanteId);
  if (error) throw new Error("Não consegui tirar. Tente de novo.");
}

// Fase 2 (22/10/2026): gera um rascunho de e-mail de PARCIAL por participante
// com meta, com os números de hoje, ligado ao programa. Opcionalmente já
// agenda o disparo (o cron de campanhas envia na hora marcada). A revisão e o
// disparo seguem o fluxo normal de Campanhas.
const PRODUTO_CAMPANHA_POR_PROGRAMA: Record<string, string> = { fianca: "fianca", capitalizacao: "capitalizacao", re: "incendio" };

export async function gerarParciais(programaId: string, formData: FormData) {
  const { supabase, email } = await exigirEquipe();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const remetenteNome = limparNomeRemetente(formData.get("remetente_nome"));
  const agendarTexto = String(formData.get("agendado_para") ?? "").trim();
  let agendadoPara: string | null = null;
  if (agendarTexto) {
    const data = new Date(`${agendarTexto}:00-03:00`);
    if (Number.isNaN(data.getTime()) || data.getTime() <= Date.now())
      redirect(`/campanhas/programas/${programaId}?erro=${encodeURIComponent("O agendamento precisa ser no futuro.")}#parciais`);
    agendadoPara = data.toISOString();
  }

  const { data: programa } = await supabase.from("campanhas_programas").select("*").eq("id", programaId).maybeSingle();
  if (!programa) redirect("/campanhas/programas");
  const { data: participantes } = await supabase
    .from("campanhas_programas_participantes")
    .select("id, imobiliaria_id, grupo_id, meta, observacao, custo_premiacao")
    .eq("programa_id", programaId);
  const lista = (participantes ?? []) as ParticipanteRow[];
  const comMeta = lista.filter((p) => p.meta !== null && Number(p.meta) > 0);
  if (!comMeta.length)
    redirect(`/campanhas/programas/${programaId}?erro=${encodeURIComponent("Nenhum participante tem meta: defina as metas antes de gerar as parciais.")}#parciais`);

  const db = createServiceClient();
  const desempenho = await montarDesempenhoPrograma(db, programa as Programa, comMeta);
  const gruposIds = comMeta.filter((p) => p.grupo_id).map((p) => p.grupo_id!);
  const membrosPorGrupo = new Map<string, string[]>();
  if (gruposIds.length) {
    const { data: membros } = await db.from("imobiliarias").select("id, grupo_id").in("grupo_id", gruposIds);
    for (const m of (membros ?? []) as { id: string; grupo_id: string }[]) {
      const l = membrosPorGrupo.get(m.grupo_id) ?? [];
      l.push(m.id);
      membrosPorGrupo.set(m.grupo_id, l);
    }
  }
  const produtos = [...new Set((programa as Programa).produtos.map((p) => PRODUTO_CAMPANHA_POR_PROGRAMA[p]).filter(Boolean))];

  const linhas = comMeta
    .map((p) => {
      const linha = desempenho.linhas.find((l) => l.participanteId === p.id);
      const destinatarios = p.imobiliaria_id ? [p.imobiliaria_id] : (membrosPorGrupo.get(p.grupo_id!) ?? []);
      if (!linha || !destinatarios.length) return null;
      const email_ = montarEmailParcial(programa as Programa, linha, desempenho.hoje, desempenho.diasRestantes);
      return {
        nome: email_.nome,
        assunto: email_.assunto,
        template: "comunicado",
        personalizacao: "nenhuma",
        titulo: email_.titulo,
        introducao: email_.introducao,
        corpo_html: email_.corpoHtml,
        valido_de: (programa as Programa).inicio,
        valido_ate: (programa as Programa).fim,
        produto: produtos[0] ?? "institucional",
        produtos: produtos.length ? produtos : ["institucional"],
        programa_id: programaId,
        imobiliarias_selecionadas: destinatarios,
        remetente_nome: remetenteNome,
        criado_por: user?.id ?? null,
        criado_por_email: email,
        status: agendadoPara ? "agendada" : "rascunho",
        agendado_para: agendadoPara,
      };
    })
    .filter((l): l is NonNullable<typeof l> => !!l);

  const { error } = await supabase.from("campanhas").insert(linhas);
  if (error) redirect(`/campanhas/programas/${programaId}?erro=${encodeURIComponent(`Não consegui gerar as parciais: ${error.message}`)}#parciais`);
  const semMeta = lista.length - comMeta.length;
  const ok =
    `${linhas.length} parcial(is) ${agendadoPara ? "agendada(s)" : "gerada(s) como rascunho"}` +
    (semMeta ? ` · ${semMeta} participante(s) sem meta ficaram de fora` : "") +
    ". Elas aparecem em Comunicações do programa.";
  redirect(`/campanhas/programas/${programaId}?ok=${encodeURIComponent(ok)}#parciais`);
}
