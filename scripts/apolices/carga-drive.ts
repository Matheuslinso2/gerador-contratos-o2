// Carga do acervo de apólices em PDF (Drive → Workspace), de qualquer ramo,
// com vigência a partir de 2020 (pedido do Matheus, 23/10/2026). Estrutura e
// regras em supabase/schema_apolices_documentos.sql.
//
// Etapas (cada uma retoma de onde parou; nada é gravado até a última):
//   npx tsx scripts/apolices/carga-drive.ts listar   -- PDFs de apólice visíveis para a conta de serviço
//   npx tsx scripts/apolices/carga-drive.ts ler      -- baixa, guarda o texto e lê cada PDF
//   npx tsx scripts/apolices/carga-drive.ts casar    -- casa com o Corp e mostra a prévia (só leitura no banco)
//   npx tsx scripts/apolices/carga-drive.ts gravar   -- grava documentos, cofre e vínculos (só com o aval do Matheus)
//
// Casamento (qualquer ramo, sem depender do modelo do PDF): a apólice do Corp
// (emissão desde 2020) só é ligada ao PDF quando o texto traz as TRÊS coisas
// dela: o nº (inteiro ou como parte do nº do PDF), as datas de início e fim da vigência
// (±1 dia) e o CPF/CNPJ do cliente do Corp. Locatários, coberturas e local de
// risco lidos pelas regras fixas (leitores.ts) só existem para Seguro Fiança.
//
// Dados pessoais (texto dos PDFs, nomes, CPFs) ficam numa pasta temporária FORA
// do projeto (APOLICES_CACHE ou <tmp>/o2-apolices-fianca) até a gravação; apagar depois.
//
// Fonte e-mail (23/10/2026, pedido do Matheus): APOLICES_FONTE=email faz as mesmas
// etapas com os PDFs anexados na caixa matheus@o2seguros.com.br desde out/2019
// (conta de serviço com delegação, só leitura; GESTAO_EMAILS_* no .env.local).
// Mesmo casamento; grava só as apólices certas que o acervo ainda não tem
// (o mesmo PDF costuma estar no Drive e em vários e-mails).
process.loadEnvFile(".env.local");
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { createServiceClient } from "@/lib/supabase/service";
import { extrairTextoPdf } from "@/lib/extrairTextoPdf";
import { getDocumentProxy, extractText } from "unpdf";
import { lerApolice, documento, type Leitura } from "./leitores";

const require = createRequire(import.meta.url);
const { cliente } = require("../base-unica/_google.cjs");
const { auth: gauth, gmail } = require("@googleapis/gmail");

const FONTE: "drive" | "email" = process.env.APOLICES_FONTE === "email" ? "email" : "drive";
const CACHE = process.env.APOLICES_CACHE || path.join(os.tmpdir(), FONTE === "email" ? "o2-apolices-email" : "o2-apolices-fianca");
const LEITURAS = path.join(CACHE, "leituras");
const TEXTOS = path.join(CACHE, "textos");
fs.mkdirSync(LEITURAS, { recursive: true });
fs.mkdirSync(TEXTOS, { recursive: true });
const arq = (n: string) => path.join(CACHE, n);
const lerJson = <T>(n: string, padrao: T): T => (fs.existsSync(arq(n)) ? JSON.parse(fs.readFileSync(arq(n), "utf8")) : padrao);
const salvarJson = (n: string, v: unknown) => fs.writeFileSync(arq(n), JSON.stringify(v));
const VERSAO_LEITURA = 3;
const SO_SENHA = process.env.APOLICES_SO_SENHA === "1";
const IGNORADO = "ignorado nesta rodada (PDF sem senha)";
const PROTEGIDOS = path.join(CACHE, "protegidos");
fs.mkdirSync(PROTEGIDOS, { recursive: true });
const nomeArq = (id: string) => id.replace(/:/g, "_"); // "gmail:x:y" não vale como nome de arquivo no Windows

/** Drive: id do arquivo e pasta. E-mail: id "gmail:<mensagem>:<parte>", pasta = conversa, anexo = id do anexo. */
type Arquivo = { id: string; nome: string; pasta: string | null; criado: string; tamanho: number; anexo?: string; assunto?: string; de?: string };
/** O que vale para qualquer ramo: candidatos a nº de apólice, datas e CPFs/CNPJs do texto. */
type Generico = { numeros: string[]; datas: string[]; documentos: string[] };
type Lido = { versao?: number; arquivo: Arquivo; leitura: Leitura | null; generico?: Generico; erro?: string; caracteres?: number };
type Situacao = "certa" | "conferir" | "sem_par" | "nao_lida";
type Casado = {
  arquivo: Arquivo;
  leitura: Leitura | null;
  situacao: Situacao;
  motivo: string | null;
  nosso_numero: string | null;
  corp: { seg: string; ramo: string; produto: string; ini: string; fim: string; numero: string; cliente: string } | null;
  candidatos?: { nn: string; numero: string; seg: string; ramo: string; ini: string; fim: string }[];
  garantidos_confirmados: boolean; // Fiança: segurado lido = cliente do Corp (aí os locatários lidos valem)
};

// ---------------- listar ----------------
// Pelo nome, descarta o que claramente não é apólice (cartas de aprovação/recusa,
// cotações, contratos, propostas, boletos...). Nome com "apólice" sempre fica.
const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
const NAO_APOLICE = /CARTA|APROVA|APROV\b|RECUSA|CONTRATO|BASICO|COMPLET|PROPOSTA|\bPROP\b|ORCAMENTO|COTACAO|PENDENCIA|FICHA|ANALISE|MINUTA|RELATORIO|ADITIVO|TAXA FIXA|\bLMI\b|CONDICOES|CONDICAO|BOLETO|PANORAMA|CALCULO|ENDOSSO|CANCELAMENTO|CLAUSULA|MANUAL|NOTIFICA|DECLARA|VISTORIA|LAUDO|RECIBO|PLANILHA|NOTA FISCAL|\bNF\b|DANFE|FATURA|EXTRATO|COMPROVANTE/;
const talvezApolice = (nome: string) => /APOLICE/.test(sem(nome)) || !NAO_APOLICE.test(sem(nome));

