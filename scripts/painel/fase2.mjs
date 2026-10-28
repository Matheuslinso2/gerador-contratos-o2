// Fase 2 (29/10/2026): aba Campanhas integrada com a área Campanhas do Workspace
// (metas, produção, projeção, farol, e-mails, contatos). Recebe o HTML da fase 1.

export function aplicarFase2(entrada) {
  let h = entrada;
  const trocar = (de, para) => {
    if (!h.includes(de)) throw new Error("Trecho não encontrado: " + de.slice(0, 90));
    h = h.replace(de, para);
  };

  // Markup novo da aba (ordem aprovada: filtros, resumo, prazo × resultado,
  // acompanhamento, clientes, e-mail, financeiro/Corp, notas).
  const ini = h.indexOf("  <!-- CAMPANHAS -->");
  const fim = h.indexOf("  <!-- COLABORADORAS -->");
  if (ini < 0 || fim < 0) throw new Error("Seção Campanhas não encontrada");
  h =
    h.slice(0, ini) +
    `  <!-- CAMPANHAS -->
  <section class="pg" id="campanhas" hidden>
    <p class="aviso hot" id="camp-erro" hidden></p>
    <div class="sec">
      <span class="eyebrow">Campanhas · 1. Filtros</span>
      <div class="picks" id="grp-camp" role="group" aria-label="Campanha"><span class="muted">Campanha</span></div>
    </div>

    <div class="sec">
      <span class="eyebrow">Campanhas · 2. Resumo da campanha</span>
      <div class="tiles">
        <div class="tile"><span class="l">Clientes na campanha</span><b class="v" id="ct-clientes">—</b><span class="s" id="ct-clientes-s">—</span></div>
        <div class="tile"><span class="l" data-o="camp_contratacoes">Contratações novas</span><b class="v" id="ct-contr">—</b><span class="s" id="ct-contr-s">—</span></div>
        <div class="tile"><span class="l" data-o="meta_camp">Atingimento da meta</span><b class="v" id="ct-meta">—</b><span class="s" id="ct-meta-s">—</span></div>
        <div class="tile"><span class="l" data-o="prazo">Prazo restante</span><b class="v" id="ct-prazo">—</b><span class="s" id="ct-prazo-s">—</span></div>
      </div>
      <p class="muted" id="ct-cotacoes">—</p>
    </div>

    <div class="card">
      <span class="eyebrow">Campanhas · 3. Prazo × resultado</span>
      <p class="muted">Barra cinza: quanto do prazo já passou. Barra colorida: quanto da meta já foi atingido. Isso mostra o ritmo proporcional, mas não prova atraso por si só: o risco vem do farol (projeção até o fim). Campanha sem meta não é classificada como atrasada.</p>
      <div class="camp" id="camp-bars"></div>
    </div>

    <div class="sec">
      <span class="eyebrow">Campanhas · 4. Acompanhamento e alertas</span>
      <p class="muted">Clique em um alerta para filtrar a tabela abaixo. Os alertas podem se sobrepor: o mesmo cliente pode aparecer em mais de um.</p>
      <div class="tiles" id="camp-alertas">
        <div class="tile alert alertbtn" role="button" tabindex="0" data-alerta="contato"><span class="l" data-o="camp_contato">Sem contato do(a) vendedor(a)</span><b class="v" id="ca-contato">—</b><span class="s">7 dias ou mais, ou sem contato registrado</span></div>
        <div class="tile alert alertbtn" role="button" tabindex="0" data-alerta="parado"><span class="l" data-o="camp_parado">Parados na etapa</span><b class="v" id="ca-parado">—</b><span class="s">mais de 2 dias na mesma etapa</span></div>
        <div class="tile warn alertbtn" role="button" tabindex="0" data-alerta="cotacao"><span class="l" data-o="camp_cotacoes">Cotações pendentes</span><b class="v" id="ca-cotacao">—</b><span class="s" id="ca-cotacao-s">—</span></div>
        <div class="tile warn alertbtn" role="button" tabindex="0" data-alerta="risco"><span class="l" data-o="camp_risco">Risco de meta</span><b class="v" id="ca-risco">—</b><span class="s">farol Em risco ou Não atingida</span></div>
      </div>
    </div>

    <div class="card">
      <span class="eyebrow">Campanhas · 5. Clientes no funil Campanhas</span>
      <p class="muted" id="camp-tab-nota">—</p>
      <div class="tw"><table id="camp-tab"><thead><tr><th>Cliente / vendedor(a)</th><th>Etapa / dias na etapa</th><th data-o="camp_email">E-mail</th><th>Acompanhamento</th><th class="n">Realizado / meta</th><th data-o="camp_farol">Farol</th><th>Detalhes</th></tr></thead><tbody></tbody></table></div>
    </div>

    <details class="notas-box" id="camp-email-box">
      <summary>6. Comunicação por e-mail</summary>
      <p class="muted">E-mails da campanha enviados à imobiliária (principal e e-mails filhos). A contagem é de mensagens enviadas; "abertos" são mensagens com abertura registrada. Abertura de e-mail não comprova leitura, interesse ou oportunidade.</p>
      <div class="tw"><table id="camp-email-tab"><thead><tr><th>Cliente</th><th>Situação</th><th class="n">Mensagens enviadas</th><th class="n">Com abertura</th></tr></thead><tbody></tbody></table></div>
    </details>

    <details class="notas-box" id="camp-fin-box" data-nivel="gestao">
      <summary>7. Resultado financeiro e conferência Corp</summary>
      <p class="muted">Contratações (funil Bitrix e planilhas) e documentos do Corp são medidas diferentes e não se somam. O resultado é comissão Corp − repasse Corp − custo de premiação.</p>
      <div class="tw"><table id="camp-fin-tab"><thead><tr><th>Campanha</th><th class="n">Comissão O2 (Corp)</th><th class="n">Repasse (Corp)</th><th class="n">Custo de premiação</th><th class="n">Resultado</th><th class="n">Documentos Corp</th><th class="n">Prêmio líquido (Corp)</th></tr></thead><tbody></tbody></table></div>
      <p class="muted" style="margin-top:10px">Resultado Financeiro das Empresas no CRM (campo preenchido manualmente, com a data do resultado). É outra fonte: não é a produção da área Campanhas.</p>
      <div class="tw"><table id="camp-crmfin-tab"><thead><tr><th>Campanha (CRM)</th><th class="n">Apólices no mês</th><th class="n">Apólices acumuladas</th><th class="n">Apólices sem data</th></tr></thead><tbody></tbody></table></div>
    </details>

    <details class="notas-box" id="camp-pend-box">
      <summary>Pendências de vínculo entre CRM e campanha</summary>
      <p class="muted">Cards do funil Campanhas que não puderam ser ligados a uma imobiliária com meta. Não entram nos números de produção e meta.</p>
      <div class="tw"><table id="camp-pend-tab"><thead><tr><th>Card</th><th>Cliente</th><th>Vendedor(a)</th><th>Motivo</th></tr></thead><tbody></tbody></table></div>
    </details>

    <details class="notas-box">
      <summary>8. Notas, fontes e regras</summary>
      <ul class="notas">
        <li>Fonte da produção, meta, projeção e farol: área Campanhas do Workspace (funil Bitrix e planilhas, só contratos novos; renovações ficam fora da meta). Metas já cadastradas por cliente.</li>
        <li>Fonte de cards, etapas e tempo na etapa: CRM Bitrix (funil Campanhas), com a data real de entrada na etapa pelo histórico. Vínculo cliente do CRM ↔ imobiliária pelo ID da Empresa do Bitrix, só vínculos confirmados.</li>
        <li>Alerta de contato: último contato registrado pelo(a) vendedor(a) responsável pelo card (Bitrix e contatos lançados por fora). Contato de outros colaboradores aparece no detalhe e não zera o alerta; e-mail automático da campanha não conta como contato.</li>
        <li>Atingimento só é calculado com meta válida. Se parte dos clientes não tem meta, o painel mostra a cobertura.</li>
        <li>Cotação, contratação, apólice e documento Corp não são equivalentes.</li>
      </ul>
    </details>
  </section>

` +
    h.slice(fim);

  // CSS dos alertas clicáveis e do detalhe.
  trocar(".sx .tab{font:inherit;", ".sx .alertbtn{cursor:pointer}\n.sx .alertbtn[aria-pressed=true]{outline:2px solid var(--color-fg)}\n.sx .alertbtn:focus-visible{outline:2px solid var(--color-fg);outline-offset:2px}\n.sx tr.det td{background:var(--color-bg)}\n.sx .dg{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,17rem),1fr));gap:var(--cds-gap-md)}\n.sx .dg h4{margin:0 0 4px;font-size:var(--cds-font-size-caption);text-transform:uppercase;letter-spacing:.05em;color:var(--color-fg-muted)}\n.sx .dg p{margin:2px 0}\n.sx .tab{font:inherit;");

  // O quadro antigo de Campanhas sai; entra o novo.
  trocar("drawCamp();", "drawCampanhas();");
  trocar(
    "const draw=()=>{iniciar();",
    `const ROT_CANAL={ligacao:'Ligação',whatsapp:'WhatsApp',email:'E-mail',reuniao:'Reunião',visita:'Visita',outro:'Outro'};
  const dBr=iso=>iso?new Date(iso).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit'}):'—';
  const dBrA=iso=>iso?iso.slice(8,10)+'/'+iso.slice(5,7)+'/'+iso.slice(0,4):'—';
  const nomeEmail=e=>{if(!e)return '—';const p=String(e).split('@')[0];return p.charAt(0).toUpperCase()+p.slice(1);};
  const el=(tag,txt,cls)=>{const x=document.createElement(tag);if(txt!==undefined)x.textContent=txt;if(cls)x.className=cls;return x;};
  const unicosPorPart=rows=>{const m=new Map();rows.forEach(r=>{if(r.vinculo==='Vinculado'&&r.participante_id){const k=r.campanha_id+'|'+r.participante_id;if(!m.has(k))m.set(k,r);}});return [...m.values()];};
  const temAlerta={
    contato:r=>r.vinculo==='Vinculado'&&!!r.alerta_contato&&/dias sem contato|Sem contato registrado/.test(r.alerta_contato),
    parado:r=>r.situacao==='Parado',
    cotacao:r=>(r.cotacoes_abertas||0)>0,
    risco:r=>r.farol_chave==='em_risco'||r.farol_chave==='nao_atingida'
  };
  const numAlertas=r=>['contato','parado','risco'].filter(k=>temAlerta[k](r)).length+((r.aprovadas_paradas||0)>0?1:0);
  const fmtM=(v,moeda)=>v===null||v===undefined?'—':(moeda==='Sim'?brl.format(v):Number(v).toLocaleString('pt-BR',{maximumFractionDigits:1}));
  const camposCamp=()=>{
    const defs=rowsOf('camp_def'),cli=rowsOf('camp_clientes');
    if(!defs||!cli) return null;
    let rows=cli;
    if(S.camp!=='Todas') rows=rows.filter(r=>r.campanha===S.camp);
    if(S.vend!=='Todas') rows=rows.filter(r=>r.vendedora===S.vend);
    if(S.gest!=='Todos') rows=rows.filter(r=>r.gestor===S.gest);
    return {defs,cli,rows,defsSel:S.camp==='Todas'?defs:defs.filter(d=>d.nome===S.camp)};
  };
  const detalheCard=r=>{
    const box=el('div',undefined,'dg');
    const col=(titulo,linhas)=>{const c=el('div');c.appendChild(el('h4',titulo));linhas.forEach(t=>{if(t instanceof Node)c.appendChild(t);else c.appendChild(el('p',t));});return c;};
    const link=el('a','Abrir card no Bitrix');link.href='https://o2seguros.bitrix24.com.br/crm/deal/details/'+r.card+'/';link.target='_blank';link.rel='noopener noreferrer';
    const unid=r.unidade||'';
    box.append(
      col('Card e campanha',['Card '+r.card+' · empresa '+r.empresa_id,link,'Campanha: '+(r.campanha||'—')+(r.campanha_inicio?' ('+dBrA(r.campanha_inicio)+' a '+dBrA(r.campanha_fim)+')':''),'Produtos no CRM: '+(r.produtos||'—')]),
      col('Papéis',['Vendedor(a) no CRM: '+r.vendedora,'Gestor da conta no CRM: '+r.gestor,'Responsável O2 na campanha: '+nomeEmail(r.responsavel_o2),'Gestor da conta na campanha: '+nomeEmail(r.gestor_conta)]),
      col('Etapa',[r.etapa+' · '+fmt(r.dias_etapa,'dd')+(typeof r.dias_etapa==='number'?' dia(s)':'')+(r.situacao==='Parado'?' (parado)':''),'Dias sem atividade no card: '+(r.dias_sem_ativ===null||r.dias_sem_ativ===undefined?'—':r.dias_sem_ativ)]),
      col('Contatos',['Último do(a) vendedor(a) responsável: '+(r.ultimo_contato_vend?dBr(r.ultimo_contato_vend)+' ('+r.dias_sem_contato_vend+' dias)':'Sem contato registrado'),'Último de qualquer colaborador: '+(r.ultimo_contato_qualquer?dBr(r.ultimo_contato_qualquer)+' · '+(ROT_CANAL[r.ultimo_contato_qualquer_canal]||'')+' · '+(r.ultimo_contato_qualquer_quem||'não identificado'):'—'),...((r.contatos||[]).slice(0,6).map(e=>'• '+dBr(e.data)+' · '+(ROT_CANAL[e.canal]||e.canal)+' · '+e.quem+(e.origem==='manual'?' (lançado por fora)':'')))]),
      col('Produção e meta ('+unid.replace(/[()]/g,'')+')',['Meta total: '+fmtM(r.meta,r.moeda)+' · mensal ≈ '+fmtM(r.meta_mensal,r.moeda),'Realizado: '+fmtM(r.realizado,r.moeda)+' (no mês: '+fmtM(r.realizado_mes,r.moeda)+')','Faltam: '+fmtM(r.faltam,r.moeda)+' · ritmo necessário/sem.: '+fmtM(r.ritmo_semana,r.moeda),'Projeção: '+fmtM(r.projecao,r.moeda)+' · farol: '+(r.farol||'—'),'Renovações (fora da meta): '+(r.renovacoes??'—')]),
      col('Cotações e e-mails',['Cotações recebidas no mês: '+(r.cotacoes_mes??'—'),'Em aberto: '+(r.cotacoes_abertas??'—')+' · aprovadas há 7+ dias sem fechar: '+(r.aprovadas_paradas??'—'),'E-mails: '+(r.email_status||'—')+' · '+(r.email_abertos??0)+' com abertura de '+(r.email_enviados??0)+' enviados'])
    );
    return box;
  };
  const drawCampanhas=()=>{
    const erroEl=document.getElementById('camp-erro');const errs=rowsOf('camp_erros');
    erroEl.hidden=!errs||!errs.length;erroEl.textContent=errs&&errs.length?'Não consegui integrar as metas da área Campanhas agora: '+errs.map(e=>e.erro).join(' | '):'';
    const d=camposCamp();
    if(!d){document.getElementById('ct-clientes').textContent='—';return;}
    // seletor de campanha (gerado dos dados)
    const grp=document.getElementById('grp-camp');
    if(!S.campPicker||S.campPicker!==d.defs.map(x=>x.nome).join('|')){
      grp.querySelectorAll('button').forEach(b=>b.remove());
      ['Todas',...d.defs.map(x=>x.nome)].forEach(n=>{const b=el('button',n==='Todas'?'Todas':n,'pick fc');b.dataset.c=n;b.setAttribute('aria-pressed',S.camp===n?'true':'false');b.addEventListener('click',()=>{S.camp=n;press('.sx .fc','c',n);draw();});grp.appendChild(b);});
      S.campPicker=d.defs.map(x=>x.nome).join('|');
    }
    const un=unicosPorPart(d.rows);const vinc=d.rows.filter(r=>r.vinculo==='Vinculado');
    const imobs=new Set(vinc.map(r=>r.imobiliaria_id));
    const set=(id,t)=>{document.getElementById(id).textContent=t;};
    // 2. resumo
    set('ct-clientes',fmt(imobs.size,'int'));
    set('ct-clientes-s',d.rows.length+' card(s) no CRM'+(d.rows.length-vinc.length?' · '+(d.rows.length-vinc.length)+' sem vínculo (ver pendências)':''));
    const moedaSel=d.defsSel.length&&d.defsSel.every(x=>x.moeda==='Sim')?'Sim':'Não';
    const unidades=[...new Set(d.defsSel.map(x=>x.metrica_rotulo.replace(/[()]/g,'')))].join(' / ')||'—';
    set('ct-contr',un.length?fmtM(un.reduce((s,r)=>s+(r.realizado||0),0),moedaSel):'—');
    set('ct-contr-s','no mês: '+(un.length?fmtM(un.reduce((s,r)=>s+(r.realizado_mes||0),0),moedaSel):'—')+' · '+unidades+' · fonte: área Campanhas');
    const comMeta=un.filter(r=>r.meta!==null&&r.meta>0);
    if(!comMeta.length){set('ct-meta','meta não definida');set('ct-meta-s','Sem meta cadastrada para os clientes deste recorte');}
    else{const m=comMeta.reduce((s,r)=>s+r.meta,0),rl=comMeta.reduce((s,r)=>s+(r.realizado||0),0);
      set('ct-meta',fmtM(rl,moedaSel)+' / '+fmtM(m,moedaSel)+' · '+Math.round(rl/m*100)+'%');
      set('ct-meta-s',comMeta.length===un.length?'Todos os '+un.length+' clientes têm meta':'Cobertura: '+comMeta.length+' de '+un.length+' clientes com meta (consolidado só deles)');}
    const prazos=d.defsSel.slice().sort((a,b)=>a.dias_restantes-b.dias_restantes);
    if(!prazos.length){set('ct-prazo','—');set('ct-prazo-s','Sem campanha com meta e período');}
    else{set('ct-prazo',prazos[0].dias_restantes>0?prazos[0].dias_restantes+' dias':'Encerrada');
      set('ct-prazo-s',(d.defsSel.length>1?'Próximo vencimento. ':'')+prazos.map(p=>p.nome.slice(0,28)+': até '+dBrA(p.fim)+' ('+p.dias_restantes+' d)').join(' · '));}
    set('ct-cotacoes','Cotações recebidas no mês: '+fmt(un.reduce((s,r)=>s+(r.cotacoes_mes||0),0),'int')+' · recebidas no mês, só negócios novos; fonte: funil da área Campanhas (não é contratação).');
    // 3. prazo x resultado (uma linha por campanha)
    const bars=document.getElementById('camp-bars');bars.replaceChildren();
    d.defsSel.forEach(c=>{
      const t=el('h4',c.nome+' · '+dBrA(c.inicio)+' a '+dBrA(c.fim)+' · '+(d.rows.filter(r=>r.campanha_id===c.id).length)+' card(s) no CRM');bars.appendChild(t);
      bars.appendChild(barRow('Prazo decorrido',[[c.pct_prazo||0,'var(--cds-chart-muted)']],100,fmt((c.pct_prazo||0)/100,'pct')+' · faltam '+c.dias_restantes+' dias'));
      bars.appendChild(barRow('Meta atingida',[[Math.min(100,c.pct_meta||0),dash.colors[1]]],100,c.pct_meta===null?'meta não definida':fmtM(c.realizado,c.moeda)+' / '+fmtM(c.meta_total,c.moeda)+' · '+Math.round(c.pct_meta)+'%'));
    });
    if(!d.defsSel.length) bars.appendChild(el('p','Nenhuma campanha com meta e período neste recorte.','muted'));
    // 4. alertas
    set('ca-contato',fmt(d.rows.filter(temAlerta.contato).length,'int'));
    set('ca-parado',fmt(d.rows.filter(temAlerta.parado).length,'int'));
    set('ca-cotacao',fmt(un.reduce((s,r)=>s+(r.cotacoes_abertas||0),0),'int'));
    set('ca-cotacao-s','em aberto · '+un.reduce((s,r)=>s+(r.aprovadas_paradas||0),0)+' aprovada(s) há 7+ dias sem fechar');
    set('ca-risco',fmt(un.filter(temAlerta.risco).length,'int'));
    document.querySelectorAll('#camp-alertas .alertbtn').forEach(b=>b.setAttribute('aria-pressed',S.campAlerta===b.dataset.alerta?'true':'false'));
    // 5. tabela
    let lista=d.rows;
    if(S.campAlerta) lista=lista.filter(temAlerta[S.campAlerta]);
    lista=[...lista].sort((a,b)=>numAlertas(b)-numAlertas(a)||(b.dias_etapa??-1)-(a.dias_etapa??-1));
    set('camp-tab-nota','Ordenado por número de alertas (contato, parado, cotação aprovada parada, risco de meta) e, em empate, por mais dias na etapa.'+(S.campAlerta?' Filtro de alerta ativo (clique no alerta de novo para limpar).':''));
    const tb=document.querySelector('#camp-tab tbody');tb.replaceChildren();
    lista.forEach(r=>{
      const tr=el('tr');
      const c1=el('td');c1.appendChild(el('b',r.cliente));c1.appendChild(el('div',r.vendedora+(r.gestor&&r.gestor!=='Sem gestor'?' · gestor '+r.gestor:''),'muted'));
      const c2=el('td',r.etapa);c2.appendChild(el('div',typeof r.dias_etapa==='number'?r.dias_etapa+' dia(s) na etapa':'sem data de entrada','muted'));if(r.situacao==='Parado')c2.appendChild(el('div','Parado (mais de 2 dias)','bad'));
      const c3=el('td',r.vinculo==='Vinculado'?(r.email_status||'—'):'—');if(r.vinculo==='Vinculado')c3.appendChild(el('div',(r.email_abertos??0)+'/'+(r.email_enviados??0)+' abertos','muted'));
      const c4=el('td');
      if(r.vinculo!=='Vinculado'){c4.appendChild(el('span','Sem vínculo com a campanha','muted'));}
      else{
        if(r.alerta_contato&&temAlerta.contato(r)){c4.appendChild(el('div',r.alerta_contato.replace('dias sem contato','dias sem contato do(a) vendedor(a)'),'bad'));}
        else if(r.alerta_contato){c4.appendChild(el('div',r.alerta_contato,'warn'));}
        else c4.appendChild(el('div','Contato do(a) vendedor(a) em dia','ok'));
        c4.appendChild(el('div','Último do(a) vendedor(a): '+(r.ultimo_contato_vend?dBr(r.ultimo_contato_vend):'sem contato registrado'),'muted'));
        if((r.aprovadas_paradas||0)>0)c4.appendChild(el('div',r.aprovadas_paradas+' cotação(ões) aprovada(s) há 7+ dias','warn'));
      }
      const c5=el('td',undefined,'n');
      if(r.vinculo!=='Vinculado'||r.meta===null){c5.textContent=r.vinculo!=='Vinculado'?'—':'meta não definida';}
      else{c5.textContent=fmtM(r.realizado,r.moeda)+' / '+fmtM(r.meta,r.moeda)+(r.pct!==null?' · '+Math.round(r.pct)+'%':'');c5.appendChild(el('div','faltam '+fmtM(r.faltam,r.moeda),'muted'));}
      const c6=el('td');if(r.farol){const f=el('span',r.farol);f.title='Farol da área Campanhas: projeção até o fim da campanha contra a meta total.';if(r.farol_chave==='em_risco'||r.farol_chave==='nao_atingida')f.className='bad';else if(r.farol_chave==='no_ritmo'||r.farol_chave==='atingida')f.className='ok';c6.appendChild(f);}else c6.textContent='—';
      const c7=el('td');const bt=el('button','Detalhes','pick');bt.setAttribute('aria-expanded','false');
      bt.addEventListener('click',()=>{
        const nxt=tr.nextElementSibling;
        if(nxt&&nxt.classList.contains('det')){nxt.remove();bt.setAttribute('aria-expanded','false');return;}
        const dt=el('tr',undefined,'det');const td=el('td');td.colSpan=7;td.appendChild(detalheCard(r));dt.appendChild(td);tr.after(dt);bt.setAttribute('aria-expanded','true');});
      c7.appendChild(bt);
      tr.append(c1,c2,c3,c4,c5,c6,c7);tb.appendChild(tr);
    });
    if(!lista.length){const tr=el('tr');const td=el('td','Nenhum cliente neste recorte.','muted');td.colSpan=7;tr.appendChild(td);tb.appendChild(tr);}
    // 6. e-mails
    const te=document.querySelector('#camp-email-tab tbody');te.replaceChildren();
    vinc.slice().sort((a,b)=>String(a.cliente).localeCompare(String(b.cliente),'pt-BR')).forEach(r=>{const tr=el('tr');tr.append(el('td',r.cliente),el('td',r.email_status||'—'),el('td',String(r.email_enviados??0),'n'),el('td',String(r.email_abertos??0),'n'));te.appendChild(tr);});
    // 7. financeiro / Corp e CRM
    const tf=document.querySelector('#camp-fin-tab tbody');tf.replaceChildren();
    d.defsSel.forEach(c=>{const tr=el('tr');tr.append(el('td',c.nome),el('td',c.comissao===null?'—':brl.format(c.comissao),'n'),el('td',c.repasse===null?'—':brl.format(c.repasse),'n'),el('td',c.custo_premiacao===null?'—':brl.format(c.custo_premiacao),'n'),el('td',c.resultado===null?'—':brl.format(c.resultado),'n'),el('td',c.corp_documentos===null?'—':fmt(c.corp_documentos,'int'),'n'),el('td',c.corp_premio===null?'—':brl.format(c.corp_premio),'n'));tf.appendChild(tr);});
    const tc=document.querySelector('#camp-crmfin-tab tbody');tc.replaceChildren();
    (rowsOf('camp_kpi')||[]).filter(r=>r.vendedora==='Todas'&&r.mes===S.mesAtual&&r.campanha!=='Todas').forEach(r=>{const tr=el('tr');tr.append(el('td',r.campanha),el('td',fmt(r.apolices_mes,'int'),'n'),el('td',fmt(r.apolices_acum,'int'),'n'),el('td',fmt(r.apolices_sem_data,'int'),'n'));tc.appendChild(tr);});
    // pendências de vínculo
    const tp=document.querySelector('#camp-pend-tab tbody');tp.replaceChildren();
    (rowsOf('camp_pendencias')||[]).forEach(r=>{const tr=el('tr');tr.append(el('td',String(r.card)),el('td',r.cliente),el('td',r.vendedora),el('td',r.motivo));tp.appendChild(tr);});
  };
  document.querySelectorAll('#camp-alertas .alertbtn').forEach(b=>{const alt=()=>{S.campAlerta=S.campAlerta===b.dataset.alerta?null:b.dataset.alerta;drawCampanhas();};b.addEventListener('click',alt);b.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();alt();}});});
  const draw=()=>{iniciar();`
  );
  return h;
}
