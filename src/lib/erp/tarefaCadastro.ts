// ERP O2 — leitura das tarefas "CADASTRO <SETOR> CORP <MÊS>" do Bitrix (28/10/2026). SÓ LEITURA no Bitrix.
// A proposta é anexada no chat da tarefa antes do cadastro no Corp; a mensagem traz os dados do cadastro.
// Formato observado (uma mensagem por proposta):
//   NOME - IMOBILIÁRIA / == / SEG: nº / == / CADASTRAR COM A VIGENCIA: dd/mm/aaaa A dd/mm/aaaa / OBS / = / SEGURADORA PLANO /
//   = / COMISSÃO: n% / REPASSE ...: R$ ou % / DESCONTO ...
// Nada é inventado: campo que não aparece fica null.

export type PropostaCadastro = {
  nome: string | null;
  imobiliaria: string | null;
  seg: string | null;
  vigencia_inicio: string | null; // aaaa-mm-dd
  vigencia_fim: string | null;
  seguradora_plano: string | null;
  comissao_pct: number | null;
  repasses: { quem: string | null; valor: string }[];
  arquivos: number;
  data_mensagem: string | null;
  mensagem_id: number;
  tarefa_id: number;
};

const iso = (d: string) => d.split("/").reverse().join("-");
const num = (s: string) => Number(s.replace(",", "."));

export function lerMensagemCadastro(texto: string, extra: { arquivos: number; data: string | null; id: number; tarefa: number }): PropostaCadastro | null {
  const t = texto.replace(/\r/g, "");
  if (/criou \[URL=/.test(t) || !/CADASTRAR COM A VIGENCIA|SEG:/i.test(t)) return null; // aviso do sistema ou mensagem sem dados
  const linhas = t.split("\n").map((l) => l.trim());
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

export const chamadorBitrix = (baseUrl: string): Chamar => (metodo, params = {}) =>
  fetch(baseUrl.replace(/\/?$/, "/") + metodo + ".json", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(params) }).then((r) => r.json());

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
