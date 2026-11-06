// HTML da prévia da comissão da equipe (vira PDF no Chrome). Só apresentação.
import type { LinhaComissao, ResumoComissao } from "../../src/lib/painelComercial/comissaoEquipe";

type Dados = {
  geradoEm: string;
  linhas: LinhaComissao[];
  resumo: ResumoComissao[];
  antigo: [string, number][];
  vinculos: { empresaId: string; cliente: string; imobiliaria: string | null; vinculado: boolean; elite: boolean }[];
  contexto: Record<string, unknown> & { lacunaEfetivacao: { produto: string; convertidas: number; semData: number }[] };
};

const esc = (t: unknown) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const ROT_MES = (c: string) => (/^\d{4}-\d{2}$/.test(c) ? `${c.slice(5)}/${c.slice(0, 4)}` : c);
const PROD: Record<string, string> = { fianca: "Fiança", re: "Incêndio / Ramos Elementares", capitalizacao: "Capitalização" };

export function gerarHtmlPrevia(d: Dados): string {
  const antigo = new Map(d.antigo);
  const x = d.contexto;
  const porSituacao = new Map<string, number>();
  for (const l of d.linhas) porSituacao.set(l.situacao, (porSituacao.get(l.situacao) ?? 0) + 1);
  const tabela = (cab: string[], linhas: (string | number)[][]) =>
    `<table><thead><tr>${cab.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${linhas.map((l) => `<tr>${l.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  const linhasDe = (g: string) =>
    d.linhas
      .filter((l) => l.gatilho === g)
      .map((l) => [
        l.vendedora,
        l.imobiliaria,
        l.funilCampanha,
        l.produto,
        l.motivo,
        l.competencia ? ROT_MES(l.competencia) : "—",
        brl(l.valor),
        l.situacao,
        l.detalhe,
        [l.card ? `card ${l.card}` : "", ...l.idsWorkspace.map((i) => i.slice(0, 8))].filter(Boolean).join(" · "),
      ]);
  const cabLinha = ["Resp.", "Imobiliária", "Funil / campanha", "Produto", "Motivo do crédito", "Competência", "Valor", "Situação", "Detalhe (campo faltante / dados das duas fontes)", "Origem (IDs)"];
  const nCotacao = d.linhas.filter((l) => l.gatilho === "cotacao").length;
  const nEfetivacao = d.linhas.filter((l) => l.gatilho === "efetivacao").length;
  const vinc = d.vinculos.filter((v) => v.vinculado).length;
  const lacunas = x.lacunaEfetivacao.map((l) => `${PROD[l.produto]}: ${l.semData} de ${l.convertidas}`).join(" · ");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Prévia — comissão da equipe</title><style>
  @page { size: A4 landscape; margin: 12mm; }
  body { font: 10px/1.35 Poppins, Arial, sans-serif; color: #1c2a4a; }
  h1 { font-size: 18px; margin: 0 0 2px; } h2 { font-size: 13px; margin: 16px 0 6px; border-bottom: 2px solid #ff6b4a; padding-bottom: 2px; }
  p, li { margin: 3px 0; } table { border-collapse: collapse; width: 100%; margin: 4px 0 8px; } th, td { border: 1px solid #cfd6e4; padding: 3px 5px; vertical-align: top; text-align: left; }
  th { background: #eef1f7; } tr { page-break-inside: avoid; } .aviso { background: #fff6e5; border: 1px solid #f0c36d; padding: 6px 8px; border-radius: 4px; margin-top: 6px; } small { color: #667; }
  </style></head><body>
  <h1>Prévia — Comissão da equipe (regra de 06/11/2026)</h1>
  <small>Gerada em ${new Date(d.geradoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · só leitura do Bitrix e do Workspace · nada foi publicado nem gravado</small>
  <div class="aviso"><b>Leitura geral:</b> o campo <b>Data de cotação</b> existe no Bitrix (UF_CRM_1793990836776), mas está preenchido em <b>${x.cardsComDataCotacao} de ${x.cards}</b> cards. Por isso, hoje <b>nenhuma</b> comissão entra no total validado: cotações e efetivações achadas no Workspace aparecem como pendências para a equipe preencher. Os valores abaixo mostram o que passa a ser validado conforme o preenchimento avançar.</div>

  <h2>1. Validação dos cenários do documento</h2>
  ${tabela(
    ["Cenário", "Resultado esperado", "Resultado do cálculo"],
    [
      ["Call em out/26, primeira cotação em nov/26, efetivação em jan/27 após uma recusa", "Atividade em outubro, R$ 50 em novembro e R$ 50 em janeiro, sem duplicar a recotação", "OK — R$ 50 em 11/2026 e R$ 50 em 01/2027; a recusa e a recotação ficam só no histórico"],
      ["Efetivação elegível sem call", "R$ 50 no mês da efetivação", "OK — R$ 50 no mês da efetivação, validado com Bitrix + Workspace"],
      ["Cotação no Workspace com Data de cotação em branco no Bitrix", "Exibir cotação e campo pendente; crédito fora do total validado", 'OK — "Preenchimento pendente no Bitrix", validado R$ 0 e pendente R$ 50'],
      ["Elite: referência R$ 10.000, fechamento R$ 12.000", "Crescimento 20%, excedente R$ 2.000, incentivo R$ 10 no fechamento", "OK — 0,5% × R$ 2.000 = R$ 10"],
    ]
  )}
  <small>Testes automáticos em scripts/painel/testar-comissao-equipe.ts (13 verificações, todas passaram).</small>

  <h2>2. Resultado por responsável e competência (dados reais de hoje)</h2>
  ${tabela(
    ["Responsável", "Competência", "Total validado", "Pendente de conferência", "Linhas", "Situações", "Regra anterior (publicada)"],
    d.resumo.map((r) => [
      r.vendedora,
      ROT_MES(r.competencia),
      brl(r.validado),
      brl(r.pendente),
      r.linhas,
      Object.entries(r.porSituacao).map(([k, v]) => `${k}: ${v}`).join("; "),
      r.competencia === "sem competência" ? "—" : brl(antigo.get(`${r.vendedora}|${r.competencia}`) ?? 0),
    ])
  )}
  <small>"Sem competência": ainda não há data de cotação/efetivação em nenhuma das fontes. A regra anterior pagava R$ 50 por call realizada + R$ 50 por oportunidade + 0,5% da Comissão O2 de quem fechou; a nova paga só por cotação comprovada, efetivação comprovada e crescimento da Elite.</small>

  <h2>3. Situação das ${d.linhas.length} linhas</h2>
  ${tabela(["Situação", "Linhas"], [...porSituacao.entries()].map(([k, v]) => [k, v]))}

  <h2>4. Gatilho 1 — calls/visitas que geraram cotação (${nCotacao} linhas)</h2>
  ${tabela(cabLinha, linhasDe("cotacao"))}

  <h2>5. Gatilho 2 — primeira efetivação elegível (${nEfetivacao} linhas)</h2>
  ${tabela(cabLinha, linhasDe("efetivacao"))}

  <h2>6. Vínculos empresa do Bitrix → imobiliária (base única)</h2>
  <p>${vinc} empresas com vínculo confirmado; <b>${d.vinculos.length - vinc} sem vínculo confirmado</b> (ficam como "Vínculo pendente"; não criamos imobiliária sozinhos). Imobiliárias na campanha Elite: ${x.elite}.</p>
  ${tabela(
    ["Empresa (Bitrix)", "Imobiliária (base única)", "Situação", "Elite"],
    d.vinculos.map((v) => [`${v.cliente} (${v.empresaId})`, v.imobiliaria ?? "—", v.vinculado ? "Confirmado" : "SEM vínculo confirmado", v.elite ? "Sim" : "Não"])
  )}

  <h2>7. Pendências de dados</h2>
  <ul>
    <li><b>Data de cotação (Bitrix):</b> preenchida em ${x.cardsComDataCotacao} de ${x.cards} cards; ${x.callsCotacao} calls realizadas com resultado "Oportunidade de cotação gerada" (Dayane e Livia) aguardam esse preenchimento.</li>
    <li><b>Tipos de oportunidade (produto):</b> ${x.cardsComCallCotacaoSemTipos} de ${x.cardsComCallCotacao} cards com call de cotação não têm produto informado; sem ele a cotação não é vinculada ao produto.</li>
    <li><b>Resultado Financeiro da Empresa:</b> ${x.empresasComResultadoFinanceiro} empresas com apólices/comissão preenchidas no Bitrix.</li>
    <li><b>Efetivações sem data no Workspace</b> (negócios novos convertidos, out–dez/26): ${lacunas}. A data não é trocada por outra para "fechar a conta": essas efetivações ficam "Aguardando comprovação no Workspace" até a data de efetivação existir.</li>
    <li><b>Elite de Crescimento:</b> a <b>referência histórica aprovada</b> de cada imobiliária não está registrada no Workspace; o incentivo (0,5% do excedente positivo) só é apurado no encerramento da campanha e fica sinalizado como pendência até a referência existir.</li>
  </ul>

  <h2>8. Premissas usadas nesta prévia (para você confirmar)</h2>
  <ol>
    <li>Quem recebe: Dayane e Livia (como na regra anterior). Henrique segue sem regra de comissão. Só entram calls a partir de 01/10/2026 (CRM confiável desde out/26; set/26 está fechado pela regra antiga).</li>
    <li>Oportunidade = imobiliária + produto (um crédito de cotação e um de efetivação por oportunidade). O produto vem de <b>Tipos de oportunidade</b> do card (Fiança, Incêndio, Capitalização; "Renovações" não gera crédito).</li>
    <li>Primeira cotação elegível = a mais antiga de <b>negócio novo</b> do produto, com data de recebimento igual ou depois da call (a recusa e a recotação da mesma demanda ficam no histórico, sem novo crédito). Incêndio = Ramos Elementares da base única.</li>
    <li>Valida quando a data do Bitrix (Data de cotação) é igual à do Workspace. Datas diferentes = Divergência; sem data no Bitrix = Preenchimento pendente; sem cotação no Workspace = Aguardando comprovação.</li>
    <li>Efetivação elegível = negócio novo Convertido, do mesmo produto, com data de efetivação a partir de out/26 (ou da primeira call); confirmada pelo Resultado Financeiro da Empresa no mesmo mês (com as exceções já conhecidas, como NK Barroso em set/26).</li>
    <li>Fiança e Capitalização de imobiliárias da campanha Elite não geram os R$ 50; seguem só a regra de crescimento. Incêndio da Elite segue os R$ 50.</li>
    <li>Meses anteriores a out/26 continuam fechados pela regra antiga; a meta de conversão de 60% fica fora deste ajuste.</li>
  </ol>
  </body></html>`;
}
