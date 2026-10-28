// Correções PROPOSTAS (nada é gravado) da vigência de Capitalização: o certificado da seguradora é a fonte da verdade
// (regra do Matheus, 28/10): início = o do certificado; fim = início + modo de reaplicação (12/15/30 meses). Lê os resultados de
// certificados-bitrix.ts e certificados-emails.ts (arquivos JSON na pasta temporária), compara com o documento do ERP e gera um CSV
// de conferência com Código O2, vigência do ERP, vigência pelo certificado e a diferença em dias. uso:
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/correcoes-vigencia-cap.ts
process.loadEnvFile(".env.local");
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServiceClient } from "@/lib/supabase/service";

type Ach = { nosso_numero: number; situacao: string; arquivo: string; inicio: string | null; meses: number | null; fim_calculado: string | null; fim_erp: string | null; tarefa?: number; caixa?: string };
const sb = createServiceClient();
const dias = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const csv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const ler = (nome: string): Ach[] => { const f = path.join(os.tmpdir(), nome); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : []; };

(async () => {
  const fontes: [string, Ach[]][] = [["Bitrix", ler("certificados-bitrix.json")], ["e-mail", ler("certificados-emails.json")], ["e-mail (passada restante)", ler("certificados-emails-2.json")]];
  const porCodigo = new Map<number, Ach & { fonte: string }>();
  for (const [fonte, lista] of fontes) for (const a of lista) {
    const antes = porCodigo.get(a.nosso_numero);
    if (!antes || (antes.situacao === "provavel" && a.situacao === "confirmada")) porCodigo.set(a.nosso_numero, { ...a, fonte });
  }
  const codigos = [...porCodigo.keys()];
  const erp = new Map<number, { inicio: string | null; fim: string | null }>();
  for (let i = 0; i < codigos.length; i += 100) {
    const { data } = await sb.from("erp_documentos").select("nosso_numero,vigencia_inicio,vigencia_fim").in("nosso_numero", codigos.slice(i, i + 100));
    for (const d of data ?? []) erp.set(Number(d.nosso_numero), { inicio: d.vigencia_inicio, fim: d.vigencia_fim });
  }
  const linhas = [["codigo_o2", "fonte", "situacao_ligacao", "inicio_erp", "fim_erp", "inicio_certificado", "modo_meses", "fim_pelo_certificado", "dif_inicio_dias", "dif_fim_dias", "correcao_proposta"].map(csv).join(";")];
  const r = { ligados: porCodigo.size, semDadoDeVigencia: 0, inicioIgual: 0, inicioDiferente: 0, fimIgualOuAte1: 0, fimDiferente: 0 };
  const faixas: Record<string, number> = {};
  for (const [cod, a] of porCodigo) {
    const e = erp.get(cod);
    if (!e || !a.inicio || !a.fim_calculado) { r.semDadoDeVigencia++; continue; }
    const dIni = e.inicio ? dias(a.inicio, e.inicio) : null;
    const dFim = e.fim ? dias(a.fim_calculado, e.fim) : null;
    if (dIni === 0) r.inicioIgual++; else r.inicioDiferente++;
    const fimOk = dFim !== null && Math.abs(dFim) <= 1;
    if (fimOk) r.fimIgualOuAte1++; else { r.fimDiferente++; const k = dFim === null ? "ERP sem fim" : Math.abs(dFim) <= 7 ? `${dFim > 0 ? "ERP depois" : "ERP antes"}: 2 a 7 dias` : `${dFim > 0 ? "ERP depois" : "ERP antes"}: mais de 7 dias`; faixas[k] = (faixas[k] ?? 0) + 1; }
    const corrige = dIni !== 0 || !fimOk;
    linhas.push([cod, a.fonte, a.situacao, e.inicio, e.fim, a.inicio, a.meses, a.fim_calculado, dIni, dFim, corrige ? `início ${a.inicio} / fim ${a.fim_calculado}` : "nenhuma"].map(csv).join(";"));
  }
  const saida = path.join(os.tmpdir(), "correcoes-propostas-vigencia-cap.csv");
  fs.writeFileSync(saida, "﻿" + linhas.join("\n"));
  console.log("CORREÇÕES PROPOSTAS DE VIGÊNCIA (Capitalização) — nada gravado");
  console.log(JSON.stringify(r));
  console.log("fim diferente por faixa:", JSON.stringify(faixas));
  console.log("arquivo:", saida);
})();
