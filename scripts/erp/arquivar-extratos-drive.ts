// ERP O2 — ARQUIVO dos extratos de comissão do Drive anteriores à baixa do ERP (01/11/2026, "registrar todo tipo de informação").
// Lê a pasta oficial do Drive desde 2025-01 até 2026-07 (o que é de ago/2026 em diante já está em erp_extratos_seguradora) e grava
// em erp_arquivo_extratos (1 por arquivo) + erp_arquivo_extrato_linhas (todos os campos), fonte drive, nível 1. NÃO dispara baixa.
// Leitores fixos (Tokio/Porto/Yelum PDF, Pottencial/Too planilha, planilha genérica); PDF de formato desconhecido fica registrado como
// 'precisa_ia' (sem custo de IA aqui). Só leitura no Drive. Desfazer: delete from erp_arquivo_extratos where lote = '<lote>' (cascata).
// uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/arquivar-extratos-drive.ts <lote> [SEG,SEG...]
process.loadEnvFile(".env.local");
process.env.ERP_EXTRATOS_DESDE = "2025-01";

(async () => {
  const { createServiceClient } = await import("@/lib/supabase/service");
  const { listarArquivosExtratos, parsePlanilhaGenerica } = await import("@/lib/erp/extratosDrive");
  const { parseTokioPdf, parsePortoPdf } = await import("@/lib/erp/extratosPdf");
  const { parseYelumPdf } = await import("@/lib/erp/extratoYelum");
  const { parsePottencial, parseToo } = await import("@/lib/erp/extratos");
  const { abrirTextoPdfComSenha, candidatosSenhaO2 } = await import("@/lib/pdfComSenha");
  const { drive } = await import("@googleapis/drive");
  const { obterAutenticacaoGoogle } = await import("@/lib/googleAuth");
  const sb = createServiceClient();
  const lote = process.argv[2];
  const filtro = process.argv[3]?.split(",");
  if (!lote) throw new Error("uso: <lote> [seguradoras]");
  const api = drive({ version: "v3", auth: obterAutenticacaoGoogle(["https://www.googleapis.com/auth/drive.readonly"], { contexto: "arquivo de extratos (só leitura)" }) });
  const { data: ja } = await sb.from("erp_arquivo_extratos").select("arquivo_id");
  const feitos = new Set((ja ?? []).map((x: { arquivo_id: string }) => x.arquivo_id));
  const arqs = (await listarArquivosExtratos(api)).filter((a) => (a.competencia ?? "") < "2026-08-01" && !feitos.has(a.id) && (!filtro || filtro.includes(a.seguradora)));
  console.log("arquivos a arquivar:", arqs.length);
  const res = { arquivos: 0, lidos: 0, precisa_ia: 0, nao_lidos: 0, linhas: 0, erros: 0 };
  for (const a of arqs) {
    res.arquivos++;
    let leitor = "", status = "lido", motivo: string | null = null;
    let parsed: { linhas: any[]; total_bruto: number | null; total_liquido: number | null } = { linhas: [], total_bruto: null, total_liquido: null };
    try {
      const nome = a.nome.toLowerCase();
      if (a.mime.startsWith("application/vnd.google-apps.") && a.mime !== "application/vnd.google-apps.spreadsheet") throw new Error(`tipo não lido (${a.mime})`);
      const r = a.mime === "application/vnd.google-apps.spreadsheet"
        ? await api.files.export({ fileId: a.id, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, { responseType: "arraybuffer" })
        : await api.files.get({ fileId: a.id, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" });
      const buf = Buffer.from(r.data as ArrayBuffer);
      if (/\.(xlsx?|xlsm|ods|csv)$/.test(nome) || /sheet|excel|csv/.test(a.mime)) {
        if (a.seguradora === "POTT") { parsed = parsePottencial(buf); leitor = "leitor Pottencial"; }
        else if (a.seguradora === "TOO") { parsed = parseToo(buf); leitor = "leitor Too"; }
        if (!parsed.linhas.length) { const g = parsePlanilhaGenerica(buf); parsed = g; leitor = `leitor genérico (${g.cabecalho ?? "sem cabeçalho"})`; }
      } else if (/\.pdf$/.test(nome) || a.mime === "application/pdf") {
        const texto = (await abrirTextoPdfComSenha(buf, candidatosSenhaO2()))?.texto;
        if (!texto) throw new Error("PDF não abriu (senha desconhecida?)");
        const fixo = a.seguradora === "TOKI" ? parseTokioPdf(texto) : a.seguradora === "PORT" ? parsePortoPdf(texto) : a.seguradora === "YELU" ? parseYelumPdf(texto) : null;
        if (fixo) { parsed = fixo as typeof parsed; leitor = `leitor ${a.seguradora} (PDF)`; if (!a.pagoEm && "pago_em" in fixo && typeof (fixo as any).pago_em === "string") a.pagoEm = (fixo as any).pago_em; }
        else { status = "precisa_ia"; motivo = "PDF de formato sem leitor fixo"; }
      } else throw new Error(`tipo não lido (${a.mime || nome})`);
      if (status === "lido" && !parsed.linhas.length) { status = "nao_lido"; motivo = `nenhuma linha reconhecida (${leitor})`; }
    } catch (e) { status = "nao_lido"; motivo = (e as Error).message; }
    const soma = Math.round(parsed.linhas.reduce((s, l) => s + (l.valor_comissao ?? 0), 0) * 100) / 100;
    const { error } = await sb.from("erp_arquivo_extratos").insert({
      lote, arquivo_id: a.id, caminho: a.caminho, arquivo_nome: a.nome, mime: a.mime, modificado_em: a.modificado || null,
      seguradora: a.seguradora, corretora: a.corretora, competencia: a.competencia, pago_em: a.pagoEm, leitor, status, motivo,
      total_bruto: parsed.total_bruto, total_liquido: parsed.total_liquido, soma_linhas: soma, n_linhas: parsed.linhas.length,
    });
    if (error) { res.erros++; console.error("arquivo", a.caminho, error.message); continue; }
    if (parsed.linhas.length) {
      const CAMPOS = ["apolice", "proposta", "endosso", "parcela", "cliente", "cpf_cnpj", "premio", "pct_comissao", "valor_comissao", "vigencia_inicio", "produto", "tipo"];
      const linhas = parsed.linhas.map((l, i) => {
        const extras = Object.fromEntries(Object.entries(l).filter(([k]) => !CAMPOS.includes(k) && k !== "n"));
        const vig = typeof l.vigencia_inicio === "string" && /^\d{4}-\d{2}-\d{2}$/.test(l.vigencia_inicio) ? l.vigencia_inicio : null;
        if (l.vigencia_inicio && !vig) extras.vigencia_inicio_texto = l.vigencia_inicio;
        return { arquivo_id: a.id, lote, n: l.n ?? i + 1, seguradora: a.seguradora, corretora: a.corretora, competencia: a.competencia, pago_em: a.pagoEm,
          apolice: l.apolice, proposta: l.proposta, endosso: l.endosso, parcela: Number.isFinite(l.parcela) ? l.parcela : null, cliente: l.cliente, cpf_cnpj: l.cpf_cnpj,
          premio: l.premio, pct_comissao: l.pct_comissao, valor_comissao: l.valor_comissao, vigencia_inicio: vig, produto: l.produto, tipo: l.tipo,
          extras: Object.keys(extras).length ? extras : null };
      });
      // n repetido no mesmo arquivo: renumera para não perder linha
      const vistos = new Set<number>(); let prox = linhas.length + 1;
      for (const l of linhas) { if (vistos.has(l.n)) l.n = prox++; vistos.add(l.n); }
      for (let k = 0; k < linhas.length; k += 200) {
        const { error: e2 } = await sb.from("erp_arquivo_extrato_linhas").insert(linhas.slice(k, k + 200));
        if (e2) { res.erros++; console.error("linhas", a.caminho, e2.message); break; }
      }
    }
    res[status === "lido" ? "lidos" : status === "precisa_ia" ? "precisa_ia" : "nao_lidos"]++;
    res.linhas += parsed.linhas.length;
    if (res.arquivos % 50 === 0) console.log(JSON.stringify(res));
  }
  console.log("FIM", JSON.stringify(res));
})().catch((e) => { console.error("ERRO", e.message); process.exit(1); });
