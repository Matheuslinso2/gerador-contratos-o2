import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { ENTITY_TYPE_ID_DEAL } from "./entidadesCard";

// Dados individuais da imobiliária do card para os modelos de e-mail das
// campanhas (meta, realizado, quanto falta, prazo, cotações em aberto) e o
// quadro de desempenho pronto (barra de progresso + números).
//
// Fonte: o retrato do Painel Comercial (painel_comercial_snapshot, até 10 min
// de idade), que já junta o card do CRM com a área Campanhas do Workspace pelo
// ID da Empresa. Só vale para Negócios que estão numa campanha com a
// imobiliária vinculada. Qualquer outro card devolve null, e na tela o campo
// vira um trecho entre colchetes para a pessoa preencher à mão (nunca se
// inventa número).

export type DadosCampanhaCard = {
  campanha: string;
  unidade: string;
  meta: string | null;
  realizado: string | null;
  faltam: string | null;
  percentual: string | null;
  diasRestantes: string | null;
  prazo: string | null;
  cotacoesAbertas: string | null;
  quadroHtml: string;
  posicaoEm: string;
};

type Linha = Record<string, unknown>;

const dataBr = (iso: unknown) => (typeof iso === "string" && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function formatar(n: number | null, moeda: boolean): string | null {
  if (n === null) return null;
  return moeda ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }) : n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

const COR = "#073763";
const LARANJA = "#ff9900";
const linhaQuadro = (rotulo: string, valor: string) =>
  `<tr><td style="padding:3px 0;color:#444440;">${rotulo}</td><td style="padding:3px 0;text-align:right;font-weight:bold;color:${COR};">${valor}</td></tr>`;

// Mesmo desenho dos e-mails de parcial da campanha (barra + números), em HTML
// de e-mail (tabelas, estilos inline) e na aparência dos e-mails do card.
function montarQuadro(d: Omit<DadosCampanhaCard, "quadroHtml">, percentualNumero: number | null): string {
  const p = percentualNumero === null ? null : Math.max(0, Math.min(100, Math.round(percentualNumero)));
  const barra =
    p === null
      ? ""
      : `<tr><td colspan="2" style="padding:8px 0 4px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>
            <td style="background:#d9d9d9;border-radius:8px;height:14px;padding:0;">
              <table role="presentation" width="${Math.max(p, 2)}%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr><td style="background:${LARANJA};border-radius:8px;height:14px;font-size:0;line-height:0;">&nbsp;</td></tr></table>
            </td></tr></table>
          <div style="text-align:center;font-weight:bold;font-size:12px;margin-top:4px;">${p}% da meta</div>
        </td></tr>`;
  const linhas = [
    d.meta ? linhaQuadro("Meta da campanha", d.meta) : linhaQuadro("Meta da campanha", "ainda não definida"),
    d.realizado ? linhaQuadro("Realizado até agora", d.realizado) : "",
    d.faltam ? linhaQuadro("Faltam", d.faltam) : "",
    d.diasRestantes && d.prazo ? linhaQuadro("Dias até o fim da campanha", `${d.diasRestantes} (até ${d.prazo})`) : "",
    d.cotacoesAbertas ? linhaQuadro("Cotações em andamento", d.cotacoesAbertas) : "",
  ].join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;max-width:480px;font-family:verdana,sans-serif;font-size:13px;color:${COR};border:1px solid #d9d9d9;border-radius:8px;">
    <tr><td colspan="2" style="padding:10px 12px 0;font-weight:bold;">Seu desempenho na campanha ${d.campanha} <span style="font-weight:normal;color:#8d8683;font-size:11px;">(posição em ${d.posicaoEm})</span></td></tr>
    <tr><td colspan="2" style="padding:0 12px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${barra}${linhas}</table></td></tr>
    <tr><td colspan="2" style="padding:0 0 8px;"></td></tr>
  </table>`;
}

export async function buscarDesempenhoDoCard(entityTypeId: number, itemId: number): Promise<DadosCampanhaCard | null> {
  // O vínculo cliente ↔ imobiliária está nos Negócios do funil Campanhas.
  if (entityTypeId !== ENTITY_TYPE_ID_DEAL) return null;
  try {
    const { data } = await createServiceClient().from("painel_comercial_snapshot").select("linhas:dados->camp_clientes, gerado_em").eq("id", 1).maybeSingle();
    const lista = (data?.linhas as Linha[] | null) ?? [];
    const r = lista.find((x) => Number(x.card) === itemId && x.vinculo === "Vinculado");
    if (!r) return null;
    const moeda = r.moeda === "Sim";
    const meta = num(r.meta);
    const realizado = num(r.realizado);
    const faltam = num(r.faltam);
    const dias = num(r.dias_restantes);
    const posicaoEm = dataBr(String(data?.gerado_em ?? "").slice(0, 10)) ?? "hoje";
    const base = {
      campanha: String(r.campanha ?? "campanha"),
      unidade: String(r.unidade ?? ""),
      meta: formatar(meta, moeda),
      realizado: formatar(realizado, moeda),
      faltam: formatar(faltam, moeda),
      percentual: num(r.pct) === null ? null : `${Math.round(num(r.pct) as number)}%`,
      diasRestantes: dias === null ? null : `${dias} dia${dias === 1 ? "" : "s"}`,
      prazo: dataBr(r.campanha_fim),
      cotacoesAbertas: num(r.cotacoes_abertas) === null ? null : String(num(r.cotacoes_abertas)),
      posicaoEm,
    };
    return { ...base, quadroHtml: montarQuadro(base, num(r.pct)) };
  } catch (e) {
    console.warn("Desempenho da campanha indisponível para o e-mail do card:", e);
    return null;
  }
}
