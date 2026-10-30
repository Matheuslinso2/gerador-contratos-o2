import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const T=path.join(os.tmpdir(),"tokio");
const props=JSON.parse(fs.readFileSync(path.join(os.tmpdir(),"tokio-propostas.json"),"utf8"));
const iso=d=>d.split("/").reverse().join("-");
const ap=new Map(); for(const l of fs.readFileSync(path.join(T,"consulta-55002.txt"),"utf8").split("\n").filter(Boolean)){const [cpf,n,ramo,prod,ini,fim,emi,sit,pt,pl,idepol,numoper,cor,end]=l.split("|"); (ap.get(cpf)??ap.set(cpf,[]).get(cpf)).push({cpf,n,ramo,prod,ini:iso(ini),fim:iso(fim),emi:iso(emi),sit,pt,pl,idepol,numoper,cor,end});}
const cot=new Map(); for(const l of fs.readFileSync(path.join(T,"cotacoes.txt"),"utf8").split("\n").filter(Boolean)){const [cpf,n,prod,mod,ini,fim,emi,pl,sit,orig,cor]=l.split("|"); cot.set(n,{cpf,n,prod,ini,fim,emi,pl,sit});}
const st={total:props.length,semCpf:0,cpfSemApolice:0,porCotacao:0,cotacaoSemApolice:0,candidatasCpf:0,semNada:0};
const out=[];
for(const p of props){
 const nums=String(p.proposta??"").split(/[^0-9]+/).filter(x=>x.length>=5);
 const cs=nums.map(n=>cot.get(n)).filter(Boolean);
 let achou=null;
 for(const c of cs){ const a=(ap.get(c.cpf)??[]).filter(a=>a.ini===c.ini&&a.fim===c.fim); if(a.length){achou={via:"cotacao",cotacao:c.n,ap:a};break;} }
 if(achou){st.porCotacao++;out.push({id:p.id,codigo_o2:p.codigo_o2,ramo:p.ramo,proposta:p.proposta,...achou});continue;}
 if(cs.length){st.cotacaoSemApolice++;continue;}
 if(!p.cpfs.length){st.semCpf++;continue;}
 const lista=p.cpfs.flatMap(c=>ap.get(c)??[]).filter(a=>a.sit==="Ativa");
 if(!lista.length){st.cpfSemApolice++;continue;}
 st.candidatasCpf++; out.push({id:p.id,codigo_o2:p.codigo_o2,ramo:p.ramo,proposta:p.proposta,via:"cpf",ap:lista});
}
console.log(st);
const pares=new Set(); for(const o of out) for(const a of o.ap) pares.add(a.ramo+"/"+a.n);
console.log("apólices distintas a baixar:",pares.size, "só por cotação:",new Set(out.filter(o=>o.via==="cotacao").flatMap(o=>o.ap.map(a=>a.ramo+"/"+a.n))).size);
fs.writeFileSync(path.join(T,"cruzamento.json"),JSON.stringify(out));
