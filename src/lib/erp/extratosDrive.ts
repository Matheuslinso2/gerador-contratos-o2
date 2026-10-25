// ERP O2 — Fase 2 (25/10/2026): extratos de comissão baixados dos sites das seguradoras e colocados
// pela equipe na pasta do Drive "BAIXA DE COMISSÃO / EXTRATOS DE COMISSÃO (o ERP lê daqui)".
// Estrutura: <corretora> / <seguradora> / [subpastas livres, ex. 2026-10] / arquivo (xls, xlsx, csv, pdf, planilha Google).
// A conta de serviço GOOGLE_SERVICE_ACCOUNT_* tem só leitura nessa pasta (dada em 25/10).
// Leitura: Pottencial e Too pelos leitores fixos (mesmo layout do e-mail); outras planilhas por um leitor
// genérico que acha o cabeçalho pelas palavras (apólice, parcela, prêmio, comissão…); PDF (com as senhas
// conhecidas da O2) pela IA, que devolve as linhas. Cada arquivo vira 1 erp_extratos_seguradora
// (origem 'drive', arquivo_path = 'drive:<id>') + linhas em erp_extrato_linhas; casamento em erp_cruzar_extratos().
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { drive, type drive_v3 } from "@googleapis/drive";
import * as XLSX from "xlsx";
import Anthropic from "@anthropic-ai/sdk";
import { obterAutenticacaoGoogle } from "@/lib/googleAuth";
import { abrirTextoPdfComSenha, candidatosSenhaO2 } from "@/lib/pdfComSenha";
import { parsePottencial, parseToo, num, txt, dataBr, type LinhaExtrato } from "@/lib/erp/extratos";

export const PASTA_EXTRATOS = process.env.ERP_EXTRATOS_DRIVE_PASTA || "1CWbgcf2V2DqYMiG_mCghoZsk6v8fR1EL";

// nome da pasta (como está no Drive / na planilha CONTROLE BAIXA) → abreviação em erp_seguradoras
const SEGURADORA_DA_PASTA: Record<string, string> = {
  ALFA: "ALFA", ALLIANZ: "ALLI", AXA: "AXA", AZUL: "AZUL", BRADESCO: "BRAD", BRASILCAP: "BRAS", HDI: "HDI", ICATU: "ICAT",
  MAPFRE: "MAPF", PORTO: "PORT", POTTENCIAL: "POTT", SUHAI: "SUHA", SULAMERICA: "SULA", TOKIO: "TOKI", TOO: "TOO", YELUM: "YELU", ZURICH: "ZURI",
};
const NOME_LINHA: Record<string, string> = { POTT: "POTTENCIAL", TOO: "TOO", TOKI: "TOKIO" };

type Arquivo = { id: string; nome: string; mime: string; modificado: string; corretora: "O2 Corretora" | "O2 Capitalização"; seguradora: string; caminho: string };

function clienteDrive(): drive_v3.Drive {
  const auth = obterAutenticacaoGoogle(["https://www.googleapis.com/auth/drive.readonly"], { contexto: "extratos de comissão (Drive)" });
  return drive({ version: "v3", auth });
}

