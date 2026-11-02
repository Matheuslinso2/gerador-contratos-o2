// Carrega para o ERP as regras extraídas de manuais das seguradoras (Drive, fonte F13, nível 4 do guia) em erp_manuais_seguradora + erp_regras_seguradora.
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/carregar-regras-seguradora.ts "<arquivo.json>" [--gravar]
// O JSON tem {manuais:[{seguradora,produto,nome,tipo,data_modificada,tamanho,drive_id,link}], regras:[{seguradora,produto,tema,regra,parametros,manual,pagina,versao_data,trecho,drive_id}], nao_consegui_abrir:[{nome,motivo}]}.
// Regra de manual nunca prova data nem valor: só prevê. Sem --gravar é ensaio. Reexecutar o mesmo arquivo não duplica (manual por drive_id; regra por seguradora+tema+manual+página+texto).
process.loadEnvFile(".env.local");
import { readFileSync } from "node:fs";
import { createServiceClient } from "@/lib/supabase/service";

const arquivo = process.argv[2];
const GRAVAR = process.argv.includes("--gravar");
const sb = createServiceClient();

type Manual = { seguradora: string; produto?: string | null; nome?: string; nome_arquivo?: string; tipo?: string | null; data_modificada?: string | null; data_modificacao?: string | null; tamanho?: number | string | null; tamanho_bytes?: number | string | null; drive_id?: string | null; link?: string | null; leitura?: string | null; observacao?: string | null };
type Regra = { seguradora: string; produto?: string | null; tema: string; regra: string; parametros?: Record<string, unknown> | null; manual?: string | null; pagina?: number | string | null; versao_data?: string | null; trecho?: string | null; drive_id?: string | null };
const TEMAS = new Set(["fatura_mensal", "forma_pagamento", "primeira_parcela", "prazo_emissao", "vigencia", "comissao", "cancelamento_estorno", "renovacao", "sinistro", "endosso", "resgate_capitalizacao", "outros"]);
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();

(async () => {
  const j = JSON.parse(readFileSync(arquivo, "utf8")) as { manuais: Manual[]; regras: Regra[]; nao_consegui_abrir?: { nome: string; motivo: string }[] };
  const { data: segs } = await sb.from("erp_seguradoras").select("id, nome");
  const seguradoraId = (nome: string) => {
    const n = norm(nome);
    const alvo = n.includes("PORTO") ? "PORTO SEGURO" : n.includes("TOKIO") ? "TOKIO" : n.includes("POTTENCIAL") ? "POTTENCIAL" : n.includes("YELUM") || n.includes("LIBERTY") ? "YELUM" : n;
    const c = (segs ?? []).filter((s) => norm(s.nome).includes(alvo));
    return c.length === 1 ? c[0].id : null;
  };
  const invalidas = j.regras.filter((r) => !TEMAS.has(r.tema));
  console.log(`${GRAVAR ? "GRAVANDO" : "ENSAIO"}: ${j.manuais.length} manuais, ${j.regras.length} regras (${invalidas.length} com tema fora do catálogo), ${(j.nao_consegui_abrir ?? []).length} não abertos`);
  if (invalidas.length) console.log("temas fora do catálogo:", [...new Set(invalidas.map((r) => r.tema))].join(", "));
  if (!GRAVAR) return;
  const idPorDrive = new Map<string, string>();
  for (const m of j.manuais) {
    const linha = { seguradora_id: seguradoraId(m.seguradora), seguradora_nome: m.seguradora, produto: m.produto ?? null, nome_arquivo: m.nome ?? m.nome_arquivo ?? "(sem nome)", tipo: m.tipo ?? null, data_modificacao: (m.data_modificada ?? m.data_modificacao) ? String(m.data_modificada ?? m.data_modificacao).slice(0, 10) : null, tamanho_bytes: (m.tamanho ?? m.tamanho_bytes) ? Number(m.tamanho ?? m.tamanho_bytes) : null, drive_id: m.drive_id ?? null, link: m.link ?? null, status_leitura: /n[aã]o|sem/i.test(m.leitura ?? "") ? (/sem texto/i.test(m.leitura ?? "") ? "sem_texto" : "nao_aberto") : "lido", observacao: m.observacao ?? null, lido_por: "sessão Repasses ERP (Drive, somente leitura)" };
    const { data, error } = await sb.from("erp_manuais_seguradora").upsert(linha, { onConflict: "drive_id" }).select("id, drive_id").single();
    if (error) { console.log("erro manual", m.nome, error.message); continue; }
    if (data?.drive_id) idPorDrive.set(data.drive_id, data.id);
  }
  for (const n of j.nao_consegui_abrir ?? []) {
    await sb.from("erp_manuais_seguradora").insert({ seguradora_nome: "(não identificada)", nome_arquivo: n.nome, status_leitura: "nao_aberto", observacao: n.motivo, lido_por: "sessão Repasses ERP (Drive, somente leitura)" });
  }
  let novas = 0, repetidas = 0;
  for (const r of j.regras.filter((x) => TEMAS.has(x.tema))) {
    const pagina = r.pagina === null || r.pagina === undefined ? null : Number(r.pagina) || null;
    const { data: ja } = await sb.from("erp_regras_seguradora").select("id").eq("seguradora_nome", r.seguradora).eq("tema", r.tema).eq("manual_nome", r.manual ?? "").eq("regra", r.regra).maybeSingle();
    if (ja) { repetidas++; const mid = r.drive_id ? idPorDrive.get(r.drive_id) : null; if (mid) await sb.from("erp_regras_seguradora").update({ manual_id: mid }).eq("id", ja.id).is("manual_id", null); continue; }
    const { error } = await sb.from("erp_regras_seguradora").insert({ seguradora_id: seguradoraId(r.seguradora), seguradora_nome: r.seguradora, produto: r.produto ?? null, tema: r.tema, regra: r.regra, parametros: r.parametros ?? {}, manual_id: r.drive_id ? idPorDrive.get(r.drive_id) ?? null : null, manual_nome: r.manual ?? null, pagina, versao_data: r.versao_data ?? null, trecho: r.trecho ?? null });
    if (error) console.log("erro regra", r.tema, error.message); else novas++;
  }
  console.log(`gravadas ${novas} regras novas, ${repetidas} já existiam`);
})();
