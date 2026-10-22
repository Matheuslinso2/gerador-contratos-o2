import { FONTE, O2_CINZA_CLARO, O2_CINZA_ESCURO, O2_LARANJA, O2_NAVY, blocoSecao, linhaCampo } from "@/lib/integracoes/emailO2";
import { metricaInfo, type ConfigDesempenho, type LinhaDesempenho } from "./desempenho";

// E-mail de PARCIAL de uma campanha com metas (22/10/2026): o que
// antes a equipe montava à mão para cada imobiliária ("🏆 Parcial da
// Campanha Clube Elite O2 - Intex"). Cada imobiliária recebe só os PRÓPRIOS
// números. Os valores ficam fixos no momento em que o rascunho é gerado.

const escapar = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const dataBr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

const ROTULO_METRICA_EMAIL: Record<string, string> = {
  contratacoes: "contratações",
  cotacoes: "cotações",
  premio: "prêmio",
  comissao: "comissão",
};

function formatar(n: number, moeda: boolean): string {
  return moeda
    ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })
    : n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

function barraProgresso(percentual: number): string {
  const p = Math.max(0, Math.min(100, Math.round(percentual)));
  return `
    <tr>
      <td style="padding:18px 28px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <tr>
            <td style="background:${O2_CINZA_CLARO};border-radius:8px;height:14px;padding:0;">
              <table role="presentation" width="${Math.max(p, 2)}%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                <tr><td style="background:${O2_LARANJA};border-radius:8px;height:14px;font-size:0;line-height:0;">&nbsp;</td></tr>
              </table>
            </td>
          </tr>
        </table>
        <p style="margin:6px 0 0;font-size:13px;font-weight:700;color:${O2_NAVY};font-family:${FONTE};text-align:center;">${p}% da meta</p>
      </td>
    </tr>`;
}

function paragrafo(html: string, alinhar: "left" | "center" = "left"): string {
  return `
    <tr>
      <td style="padding:16px 28px 0;" align="${alinhar}">
        <p style="margin:0;font-size:14px;line-height:1.6;color:${O2_CINZA_ESCURO};font-family:${FONTE};">${html}</p>
      </td>
    </tr>`;
}

export function montarEmailParcial(programa: ConfigDesempenho, linha: LinhaDesempenho, hoje: string, diasRestantes: number) {
  const metrica = metricaInfo(programa.metrica);
  const unidade = ROTULO_METRICA_EMAIL[programa.metrica] ?? "resultado";
  const nome = escapar(linha.nome.replace(/ \(grupo\)$/, ""));
  const meta = linha.meta ?? 0;
  const percentual = meta > 0 ? (linha.realizado / meta) * 100 : 0;
  const atingiu = meta > 0 && linha.realizado >= meta;

  const numeros =
    linhaCampo("Meta da campanha", `${formatar(meta, metrica.moeda)}${metrica.moeda ? "" : ` ${unidade}`}`) +
    linhaCampo("Realizado até agora", `${formatar(linha.realizado, metrica.moeda)}${metrica.moeda ? "" : ` ${unidade}`}`) +
    (atingiu ? linhaCampo("Situação", "Meta atingida! 🏆") : linhaCampo("Faltam", `${formatar(linha.faltam ?? 0, metrica.moeda)}${metrica.moeda ? "" : ` ${unidade}`}`)) +
    linhaCampo("Dias até o fim da campanha", diasRestantes > 0 ? `${diasRestantes} dias (até ${dataBr(programa.fim)})` : "Campanha encerrada") +
    (linha.funil.emAndamento > 0 ? linhaCampo("Cotações em andamento", String(linha.funil.emAndamento)) : "");

  const abertura = atingiu
    ? `A <b>${nome}</b> já atingiu a meta da campanha <b>${escapar(programa.nome)}</b>. Parabéns pela parceria e pelo resultado!`
    : `Segue o acompanhamento da <b>${nome}</b> na campanha <b>${escapar(programa.nome)}</b>, com os números até ${dataBr(hoje)}.`;

  const premiacao = programa.premiacao_descricao
    ? paragrafo(`<b style="color:${O2_LARANJA};">Ao atingir a meta:</b> ${escapar(programa.premiacao_descricao)}`)
    : "";

  const fechamento = atingiu
    ? "Nossa equipe vai entrar em contato para os próximos passos."
    : linha.funil.emAndamento > 0
      ? `Vocês têm ${linha.funil.emAndamento} cotação(ões) em andamento: nossa equipe está à disposição para ajudar a fechar e chegar lá.`
      : "Nossa equipe está à disposição para ajudar a chegar lá. Envie suas cotações!";

  const corpoHtml =
    paragrafo("Olá, parceiro O2!") +
    paragrafo(abertura) +
    (meta > 0 ? barraProgresso(percentual) : "") +
    blocoSecao("Seu desempenho parcial", numeros) +
    premiacao +
    paragrafo(fechamento) +
    `<tr><td style="padding:12px 0 0;"></td></tr>`;

  const nomeSimples = linha.nome.replace(/ \(grupo\)$/, "");
  return {
    nome: `🏆 Parcial — ${programa.nome} — ${nomeSimples} (${dataBr(hoje).slice(0, 5)})`,
    assunto: `🏆 Parcial da campanha ${programa.nome} — ${nomeSimples}`,
    titulo: programa.nome,
    introducao: `Acompanhamento parcial até ${dataBr(hoje)}`,
    corpoHtml,
  };
}
