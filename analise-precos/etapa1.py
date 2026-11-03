import sys; sys.path.insert(0,'analise-precos')
from preparar import *
import statsmodels.api as sm
from sklearn.metrics import roc_auc_score
import json
df=carregar(); out={}
dec=df[df.status_padrao.isin(['Convertido','Perdido','Recusado'])&df.alu_ok].copy()
dec['conv']=(dec.status_padrao=='Convertido').astype(int)
def ic(k,n,z=1.96):
    p=k/n; den=1+z*z/n; c=(p+z*z/(2*n))/den; h=z*np.sqrt(p*(1-p)/n+z*z/(4*n*n))/den; return c-h,c+h
# ---- tabelas de conversão
def tab(g):
    t=dec.groupby(g,observed=True).agg(cotacoes=('conv','size'),fechadas=('conv','sum'),recusadas=('status_padrao',lambda s:(s=='Recusado').sum()),perdidas=('status_padrao',lambda s:(s=='Perdido').sum()))
    t['conversao_%']=100*t.fechadas/t.cotacoes
    t['recusa_%']=100*t.recusadas/t.cotacoes
    t['fecha_se_aprovada_%']=100*t.fechadas/(t.fechadas+t.perdidas)
    lo=[ic(k,n) for k,n in zip(t.fechadas,t.cotacoes)]
    t['ic95_min']=[100*a for a,b in lo]; t['ic95_max']=[100*b for a,b in lo]
    return t.round(1)
t_faixa=tab('faixa'); t_ano=tab('ano'); t_mes=tab('mes'); t_mes=t_mes[t_mes.cotacoes>=100]
t_imob=tab('imob'); t_imob=t_imob[t_imob.cotacoes>=150].sort_values('cotacoes',ascending=False)
# encolhimento (empirical Bayes simples) para ranking de imobiliárias
m=dec.conv.mean(); k0=60
t_imob['conversao_ajustada_%']=(100*(t_imob.fechadas+k0*m)/(t_imob.cotacoes+k0)).round(1)
# ---- modelo logístico
top=list(dec.imob.value_counts().head(20).index)
def desenho(d):
    X=pd.DataFrame(index=d.index)
    X['ln_aluguel']=np.log(d.aluguel)-np.log(2000)
    X['ln_aluguel2']=X.ln_aluguel**2
    X['comercial']=(d.tipo_locacao=='COMERCIAL').astype(int)
    for a in [2021,2022,2023,2024,2025,2026]: X[f'ano_{a}']=(d.ano==a).astype(int)
    X['ano_sem_data']=d.ano.isna().astype(int)
    for i in top: X['imob_'+i[:18]]=(d.imob==i).astype(int)
    return sm.add_constant(X.astype(float),has_constant='add')
def ajusta(d,nome):
    X=desenho(d); y=d.conv
    tr=d.ano.fillna(2020)<=2025
    cols=[c for c in X.columns if c=='const' or X[tr][c].std()>0]
    mod=sm.Logit(y[tr],X[tr][cols]).fit(disp=0,maxiter=200)
    auc_t=roc_auc_score(y[~tr],mod.predict(X[~tr][cols]))
    full=sm.Logit(y,X).fit(disp=0,maxiter=200)
    return full,auc_t,len(d)
mA,aucA,nA=ajusta(dec,'A')
decB=dec[dec.status_padrao.isin(['Convertido','Perdido'])]
mB,aucB,nB=ajusta(decB,'B')
def resumo(m):
    r=pd.DataFrame({'efeito_odds':np.exp(m.params),'p':m.pvalues,'min':np.exp(m.conf_int()[0]),'max':np.exp(m.conf_int()[1])})
    return r.round(3)
rA,rB=resumo(mA),resumo(mB)
# chance prevista por aluguel (cliente "médio": residencial, 2026, sem imob específica)
grade=pd.DataFrame({'aluguel':[800,1000,1500,2000,3000,4000,6000,8000,12000]})
def pred(m,tipo):
    d=pd.DataFrame({'aluguel':grade.aluguel,'tipo_locacao':'RESIDENCIAL','ano':2026,'imob':'_'}); return m.predict(desenho(d)[m.params.index]).round(3)
grade['chance_fechar_%']=(100*pred(mA,0)).round(1); grade['chance_fechar_se_aprovada_%']=(100*pred(mB,0)).round(1)
# ---- preço praticado (prêmio) com correção de viés
c=df[(df.status_padrao=='Convertido')&df.alu_ok&(df.ano>=2024)].copy()
c['tem_premio']=c.premio.notna()
c['premio']=c.premio.where(c.premio.between(c.aluguel*0.3,c.aluguel*12))  # remove absurdos
c['tem_premio']=c.premio.notna()
cov=c.groupby('faixa',observed=True).tem_premio.agg(['size','sum']); cov['peso']=cov['size']/cov['sum']
c['w']=c.faixa.astype(object).map(cov.peso.astype(float)).astype(float).where(c.tem_premio)
p=c[c.tem_premio&c.seg.notna()].copy()
p['k_aluguel']=p.premio/p.aluguel; p['parcela']=p.premio/12; p['k_parc_alu']=p.parcela/p.aluguel
p['k_parc_pac']=p.parcela/p.pacote
def wq(x,w,q):
    o=np.argsort(x.values); xs=x.values[o]; ws=w.values[o]; cw=np.cumsum(ws)/ws.sum(); return xs[np.searchsorted(cw,q)]
rows=[]
for s,g in p.groupby('seg'):
    g=g.dropna(subset=['w'])
    q=g.dropna(subset=['k_parc_pac'])
    rows.append(dict(seguradora=s,apolices=len(g),premio_mediano=g.premio.median(),premio_em_alugueis_mediano=wq(g.k_aluguel,g.w,.5),p25=wq(g.k_aluguel,g.w,.25),p75=wq(g.k_aluguel,g.w,.75),
      parcela_mensal_sobre_aluguel_pct=100*wq(g.k_parc_alu,g.w,.5),n_com_pacote=len(q),parcela_sobre_pacote_pct=100*wq(q.k_parc_pac,q.w,.5) if len(q)>20 else np.nan))
t_seg=pd.DataFrame(rows).round(2)
share=df[(df.status_padrao=='Convertido')&df.seg.notna()].groupby(['ano','seg']).size().unstack().fillna(0)
share=(100*share.div(share.sum(1),axis=0)).round(1)
cobertura=dict(conv_2024mais=int(len(c)),com_premio=int(c.tem_premio.sum()),
   aluguel_medio_com=float(c[c.tem_premio].aluguel.mean()),aluguel_medio_sem=float(c[~c.tem_premio].aluguel.mean()))
pd.to_pickle(dict(t_faixa=t_faixa,t_ano=t_ano,t_mes=t_mes,t_imob=t_imob,rA=rA,rB=rB,aucA=aucA,aucB=aucB,nA=nA,nB=nB,grade=grade,t_seg=t_seg,share=share,cobertura=cobertura,
  datas_ruins=int(df.data_ruim.sum()),n_total=len(df),n_dec=len(dec),pacote_cov=float(c.pacote.notna().mean()),
  tx_global=float(dec.conv.mean())),'analise-precos/etapa1.pkl')
for n,t in [('faixa',t_faixa),('imob',t_imob.head(12)),('modelA',rA.head(10)),('modelB',rB.head(10)),('grade',grade),('seg',t_seg),('share',share)]: print(n);print(t.to_string())
print(aucA,aucB,cobertura)
