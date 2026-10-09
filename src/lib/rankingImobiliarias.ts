// Ranking de produtividade das imobiliárias (quadro da página inicial).
// Módulo PURO (sem acesso a banco): recebe os retratos dos painéis e junta
// os números de cada imobiliária. A leitura do Supabase fica em
// dashboardProducao.ts.
//
// Fontes (todas do retrato que o próprio painel já salva):
//   - Seguro Fiança: topImobiliarias (cotações, convertidos, comissão efetivada)
//   - Capitalização: titulos[] (mesma lista que o painel mostra: Emitido =
//     efetivado, comissão do título emitido)
//   - Ramos Elementares: novos.consolidado.porImobiliaria (só os "novos")
// Seguro Auto NÃO entra: o painel de Auto não registra imobiliária (os
// cards são de cliente final).

type FiancaImob = { nome: string; total: number; convertidos: number; comissaoEfetivada: number };
type CapTitulo = { imobiliaria: string; etapaNome: string; comissao: number };
type RamosImob = { nome: string; total: number; efetivados: number; comissaoEfetivada: number };

export type EntradaRanking = {
  fianca: FiancaImob[];
  capitalizacao: CapTitulo[];
  ramos: RamosImob[];
};

export type NumerosProduto = { cotacoes: number; efetivadas: number; comissao: number };

export type LinhaRanking = {
  nome: string;
  fianca: NumerosProduto;
  capitalizacao: NumerosProduto;
  ramos: NumerosProduto;
  cotacoes: number;
  efetivadas: number;
  comissao: number;
};

// Nomes que significam "sem imobiliária" em cada painel -- ficam de fora.
const SEM_IMOBILIARIA = new Set(["", "—", "-", "nao informada", "nao administrada", "nao administrado"]);

// Palavras que só dizem o tipo da empresa, não quem ela é -- tiradas antes de
// comparar nomes (as mesmas imobiliárias aparecem com grafias diferentes em
// cada painel: "Ramiro Sá Imóveis" / "RAMIRO SÁ IMÓVEIS", "Brotherhood" /
// "Brotherhood Consultoria e Servicos LTDA").
const PALAVRAS_GENERICAS = new Set([
  "ltda", "me", "epp", "eireli", "sa", "s", "a", "de", "da", "do", "dos", "das", "e", "em", "ao",
  "imoveis", "imovel", "imobiliaria", "imobiliarias", "administracao", "administradora", "adm",
  "consultoria", "servicos", "corretora", "corretor", "corretagem", "gestao", "negocios", "participacoes",
  "condominios", "base", "grupo",
]);

function semAcento(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function tokensDe(nome: string): string[] {
  const limpo = semAcento(nome.toLowerCase()).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  return limpo.split(" ").filter((t) => t && !PALAVRAS_GENERICAS.has(t));
}

function semImobiliaria(nome: string): boolean {
  const limpo = semAcento(nome.toLowerCase()).replace(/[^a-z0-9 —-]/g, " ").replace(/\s+/g, " ").trim();
  return SEM_IMOBILIARIA.has(limpo);
}

type Grupo = {
  tokens: string[]; // do nome mais completo visto até agora
  nomes: { nome: string; peso: number }[];
  fianca: NumerosProduto;
  capitalizacao: NumerosProduto;
  ramos: NumerosProduto;
};

const zero = (): NumerosProduto => ({ cotacoes: 0, efetivadas: 0, comissao: 0 });

function contido(menor: string[], maior: string[]): boolean {
  return menor.length > 0 && menor.every((t) => maior.includes(t));
}

// Junta as grafias de uma mesma imobiliária: chave idêntica depois de
// limpar o nome, ou todas as palavras de um nome contidas no outro ("JGM"
// em "JGM de Mesquita") -- MAS só quando isso aponta pra uma única
// imobiliária; se houver dúvida ("Adjuve" sozinho serve pra Petrópolis e
// pra Cabo Frio), mantém separado em vez de juntar errado.
class Agrupador {
  grupos: Grupo[] = [];

  private achar(tokens: string[]): Grupo | null {
    const chave = tokens.join(" ");
    const igual = this.grupos.find((g) => g.tokens.join(" ") === chave);
    if (igual) return igual;
    const candidatos = this.grupos.filter((g) => contido(tokens, g.tokens) || contido(g.tokens, tokens));
    return candidatos.length === 1 ? candidatos[0] : null;
  }

  obter(nome: string): Grupo {
    const tokens = tokensDe(nome);
    let grupo = this.achar(tokens);
    if (!grupo) {
      grupo = { tokens, nomes: [], fianca: zero(), capitalizacao: zero(), ramos: zero() };
      this.grupos.push(grupo);
    } else if (tokens.length > grupo.tokens.length && contido(grupo.tokens, tokens)) {
      grupo.tokens = tokens; // guarda a versão mais completa do nome
    }
    return grupo;
  }
}

function somar(a: NumerosProduto, b: Partial<NumerosProduto>) {
  a.cotacoes += b.cotacoes ?? 0;
  a.efetivadas += b.efetivadas ?? 0;
  a.comissao += b.comissao ?? 0;
}

export function montarRanking(entrada: EntradaRanking, limite = 10): LinhaRanking[] {
  const ag = new Agrupador();

  // Fiança primeiro: é o painel com o nome mais completo e a maior lista,
  // então serve de "âncora" pros nomes curtos dos outros.
  for (const f of [...entrada.fianca].sort((x, y) => y.total - x.total)) {
    if (semImobiliaria(f.nome)) continue;
    const g = ag.obter(f.nome);
    g.nomes.push({ nome: f.nome, peso: f.total + 1000 });
    somar(g.fianca, { cotacoes: f.total, efetivadas: f.convertidos, comissao: f.comissaoEfetivada });
  }
  for (const r of entrada.ramos) {
    if (semImobiliaria(r.nome)) continue;
    const g = ag.obter(r.nome);
    g.nomes.push({ nome: r.nome, peso: r.total });
    somar(g.ramos, { cotacoes: r.total, efetivadas: r.efetivados, comissao: r.comissaoEfetivada });
  }
  for (const t of entrada.capitalizacao) {
    if (semImobiliaria(t.imobiliaria)) continue;
    const g = ag.obter(t.imobiliaria);
    g.nomes.push({ nome: t.imobiliaria, peso: 1 });
    const emitido = t.etapaNome.trim().toLowerCase() === "emitido";
    somar(g.capitalizacao, { cotacoes: 1, efetivadas: emitido ? 1 : 0, comissao: emitido ? t.comissao : 0 });
  }

  const linhas: LinhaRanking[] = ag.grupos.map((g) => ({
    nome: [...g.nomes].sort((a, b) => b.peso - a.peso)[0]?.nome ?? g.tokens.join(" "),
    fianca: g.fianca,
    capitalizacao: g.capitalizacao,
    ramos: g.ramos,
    cotacoes: g.fianca.cotacoes + g.capitalizacao.cotacoes + g.ramos.cotacoes,
    efetivadas: g.fianca.efetivadas + g.capitalizacao.efetivadas + g.ramos.efetivadas,
    comissao: g.fianca.comissao + g.capitalizacao.comissao + g.ramos.comissao,
  }));

  // Critério: quem mais gerou comissão efetivada; empate -> mais efetivadas;
  // depois mais cotações.
  linhas.sort((a, b) => b.comissao - a.comissao || b.efetivadas - a.efetivadas || b.cotacoes - a.cotacoes);
  return linhas.slice(0, limite);
}
