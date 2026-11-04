import pandas as pd
pd.set_option('display.width',250); pd.set_option('display.max_columns',30)
m=pd.read_pickle('analise-precos/margem.pkl')
for c in ['premio_liquido','comissao','repasse']: m[c]=m[c].astype(float)
m['margem']=m.comissao-m.repasse
def res(g):
    s=g[['apolices','premio_liquido','comissao','repasse','margem','sem_comissao','sem_repasse']].sum()
    s['com_%_premio']=100*s.comissao/s.premio_liquido if s.premio_liquido else None
    s['repasse_%_com']=100*s.repasse/s.comissao if s.comissao else None
    s['margem_%_com']=100*s.margem/s.comissao if s.comissao else None
    s['margem_por_apolice']=s.margem/s.apolices
    return s.round(1)
print(m.groupby('ano').apply(res)[['apolices','comissao','repasse','margem','margem_%_com']])
r=m[m.ano.isin([2025,2026])]
print(r.groupby('produto').apply(res).sort_values('apolices',ascending=False))
print(r[r.produto.isin(['Fiança','Incêndio imobiliário','Capitalização'])].groupby(['produto','seguradora']).apply(res).query('apolices>=30'))
i=r.groupby('imobiliaria_id',dropna=False).apply(res).sort_values('margem',ascending=False)
print(i.head(10)[['apolices','comissao','repasse','margem','margem_%_com']]); print(len(i), i.index.isna().sum() if hasattr(i.index,'isna') else '')
print('sem imob:', r[r.imobiliaria_id.isna()].apolices.sum(), 'de', r.apolices.sum())
