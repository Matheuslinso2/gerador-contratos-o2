import pandas as pd, numpy as np, re
def seg_norm(s):
    if s is None or (isinstance(s,float) and np.isnan(s)): return None
    u=s.upper().strip()
    if u.startswith('POTT'): 
        if 'TF' in u or 'TAXA FIXA' in u: return 'Pottencial Taxa Fixa'
        return 'Pottencial Tradicional'
    if u.startswith('PORTO'): return 'Porto Essencial' if 'ESSENCIAL' in u else 'Porto Tradicional'
    if u.startswith('ESSENCIAL'): return 'Porto Essencial'
    if u.startswith('TOKIO'): return 'Tokio'
    if u.startswith('TOO'): return 'Too'
    if u.startswith('LIBERTY'): return 'Liberty'
    return None
def carregar():
    df=pd.read_pickle('analise-precos/fianca.pkl')
    # 1 linha = 1 caso: a planilha repete o caso nos meses seguintes (herdada); fica o estado mais avançado.
    ordem={'Convertido':6,'Perdido':5,'Recusado':4,'Cancelado':3,'Aprovado':2,'Em análise':1}
    df['_r']=df.status_padrao.map(ordem).fillna(0)
    df=df.sort_values(['_r','herdada'],ascending=[False,True]).drop_duplicates('chave_caso').drop(columns='_r').reset_index(drop=True)
    x=pd.json_normalize(df.extras.apply(lambda e:e or {}))
    for c in ['pacote_locacao','condominio','iptu','tipo_locacao','cep','bairro','cidade']:
        df[c]=x[c] if c in x else None
    for c in ['aluguel','premio','comissao','pacote_locacao','condominio','iptu']: df[c]=pd.to_numeric(df[c],errors='coerce')
    df['data']=pd.to_datetime(df.data_recebimento,errors='coerce')
    df['data_ruim']=~df.data.dt.year.between(2020,2026)
    df.loc[df.data_ruim,'data']=pd.NaT
    df['mes']=df.data.dt.to_period('M').astype(str).where(df.data.notna())
    df['ano']=df.data.dt.year
    df['seg']=df.seguradora.map(seg_norm)
    df['alu_ok']=df.aluguel.between(300,40000)
    # pacote só vale se >= aluguel (senão é lixo)
    df['pacote']=df.pacote_locacao.where(df.pacote_locacao>=df.aluguel)
    df['imob']=df.imobiliaria_texto.str.upper().str.strip()
    df['faixa']=pd.cut(df.aluguel,[0,1000,1500,2000,3000,5000,8000,1e9],right=False,
        labels=['< 1.000','1.000-1.499','1.500-1.999','2.000-2.999','3.000-4.999','5.000-7.999','8.000+'])
    return df
