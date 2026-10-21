// Leitor das planilhas "COTAÇÃO DIÁRIA RE" anteriores a jul/2026, que o painel
// /ramos-elementares não lê (formatos antigos). Lê as CÓPIAS CONGELADAS
// (bucket planilhas-congeladas, referência de 18/10/2026) e devolve os
// negócios novos no mesmo formato de mapearNovos (analise.ts), com as mesmas
// normalizações do painel (statusCanonico, ramoCanonico, imobiliariaCanonica),
// para a linha do tempo ligar a mesma cotação entre os meses.
// Formatos (21/10/2026):
//  - jul–set/2025 (antigo): abas IMOBILIÁRIO, INDIVIDUAL, DEMAIS RAMOS + TOTALIZADOR
//  - set–out/2025: abas INCENDIO, DEMAIS RAMOS + CONTAGEM
//  - nov/2025–jan/2026: aba COTAÇÕES NOVO + CONTAGEM
//  - fev–jun/2026: aba NOVOS + CONTAGEM / CONTAGEM verif.
// A mesma cotação ainda aberta reaparece no mês seguinte (herança): linha com
// data de recebimento em mês anterior ao da planilha = herdada.
import { listarCopias, abrirCopia, acharCabecalho, norm } from "./_copias.mjs";
import { imobiliariaCanonica, ramoCanonico, statusCanonico } from "@/lib/ramos-elementares/analise";

export type LinhaNovaAntiga = {
  aba: string;
  linha: number;
  status: string;
  imobiliaria: string;
  segurado: string;
  ramo: string;
  seguradora: string;
  premioTotal: number;
  comissao: number;
  dataRecebida: number | null; // serial de data (dias desde 30/12/1899), como no Google
  dataEfetivacao: number | null;
  cotador: string;
};
export type PlanilhaAntiga = { comp: string; arquivoId: string; nome: string; linhas: LinhaNovaAntiga[]; totais: string[] };

const MESES = ["JANEIRO", "FEVEREIRO", "MARCO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"];
const ABAS_NOVOS = /^(IMOBILIARIO|INDIVIDUAL|DEMAIS RAMOS|INCENDIO|COTACOES NOVO|NOVOS)$/;
// Duas planilhas de setembro/2025 com os mesmos 181 negócios novos em formatos
// diferentes: vale a reorganizada ("09 SETEMBRO/2025"), a outra é ignorada.
const IGNORAR = /^SETEMBRO\/2025|^COPIA DE/;

function competenciaDoNome(nome: string): string | null {
  const n = norm(nome);
  const m = n.match(/(JANEIRO|FEVEREIRO|MARCO|ABRIL|MAIO|JUNHO|JULHO|AGOSTO|SETEMBRO|OUTUBRO|NOVEMBRO|DEZEMBRO)\s*\/\s*(\d{4})/);
  if (!m) return null;
  return `${m[2]}-${String(MESES.indexOf(m[1]) + 1).padStart(2, "0")}`;
}
// Datas da cópia xlsx vêm como Date (meia-noite de Brasília = 03:00 UTC, com
// segundos de fuso histórico); o Google devolve o serial do dia.
function serial(v: unknown): number | null {
  if (v instanceof Date && !isNaN(v.getTime())) return Math.floor((v.getTime() - 3 * 3600_000 - Date.UTC(1899, 11, 30)) / 86400_000);
  if (typeof v === "number" && v > 20000 && v < 80000) return Math.floor(v);
  return null;
}
const txt = (v: unknown) => (v == null ? "" : String(v).trim());
const numero = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export async function lerPlanilhasAntigasRE(ate: string): Promise<PlanilhaAntiga[]> {
  const copias = ((await listarCopias()) as { arquivo_id: string; nome: string; pasta: string }[]).filter(
    (c) => /COTACAO DIARIA RE/.test(norm(c.nome)) && !IGNORAR.test(norm(c.nome))
  );
  const saida: PlanilhaAntiga[] = [];
  for (const c of copias) {
    const comp = competenciaDoNome(c.nome);
    if (!comp || comp >= ate) continue;
    const abas = (await abrirCopia(c, { linhas: 5000, bruto: true })) as [string, unknown[][]][];
    const linhas: LinhaNovaAntiga[] = [];
    const totais: string[] = [];
    for (const [nomeAba, dados] of abas) {
      if (/TOTALIZADOR|CONTAGEM/.test(norm(nomeAba))) {
        // Para a conferência: primeiras linhas TOTAL do quadro de totais da própria planilha.
        for (const l of dados.slice(0, 40)) if (l && /^TOTAL( GERAL)?$/.test(norm(l[0])) && typeof l[1] === "number") totais.push(`${nomeAba}: ${l[1]}`);
        continue;
      }
      if (!ABAS_NOVOS.test(norm(nomeAba))) continue;
      const cab = acharCabecalho(dados, /^IMOBILI/);
      if (!cab) continue;
      const col = (re: RegExp) => cab.colunas.findIndex((x: string) => re.test(x));
      const iStatus = Math.max(0, col(/^STATUS$/));
      const iData = col(/^DT (RECEBIDA|ENTRADA)/);
      const iImob = col(/^IMOBILI/);
      const iSeg = col(/^(SEGURADO|CLIENTE)$/);
      const iRamo = col(/^RAMO$/);
      const iSeguradora = col(/^SEGURADORA$/);
      const iPremio = col(/^PREM\. TOTAL/);
      const iComissao = col(/^COMISSAO$/);
      const iEfet = col(/^DATA EFETIVACAO/);
      const iCotador = col(/^(COTADOR|COLABORADOR)$/);
      dados.slice(cab.indice + 1).forEach((l, k) => {
        const statusRaw = txt(l?.[iStatus]);
        const imob = txt(l?.[iImob]);
        const seg = iSeg >= 0 ? txt(l?.[iSeg]) : "";
        if (!statusRaw || /^\d+$/.test(statusRaw) || (!imob && !seg)) return;
        linhas.push({
          aba: nomeAba,
          linha: cab.indice + 2 + k,
          status: statusCanonico(statusRaw),
          imobiliaria: imobiliariaCanonica(imob),
          segurado: seg,
          ramo: ramoCanonico(iRamo >= 0 ? txt(l?.[iRamo]) : /INDIVIDUAL/.test(norm(nomeAba)) ? "RESIDENCIAL" : "IMOBILIARIO"),
          seguradora: iSeguradora >= 0 ? txt(l?.[iSeguradora]).toUpperCase() : "",
          premioTotal: iPremio >= 0 ? numero(l?.[iPremio]) : 0,
          comissao: iComissao >= 0 ? numero(l?.[iComissao]) : 0,
          dataRecebida: iData >= 0 ? serial(l?.[iData]) : null,
          dataEfetivacao: iEfet >= 0 ? serial(l?.[iEfet]) : null,
          cotador: iCotador >= 0 ? txt(l?.[iCotador]) : "",
        });
      });
    }
    saida.push({ comp, arquivoId: c.arquivo_id, nome: c.nome, linhas, totais });
  }
  return saida.sort((a, b) => a.comp.localeCompare(b.comp));
}
