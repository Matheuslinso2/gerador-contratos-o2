"""Propensão de venda cruzada por cliente (Matheus, 04/11/2026) — roda local, sem IA paga.
Pergunta: entre clientes que acabam de comprar o produto-base, quem compra o produto-alvo nos 12 meses seguintes?
Referência de método: monografia UFRGS 2013 (regressão logística + redes neurais). Aqui: logística, árvores
(gradient boosting) e a média das duas ("em paralelo"), sempre testando em período que o modelo não viu."""
import sys, numpy as np, pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline
from sklearn.metrics import roc_auc_score

df = pd.read_pickle('analise-precos/propensao_docs.pkl')
df['vi'] = pd.to_datetime(df.vigencia_inicio, errors='coerce')
df = df[df.vi.notna() & df.locatario_id.notna() & (df.vi <= pd.Timestamp.today())].copy()
df['ramo'] = df.ramo.fillna('').str.upper().str.replace(r'^2 ', '', regex=True)
df['prod'] = df.ramo.map({'IMOBILIARIO': 'INC', 'FIANCA LOCATICIA': 'FIA', 'FIANÇA': 'FIA', 'CAPITALIZAÇÃO': 'CAP'}).fillna('OUT')
df['premio_liquido'] = pd.to_numeric(df.premio_liquido, errors='coerce')
NOMES = {'FIA': 'Fiança', 'INC': 'Incêndio', 'CAP': 'Capitalização'}
HOJE = pd.Timestamp.today().normalize()
JANELA = pd.Timedelta(days=365)
CARENCIA = pd.Timedelta(days=30)  # compra dentro de 30 dias do base conta como pacote, não como venda cruzada


def montar(base, alvo):
    b = df[df['prod'] == base].sort_values('vi').drop_duplicates('locatario_id')  # 1ª compra do produto-base
    a = df[df['prod'] == alvo].groupby('locatario_id').vi.apply(lambda s: np.sort(s.values))
    antes = df[df['prod'] != base].groupby('locatario_id').vi.apply(lambda s: np.sort(s.values))
    linhas = []
    for r in b.itertuples():
        t0 = r.vi
        datas = a.get(r.locatario_id, np.array([], dtype='datetime64[ns]'))
        if len(datas) and (datas <= np.datetime64(t0 + CARENCIA)).any():
            continue  # já tinha o alvo (ou veio junto): não é candidato à venda cruzada
        if t0 + JANELA > HOJE:
            continue  # desfecho ainda não observável
        y = int(len(datas) and ((datas > np.datetime64(t0 + CARENCIA)) & (datas <= np.datetime64(t0 + JANELA))).any())
        outros = antes.get(r.locatario_id, np.array([], dtype='datetime64[ns]'))
        linhas.append((r.locatario_id, r.imobiliaria_principal_id, t0, y, r.premio_liquido, r.seguradora, r.forma_pagamento, r.qtd_parcelas, r.aluguel, int((outros < np.datetime64(t0)).sum())))
    d = pd.DataFrame(linhas, columns=['cliente', 'imob', 't0', 'y', 'premio', 'seg', 'forma', 'parcelas', 'aluguel', 'outros_antes'])
    # taxa histórica de venda cruzada da imobiliária, calculada SÓ com desfechos já conhecidos em t0 (sem vazamento)
    d = d.sort_values('t0').reset_index(drop=True)
    d['resolve'] = d.t0 + JANELA
    taxa, n_prev = [], []
    por_imob = {k: g for k, g in d.groupby('imob')}
    for i, r in d.iterrows():
        g = por_imob.get(r.imob)
        h = g[(g.resolve <= r.t0)] if g is not None else None
        n = 0 if h is None else len(h)
        n_prev.append(n)
        soma = 0 if h is None else h.y.sum()
        taxa.append((soma + 2 * d.y.mean()) / (n + 2))  # suavizada pela taxa geral
    d['imob_taxa_prev'] = taxa
    d['imob_n_prev'] = n_prev
    d['ano'] = d.t0.dt.year
    d['log_premio'] = np.log1p(d.premio.fillna(d.premio.median()))
    d['tem_aluguel'] = d.aluguel.notna().astype(int)
    d['log_aluguel'] = np.log1p(d.aluguel.fillna(d.aluguel.median() if d.aluguel.notna().any() else 0))
    d['parcelas'] = pd.to_numeric(d.parcelas, errors='coerce').fillna(1)
    return d