/** Gmail da caixa do Matheus, só leitura (mesma conta de serviço da Gestão de E-mails). */
function clienteGmail() {
  const email = process.env.GESTAO_EMAILS_GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const chave = process.env.GESTAO_EMAILS_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!email || !chave) throw new Error("faltam GESTAO_EMAILS_GOOGLE_SERVICE_ACCOUNT_EMAIL/PRIVATE_KEY no .env.local");
  const jwt = new gauth.JWT({ email, key: chave.replace(/\\n/g, "\n"), scopes: ["https://www.googleapis.com/auth/gmail.readonly"], subject: "matheus@o2seguros.com.br" });
  return gmail({ version: "v1", auth: jwt });
}

type Parte = { partId?: string | null; filename?: string | null; body?: { attachmentId?: string | null; size?: number | null } | null; parts?: Parte[] | null };
const partesDe = (p: Parte | null | undefined): Parte[] => (p ? [p, ...(p.parts ?? []).flatMap(partesDe)] : []);

async function listarEmail() {
  const g = clienteGmail();
  // Caixa grande (recebe os grupos incêndio/fiança...): ids e anexos já vistos ficam
  // salvos, e a etapa retoma de onde parou se for interrompida.
  let ids = lerJson<string[]>("email-ids.json", []);
  if (!ids.length) {
    let pageToken: string | undefined;
    do {
      const r = await g.users.messages.list({ userId: "me", q: "has:attachment filename:pdf after:2019/10/01", maxResults: 500, pageToken });
      for (const m of r.data.messages ?? []) ids.push(m.id!);
      pageToken = r.data.nextPageToken ?? undefined;
      if (ids.length % 5000 === 0) console.log(`  contando e-mails: ${ids.length}`);
    } while (pageToken);
    salvarJson("email-ids.json", ids);
  }
  console.log(`e-mails com PDF anexo desde out/2019: ${ids.length}`);
  // O mesmo anexo (nome + tamanho) encaminhado em vários e-mails é baixado uma vez só.
  type Parcial = { vistos: string[]; anexos: number; todos: [string, Arquivo][] };
  const parcial = lerJson<Parcial>("email-parcial.json", { vistos: [], anexos: 0, todos: [] });
  const vistosSet = new Set(parcial.vistos);
  const todos = new Map<string, Arquivo>(parcial.todos);
  let anexos = parcial.anexos;
  const fila = ids.filter((id) => !vistosSet.has(id));
  const salvar = () => salvarJson("email-parcial.json", { vistos: [...vistosSet], anexos, todos: [...todos] });
  // Só a estrutura das partes (sem o corpo dos e-mails): bem mais leve.
  const nivel = (n: number): string => `partId,filename,body(attachmentId,size)${n ? `,parts(${nivel(n - 1)})` : ""}`;
  const campos = `id,threadId,internalDate,payload(headers(name,value),${nivel(5)})`;
  const trabalhar = async (id: string) => {
    let r;
    for (let t = 0; ; t++) {
      try { r = await g.users.messages.get({ userId: "me", id, format: "full", fields: campos }); break; }
      catch (e) { if (t >= 4) { console.log(`  falhou ${id}: ${(e as Error).message}`); vistosSet.add(id); return; } await new Promise((ok) => setTimeout(ok, 2000 * (t + 1))); }
    }
    // Assunto e remetente: pistas da senha dos PDFs protegidos (ex.: aviso da seguradora com o nome do segurado).
    const cab = (n: string): string | undefined => (r.data.payload?.headers ?? []).find((h: { name?: string }) => h.name?.toLowerCase() === n)?.value ?? undefined;
    for (const p of partesDe(r.data.payload)) {
      if (!p.filename || !/\.pdf$/i.test(p.filename) || !p.body?.attachmentId) continue;
      anexos++;
      const chave = `${p.filename.toLowerCase()}|${p.body.size}`;
      if (todos.has(chave)) continue;
      todos.set(chave, { id: `gmail:${id}:${p.partId}`, nome: p.filename, pasta: r.data.threadId ?? null, criado: new Date(Number(r.data.internalDate)).toISOString(), tamanho: p.body.size ?? 0, anexo: p.body.attachmentId, assunto: cab("subject"), de: cab("from") });
    }
    vistosSet.add(id);
    if (vistosSet.size % 1000 === 0) { salvar(); console.log(`  ${vistosSet.size}/${ids.length} e-mails | anexos distintos: ${todos.size}`); }
  };
  await Promise.all(Array.from({ length: 16 }, async () => { while (fila.length) await trabalhar(fila.shift()!); }));
  salvar();
  const unicos = [...todos.values()];
  // Na caixa de e-mail o volume é ~15× o do Drive (repasses, NFS-e, pendências, termos de
  // chaves...): além do filtro geral, descarta nomes com qualquer palavra que comece assim.
  const RUIM = /^(REPASSE|PENDDOC|APROV|RECUS|CANC|NFSE|NFE|PAGAMENTO|PROGRAMA|PREVIA|COMUNICADO|GUIA|DARF|CARNE|PARCELA|QUITA|SINISTRO|INDENIZ|TERMO|ENTREGA|CHAVES|CLICKSIGN|ASSINAD|PREMIA|RELACAOCERTIFICADO|EXTRATO|FATURA|BOLETO|RECIBO|DANFE|CONTRATO|VISTORIA|LAUDO|ORCAMENTO|COTAC|PROPOSTA|AVISO|RELATORIO|DEMONSTRATIVO|COMISS|HOLERITE|CURRICULO|INFORME|PROCURA|ATA|EDITAL|IPTU|CONDOMINIO|COBRANCA|NOTIFICA|DECLARA|DOCUMENTO|IDENTIDADE|CNH|RG|CPF|COMPROVANTE|CERTIDAO)/;
  const palavras = (nome: string) => sem(nome).replace(/\.PDF$/, "").split(/[^A-Z]+/);
  const lista = unicos.filter((a) => talvezApolice(a.nome) && (/APOLICE/.test(sem(a.nome)) || !palavras(a.nome).some((t) => RUIM.test(t))));
  salvarJson("lista.json", lista);
  const porAno: Record<string, number> = {};
  for (const a of lista) porAno[a.criado.slice(0, 4)] = (porAno[a.criado.slice(0, 4)] ?? 0) + 1;
  console.log(`anexos PDF: ${anexos} | distintos (nome+tamanho): ${unicos.length} | na lista: ${lista.length} (descartados pelo nome — boletos, notas, cotações...: ${unicos.length - lista.length})`);
  console.log("por ano do e-mail:", JSON.stringify(porAno));
}

