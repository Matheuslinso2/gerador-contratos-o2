// Fase 1 (29/10/2026): pedidos consolidados da Vanessa sobre o painel v5.
// Recebe o HTML já adaptado por gerar-html.mjs e devolve o HTML final.
// Qualquer trecho que não casar faz o script FALHAR.

export function aplicarFase1(entrada) {
  let h = entrada;
  const trocar = (de, para, todas = false) => {
    if (!h.includes(de)) throw new Error("Trecho não encontrado: " + de.slice(0, 90));
    h = todas ? h.split(de).join(para) : h.replace(de, para);
  };
  const trocarRegex = (re, para) => {
    if (!re.test(h)) throw new Error("Padrão não encontrado: " + re);
    h = h.replace(re, para);
  };

  // Navegação: CRM Leads (3 visões) agrupado + ordem pedida + nomes novos.
  trocarRegex(
    /  <div class="tabs" role="tablist">[\s\S]*?<\/div>\n/,
    `  <div class="tabs" role="tablist">
    <div class="tabgrp" role="group" aria-label="CRM Leads"><span class="tabgrp-l">CRM Leads</span>
      <button class="tab" role="tab" data-pg="lead-prio" aria-selected="true">Prioridades</button>
      <button class="tab" role="tab" data-pg="lead-prosp" aria-selected="false">Prospecção</button>
      <button class="tab" role="tab" data-pg="lead-cad" aria-selected="false">Cadastro e caminhos</button>
    </div>
    <button class="tab" role="tab" data-pg="ativacao" aria-selected="false">Ativação</button>
    <button class="tab" role="tab" data-pg="sucesso" aria-selected="false">Sucesso</button>
    <button class="tab" role="tab" data-pg="campanhas" aria-selected="false">Campanhas</button>
    <button class="tab" role="tab" data-pg="colab" aria-selected="false">Colaboradores</button>
    <button class="tab" role="tab" data-pg="meta" aria-selected="false">Meta e Comissões Equipe</button>
  </div>
`
  );
  trocar('<section class="pg" id="sucesso">', '<section class="pg" id="sucesso" hidden>');
  trocar("pg:'sucesso'}", "pg:'lead-prio'}");
  trocar("textContent=v?'Meu painel':'Colaboradoras'", "textContent=v?'Meu painel':'Colaboradores'");
  trocar(
    "b.hidden=v&&!['colab','campanhas'].includes(b.dataset.pg);",
    "b.hidden=(v&&!['colab','campanhas','lead-prio','lead-prosp','lead-cad'].includes(b.dataset.pg))||(S.acesso==='equipe'&&b.dataset.pg==='meta');"
  );
  trocar(
    "if(['sucesso','ativacao','campanhas','colab','meta'].includes(h)) show(h);",
    "if(['lead-prio','lead-prosp','lead-cad','sucesso','ativacao','campanhas','colab','meta'].includes(h)) show(h);"
  );
  trocar(
    "const rot={dir:'Diretoria',sup:'Supervisão',Dayane:'Vendedora (Dayane)',Livia:'Vendedora (Livia)'};",
    "const rot={dir:'Diretoria',sup:'Supervisão',equipe:'Equipe',Dayane:'Vendedor(a) (Dayane)',Livia:'Vendedor(a) (Livia)'};"
  );

  // CSS do grupo de abas.
  trocar(
    ".sx .tab{font:inherit;",
    ".sx .tabgrp{display:flex;flex-wrap:wrap;align-items:flex-end;gap:var(--cds-gap-xs);padding:0 var(--cds-pad-sm);margin-right:var(--cds-gap-md);border:1px solid var(--color-border-line);border-bottom:0;border-radius:var(--cds-radius) var(--cds-radius) 0 0;background:var(--color-panel)}\n.sx .tabgrp-l{align-self:center;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--color-fg-muted);padding-right:var(--cds-pad-sm)}\n.sx .tab{font:inherit;"
  );

  // Parados no topo do Sucesso (alerta para a supervisão).
  {
    const ini = h.indexOf('      <div class="card hot">');
    const marca = "</tbody></table></div>\n      </div>\n";
    const fim = h.indexOf(marca, ini);
    if (ini < 0 || fim < 0) throw new Error("card de parados não encontrado");
    const bloco = h.slice(ini, fim + marca.length);
    h = h.slice(0, ini) + h.slice(fim + marca.length);
    trocar(
      '    <div class="sec" id="suc-dir">',
      '    <div class="sec" id="suc-parados-topo" data-nivel="gestao">\n      <span class="eyebrow">Alerta · Supervisão</span>\n' + bloco + '    </div>\n\n    <div class="sec" id="suc-dir">'
    );
  }

  // Filtros ativos + voltar à visão geral.
  trocar(
    '  <div class="tabs" role="tablist">',
    '  <div class="picks" id="filtros-ativos-box"><span class="muted">Filtros ativos</span><span id="filtros-ativos" class="muted">—</span><button class="pick" id="limpar-filtros" hidden>Voltar à visão geral</button></div>\n\n  <div class="tabs" role="tablist">'
  );

  // CRM Leads: as três visões (mesmas regras e fonte do painel anterior).
  trocar(
    "  <!-- SUCESSO -->",
    `  <!-- CRM LEADS -->
  <section class="pg" id="lead-prio">
    <div class="sec">
      <span class="eyebrow">CRM Leads · 1. Prioridades</span>
      <p class="muted" id="lead-nota">—</p>
      <div class="tiles">
        <div class="tile alert"><span class="l">Com atividade vencida</span><b class="v" id="lp-venc">—</b><span class="s">Conferir execução e definir o retorno</span></div>
        <div class="tile warn"><span class="l">Sem atividade com prazo</span><b class="v" id="lp-sem">—</b><span class="s">Sem vencida e sem atividade futura</span></div>
        <div class="tile"><span class="l">Com atividade programada</span><b class="v" id="lp-prog">—</b><span class="s">Sem pendência vencida registrada</span></div>
      </div>
      <div class="card">
        <h3>Quem atender primeiro</h3>
        <div class="tw"><table id="lead-tbl"><thead><tr><th>Lead / responsável</th><th>Situação</th><th>Direcionamento</th></tr></thead><tbody></tbody></table></div>
        <button class="pick" id="lead-mais" hidden></button>
      </div>
    </div>
  </section>
  <section class="pg" id="lead-prosp" hidden>
    <div class="sec">
      <span class="eyebrow">CRM Leads · 2. Prospecção</span>
      <div class="tiles">
        <div class="tile"><span class="l">Decisor registrado</span><b class="v" id="lq-dec">—</b><span class="s" id="lq-dec-s">—</span></div>
        <div class="tile"><span class="l">E-mail inicial marcado como enviado</span><b class="v" id="lq-email">—</b><span class="s">Contagem do campo, não do Gmail</span></div>
        <div class="tile"><span class="l">Conversão entre etapas</span><b class="v">Não apurado</b><span class="s">Depende do histórico de entradas e saídas</span></div>
      </div>
      <div class="card"><h3>Distribuição por etapa</h3><div class="fun" id="lead-etapas"></div></div>
      <p class="muted">Contato efetivo, taxa de resposta, tempo até o primeiro contato, comparecimento e conversão por etapa: não apurados nesta consulta.</p>
    </div>
  </section>
  <section class="pg" id="lead-cad" hidden>
    <div class="sec">
      <span class="eyebrow">CRM Leads · 3. Cadastro e caminhos</span>
      <div class="tiles">
        <div class="tile"><span class="l">Cadastro marcado como concluído</span><b class="v" id="lc-cad">—</b><span class="s">Entre os leads ainda ativos</span></div>
        <div class="tile"><span class="l">Proposta marcada como enviada</span><b class="v">Não apurado</b><span class="s">Sem campo confiável no Bitrix ainda</span></div>
        <div class="tile"><span class="l">Parceiros ativados</span><b class="v">Não apurado</b><span class="s">Leads convertidos e emissões não consultados</span></div>
      </div>
      <div class="card"><h3>Caminho de atendimento</h3><div class="fun" id="lead-caminhos"></div></div>
      <p class="muted">Ativação: primeira contratação/emissão confirmada. Contagem zero em um campo não comprova ausência de trabalho.</p>
    </div>
  </section>

  <!-- SUCESSO -->`
  );

  // JS dos leads, filtros ativos e dica por toque.
  trocar(
    "const draw=()=>{iniciar();estado();nivel();",
    `const CAMINHOS=['A — Cotação + cadastro','B — Plataforma + cadastro','C — Cotação sem cadastro','Em definição','Não informado'];
  const ETAPAS_L=[['NEW','1. NOVO LEAD / ENRIQUECIMENTO | DAYANE'],['UC_N8ETQN','2. EMAIL INICIAL.+TOMAD. DE DECISÃO'],['UC_KGCI58','3. LIGAÇÃO (ATÉ 7 DIAS)'],['UC_3UHNFO','4. RETOMADA PROGRAMADA'],['UC_QZ9OF8','6. CALL OU VISITA AGENDADA'],['UC_2XNYOR','7. REUNIÃO REALIZADA / DIAGNÓSTICO'],['UC_WJ48PO','9. E-MAILS PADRÃO | PRODUTOS + COMISSÕES'],['UC_9RFDW0','10. ATIVIÇÃO EM ANDAM.'],['UC_0DHSFN','11. CADASTRO COMPLETO'],['UC_Q5TX86','12.PRIMEIRA EMISSÃO/APÓLICE']];
  const fmtDH=iso=>new Date(iso).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
  const leadsDoFiltro=()=>{const rows=rowsOf('crm_leads');if(!rows) return null;return S.vend==='Todas'?rows:rows.filter(l=>String(l.responsavel).split(' ')[0]===S.vend);};
  const setTxt=(id,t)=>{document.getElementById(id).textContent=t;};
  const drawLeads=()=>{
    const rows=leadsDoFiltro(),nota=document.getElementById('lead-nota');
    if(!rows){
      const erro=rowsOf('crm_leads_erro');
      nota.textContent=erro?'Não consegui buscar os Leads do Bitrix agora.':(dash.meta.erro?'Erro ao carregar os dados.':'Carregando…');
      ['lp-venc','lp-sem','lp-prog','lq-dec','lq-email','lc-cad'].forEach(i=>setTxt(i,'—'));
      document.querySelector('#lead-tbl tbody').replaceChildren();['lead-etapas','lead-caminhos'].forEach(i=>document.getElementById(i).replaceChildren());return;
    }
    const info=(rowsOf('crm_leads_info')||[])[0];
    nota.textContent=rows.length+' leads ativos · fotografia ao vivo em '+(info?fmtDH(info.atualizado_em):'—')+' · campos vazios não comprovam ausência de trabalho';
    setTxt('lp-venc',fmt(rows.filter(l=>l.prioridade===1).length,'int'));setTxt('lp-sem',fmt(rows.filter(l=>l.prioridade===2).length,'int'));setTxt('lp-prog',fmt(rows.filter(l=>l.prioridade===3).length,'int'));
    const ord=[...rows].sort((a,b)=>a.prioridade-b.prioridade||(a.prazo?new Date(a.prazo).getTime():Infinity)-(b.prazo?new Date(b.prazo).getTime():Infinity)||a.id-b.id);
    const tb=document.querySelector('#lead-tbl tbody');tb.replaceChildren();
    const mais=document.getElementById('lead-mais');
    (S.leadsTodos?ord:ord.slice(0,6)).forEach(l=>{
      const tr=document.createElement('tr');
      const c1=document.createElement('td');const a=document.createElement('a');a.href=l.link;a.target='_blank';a.rel='noopener noreferrer';a.textContent=l.nome;c1.appendChild(a);
      const r=document.createElement('div');r.className='muted';r.textContent=l.responsavel;c1.appendChild(r);
      const c2=document.createElement('td');c2.textContent=l.prioridade===1?'Atividade vencida':l.prioridade===2?'Sem atividade com prazo':'Programado';
      const pz=document.createElement('div');pz.className='muted';pz.textContent=l.prazo?fmtDH(l.prazo):'Prazo não registrado';c2.appendChild(pz);
      const c3=document.createElement('td');c3.textContent=l.prioridade===1?'Conferir a execução e registrar o próximo passo':l.prioridade===2?'Agendar contato com responsável e prazo':'Seguir o agendamento';
      const as=document.createElement('div');as.className='muted';as.textContent=l.assunto;c3.appendChild(as);
      if(l.prioridade===1) c2.classList.add('bad');
      tr.append(c1,c2,c3);tb.appendChild(tr);
    });
    if(!ord.length){const tr=document.createElement('tr');const td=document.createElement('td');td.colSpan=3;td.className='muted';td.textContent='Nenhum lead neste recorte.';tr.appendChild(td);tb.appendChild(tr);}
    mais.hidden=ord.length<=6;mais.textContent=S.leadsTodos?'Mostrar apenas 6':'Ver todos os '+ord.length+' leads';
    setTxt('lq-dec',fmt(rows.filter(l=>l.decisor==='Sim').length,'int'));setTxt('lq-dec-s','De '+rows.length+' leads ativos');
    setTxt('lq-email',fmt(rows.filter(l=>l.email_inicial==='Sim').length,'int'));setTxt('lc-cad',fmt(rows.filter(l=>l.cadastro==='Sim').length,'int'));
    const be=document.getElementById('lead-etapas');be.replaceChildren();
    const maxE=Math.max(1,...ETAPAS_L.map(([id])=>rows.filter(l=>l.stage_id===id).length));
    ETAPAS_L.forEach(([id,nome])=>{const ds=rows.filter(l=>l.stage_id===id);const v=ds.filter(l=>l.prioridade===1).length;be.appendChild(barRow(nome,[[ds.length,dash.colors[0]]],maxE,ds.length+' ('+v+(v===1?' vencida)':' vencidas)')));});
    const bc=document.getElementById('lead-caminhos');bc.replaceChildren();
    const maxC=Math.max(1,...CAMINHOS.map(c=>rows.filter(l=>l.caminho===c).length));
    CAMINHOS.forEach(c=>bc.appendChild(barRow(c,[[rows.filter(l=>l.caminho===c).length,dash.colors[0]]],maxC,String(rows.filter(l=>l.caminho===c).length))));
  };
  document.getElementById('lead-mais').addEventListener('click',()=>{S.leadsTodos=!S.leadsTodos;drawLeads();});
  const filtrosAtivos=()=>{
    const p=[];const cur=!!S.mes&&S.mes===S.mesAtual;
    p.push('Mês: '+((rowsOf('meses')||[]).find(r=>r.mes===S.mes)||{rotulo:S.mes||'—'}).rotulo);
    if(S.vend!=='Todas') p.push('Vendedor(a): '+S.vend);
    if(S.gest!=='Todos') p.push('Gestor da Conta: '+S.gest);
    if(S.camp!=='Todas') p.push('Campanha: '+S.camp);
    document.getElementById('filtros-ativos').textContent=p.join(' · ');
    document.getElementById('limpar-filtros').hidden=!((S.vend!=='Todas'&&!isVend())||S.gest!=='Todos'||S.camp!=='Todas'||(!!S.mes&&!cur));
  };
  document.getElementById('limpar-filtros').addEventListener('click',()=>{
    S.vend=isVend()?S.acesso:'Todas';S.gest='Todos';S.camp='Todas';S.mes=S.mesAtual;
    press('.sx .fv','v',S.vend);press('.sx .fg','g','Todos');press('.sx .fc','c','Todas');press('.sx .fm','m',S.mes);draw();});
  const draw=()=>{iniciar();estado();nivel();filtrosAtivos();drawLeads();`
  );
  trocar("document.addEventListener('focusin',showTip);", "document.addEventListener('focusin',showTip);document.addEventListener('touchstart',showTip,{passive:true});");

  // Nomenclatura: Vendedor(a) em todos os textos visíveis (ids, campos e chaves ficam como estão).
  for (const [de, para] of [
    [">Vendedora<", ">Vendedor(a)<"],
    ['aria-label="Vendedora"', 'aria-label="Vendedor(a)"'],
    ["<h3>Vendedoras: quem converte melhor</h3>", "<h3>Vendedores(as): quem converte melhor</h3>"],
    ["<h3>Vendedoras e conversão</h3>", "<h3>Vendedores(as) e conversão</h3>"],
    ["<h3>Motivo da entrada por vendedora</h3>", "<h3>Motivo da entrada por vendedor(a)</h3>"],
    ["Gestor + vendedora", "Gestor + vendedor(a)"],
    ["Escolha uma vendedora no filtro", "Escolha um(a) vendedor(a) no filtro"],
    ["Comissão das vendedoras", "Comissão dos vendedores(as)"],
    ["números por vendedora (agendadas", "números por vendedor(a) (agendadas"],
    ["cada vendedora vê só a própria", "cada vendedor(a) vê só a própria"],
    ["Por mês e vendedora:", "Por mês e vendedor(a):"],
    ["por campanha e vendedora.", "por campanha e vendedor(a)."],
    ["Cards por etapa e vendedora", "Cards por etapa e vendedor(a)"],
    ["para cada vendedora e para todas", "para cada vendedor(a) e para todos(as)"],
    [">Colaboradora<", ">Colaborador(a)<"],
    ["Desempenho de cada colaboradora no mês", "Desempenho de cada colaborador(a) no mês"],
    ["Ligações e WhatsApp no mês, por colaboradora", "Ligações e WhatsApp no mês, por colaborador(a)"],
  ]) {
    if (!h.includes(de)) throw new Error("Texto a renomear não encontrado: " + de);
    h = h.split(de).join(para);
  }
  return h;
}
