// ERP O2 — leitura das tarefas "CADASTRO <SETOR> CORP <MÊS>" do Bitrix (28/10/2026). SÓ LEITURA no Bitrix.
// A proposta é anexada no chat da tarefa antes do cadastro no Corp; a mensagem traz os dados do cadastro.
// Formato observado (uma mensagem por proposta):
//   NOME - IMOBILIÁRIA / == / SEG: nº / == / CADASTRAR COM A VIGENCIA: dd/mm/aaaa A dd/mm/aaaa / OBS / = / SEGURADORA PLANO /
//   = / COMISSÃO: n% / REPASSE ...: R$ ou % / DESCONTO ...
// Nada é inventado: campo que não aparece fica null.
import type { SupabaseClient } from "@supabase/supabase-js";

export type PropostaCadastro = {
  nome: string | null;
  imobiliaria: string | null;
  seg: string | null;
  vigencia_inicio: string | null; // aaaa-mm-dd
  vigencia_fim: string | null;
  seguradora_plano: string | null;
  comissao_pct: number | null;
  repasses: { quem: string | null; valor: string }[];
  assunto_email: string | null; // "ASSUNTO DO E-MAIL:" — chave para achar o e-mail na base indexada
  campos: Record<string, string>; // todos os "CHAVE: valor" da mensagem, como escritos
  sem_repasse: boolean;
  arquivos: number;
  data_mensagem: string | null;
  mensagem_id: number;
  tarefa_id: number;
};

const iso = (d: string) => d.split("/").reverse().join("-");
const num = (s: string) => Number(s.replace(",", "."));

export function lerMensagemCadastro(texto: string, extra: { arquivos: number; data: string | null; id: number; tarefa: number }): PropostaCadastro | null {
  const t = texto.replace(/\r/g, "");
  if (/^\s*\[USER=\d+\]/.test(t) || /\[TIMESTAMP=|\[URL=\/company/.test(t)) return null; // aviso do sistema (tarefa criada, lista de verificação, prazo…)
  const linhas = t.split("\n").map((l) => l.trim());
  const campos: Record<string, string> = {};
  for (const l of linhas) {
    const m = /^([A-ZÀ-Ú][A-ZÀ-Ú0-9 ()/.\-]{1,34}):\s*(.*)$/.exec(l);
    if (m) campos[m[1].trim().toUpperCase()] = m[2].trim();
  }
  const conhecida = /CADASTRAR COM A VIGENCIA|SEG:|COMISS[AÃ]O|REPASSE|ASSUNTO DO E-?MAIL|IMOB(ILI[AÁ]RIA)?:|CONTRATA[CÇ][AÃ]O|SEM REPASSE/i.test(t);
  if (!conhecida) return null; // mensagem sem dados de cadastro (ex.: só o título do arquivo)
  const primeira = linhas.find((l) => l && !/^=+$/.test(l)) ?? "";
  const [nome, ...resto] = primeira.split(/\s+-\s+/);
  const vig = /VIG[EÊ]NCIA:?\s*([\d/]{10})\s*A\s*([\d/]{10})/i.exec(t.replace(/\n/g, " "));
  const com = /COMISS[AÃ]O:?\s*([\d.,]+)\s*%/i.exec(t);
  const seg = /SEG:?\s*(\d+)/i.exec(t);
  // linha com seguradora/plano: a que vem depois do bloco de vigência/OBS e antes de COMISSÃO
  const iCom = linhas.findIndex((l) => /^COMISS/i.test(l));
  const candidatas = linhas.slice(0, iCom < 0 ? linhas.length : iCom).filter((l) => /\b(PORTO|POTTENCIAL|TOKIO|TOO|YELUM|LIBERTY|ALFA|SUHAI|HDI|SOMPO|BRASILCAP|ESSENCIAL|TRADICIONAL)\b/i.test(l));
  const repasses = linhas
    .filter((l) => /^REPASSE/i.test(l))
    .map((l) => {
      const m = /^REPASSE\s*([^:]*):\s*(.+)$/i.exec(l);
      return m ? { quem: m[1].trim() || null, valor: m[2].trim() } : { quem: null, valor: l };
    });
  return {
    assunto_email: campos["ASSUNTO DO E-MAIL"] || campos["ASSUNTO DO EMAIL"] || null,
    campos,
    sem_repasse: /SEM REPASSE/i.test(t),
    nome: nome?.trim() || null,
    imobiliaria: resto.join(" - ").trim() || null,
    seg: seg?.[1] ?? null,
    vigencia_inicio: vig ? iso(vig[1]) : null,
    vigencia_fim: vig ? iso(vig[2]) : null,
    seguradora_plano: candidatas.at(-1) ?? null,
    comissao_pct: com ? num(com[1]) : null,
    repasses,
    arquivos: extra.arquivos,
    data_mensagem: extra.data,
    mensagem_id: extra.id,
    tarefa_id: extra.tarefa,
  };
}

type Chamar = (metodo: string, params?: Record<string, unknown>) => Promise<{ result?: any; error?: string; error_description?: string; next?: number; total?: number }>;

/** Chamador com intervalo mínimo entre chamadas (o Bitrix em nuvem aceita ~2 por segundo por webhook) e nova tentativa se limitar. */
export const chamadorBitrix = (baseUrl: string): Chamar => {
  let ultima = 0;
  return async (metodo, params = {}) => {
    for (let t = 0; ; t++) {
      const espera = Math.max(0, ultima + 600 - Date.now());
      if (espera) await new Promise((r) => setTimeout(r, espera));
      ultima = Date.now();
      let r: Awaited<ReturnType<Chamar>>;
      try {
        r = await fetch(baseUrl.replace(/\/?$/, "/") + metodo + ".json", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(params), signal: AbortSignal.timeout(30_000) }).then((x) => x.json());
      } catch (e) {
        if (t < 5) { await new Promise((x) => setTimeout(x, 2000 * (t + 1))); continue; } // queda de conexão: tenta de novo
        throw e;
      }
      if ((r.error === "QUERY_LIMIT_EXCEEDED" || r.error === "OPERATION_TIME_LIMIT") && t < 5) { await new Promise((x) => setTimeout(x, 2000 * (t + 1))); continue; }
      return r;
    }
  };
};

/** Tarefas cujo título tem o texto dado (todas as páginas). */
export async function listarTarefas(bx: Chamar, titulo: string, limite = 1000) {
  const todas: { id: number; title: string; createdDate: string }[] = [];
  for (let start = 0; todas.length < limite; ) {
    const r = await bx("tasks.task.list", { select: ["ID", "TITLE", "CREATED_DATE"], filter: { "%TITLE": titulo }, order: { ID: "desc" }, start });
    if (r.error) throw new Error(`${r.error}: ${r.error_description ?? ""}`);
    todas.push(...(r.result?.tasks ?? []));
    if (r.next === undefined) break;
    start = r.next;
  }
  return todas;
}

/** Mensagens e arquivos do chat de uma tarefa (todas as páginas, da mais nova para a mais antiga). */
export async function lerChatDaTarefa(bx: Chamar, tarefaId: number) {
  const g = await bx("tasks.task.get", { taskId: tarefaId, select: ["ID", "CHAT_ID"] });
  const chatId = g.result?.task?.chatId;
  if (!chatId) return { chatId: null, mensagens: [] as any[], arquivos: new Map<number, any>() };
  const mensagens: any[] = [];
  const arquivos = new Map<number, any>();
  let ultimo: number | undefined;
  for (;;) {
    const r = await bx("im.dialog.messages.get", { DIALOG_ID: `chat${chatId}`, LIMIT: 50, ...(ultimo ? { LAST_ID: ultimo } : {}) });
    if (r.error) throw new Error(`${r.error}: ${r.error_description ?? ""}`);
    const ms: any[] = r.result?.messages ?? [];
    mensagens.push(...ms);
    for (const f of r.result?.files ?? []) arquivos.set(f.id, f);
    if (ms.length < 50) break;
    ultimo = Math.min(...ms.map((m) => m.id));
  }
  return { chatId: Number(chatId), mensagens, arquivos };
}

// ---------- ligação ao documento do ERP ----------
export const normNome = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z ]+/g, " ").replace(/\s+/g, " ").trim();

