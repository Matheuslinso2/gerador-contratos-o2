// Gera src/lib/painelComercial/painelHtml.ts a partir do index.html OFICIAL do
// pacote da Vanessa (painel_v5_2026-10-28). Cada troca abaixo é um desvio
// documentado da referência; qualquer trecho que não casar faz o script FALHAR
// (nada é publicado diferente do que está descrito aqui).
//   node scripts/painel/gerar-html.mjs <caminho do index.html do pacote>
import fs from "fs";

const origem = process.argv[2];
if (!origem) throw new Error("Informe o caminho do index.html do pacote.");
let h = fs.readFileSync(origem, "utf8");

const trocar = (de, para, todas = false) => {
  if (!h.includes(de)) throw new Error("Trecho não encontrado na referência: " + de.slice(0, 90));
  h = todas ? h.split(de).join(para) : h.replace(de, para);
};
const trocarRegex = (re, para) => {
  if (!re.test(h)) throw new Error("Padrão não encontrado: " + re);
  h = h.replace(re, para);
};

// 1. Cabeçalho: data real da leitura no lugar de "27/10/2026" fixo.
trocar('Dados do Bitrix de 27/10/2026 · Visão:', 'Dados do Bitrix atualizados em <b id="atualizado-em">—</b> · Visão:');
trocar('<p class="aviso" id="aviso-mes">', '<p class="aviso hot" id="erro-dados" hidden></p>\n  <p class="aviso" id="aviso-mes">');

// 2. Visão: sai o seletor de simulação (a visão vem do login, no servidor).
trocarRegex(/    <div class="picks" role="group" aria-label="Visão">[\s\S]*?<\/div>\n/, "");

// 3. Meses gerados a partir dos dados (não fixar out/26 no código).
trocarRegex(
  /    <div class="picks" role="group" aria-label="Mês"><span class="muted">Mês<\/span>[\s\S]*?<\/div>\n/,
  '    <div class="picks" role="group" aria-label="Mês" id="grp-mes"><span class="muted">Mês</span></div>\n'
);

// 4. Estado inicial vem do servidor (visão e mês atual).
trocar("const S={acesso:'dir',mes:'2026-10',vend:'Todas',gest:'Todos',camp:'Todas',pg:'sucesso'};", "const CRM_OK='2026-10';const S={acesso:'dir',mes:null,mesAtual:null,pronto:false,vend:'Todas',gest:'Todos',camp:'Todas',pg:'sucesso'};");
trocar("const fmt=(v,f)=>{\n    if(v===null||v===undefined||v==='') return f==='pct'?'sem base':'—';",
  "const fmt=(v,f)=>{\n    if(f==='meta'&&(v===null||v===undefined||v==='')) return 'meta não definida';\n    if(f==='dd'&&(v===null||v===undefined)) return 'sem data de entrada';\n    if(v===null||v===undefined||v==='') return f==='pct'?'sem base':'—';\n    if(f==='dd') return Number(v).toLocaleString('pt-BR');\n    if(f==='meta') return Number(v).toLocaleString('pt-BR');");

// 5. '2026-10' fixo -> mês atual vindo dos dados.
trocar('data-only-mes="2026-10"', 'data-only-mes="atual"', true);
trocar("if(t.dataset.onlyMes&&S.mes!==t.dataset.onlyMes)", "if(t.dataset.onlyMes&&S.mes!==S.mesAtual)");
trocar("S.mes<'2026-10'", "S.mes<CRM_OK", true);
trocar("r.mes==='2026-10'&&r.vendedora===S.vend", "r.mes===S.mesAtual&&r.vendedora===S.vend");
trocar("el.textContent='em '+(S.mes==='2026-10'?'out/26 (até 27/10)':'set/26')", "el.textContent=mesTxt()");
trocar("const mes=S.mes==='2026-10'?'outubro (até 27/10)':'setembro';", "const mm=(rowsOf('meses')||[]).find(r=>r.mes===S.mes);const mes=mm?mm.rotulo.toLowerCase():S.mes;");
trocar("Out/26 até 27/10", "Mês atual, até a última atualização", true);

