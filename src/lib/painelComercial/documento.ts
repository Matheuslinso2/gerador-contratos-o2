import { PAINEL_FRAGMENTO } from "./painelHtml";

// Documento HTML completo do Painel Comercial v5, servido em
// /painel-comercial/app (só para quem tem perfil) e exibido num iframe da
// página /painel-comercial. O iframe isola o CSS do painel (aprovado pela
// Vanessa) do CSS do Workspace.
//
// A referência foi escrita para o runtime de dashboard do Claude (dash.data,
// dash.calc, dash.onData, dash.setLink). Aqui só essa CAMADA DE DADOS muda:
// mesmos IDs de dataset e mesmas colunas, lidos de /api/painel-comercial/dados.

const TOKENS = `
:root{
  --font-anthropic-sans:'Poppins',Arial,Helvetica,sans-serif;
  --font-anthropic-serif:'Poppins',Arial,Helvetica,sans-serif;
  --cds-gap-xs:6px;--cds-gap-sm:10px;--cds-gap-md:14px;--cds-gap-lg:22px;
  --cds-pad-sm:8px;--cds-pad-md:14px;--cds-pad-lg:18px;--cds-radius:10px;
  --cds-font-size-title:26px;--cds-font-size-heading:18px;--cds-font-size-body:14px;--cds-font-size-caption:12px;
  --cds-font-weight-medium:600;
  --color-bg:#ffffff;--color-panel:#f7f9fb;--color-fg:#01192e;--color-fg-muted:#5b6770;--color-border-line:#d9e0e6;
  --color-bad:#c62828;--color-warn:#b26a00;--color-ok:#1b7a3a;
  --cds-chart-grid:#e4eaee;--cds-chart-muted:#9fb0bd;--cds-chart-status-critical:#c62828;
}
@media (prefers-color-scheme:dark){:root{
  --color-bg:#0b1d2e;--color-panel:#10283d;--color-fg:#eef3f7;--color-fg-muted:#9db0bf;--color-border-line:#244157;
  --color-bad:#ff7b72;--color-warn:#e3a008;--color-ok:#56d364;--cds-chart-grid:#1b3449;--cds-chart-muted:#5f7a8f;--cds-chart-status-critical:#ff7b72;
}}
html,body{margin:0;background:var(--color-bg);color:var(--color-fg);font-family:var(--font-anthropic-sans)}
body{padding:16px}
@media (max-width:640px){body{padding:12px}}
`;

// Substitui o runtime do artifact. data(id) devolve {status,data}; calc() guarda
// as tabelas calculadas no navegador (conv, etapas_v, camp_parados); onData()
// avisa quando os datasets chegam. A comissão individual já vem filtrada do servidor.
const RUNTIME = `
(function(){
  var store={},calcs=[],subs=[];
  var dash=window.dash={
    colors:['#00447E','#F8540D','#1c165c','#8d8683'],
    meta:{visao:null,geradoEm:null,erro:null},
    data:function(id){return store[id]||{status:dash.meta.erro?'error':'loading',data:null};},
    calc:function(id,o){calcs.push({id:id,inputs:o.inputs,fn:o.fn});},
    onData:function(cb){subs.push(cb);},
    setLink:function(id){try{history.replaceState(null,'','#'+id);}catch(e){}}
  };
  function avisar(){subs.forEach(function(cb){try{cb();}catch(e){console.error(e);}});}
  function aplicarCalcs(){
    calcs.forEach(function(c){
      var ok=c.inputs.every(function(i){return store[i]&&store[i].status==='ok';});
      if(!ok){return;}
      try{store[c.id]={status:'ok',data:c.fn.apply(null,c.inputs.map(function(i){return store[i].data;}))};}catch(e){console.error(e);}
    });
  }
  function carregar(){
    fetch('/api/painel-comercial/dados',{credentials:'same-origin',cache:'no-store'})
      .then(function(r){if(!r.ok)throw new Error(String(r.status));return r.json();})
      .then(function(j){
        dash.meta.visao=j.visao;dash.meta.geradoEm=j.geradoEm;dash.meta.erro=null;
        Object.keys(j.dados).forEach(function(k){store[k]={status:'ok',data:j.dados[k]};});
        aplicarCalcs();avisar();
      })
      .catch(function(e){
        dash.meta.erro='Não consegui carregar os dados do Bitrix agora ('+e.message+'). Tente de novo em instantes.';
        avisar();
      });
  }
  window.addEventListener('DOMContentLoaded',function(){
    carregar();
    var tell=function(){try{parent.postMessage({tipo:'painel-comercial-altura',altura:document.documentElement.scrollHeight},location.origin);}catch(e){}};
    if(window.ResizeObserver){new ResizeObserver(tell).observe(document.body);}
    tell();
  });
})();
`;

export function montarDocumentoPainel(): string {
  // O fragmento da referência termina com o <script> que usa window.dash; ele
  // roda depois do runtime e antes do DOMContentLoaded.
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Painel comercial</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap" rel="stylesheet">
<style>${TOKENS}</style>
<script>${RUNTIME}</script>
</head>
<body>
${PAINEL_FRAGMENTO}
</body>
</html>`;
}