async function listar() {
  if (FONTE === "email") return listarEmail();
  const { drive } = cliente("GERAL");
  // Pelo nome ("apólice", qualquer ramo) e, na Fiança, também pelo texto
  // ("Fiança Locatícia"), porque há apólices salvas só com o nome do inquilino.
  const termos = ["apolice", "APOLICE", "Apolice", "apólice", "APÓLICE", "Apólice"];
  const desde = "createdTime >= '2019-10-01T00:00:00Z'"; // apólices com vigência desde 2020
  const consultas = [
    `mimeType='application/pdf' and trashed=false and ${desde} and (${termos.map((t) => `name contains '${t}'`).join(" or ")})`,
    `mimeType='application/pdf' and trashed=false and ${desde} and (fullText contains 'FIANÇA LOCATÍCIA' or fullText contains 'Fianca Locaticia')`,
  ];
  const todos = new Map<string, Arquivo>();
  for (const q of consultas) {
    let pageToken: string | undefined;
    do {
      const r = await drive.files.list({
        q, pageSize: 1000, pageToken, supportsAllDrives: true, includeItemsFromAllDrives: true, corpora: "allDrives",
        fields: "nextPageToken,files(id,name,parents,createdTime,size)",
      });
      for (const f of r.data.files ?? [])
        todos.set(f.id, { id: f.id, nome: f.name, pasta: f.parents?.[0] ?? null, criado: f.createdTime, tamanho: Number(f.size ?? 0) });
      pageToken = r.data.nextPageToken ?? undefined;
    } while (pageToken);
  }
  const lista = [...todos.values()].filter((a) => talvezApolice(a.nome));
  salvarJson("lista.json", lista);
  const porAno: Record<string, number> = {};
  for (const a of lista) porAno[a.criado.slice(0, 4)] = (porAno[a.criado.slice(0, 4)] ?? 0) + 1;
  console.log(`PDFs na lista: ${lista.length} (descartados pelo nome — cartas, cotações, contratos...: ${todos.size - lista.length})`);
  console.log("por ano de criação do arquivo:", JSON.stringify(porAno));
}

// ---------------- ler ----------------
/** Candidatos a nº de apólice: cada sequência numérica (com . - / no meio), inteira,
 * em partes e os finais (o Corp guarda o fim do nº da Pottencial); sem zeros à esquerda. */
function generico(texto: string): Generico {
  const numeros = new Set<string>();
  const add = (s: string) => { const d = s.replace(/^0+/, ""); if (d.length >= 6 && d.length <= 20) numeros.add(d); };
  for (const m of texto.matchAll(/\d[\d.\-\/]*\d/g)) {
    const tok = m[0];
    const inteiro = tok.replace(/\D/g, "");
    if (inteiro.length > 30) continue;
    add(inteiro);
    for (const p of tok.split(/[.\-\/]/)) add(p);
    for (let i = 1; i <= inteiro.length - 6; i++) add(inteiro.slice(i));
  }
  const datas = new Set<string>();
  for (const m of texto.matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)) datas.add(`${m[3]}-${m[2]}-${m[1]}`);
  const documentos = new Set<string>();
  for (const m of texto.matchAll(/\d{2,3}[.\d]*[\/\-]?[\d.\-\/]*\d/g)) { const d = documento(m[0]); if (d) documentos.add(d); }
  return { numeros: [...numeros], datas: [...datas], documentos: [...documentos] };
}