// 6. Novo critério de parado: mais de 2 dias na mesma etapa (item 6a).
trocar("Cards acima do prazo da etapa, do maior atraso para o menor. Atraso = dias na etapa menos o prazo.", "Cards há mais de 2 dias na mesma etapa (data de entrada na etapa pelo histórico do Bitrix), do maior atraso para o menor. Atraso = dias na etapa menos 2.");
trocar("Vermelho = parados (acima do prazo).", "Vermelho = parados (mais de 2 dias na etapa).");
trocar('<span class="s">7+ dias sem atividade</span>', '<span class="s">mais de 2 dias na etapa</span>');
trocar("Parado = 7 dias ou mais sem nenhuma atividade no card. Consulta de 28/10.", 'Parado = mais de 2 dias na mesma etapa (data de entrada pelo histórico do Bitrix). "Dias sem atividade" é só informação extra.');
trocar("Cards do funil Campanhas parados (7+ dias sem atividade) por campanha e vendedora.", "Cards do funil Campanhas parados (mais de 2 dias na mesma etapa) por campanha e vendedora.");
trocar("Cards abertos hoje por etapa, no prazo e parados, para cada vendedora e para todas.", "Cards abertos hoje por etapa, no prazo e parados (mais de 2 dias na etapa), para cada vendedora e para todas.");

// 7. Etapas atuais (funil 12 renomeado em 28/10): ordem das barras.
trocar("const ord=['RADAR DE NEGÓCIOS/ANÁLISE','Contato em andamento','Visita/Call','Pós visita/call','Oportunidade','Resultados gerados'];",
  "const ord=['RADAR DE NEGÓCIOS/ANÁLISE','Contato em andamento','Análise de desempenho','Visita/Call','Pós visita/call','Oportunidade','Em campanha','Resultados gerados','Ação futura','Reciclagem','Cliente sem potencial','Preparação da campanha','Pronto para contato','Contato em andamento (Campanhas)','Visita / Call agendada','Acomp. — sem cotação','Engaj. — com cotação','Apuração do resultado','Pós-campanha','Cliente sem potencial (Campanhas)'];");

// 8. Campanhas: meta personalizada por cliente (item 6b). Sem meta válida, não calcula.
trocar("t='base a calcular'", "t='meta não definida'");
trocar("r.atingimento==null?'base a calcular'", "r.atingimento==null?'meta não definida'");
trocar('<span class="s">+40% sobre o período anterior</span>', '<span class="s">meta personalizada por cliente</span>');
trocarRegex(/    <p class="aviso">A meta de cada campanha é[\s\S]*?<\/p>\n/, '    <p class="aviso">A meta de cada campanha é personalizada por cliente e fica cadastrada no Workspace (não no Bitrix). Enquanto um cliente não tiver meta válida, o painel mostra "meta não definida" e não calcula atingimento. Apólices sem a DATA - RESULTADO COMERCIAL GERADO não entram em nenhum mês e aparecem no quadro "Apólices sem data".</p>\n');
trocar('data-cols="card,cliente,vendedora,gestor,etapa,situacao,dias_sem_ativ:int,dias_etapa:int,campanha,produtos"', 'data-cols="card,cliente,vendedora,gestor,etapa,situacao,dias_sem_ativ:int,dias_etapa:dd,campanha,produtos,meta_personalizada:meta"');
trocar('<th data-field="produtos">Produtos</th></tr></thead><tbody></tbody></table></div>\n    </div>\n  </section>\n\n  <!-- COLABORADORAS -->', '<th data-field="produtos">Produtos</th><th class="n" data-field="meta_personalizada">Meta personalizada</th></tr></thead><tbody></tbody></table></div>\n    </div>\n  </section>\n\n  <!-- COLABORADORAS -->');