async function filhos(api: drive_v3.Drive, pasta: string): Promise<drive_v3.Schema$File[]> {
  const saida: drive_v3.Schema$File[] = [];
  let pageToken: string | undefined;
  do {
    const r = await api.files.list({
      q: `'${pasta}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType, modifiedTime)",
      pageSize: 1000, pageToken, supportsAllDrives: true, includeItemsFromAllDrives: true,
    });
    saida.push(...(r.data.files ?? []));
    pageToken = r.data.nextPageToken ?? undefined;
  } while (pageToken);
  return saida;
}

const PASTA = "application/vnd.google-apps.folder";

export async function listarArquivosExtratos(api = clienteDrive()): Promise<Arquivo[]> {
  const saida: Arquivo[] = [];
  for (const c of await filhos(api, PASTA_EXTRATOS)) {
    if (c.mimeType !== PASTA) continue;
    const corretora = /CAPITALIZA/i.test(c.name ?? "") ? "O2 Capitalização" : /CORRETORA/i.test(c.name ?? "") ? "O2 Corretora" : null;
    if (!corretora) continue;
    for (const s of await filhos(api, c.id!)) {
      if (s.mimeType !== PASTA) continue;
      const chave = (s.name ?? "").toUpperCase().normalize("NFD").replace(/[^A-Z]/g, "");
      const abrev = SEGURADORA_DA_PASTA[chave];
      if (!abrev) continue;
      // arquivos da pasta da seguradora e de subpastas (até 2 níveis, ex.: 2026 / 10)
      const fila: { id: string; caminho: string; nivel: number }[] = [{ id: s.id!, caminho: `${c.name}/${s.name}`, nivel: 0 }];
      while (fila.length) {
        const atual = fila.shift()!;
        for (const f of await filhos(api, atual.id)) {
          if (f.mimeType === PASTA) {
            if (atual.nivel < 2) fila.push({ id: f.id!, caminho: `${atual.caminho}/${f.name}`, nivel: atual.nivel + 1 });
            continue;
          }
          saida.push({ id: f.id!, nome: f.name ?? "", mime: f.mimeType ?? "", modificado: f.modifiedTime ?? "", corretora, seguradora: abrev, caminho: `${atual.caminho}/${f.name}` });
        }
      }
    }
  }
  return saida;
}

async function baixar(api: drive_v3.Drive, a: Arquivo): Promise<{ buf: Buffer; tipo: "planilha" | "pdf" | "texto" | "outro" }> {
  if (a.mime === "application/vnd.google-apps.spreadsheet") {
    const r = await api.files.export({ fileId: a.id, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, { responseType: "arraybuffer" });
    return { buf: Buffer.from(r.data as ArrayBuffer), tipo: "planilha" };
  }
  if (a.mime.startsWith("application/vnd.google-apps.")) return { buf: Buffer.alloc(0), tipo: "outro" };
  const r = await api.files.get({ fileId: a.id, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" });
  const buf = Buffer.from(r.data as ArrayBuffer);
  const nome = a.nome.toLowerCase();
  if (/\.(xlsx?|xlsm|ods)$/.test(nome) || /sheet|excel/.test(a.mime)) return { buf, tipo: "planilha" };
  if (/\.csv$/.test(nome) || a.mime === "text/csv") return { buf, tipo: "planilha" };
  if (/\.pdf$/.test(nome) || a.mime === "application/pdf") return { buf, tipo: "pdf" };
  if (/\.txt$/.test(nome) || a.mime.startsWith("text/")) return { buf, tipo: "texto" };
  return { buf, tipo: "outro" };
}

// ---------- leitor genérico de planilha: acha a linha de cabeçalho e mapeia colunas pelo nome ----------
const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ /g, " ").toLowerCase().trim();
const COLUNAS: { campo: keyof LinhaExtrato; testes: RegExp[] }[] = [
  { campo: "valor_comissao", testes: [/^(vl\.?|vlr\.?|valor)?\s*(da\s+)?(comissao|corretagem)( liquida| bruta| paga)?$/, /valor.*comiss/, /comiss.*valor/, /^comissao$/, /corretagem/] },
  { campo: "pct_comissao", testes: [/^%\s*(de\s+)?(com|comissao|corretagem)/, /percentual/, /^% com/, /taxa.*comiss/] },
  { campo: "premio", testes: [/premio( liquido| tarifario| base)?$/, /base.*comiss/, /^vl\.? premio/, /^valor.*premio/] },
  { campo: "parcela", testes: [/^(n[º°o.]?\s*)?parcela$/, /^parc\.?$/, /^n.?\s*parc/, /parcela/] },
  { campo: "apolice", testes: [/^(n[º°o.]?\s*)?(da\s+)?apolice$/, /^apolice/, /apolice/, /^documento$/, /^certificado$/, /^titulo$/] },
  { campo: "proposta", testes: [/proposta/] },
  { campo: "endosso", testes: [/endosso/] },
  { campo: "cliente", testes: [/segurado/, /^cliente/, /tomador/, /^nome/, /subscritor/] },
  { campo: "cpf_cnpj", testes: [/cpf|cnpj/] },
  { campo: "vigencia_inicio", testes: [/inicio.*vig/, /vigencia.*inicio/, /^inicio/] },
  { campo: "produto", testes: [/produto/, /^ramo$/] },
];

function mapearCabecalho(linha: unknown[]): Map<keyof LinhaExtrato, number> | null {
  const mapa = new Map<keyof LinhaExtrato, number>();
  const textos = linha.map(norm);
  for (const { campo, testes } of COLUNAS) {
    for (const t of testes) {
      const i = textos.findIndex((x, idx) => x && t.test(x) && ![...mapa.values()].includes(idx));
      if (i >= 0) { mapa.set(campo, i); break; }
    }
  }
  return mapa.has("apolice") && mapa.has("valor_comissao") ? mapa : null;
}

export function parsePlanilhaGenerica(buf: Buffer): { linhas: LinhaExtrato[]; total_bruto: number | null; total_liquido: number | null; cabecalho: string | null } {
  const wb = XLSX.read(buf, { type: "buffer" });
  for (const nomeAba of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nomeAba], { header: 1, raw: true, defval: null });
    for (let h = 0; h < Math.min(rows.length, 40); h++) {
      const mapa = mapearCabecalho(rows[h] ?? []);
      if (!mapa) continue;
      const linhas: LinhaExtrato[] = [];
      for (const r of rows.slice(h + 1)) {
        const ap = txt(r[mapa.get("apolice")!]);
        const valor = num(r[mapa.get("valor_comissao")!]);
        if (!ap || valor === null || !/\d{3,}/.test(ap)) continue; // linha de total/rodapé
        const pega = (c: keyof LinhaExtrato) => (mapa.has(c) ? r[mapa.get(c)!] : null);
        linhas.push({
          n: linhas.length + 1, tipo: null, apolice: ap.replace(/\s/g, ""), valor_comissao: valor,
          proposta: txt(pega("proposta")), endosso: txt(pega("endosso")) === ap ? null : txt(pega("endosso")), parcela: num(pega("parcela")),
          cliente: txt(pega("cliente")), cpf_cnpj: txt(pega("cpf_cnpj"))?.replace(/\D/g, "") || null,
          premio: num(pega("premio")), pct_comissao: num(pega("pct_comissao")),
          vigencia_inicio: dataBr(pega("vigencia_inicio")), produto: txt(pega("produto")),
        });
      }
      if (linhas.length) {
        const total = Math.round(linhas.reduce((s, l) => s + (l.valor_comissao ?? 0), 0) * 100) / 100;
        return { linhas, total_bruto: total, total_liquido: null, cabecalho: `${nomeAba} linha ${h + 1}: ${(rows[h] ?? []).map((x) => txt(x)).filter(Boolean).join(" | ")}` };
      }
    }
  }
  return { linhas: [], total_bruto: null, total_liquido: null, cabecalho: null };
}

// ---------- PDF (ou texto) pela IA ----------
const FERRAMENTA = {
  name: "registrar_extrato",
  description: "Registra as linhas de um extrato/demonstrativo de comissão de corretora de seguros.",
  input_schema: {
    type: "object" as const,
    properties: {
      total_bruto: { type: ["number", "null"], description: "Total bruto de comissão do extrato, se impresso." },
      total_liquido: { type: ["number", "null"], description: "Total líquido (após impostos), se impresso." },
      competencia: { type: ["string", "null"], description: "Mês de referência ou data de pagamento, formato AAAA-MM-DD." },
      linhas: {
        type: "array",
        items: {
          type: "object",
          properties: {
            apolice: { type: "string", description: "Número da apólice/certificado/título exatamente como impresso, só dígitos e pontos/traços." },
            proposta: { type: ["string", "null"] }, endosso: { type: ["string", "null"] }, parcela: { type: ["number", "null"] },
            cliente: { type: ["string", "null"], description: "Segurado/tomador." }, cpf_cnpj: { type: ["string", "null"] },
            premio: { type: ["number", "null"], description: "Prêmio base da comissão." }, pct_comissao: { type: ["number", "null"] },
            valor_comissao: { type: "number", description: "Valor da comissão da linha (negativo em estorno/cancelamento)." },
            produto: { type: ["string", "null"] },
          },
          required: ["apolice", "valor_comissao"],
        },
      },
    },
    required: ["linhas"],
  },
};

async function lerTextoPelaIA(texto: string, seguradora: string): Promise<{ linhas: LinhaExtrato[]; total_bruto: number | null; total_liquido: number | null; competencia: string | null }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("falta ANTHROPIC_API_KEY");
  const anthropic = new Anthropic({ apiKey });
  const pedacos: string[] = [];
  for (let i = 0; i < texto.length; i += 40000) pedacos.push(texto.slice(i, i + 40000));
  const saida = { linhas: [] as LinhaExtrato[], total_bruto: null as number | null, total_liquido: null as number | null, competencia: null as string | null };
  for (const [k, pedaco] of pedacos.slice(0, 6).entries()) {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 16000,
      system: `Você lê extratos de comissão de corretora de seguros (seguradora: ${seguradora}). Registre TODAS as linhas de comissão (uma por apólice × parcela), copiando números exatamente. Estorno/cancelamento entra com valor negativo. Não invente linhas; ignore totais e cabeçalhos nas linhas.${pedacos.length > 1 ? ` Este é o pedaço ${k + 1} de ${pedacos.length} do documento.` : ""}`,
      tools: [FERRAMENTA],
      tool_choice: { type: "tool", name: "registrar_extrato" },
      messages: [{ role: "user", content: `TEXTO DO EXTRATO:\n\n${pedaco}` }],
    });
    const uso = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!uso) continue;
    const r = uso.input as { linhas?: Partial<LinhaExtrato>[]; total_bruto?: number | null; total_liquido?: number | null; competencia?: string | null };
    for (const l of r.linhas ?? []) {
      if (!l.apolice || typeof l.valor_comissao !== "number") continue;
      saida.linhas.push({
        n: saida.linhas.length + 1, tipo: null, apolice: String(l.apolice).replace(/\s/g, ""), proposta: l.proposta ?? null, endosso: l.endosso ?? null,
        parcela: l.parcela ?? null, cliente: l.cliente ?? null, cpf_cnpj: l.cpf_cnpj ? String(l.cpf_cnpj).replace(/\D/g, "") : null,
        premio: l.premio ?? null, pct_comissao: l.pct_comissao ?? null, valor_comissao: l.valor_comissao, vigencia_inicio: null, produto: l.produto ?? null,
      });
    }
    saida.total_bruto = saida.total_bruto ?? r.total_bruto ?? null;
    saida.total_liquido = saida.total_liquido ?? r.total_liquido ?? null;
    saida.competencia = saida.competencia ?? r.competencia ?? null;
  }
  return saida;
}

export type ResumoDrive = { arquivos: number; novos: number; lidos: number; nao_lidos: number; linhas: number; erros: string[] };

export async function carregarExtratosDrive(sb: SupabaseClient, opts: { gravar: boolean; max?: number; refazerNaoLidos?: boolean }): Promise<ResumoDrive> {
  const api = clienteDrive();
  const arquivos = await listarArquivosExtratos(api);
  const resumo: ResumoDrive = { arquivos: arquivos.length, novos: 0, lidos: 0, nao_lidos: 0, linhas: 0, erros: [] };
  if (opts.refazerNaoLidos && opts.gravar) await sb.from("erp_extratos_seguradora").delete().eq("origem", "drive").eq("leitura", "nao_lido");
  const { data: segs } = await sb.from("erp_seguradoras").select("id, abreviacao, nome");
  const seg = new Map((segs ?? []).map((s: { id: string; abreviacao: string; nome: string }) => [s.abreviacao, s]));
  const { data: ja } = await sb.from("erp_extratos_seguradora").select("arquivo_path, seguradora_id").not("arquivo_path", "is", null);
  // drive:<id> já lido; e o mesmo nome de arquivo já lido do e-mail (mesma seguradora) não entra de novo
  const carregados = new Set((ja ?? []).map((x: { arquivo_path: string; seguradora_id: string }) => (x.arquivo_path.startsWith("drive:") ? x.arquivo_path : `${x.seguradora_id}|${x.arquivo_path}`)));
  const { data: corrs } = await sb.from("erp_corretoras").select("id, apelido");
  const corrId = new Map((corrs ?? []).map((c: { id: string; apelido: string }) => [c.apelido, c.id]));

  const jaLido = (x: Arquivo) => carregados.has(`drive:${x.id}`) || carregados.has(`${seg.get(x.seguradora)?.id}|${x.nome}`);
  for (const a of arquivos.filter((x) => !jaLido(x)).slice(0, opts.max ?? 30)) {
    resumo.novos++;
    let parsed: { linhas: LinhaExtrato[]; total_bruto: number | null; total_liquido: number | null };
    let como = "";
    let competencia: string | null = null;
    let erro: string | null = null;
    try {
      const { buf, tipo } = await baixar(api, a);
      if (tipo === "planilha") {
        if (a.seguradora === "POTT") { parsed = parsePottencial(buf); como = "leitor Pottencial"; }
        else if (a.seguradora === "TOO") { parsed = parseToo(buf); como = "leitor Too"; }
        else parsed = { linhas: [], total_bruto: null, total_liquido: null };
        if (!parsed.linhas.length) { const g = parsePlanilhaGenerica(buf); parsed = g; como = `leitor genérico (${g.cabecalho ?? "sem cabeçalho reconhecido"})`; }
      } else if (tipo === "pdf" || tipo === "texto") {
        const texto = tipo === "pdf" ? (await abrirTextoPdfComSenha(buf, candidatosSenhaO2()))?.texto ?? null : buf.toString("utf8");
        if (!texto) throw new Error("PDF não abriu (senha desconhecida?)");
        const ia = await lerTextoPelaIA(texto, seg.get(a.seguradora)?.nome ?? a.seguradora);
        parsed = ia; competencia = ia.competencia; como = "leitura por IA";
      } else throw new Error(`tipo de arquivo não lido (${a.mime})`);
      if (!parsed.linhas.length) erro = `nenhuma linha reconhecida (${como})`;
    } catch (e) {
      parsed = { linhas: [], total_bruto: null, total_liquido: null };
      erro = (e as Error).message;
    }
    if (erro) { resumo.nao_lidos++; resumo.erros.push(`${a.caminho}: ${erro}`); } else { resumo.lidos++; resumo.linhas += parsed.linhas.length; }
    if (!opts.gravar) continue;
    const somaLinhas = Math.round(parsed.linhas.reduce((s, l) => s + (l.valor_comissao ?? 0), 0) * 100) / 100;
    const dataArq = a.modificado ? a.modificado.slice(0, 7) + "-01" : null;
    const { data: ext, error } = await sb.from("erp_extratos_seguradora").insert({
      seguradora_id: seg.get(a.seguradora)?.id, corretora_id: corrId.get(a.corretora) ?? null,
      competencia: competencia && /^\d{4}-\d{2}-\d{2}$/.test(competencia) ? competencia.slice(0, 7) + "-01" : dataArq,
      tipo: "demonstrativo", origem: "drive", arquivo_path: `drive:${a.id}`, linhas: parsed.linhas,
      total_bruto: parsed.total_bruto ?? (parsed.linhas.length ? somaLinhas : null), total_liquido: parsed.total_liquido,
      leitura: erro ? "nao_lido" : "ok",
      observacao: `${a.caminho} · ${erro ? `NÃO LIDO: ${erro}` : `${como} · ${parsed.linhas.length} linhas · soma ${somaLinhas.toFixed(2)}`}`,
    }).select("id").single();
    if (error) { resumo.erros.push(`${a.caminho}: gravar: ${error.message}`); continue; }
    if (parsed.linhas.length) {
      const nome = NOME_LINHA[a.seguradora] ?? (seg.get(a.seguradora)?.nome ?? a.seguradora);
      const { error: e2 } = await sb.from("erp_extrato_linhas").insert(parsed.linhas.map((l) => ({ extrato_id: ext.id, seguradora: nome, ...l })));
      if (e2) resumo.erros.push(`${a.caminho}: linhas: ${e2.message}`);
    }
  }
  return resumo;
}