export type DocDoNome = {
  id: string; nosso_numero: number | null; numero_apolice: string | null; numero_proposta: string | null; situacao: string; tipo: string;
  vigencia_inicio: string | null; vigencia_fim: string | null; comissao_pct: number | null; seguradora_id: string | null; ramo_id: string | null; premio_total: number | null; premio_liquido: number | null; iof: number | null; premio_adicional: number | null; qtd_parcelas: number | null; dt_emissao: string | null; dt_proposta: string | null; via: string;
};
export const COLS_DOC = "id,nosso_numero,numero_apolice,numero_proposta,situacao,tipo,vigencia_inicio,vigencia_fim,comissao_pct,seguradora_id,ramo_id,premio_total,premio_liquido,iof,premio_adicional,qtd_parcelas,dt_emissao,dt_proposta";
const COLS = COLS_DOC;

/** Documentos do ERP em que o nome (inteiro, ou cada pessoa de "A E B") aparece como cliente ou como parte do item. */
export async function documentosDoNome(sb: SupabaseClient, nomeBruto: string): Promise<DocDoNome[]> {
  const n = normNome(nomeBruto);
  const pessoas = [...new Set([n, ...n.split(/ E /).map((x) => x.trim())])].filter((x) => x.split(" ").length >= 2);
  const achados = new Map<string, DocDoNome>();
  for (const nome of pessoas) {
    const toks = nome.split(" ");
    const { data: ls } = await sb.from("locatarios").select("id").eq("nome_normalizado", nome).limit(5);
    if (ls?.length) {
      const { data: ds } = await sb.from("erp_documentos").select(COLS).in("locatario_id", ls.map((l) => l.id));
      for (const d of ds ?? []) achados.set(d.id, { ...(d as Omit<DocDoNome, "via">), via: "cliente" });
    }
    const { data: ps } = await sb.from("erp_item_partes").select("item_id,nome").ilike("nome", `%${toks[0]}%${toks[toks.length - 1]}%`).limit(40);
    const exatos = (ps ?? []).filter((x) => normNome(x.nome ?? "") === nome).map((x) => x.item_id);
    if (exatos.length) {
      const { data: its } = await sb.from("erp_documento_itens").select("documento_id").in("id", exatos);
      const docIds = [...new Set((its ?? []).map((i) => i.documento_id))];
      if (docIds.length) {
        const { data: ds } = await sb.from("erp_documentos").select(COLS).in("id", docIds);
        for (const d of ds ?? []) if (!achados.has(d.id)) achados.set(d.id, { ...(d as Omit<DocDoNome, "via">), via: "parte do item" });
      }
    }
  }
  return [...achados.values()];
}
