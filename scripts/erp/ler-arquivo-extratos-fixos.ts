// ERP O2 — 01/11/2026 (Matheus: "quero que sejam lidos agora"): lê com os LEITORES FIXOS novos (extratosPdfOutros.ts, sem IA) os extratos
// do ARQUIVO do Drive que ficaram 'precisa_ia' e grava as linhas em erp_arquivo_extrato_linhas. Conferência soma × total do extrato:
// fecha (±R$ 1 ou 0,5%) → 'lido'; não fecha ou sem total → 'lido_conferir' (linhas gravadas, para conferir). Formato sem leitor continua
// 'precisa_ia'; PDF sem texto → 'nao_lido' (pdf_imagem). NÃO dispara baixa. Desfazer: linhas com lote = '<lote>'.
// uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/ler-arquivo-extratos-fixos.ts <lote> [paralelo=3] [SEG,SEG]
process.loadEnvFile(".env.local");

(async () => {
  const { createServiceClient } = await import("@/lib/supabase/service");
  const { lerExtratoPdfOutros } = await import("@/lib/erp/extratosPdfOutros");
  const { abrirTextoPdfComSenha, candidatosSenhaO2 } = await import("@/lib/pdfComSenha");
  const { drive } = await import("@googleapis/drive");
  const { obterAutenticacaoGoogle } = await import("@/lib/googleAuth");
  const sb = createServiceClient();
  const lote = process.argv[2];
  const paralelo = Number(process.argv[3] ?? 3);
  const filtro = process.argv[4]?.split(",");
  if (!lote) throw new Error("uso: <lote> [paralelo] [seguradoras]");
  const api = drive({ version: "v3", auth: obterAutenticacaoGoogle(["https://www.googleapis.com/auth/drive.readonly"], { contexto: "arquivo de extratos (só leitura)" }) });
  const fila: any[] = [];
  for (let de = 0; ; de += 1000) {
    const { data } = await sb.from("erp_arquivo_extratos").select("arquivo_id, caminho, seguradora, corretora, competencia, pago_em").eq("status", "precisa_ia").range(de, de + 999);
    fila.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const alvo = fila.filter((a) => !filtro || filtro.includes(a.seguradora));
  console.log("a ler:", alvo.length);
  const res = { arquivos: 0, lido: 0, lido_conferir: 0, sem_leitor: 0, imagem: 0, erro: 0, linhas: 0 };
  const semLeitor: Record<string, number> = {};

  async function um(a: any) {
    res.arquivos++;
    let leitor = "", status = "lido", motivo: string | null = null, linhas: any[] = [], total: number | null = null, liquido: number | null = null;
    try {
      const r = await api.files.get({ fileId: a.arquivo_id, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" });
      const texto = (await abrirTextoPdfComSenha(Buffer.from(r.data as ArrayBuffer), candidatosSenhaO2()))?.texto;
      if (!texto) throw new Error("PDF não abriu (senha desconhecida?)");
      if (texto.replace(/\s/g, "").length < 200) { status = "nao_lido"; motivo = "pdf_imagem: sem texto (escaneado)"; }
      else {
        const lido = lerExtratoPdfOutros(a.seguradora, texto);
        if (!lido) { res.sem_leitor++; semLeitor[a.seguradora] = (semLeitor[a.seguradora] ?? 0) + 1; return; }
        leitor = lido.leitor; linhas = lido.linhas; total = lido.total_bruto; liquido = lido.total_liquido;
        const soma = Math.round(linhas.reduce((s, l) => s + (l.valor_comissao ?? 0), 0) * 100) / 100;
        const fecha = total != null && Math.abs(soma - total) <= Math.max(1, Math.abs(total) * 0.005);
        if (!fecha) { status = "lido_conferir"; motivo = total == null ? `sem total no extrato (soma ${soma})` : `soma ${soma} ≠ total ${total}`; }
      }
    } catch (e) { status = "nao_lido"; motivo = (e as Error).message; }
    const soma = Math.round(linhas.reduce((s, l) => s + (l.valor_comissao ?? 0), 0) * 100) / 100;
    if (linhas.length) {
      await sb.from("erp_arquivo_extrato_linhas").delete().eq("arquivo_id", a.arquivo_id);
      const regs = linhas.map((l, i) => ({
        arquivo_id: a.arquivo_id, lote, n: i + 1, seguradora: a.seguradora, corretora: a.corretora, competencia: a.competencia, pago_em: a.pago_em,
        apolice: l.apolice, proposta: l.proposta, endosso: l.endosso, parcela: Number.isFinite(l.parcela) ? l.parcela : null, cliente: l.cliente, cpf_cnpj: l.cpf_cnpj,
        premio: l.premio, pct_comissao: l.pct_comissao, valor_comissao: l.valor_comissao, vigencia_inicio: null, produto: l.produto, tipo: l.tipo, extras: l.extras ?? null,
      }));
      for (let k = 0; k < regs.length; k += 200) {
        const { error } = await sb.from("erp_arquivo_extrato_linhas").insert(regs.slice(k, k + 200));
        if (error) { status = "nao_lido"; motivo = `gravar: ${error.message}`; break; }
      }
    }
    await sb.from("erp_arquivo_extratos").update({ status, motivo, leitor, total_bruto: total, total_liquido: liquido, soma_linhas: soma, n_linhas: linhas.length, lido_em: new Date().toISOString() }).eq("arquivo_id", a.arquivo_id);
    res.linhas += linhas.length;
    if (status === "lido") res.lido++; else if (status === "lido_conferir") res.lido_conferir++; else if (motivo?.startsWith("pdf_imagem")) res.imagem++; else res.erro++;
    if (res.arquivos % 100 === 0) console.log(JSON.stringify(res));
  }

  let i = 0;
  await Promise.all(Array.from({ length: paralelo }, async () => { while (i < alvo.length) { const a = alvo[i++]; await um(a); } }));
  console.log("FIM", JSON.stringify(res), "sem leitor:", JSON.stringify(semLeitor));
})().catch((e) => { console.error("ERRO", e.message); process.exit(1); });