async function ler() {
  const lista = lerJson<Arquivo[]>("lista.json", []);
  if (!lista.length) throw new Error("rode 'listar' antes");
  const drive = FONTE === "drive" ? cliente("GERAL").drive : null;
  const g = FONTE === "email" ? clienteGmail() : null;
  const pendentes = lista.filter((a) => {
    const f = path.join(LEITURAS, `${nomeArq(a.id)}.json`);
    return !fs.existsSync(f) || (JSON.parse(fs.readFileSync(f, "utf8")) as Lido).versao !== VERSAO_LEITURA;
  });
  console.log(`a ler: ${pendentes.length} de ${lista.length}`);
  let feitos = 0;
  const trabalhar = async (a: Arquivo) => {
    let lido: Lido;
    try {
      const ft = path.join(TEXTOS, `${nomeArq(a.id)}.txt.gz`);
      let texto: string;
      if (fs.existsSync(ft)) texto = zlib.gunzipSync(fs.readFileSync(ft)).toString("utf8");
      else {
        if (a.tamanho > 15_000_000) throw new Error("arquivo grande demais (>15 MB)");
        let pdf: Buffer;
        if (g) {
          const [, mensagem, parte] = a.id.split(":");
          const baixar = (anexo: string) => g.users.messages.attachments.get({ userId: "me", messageId: mensagem, id: anexo });
          // O id do anexo pode mudar desde a listagem: se falhar, relê a mensagem e acha a parte.
          let r = await baixar(a.anexo!).catch(() => null);
          if (!r) {
            const m = await g.users.messages.get({ userId: "me", id: mensagem, format: "full" });
            const nova = partesDe(m.data.payload).find((p) => p.partId === parte)?.body?.attachmentId;
            if (!nova) throw new Error("anexo não encontrado no e-mail");
            r = await baixar(nova);
          }
          pdf = Buffer.from(r.data.data, "base64url");
        } else {
          const r = await drive!.files.get({ fileId: a.id, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" });
          pdf = Buffer.from(r.data as ArrayBuffer);
        }
        // Rodada dos protegidos (APOLICES_SO_SENHA=1): só interessa PDF criptografado; ele é
        // guardado para a etapa 'senha' tentar abrir. Os demais já foram tratados na 1ª rodada.
        if (SO_SENHA) {
          if (!pdf.includes("/Encrypt")) throw new Error(IGNORADO);
          fs.writeFileSync(path.join(PROTEGIDOS, `${nomeArq(a.id)}.pdf`), pdf);
        }
        texto = await extrairTextoPdf(pdf);
        fs.writeFileSync(ft, zlib.gzipSync(texto));
      }
      if (texto.length <= 50) lido = { versao: VERSAO_LEITURA, arquivo: a, leitura: null, erro: "PDF sem texto (provavelmente imagem/escaneado)", caracteres: texto.length };
      else lido = { versao: VERSAO_LEITURA, arquivo: a, leitura: lerApolice(texto), generico: generico(texto.slice(0, 40000)), caracteres: texto.length };
    } catch (e) {
      lido = { versao: VERSAO_LEITURA, arquivo: a, leitura: null, erro: (e as Error).message };
    }
    fs.writeFileSync(path.join(LEITURAS, `${nomeArq(a.id)}.json`), JSON.stringify(lido));
    if (++feitos % 100 === 0) console.log(`  ${feitos}/${pendentes.length}`);
  };
  const fila = [...pendentes];
  await Promise.all(Array.from({ length: SO_SENHA ? 12 : 6 }, async () => { while (fila.length) await trabalhar(fila.shift()!); }));
  console.log(`lidos: ${feitos}`);
}

// ---------------- senha ----------------
// PDFs protegidos (guardados pela rodada APOLICES_SO_SENHA=1). A senha costuma ser o CPF/CNPJ
// do segurado (inteiro ou o começo). Candidatos: clientes do Corp das apólices cujo nº aparece
// no nome do arquivo ou no assunto do e-mail (a Porto põe o nº no meio de um número maior).
// O que abre segue o fluxo normal (texto + leitura); o casamento continua exigindo nº,
// vigência e CPF/CNPJ dentro do texto -- a senha só abre a porta, não prova nada.
// Amostra de 24/10/2026: Porto (e-mails "A apólice do seu seguro foi emitida!") = 4 primeiros dígitos.
const FORMATOS_SENHA: [string, (d: string) => string][] = [
  ["4 primeiros", (d) => d.slice(0, 4)], ["inteiro", (d) => d], ["5 primeiros", (d) => d.slice(0, 5)],
  ["6 primeiros", (d) => d.slice(0, 6)], ["8 primeiros", (d) => d.slice(0, 8)], ["3 primeiros", (d) => d.slice(0, 3)],
];

async function abrirComSenha(pdf: Buffer, senha: string): Promise<string | null> {
  try {
    const doc = await getDocumentProxy(new Uint8Array(pdf), { password: senha });
    const { text } = await extractText(doc, { mergePages: true });
    return text.trim();
  } catch (e) {
    if (/password/i.test((e as Error).name + (e as Error).message)) return null;
    throw e;
  }
}

async function senha() {
  const lista = lerJson<Arquivo[]>("lista.json", []);
  const porArq = new Map(lista.map((a) => [nomeArq(a.id), a]));
  const arquivos = fs.readdirSync(PROTEGIDOS).filter((f) => f.endsWith(".pdf"));
  console.log(`PDFs protegidos guardados: ${arquivos.length}`);
  const sb = createServiceClient();
  const porNumero = await indiceDoCorp(sb);

  // nº do Corp em qualquer trecho de 6 a 10 dígitos do nome do arquivo e do assunto
  const nnsDoArquivo = new Map<string, Set<string>>();
  for (const f of arquivos) {
    const a = porArq.get(f.slice(0, -4));
    if (!a) continue;
    const nns = new Set<string>();
    for (const m of `${a.nome} ${a.assunto ?? ""}`.matchAll(/\d+/g))
      for (let i = 0; i < m[0].length; i++)
        for (let n = 6; n <= 10 && i + n <= m[0].length; n++) {
          const t = m[0].slice(i, i + n);
          if (t[0] === "0") continue;
          for (const ap of porNumero.get(t) ?? []) nns.add(ap.nn);
        }
    nnsDoArquivo.set(f, nns);
  }
  const { clientes } = await clientesDoCorp(sb, [...new Set([...nnsDoArquivo.values()].flatMap((s) => [...s]))]);

  const deuCerto: Record<string, number> = {};
  let abertos = 0, semCandidato = 0, naoAbriu = 0, feitos = 0;
  for (const f of arquivos) {
    const a = porArq.get(f.slice(0, -4));
    if (!a) continue;
    const docs = [...new Set([...(nnsDoArquivo.get(f) ?? [])].flatMap((nn) => [...(clientes.get(nn) ?? [])]))].slice(0, 40);
    if (!docs.length) { semCandidato++; continue; }
    const pdf = fs.readFileSync(path.join(PROTEGIDOS, f));
    let texto: string | null = null;
    for (const [rotulo, formato] of FORMATOS_SENHA) {
      for (const d of docs) {
        texto = await abrirComSenha(pdf, formato(d));
        if (texto !== null) { deuCerto[`${rotulo} do ${d.length === 11 ? "CPF" : "CNPJ"}`] = (deuCerto[`${rotulo} do ${d.length === 11 ? "CPF" : "CNPJ"}`] ?? 0) + 1; break; }
      }
      if (texto !== null) break;
    }
    if (texto === null) { naoAbriu++; continue; }
    abertos++;
    fs.writeFileSync(path.join(TEXTOS, `${f.slice(0, -4)}.txt.gz`), zlib.gzipSync(texto));
    const lido: Lido = texto.length <= 50
      ? { versao: VERSAO_LEITURA, arquivo: a, leitura: null, erro: "PDF sem texto (provavelmente imagem/escaneado)", caracteres: texto.length }
      : { versao: VERSAO_LEITURA, arquivo: a, leitura: lerApolice(texto), generico: generico(texto.slice(0, 40000)), caracteres: texto.length };
    fs.writeFileSync(path.join(LEITURAS, `${f.slice(0, -4)}.json`), JSON.stringify(lido));
    if (++feitos % 100 === 0) console.log(`  ${feitos} abertos...`);
  }
  console.log(`abertos: ${abertos} | sem nº do Corp no nome/assunto: ${semCandidato} | candidatos não abriram: ${naoAbriu}`);
  console.log("senha que funcionou:", JSON.stringify(deuCerto));
}

// ---------------- casar ----------------
/** Cotação salva como se fosse apólice (ex.: "Essa é a sua cotação do seguro Pottencial"). */
const ehCotacao = (id: string) => {
  const ft = path.join(TEXTOS, `${nomeArq(id)}.txt.gz`);
  if (!fs.existsSync(ft)) return false;
  const t = zlib.gunzipSync(fs.readFileSync(ft)).toString("utf8").slice(0, 6000);
  return /sua cota[çc][ãa]o|COTA[ÇC][ÃA]O DE SEGURO|COTA[ÇC][ÃA]O N[ºo°]/i.test(t) && !/N[ºo°] DA AP[ÓO]LICE|AP[ÓO]LICE N[ºo°]/i.test(t);
};
const emLotes = <T>(xs: T[], n = 200) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const maisDias = (iso: string, d: number) => new Date(Date.parse(iso) + d * 864e5).toISOString().slice(0, 10);
// Produto pelo ramo do Corp (mesmas chaves do painel de Sinistros).
const PRODUTO_DO_RAMO: Record<string, string> = {
  FIAN: "fianca", "2FIA": "fianca", CAP: "capitalizacao", CAP2: "capitalizacao", "2CAP": "capitalizacao", AUTO: "automovel",
  IMOB: "incendio", "2IMO": "incendio", RESI: "residencial", EMPR: "empresarial", COND: "condominio",
  VIND: "vida", VDCV: "vida", VGRP: "vida", PORT: "portateis", "2POR": "portateis", RC: "rc", RCP: "rc", VIAG: "viagem",
  CCOM: "conteudo", CRES: "conteudo",
};
const produtoDoRamo = (ramo: string) => PRODUTO_DO_RAMO[ramo] ?? "outros";

async function todasAsLinhas<T>(consulta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const out: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await consulta(de, de + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

// Espelho do Corp: emissões (NOVO/RENV sem endosso) com vigência a partir de 2020, qualquer ramo,
// indexadas pelo nº da apólice (só dígitos, sem zeros à esquerda).
type Ap = { nn: string; seg: string; ramo: string; numero: string; ini: string; fim: string };
async function indiceDoCorp(sb: ReturnType<typeof createServiceClient>) {
  type Grade = { seg: string; ramo: string; numero_apolice: string; nosso_numero: number; numero_endosso: string | null; ini_vig: string; fim_vig: string };
  const grade = await todasAsLinhas<Grade>((de, ate) =>
    sb.from("corp_grade").select("seg,ramo,numero_apolice,nosso_numero,numero_endosso,ini_vig,fim_vig")
      .in("tipo", ["NOVO", "RENV"]).gte("ini_vig", "2020-01-01").not("numero_apolice", "is", null).order("id").range(de, ate));
  const porNumero = new Map<string, Ap[]>();
  for (const g of grade) {
    if ((g.numero_endosso ?? "0").replace(/^0+/, "") !== "") continue;
    const dig = g.numero_apolice.replace(/\D/g, "").replace(/^0+/, "");
    if (dig.length < 6) continue; // nº curto / "0" (Pottencial antiga) nunca casa sozinho
    const ap = { nn: String(g.nosso_numero), seg: g.seg, ramo: g.ramo, numero: g.numero_apolice, ini: g.ini_vig, fim: g.fim_vig };
    const lista = porNumero.get(dig) ?? [];
    if (!lista.some((x) => x.nn === ap.nn)) lista.push(ap);
    porNumero.set(dig, lista);
  }
  console.log(`apólices do Corp (emissões desde 2020) no índice: ${new Set([...porNumero.values()].flat().map((a) => a.nn)).size}`);
  return porNumero;
}

/** Cliente do Corp (CPF/CNPJ) de cada apólice: grade de produção do Corp (2025+) e cofre (anos anteriores). */
async function clientesDoCorp(sb: ReturnType<typeof createServiceClient>, nns: string[]) {
  const clientes = new Map<string, Set<string>>();
  const addCli = (nn: string, d: string | null | undefined) => { const doc = documento(d); if (doc) { if (!clientes.has(nn)) clientes.set(nn, new Set()); clientes.get(nn)!.add(doc); } };
  const nomeCliente = new Map<string, string>();
  for (const lote of emLotes(nns)) {
    const { data, error } = await sb.from("producao_erp").select("nosso_numero,cliente_cpf_cnpj,cliente_nome").in("nosso_numero", lote);
    if (error) throw new Error(error.message);
    for (const x of data ?? []) { addCli(String(x.nosso_numero), x.cliente_cpf_cnpj); const d = documento(x.cliente_cpf_cnpj); if (d && x.cliente_nome) nomeCliente.set(d, x.cliente_nome); }
  }
  const locDoNn = new Map<string, string[]>();
  for (const lote of emLotes(nns)) {
    const { data, error } = await sb.from("producao_unificada").select("origem_corp_numero,locatario_id").eq("fonte", "corp").in("origem_corp_numero", lote);
    if (error) throw new Error(error.message);
    for (const x of data ?? []) if (x.locatario_id) locDoNn.set(x.origem_corp_numero, [...(locDoNn.get(x.origem_corp_numero) ?? []), x.locatario_id]);
  }
  const docDoLoc = new Map<string, string | null>();
  for (const lote of emLotes([...new Set([...locDoNn.values()].flat())])) {
    const { data, error } = await sb.from("locatarios").select("id,cpf").in("id", lote);
    if (error) throw new Error(error.message);
    for (const x of data ?? []) docDoLoc.set(x.id, x.cpf);
  }
  for (const [nn, locs] of locDoNn) for (const id of locs) addCli(nn, docDoLoc.get(id));
  return { clientes, nomeCliente };
}

async function casar() {
  const sb = createServiceClient();
  const lidos = fs.readdirSync(LEITURAS).map((f) => JSON.parse(fs.readFileSync(path.join(LEITURAS, f), "utf8")) as Lido)
    .filter((l) => l.versao === VERSAO_LEITURA);
  console.log(`PDFs lidos: ${lidos.length}`);

  const porNumero = await indiceDoCorp(sb);

  // Candidatas por PDF: nº presente + fim de vigência (±1 dia) presente no texto.
  const candidatas = new Map<string, Ap[]>();
  for (const l of lidos) {
    if (!l.generico) continue;
    const datas = new Set(l.generico.datas);
    const achadas = new Map<string, Ap>();
    for (const n of l.generico.numeros)
      for (const ap of porNumero.get(n) ?? [])
        // início E fim da vigência (±1 dia) no texto: evita ligar o PDF de uma renovação à
        // apólice anterior (que termina no dia em que a nova começa) quando a nova não está no Corp.
        if ([ap.ini, ap.fim].every((d) => datas.has(d) || datas.has(maisDias(d, 1)) || datas.has(maisDias(d, -1)))) achadas.set(ap.nn, ap);
    candidatas.set(l.arquivo.id, [...achadas.values()]);
  }

  const nns = [...new Set([...candidatas.values()].flat().map((a) => a.nn))];
  const { clientes, nomeCliente } = await clientesDoCorp(sb, nns);

  const casados: Casado[] = lidos.map((l) => {
    const r = l.leitura;
    const base = { arquivo: l.arquivo, leitura: r, nosso_numero: null, corp: null, garantidos_confirmados: false };
    if (!l.generico) return { ...base, situacao: "nao_lida", motivo: l.erro ?? "não lida" };
    const docsPdf = new Set(l.generico.documentos);
    const cands = candidatas.get(l.arquivo.id) ?? [];
    if (!cands.length) return { ...base, situacao: "sem_par", motivo: ehCotacao(l.arquivo.id) ? "cotação, não é apólice" : "nenhuma apólice do Corp desde 2020 com o mesmo nº, início e fim de vigência" };
    let comCliente = cands.filter((ap) => [...(clientes.get(ap.nn) ?? [])].some((d) => docsPdf.has(d)));
    // Renovação: o PDF novo cita o nº da apólice anterior ("renova apólice nº") e começa no dia
    // em que ela termina, então as duas batem. Desempate seguro: só a apólice deste PDF tem
    // também a data de INÍCIO no texto.
    if (comCliente.length > 1) {
      const datas = new Set(l.generico.datas);
      const comInicio = comCliente.filter((ap) => datas.has(ap.ini) || datas.has(maisDias(ap.ini, 1)) || datas.has(maisDias(ap.ini, -1)));
      if (comInicio.length === 1) comCliente = comInicio;
    }
    if (comCliente.length > 1) return { ...base, situacao: "conferir", motivo: `ambígua: ${comCliente.length} apólices do Corp`, candidatos: comCliente.map((a) => ({ nn: a.nn, numero: a.numero, seg: a.seg, ramo: a.ramo, ini: a.ini, fim: a.fim })) };
    if (!comCliente.length) {
      const semDoc = cands.every((ap) => !clientes.has(ap.nn));
      return { ...base, situacao: "conferir", motivo: semDoc ? "nº e vigência conferem, mas o cliente do Corp não tem CPF/CNPJ" : "nº e vigência conferem, mas o CPF/CNPJ do cliente do Corp não está no PDF" };
    }
    const ap = comCliente[0];
    const cli = [...clientes.get(ap.nn)!].find((d) => docsPdf.has(d))!;
    const corp = { seg: ap.seg, ramo: ap.ramo, produto: produtoDoRamo(ap.ramo), ini: ap.ini, fim: ap.fim, numero: ap.numero, cliente: cli };
    const garantidos_confirmados = corp.produto === "fianca" && !!r?.fianca && r.segurado?.documento === cli && r.garantidos.length > 0;
    return { ...base, situacao: "certa", motivo: null, nosso_numero: ap.nn, corp, garantidos_confirmados };
  });
  salvarJson("casamento.json", casados);
  salvarJson("nomes-clientes.json", Object.fromEntries(nomeCliente));

  // ---------- prévia ----------
  const certas = casados.filter((c) => c.situacao === "certa");
  const porProduto: Record<string, Record<string, number>> = {};
  for (const c of certas) {
    porProduto[c.corp!.produto] ??= {};
    porProduto[c.corp!.produto][c.corp!.seg] = (porProduto[c.corp!.produto][c.corp!.seg] ?? 0) + 1;
  }
  const sit: Record<string, number> = {};
  for (const c of casados) sit[c.situacao] = (sit[c.situacao] ?? 0) + 1;
  console.log("\nPRÉVIA (nada gravado)");
  console.log("situação dos PDFs:", JSON.stringify(sit));
  console.log("PDFs certos por produto e seguradora:");
  console.table(porProduto);
  const nnsCertos = new Set(certas.map((c) => c.nosso_numero!));
  const porProdutoNn: Record<string, Set<string>> = {};
  for (const c of certas) (porProdutoNn[c.corp!.produto] ??= new Set()).add(c.nosso_numero!);
  console.log("apólices do Corp distintas ligadas a PDF:", nnsCertos.size, JSON.stringify(Object.fromEntries(Object.entries(porProdutoNn).map(([k, v]) => [k, v.size]))));
  const fiancaOk = certas.filter((c) => c.garantidos_confirmados);
  const docsGar = new Set(fiancaOk.flatMap((c) => c.leitura!.garantidos.map((g) => g.documento)));
  const existentes = new Set<string>();
  for (const lote of emLotes([...docsGar])) {
    const { data } = await sb.from("locatarios").select("cpf").in("cpf", lote);
    for (const x of data ?? []) existentes.add(x.cpf);
  }
  console.log(`Fiança com locatários confirmados: ${fiancaOk.length} PDFs | locatários distintos: ${docsGar.size} (já no cofre: ${existentes.size}, novos: ${docsGar.size - existentes.size})`);
  console.log(`Fiança certas sem locatários aproveitáveis (segurado lido ≠ cliente do Corp ou modelo não lido): ${certas.filter((c) => c.corp!.produto === "fianca" && !c.garantidos_confirmados).length}`);
  let sin = 0;
  const nnsFiancaOk = [...new Set(fiancaOk.map((c) => c.nosso_numero!))];
  for (const lote of emLotes(nnsFiancaOk)) {
    const { count } = await sb.from("sinistros_corp").select("id", { count: "exact", head: true }).in("nosso_numero", lote);
    sin += count ?? 0;
  }
  let sinTodos = 0;
  for (const lote of emLotes([...nnsCertos])) {
    const { count } = await sb.from("sinistros_corp").select("id", { count: "exact", head: true }).in("nosso_numero", lote);
    sinTodos += count ?? 0;
  }
  console.log(`sinistros do Corp em apólices ligadas a PDF: ${sinTodos} (com locatário confirmado: ${sin})`);
  const motivos: Record<string, number> = {};
  for (const c of casados) if (c.situacao !== "certa" && c.motivo) { const k = `${c.situacao}: ${c.motivo.replace(/\d+ apólices/, "N apólices")}`; motivos[k] = (motivos[k] ?? 0) + 1; }
  console.log("\nmotivos fora de 'certa':");
  for (const [m, n] of Object.entries(motivos).sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${n} × ${m.slice(0, 160)}`);
  if (FONTE === "email") {
    const { novas, jaNoAcervo, repetidas } = await selecionarEmail(sb, casados);
    const porProd: Record<string, number> = {};
    for (const c of novas) porProd[c.corp!.produto] = (porProd[c.corp!.produto] ?? 0) + 1;
    const novasLoc = novas.filter((c) => c.garantidos_confirmados);
    let sinNovas = 0;
    for (const lote of emLotes(novasLoc.map((c) => c.nosso_numero!))) {
      const { count } = await sb.from("sinistros_corp").select("id", { count: "exact", head: true }).in("nosso_numero", lote);
      sinNovas += count ?? 0;
    }
    console.log(`\nE-MAIL → o que entraria no acervo: ${novas.length} apólices novas ${JSON.stringify(porProd)} | Fiança com locatários: ${novasLoc.length} (sinistros nelas: ${sinNovas})`);
    console.log(`  fora: ${jaNoAcervo} PDFs de apólices que já estão no acervo (Drive) | ${repetidas} cópias repetidas da mesma apólice em outros e-mails`);
  }
  console.log(`\n(simulação — nada gravado; arquivos de trabalho em ${CACHE})`);
}

/** E-mail: o que entra no acervo -- só apólices certas que ainda não têm PDF gravado (Drive ou
 * e-mail anterior), uma por apólice (preferindo a que trouxe os locatários). Os demais anexos
 * (boletos, cotações, apólices sem par no Corp) não são gravados. */
async function selecionarEmail(sb: ReturnType<typeof createServiceClient>, casados: Casado[]) {
  const certas = casados.filter((c) => c.situacao === "certa");
  const jaTem = new Set<string>();
  for (const lote of emLotes([...new Set(certas.map((c) => c.nosso_numero!))])) {
    const { data, error } = await sb.from("apolice_documentos").select("nosso_numero").eq("situacao", "certa").in("nosso_numero", lote);
    if (error) throw new Error(error.message);
    for (const x of data ?? []) jaTem.add(x.nosso_numero);
  }
  const escolhida = new Map<string, Casado>();
  for (const c of certas) {
    if (jaTem.has(c.nosso_numero!)) continue;
    const atual = escolhida.get(c.nosso_numero!);
    if (!atual || (c.garantidos_confirmados && !atual.garantidos_confirmados)) escolhida.set(c.nosso_numero!, c);
  }
  return { novas: [...escolhida.values()], jaNoAcervo: certas.filter((c) => jaTem.has(c.nosso_numero!)).length, repetidas: certas.filter((c) => !jaTem.has(c.nosso_numero!)).length - escolhida.size };
}

// ---------------- gravar ----------------
const normNome = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

async function gravar() {
  const sb = createServiceClient();
  const casados = lerJson<Casado[]>("casamento.json", []);
  const nomesCorp = new Map(Object.entries(lerJson<Record<string, string>>("nomes-clientes.json", {})));
  if (!casados.length) throw new Error("rode 'casar' antes");
  const gravaveis = FONTE === "email" ? (await selecionarEmail(sb, casados)).novas : casados;
  const certas = gravaveis.filter((c) => c.situacao === "certa");

  // 1. Cofre: cliente do Corp de cada apólice certa + locatários confirmados da Fiança
  //    (não sobrescreve quem já existe; só marca a fonte "apolice_pdf").
  const pessoas = new Map<string, string | null>();
  const quer = (d: string, nome: string | null | undefined) => { if (!pessoas.get(d)) pessoas.set(d, nome ?? null); };
  for (const c of certas) {
    const r = c.leitura;
    quer(c.corp!.cliente, (r?.segurado?.documento === c.corp!.cliente ? r.segurado.nome : null) ?? nomesCorp.get(c.corp!.cliente));
    if (c.garantidos_confirmados) for (const g of r!.garantidos) quer(g.documento, g.nome);
  }
  const idPorDoc = new Map<string, string>();
  const fontesPorId = new Map<string, string[]>();
  for (const lote of emLotes([...pessoas.keys()])) {
    const { data, error } = await sb.from("locatarios").select("id,cpf,fontes").in("cpf", lote);
    if (error) throw new Error(error.message);
    for (const x of data ?? []) { idPorDoc.set(x.cpf, x.id); fontesPorId.set(x.id, x.fontes ?? []); }
  }
  const novos = [...pessoas].filter(([d]) => !idPorDoc.has(d)).map(([d, nome]) => ({
    cpf: d, nome, nome_normalizado: nome ? normNome(nome) : null, tipo_documento: d.length === 11 ? "cpf" : "cnpj",
    identificacao: "documento", primeira_fonte: "apolice_pdf", fontes: ["apolice_pdf"],
  }));
  for (const lote of emLotes(novos, 500)) {
    const { data, error } = await sb.from("locatarios").insert(lote).select("id,cpf");
    if (error) throw new Error(error.message);
    for (const x of data ?? []) idPorDoc.set(x.cpf, x.id);
  }
  let marcados = 0;
  for (const [id, fontes] of fontesPorId) if (!fontes.includes("apolice_pdf")) {
    const { error } = await sb.from("locatarios").update({ fontes: [...fontes, "apolice_pdf"] }).eq("id", id);
    if (error) throw new Error(error.message);
    marcados++;
  }

  // 2. Documentos (todos, com a situação; nenhum dado pessoal aqui).
  const fianca = (c: Casado) => c.corp?.produto === "fianca" || (!c.corp && c.leitura?.fianca);
  const linhas = gravaveis.map((c) => {
    const r = c.leitura;
    const usaLeitura = c.garantidos_confirmados; // campos lidos (local, coberturas, estipulante) só na Fiança confirmada
    return {
      fonte: FONTE, arquivo_id: c.arquivo.id, arquivo_nome: c.arquivo.nome, arquivo_pasta_id: c.arquivo.pasta, arquivo_criado_em: c.arquivo.criado,
      produto: c.corp?.produto ?? (fianca(c) ? "fianca" : "nao_identificado"), seguradora: c.corp?.seg ?? r?.seguradora ?? null,
      numero_apolice: c.corp?.numero ?? r?.numero ?? null, ramo: c.corp?.ramo ?? r?.ramo ?? null,
      vigencia_inicio: c.corp?.ini ?? r?.vigencia_inicio ?? null, vigencia_fim: c.corp?.fim ?? r?.vigencia_fim ?? null, emitida_em: r?.emitida_em ?? null,
      limite_maximo_garantia: usaLeitura ? r!.limite_maximo_garantia : null, coberturas: usaLeitura ? r!.coberturas : [],
      local_risco: usaLeitura && r!.local_risco ? { texto: r!.local_risco } : {},
      estipulante_nome: usaLeitura ? r!.estipulante_nome : null, estipulante_documento: usaLeitura ? r!.estipulante_documento : null,
      nosso_numero: c.nosso_numero, regra_casamento: c.situacao === "certa" ? "numero_vigencia_cliente" : null,
      situacao: c.situacao, motivo: c.motivo, gravado_em: new Date().toISOString(),
    };
  });
  const idDoc = new Map<string, string>();
  for (const lote of emLotes(linhas, 300)) {
    const { data, error } = await sb.from("apolice_documentos").upsert(lote, { onConflict: "arquivo_id" }).select("id,arquivo_id");
    if (error) throw new Error(error.message);
    for (const x of data ?? []) idDoc.set(x.arquivo_id, x.id);
  }

  // 3. Vínculos pessoa ↔ apólice (só nas certas): cliente do Corp como segurado; locatários só na Fiança confirmada.
  const partes = certas.flatMap((c) => {
    const documento_id = idDoc.get(c.arquivo.id)!;
    return [
      { documento_id, nosso_numero: c.nosso_numero, papel: "segurado", ordem: 1, locatario_id: idPorDoc.get(c.corp!.cliente)! },
      ...(c.garantidos_confirmados ? c.leitura!.garantidos.map((g, i) => ({ documento_id, nosso_numero: c.nosso_numero, papel: "garantido", ordem: i + 1, locatario_id: idPorDoc.get(g.documento)! })) : []),
    ];
  });
  for (const lote of emLotes([...new Set(partes.map((p) => p.documento_id))], 300)) {
    const { error } = await sb.from("apolice_partes").delete().in("documento_id", lote);
    if (error) throw new Error(error.message);
  }
  for (const lote of emLotes(partes, 500)) {
    const { error } = await sb.from("apolice_partes").insert(lote);
    if (error) throw new Error(error.message);
  }
  console.log(`gravado: ${linhas.length} documentos (${certas.length} ligados a apólice do Corp) | ${partes.length} vínculos | cofre: ${novos.length} pessoas novas, ${marcados} existentes marcadas com a fonte "apolice_pdf"`);
  console.log(`apague a pasta de trabalho com dados pessoais quando terminar: ${CACHE}`);
}

const etapa = process.argv[2];
const etapas: Record<string, () => Promise<void>> = { listar, ler, senha, casar, gravar };
if (!etapas[etapa]) {
  console.log("uso: npx tsx scripts/apolices/carga-drive.ts listar|ler|senha|casar|gravar");
  process.exit(1);
}
etapas[etapa]().catch((e) => {
  console.error(e);
  process.exit(1);
});