def preparar(d, cols_cat, ref=None):
    X = d[['imob_taxa_prev', 'imob_n_prev', 'log_premio', 'log_aluguel', 'tem_aluguel', 'parcelas', 'outros_antes']].copy()
    X['imob_n_prev'] = np.log1p(X.imob_n_prev)
    for c in cols_cat:
        top = (d if ref is None else ref)[c].fillna('?').value_counts().head(6).index
        for v in top:
            X[f'{c}={v}'] = (d[c].fillna('?') == v).astype(int)
    return X


def avaliar(base, alvo, corte='2024-01-01'):
    d = montar(base, alvo)
    tr, te = d[d.t0 < corte], d[d.t0 >= corte]
    res = {'par': f'{NOMES[base]} → {NOMES[alvo]}', 'n': len(d), 'pos': int(d.y.sum()), 'taxa': d.y.mean(), 'n_tr': len(tr), 'n_te': len(te), 'taxa_te': te.y.mean() if len(te) else np.nan}
    if len(te) < 100 or te.y.sum() < 15 or tr.y.sum() < 30 or tr.y.nunique() < 2:
        res['ok'] = False
        return res, d, None
    Xtr = preparar(tr, ['seg', 'forma'], tr)
    cols = Xtr.columns
    Xte = preparar(te, ['seg', 'forma'], tr).reindex(columns=cols, fill_value=0)
    lr = make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000, C=0.5)).fit(Xtr, tr.y)
    gb = HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=200, random_state=0).fit(Xtr, tr.y)
    p_lr, p_gb = lr.predict_proba(Xte)[:, 1], gb.predict_proba(Xte)[:, 1]
    p_par = (p_lr + p_gb) / 2
    res.update(ok=True, auc_regra=roc_auc_score(te.y, te.imob_taxa_prev), auc_lr=roc_auc_score(te.y, p_lr), auc_gb=roc_auc_score(te.y, p_gb), auc_par=roc_auc_score(te.y, p_par))
    te = te.assign(p=p_par)
    te['decil'] = pd.qcut(te.p.rank(method='first'), 10, labels=False)
    res['decis'] = te.groupby('decil').y.agg(['mean', 'sum', 'count']).reset_index()
    res['lift10'] = te[te.decil == 9].y.mean() / te.y.mean()
    res['lift30'] = te[te.decil >= 7].y.mean() / te.y.mean()
    coef = pd.Series(lr[-1].coef_[0], index=cols).sort_values()
    res['coef'] = coef
    return res, d, te


if __name__ == '__main__':
    saida = {}
    for base, alvo in [('FIA', 'INC'), ('INC', 'FIA'), ('INC', 'CAP'), ('FIA', 'CAP')]:
        r, d, te = avaliar(base, alvo)
        saida[(base, alvo)] = (r, d)
        print(r['par'], 'n', r['n'], 'positivos', r['pos'], 'taxa', round(r['taxa'], 3), '| treino', r['n_tr'], 'teste', r['n_te'])
        if r['ok']:
            print('   AUC regra simples (taxa da imob)', round(r['auc_regra'], 3), '| logística', round(r['auc_lr'], 3), '| árvores', round(r['auc_gb'], 3), '| média', round(r['auc_par'], 3), '| lift top10%', round(r['lift10'], 2), 'top30%', round(r['lift30'], 2))
        else:
            print('   amostra insuficiente para testar')
    pd.to_pickle({k: (v[0], v[1][['imob', 't0', 'y']]) for k, v in saida.items()}, 'analise-precos/propensao_res.pkl')