// 9. Estados: carregando x erro x zero x ausente (item 9).
trocar("if(!rows){msg('Carregando…');return;}", "if(!rows){msg(dash.meta.erro?'Erro ao carregar os dados do Bitrix.':'Carregando…');return;}");

// 10. Notas: sai a nota da simulação de visão; entra a regra de acesso e de parado.
trocar("<li>Visão \"Vendedora\" é uma simulação do que cada uma veria ao entrar. Hoje quem tem o link vê tudo.</li>", "<li>Parado = card há mais de 2 dias na mesma etapa, contado pela data real de entrada na etapa (histórico do Bitrix). Sem histórico, o card aparece como \"sem data de entrada\".</li>\n        <li>A comissão individual é remuneração: diretoria e supervisão veem a de todas; cada vendedora vê só a própria. O filtro é feito no servidor pelo login.</li>\n        <li>Ligações e WhatsApp contam só o que passa pelo Bitrix. Zero = houve leitura e o valor é 0; \"—\" = campo ausente ou não preenchido.</li>");

// 11. Inicialização a partir dos dados (visão do login, mês atual, botões de mês).
trocar("const draw=()=>{nivel();", `const iniciar=()=>{
    if(S.pronto) return;
    const ms=rowsOf('meses');if(!ms||!ms.length||!dash.meta.visao) return;
    S.pronto=true;S.acesso=dash.meta.visao;
    S.mesAtual=(ms.find(x=>x.padrao==='Sim')||ms[0]).mes;S.mes=S.mesAtual;
    const grp=document.getElementById('grp-mes');
    ms.forEach(m=>{const b=document.createElement('button');b.className='pick fm';b.dataset.m=m.mes;b.setAttribute('aria-pressed',m.mes===S.mes?'true':'false');
      const [a,mm]=m.mes.split('-');b.textContent=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][Number(mm)-1]+'/'+a.slice(2);
      b.addEventListener('click',()=>{S.mes=m.mes;press('.sx .fm','m',S.mes);draw();});grp.appendChild(b);});
    if(isVend()){S.vend=S.acesso;S.gest='Todos';press('.sx .fv','v',S.vend);if(!['colab','campanhas'].includes(S.pg)) show('colab');}
  };
  const mesTxt=()=>{const m=(rowsOf('meses')||[]).find(r=>r.mes===S.mes);if(!m) return '';const ate=(m.periodo.match(/a (\\d\\d\\/\\d\\d)/)||[])[1];return 'em '+m.rotulo.toLowerCase()+(S.mes===S.mesAtual&&ate?' (até '+ate+')':'');};
  const estado=()=>{
    const e=document.getElementById('erro-dados');e.hidden=!dash.meta.erro;e.textContent=dash.meta.erro||'';
    const t=document.getElementById('atualizado-em');
    t.textContent=dash.meta.geradoEm?new Date(dash.meta.geradoEm).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
  };
  const draw=()=>{iniciar();estado();nivel();`);
// o clique de mês antigo (botões fixos) sai: os botões nascem em iniciar()
trocar("document.querySelectorAll('.sx .fm').forEach(b=>b.addEventListener('click',()=>{S.mes=b.dataset.m;press('.sx .fm','m',S.mes);draw();}));\n", "");
// visão não é mais clicável
trocarRegex(/  document\.querySelectorAll\('\.sx \.fa'\)[\s\S]*?draw\(\);\}\)\);\n/, "");
fs.writeFileSync("src/lib/painelComercial/painelHtml.ts", `// GERADO por scripts/painel/gerar-html.mjs a partir do index.html oficial (painel_v5_2026-10-28). Não editar à mão.\nexport const PAINEL_FRAGMENTO = ${JSON.stringify(h)};\n`);
console.log("painelHtml.ts gerado:", h.length, "caracteres");
