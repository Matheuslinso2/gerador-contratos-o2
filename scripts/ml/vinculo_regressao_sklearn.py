# ERP O2 - 02/11/2026: CONFERE com scikit-learn a regressao logistica dos pesos de vinculo feita em TypeScript (scripts/erp/vinculo-regressao.ts).
# Le erp_vinculo_treino pela API do Supabase (chave de servico lida do .env.local, nunca impressa). Saida: so numeros agregados (nenhum CPF/nome).
# uso: .\.venv-ml\Scripts\python.exe -I scripts/ml/vinculo_regressao_sklearn.py TREINO-0211
import json
import sys
import urllib.parse
import urllib.request

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import GroupKFold

FEATURES = ["premio_igual", "premio_sem_dado", "vigencia_igual", "cpf_igual", "cpf_diferente", "nome_igual",
            "seguradora_igual", "mesmo_locatario", "comissao_igual", "ramo_igual", "premio_na_faixa_reajuste"]


def ler_env(caminho):
    env = {}
    with open(caminho, encoding="utf-8") as f:
        for linha in f:
            linha = linha.strip()
            if linha and not linha.startswith("#") and "=" in linha:
                k, v = linha.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def baixar(lote, env):
    base = env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/") + "/rest/v1/erp_vinculo_treino"
    chave = env["SUPABASE_SERVICE_ROLE_KEY"]
    linhas = []
    de = 0
    while True:
        q = urllib.parse.urlencode({"select": "grupo,rotulo,rotulo_fonte,f", "lote": "eq." + lote, "tarefa": "eq.renovacao_sucessora", "order": "id"})
        req = urllib.request.Request(base + "?" + q, headers={"apikey": chave, "Authorization": "Bearer " + chave, "Range-Unit": "items", "Range": f"{de}-{de + 999}"})
        with urllib.request.urlopen(req, timeout=60) as r:
            lote_json = json.loads(r.read().decode("utf-8"))
        linhas.extend(lote_json)
        if len(lote_json) < 1000:
            break
        de += 1000
    return linhas


def main():
    lote = sys.argv[1]
    env = ler_env(r"C:\Users\O2-Grupo\Desktop\PROJETO CENTRAL DE NEGOCIOS\gerador-contratos\.env.local")
    dados = baixar(lote, env)
    X = np.array([[float(d["f"].get(k, 0)) for k in FEATURES] for d in dados])
    y = np.array([d["rotulo"] for d in dados])
    g = np.array([d["grupo"] for d in dados])
    fonte = np.array([d["rotulo_fonte"] for d in dados])
    print(f"linhas {len(y)} | positivos {int(y.sum())} | grupos {len(set(g))}")

    # lambda (TS) -> C (sklearn): a penalidade do TS e lambda*||beta||^2/2 sem media; em sklearn C = 1/lambda
    for lam in [0.1, 1, 10]:
        gkf = GroupKFold(n_splits=5)
        oof = np.zeros(len(y))
        for tr, te in gkf.split(X, y, g):
            m = LogisticRegression(C=1.0 / lam, solver="lbfgs", max_iter=2000)
            m.fit(X[tr], y[tr])
            oof[te] = m.predict_proba(X[te])[:, 1]
        forte = fonte == "pdf"
        ll = -np.mean(y[forte] * np.log(np.clip(oof[forte], 1e-12, 1)) + (1 - y[forte]) * np.log(np.clip(1 - oof[forte], 1e-12, 1)))
        print(f"CV por grupo lambda={lam}: AUC(pdf)={roc_auc_score(y[forte], oof[forte]):.4f} logloss(pdf)={ll:.5f}")

    # protocolo A: treina no fraco (corp), testa no forte (pdf)
    corp = fonte == "corp"
    forte = fonte == "pdf"
    m = LogisticRegression(C=1.0 / 0.1, solver="lbfgs", max_iter=5000).fit(X[corp], y[corp])
    p = m.predict_proba(X[forte])[:, 1]
    print(f"A) treino=corp teste=pdf: AUC={roc_auc_score(y[forte], p):.4f}")

    # modelo final (todos os rotulos), lambda=0.1 -> comparar coeficientes com o TypeScript
    mf = LogisticRegression(C=1.0 / 0.1, solver="lbfgs", max_iter=5000).fit(X, y)
    print("intercepto", round(float(mf.intercept_[0]), 3))
    for k, c in zip(FEATURES, mf.coef_[0]):
        print(f"  {k:28s} {c:8.3f}")

    # lasso para ver quem sobrevive
    ml = LogisticRegression(penalty="l1", C=1.0 / 20, solver="liblinear", max_iter=5000).fit(X, y)
    print("lasso (C=1/20) coeficientes != 0:", [k for k, c in zip(FEATURES, ml.coef_[0]) if abs(c) > 1e-6])

    # calibracao fora-da-amostra no forte (protocolo CV por grupo, lambda 0.1)
    gkf = GroupKFold(n_splits=5)
    oof = np.zeros(len(y))
    for tr, te in gkf.split(X, y, g):
        mm = LogisticRegression(C=1.0 / 0.1, solver="lbfgs", max_iter=2000).fit(X[tr], y[tr])
        oof[te] = mm.predict_proba(X[te])[:, 1]
    bins = [0, 0.01, 0.05, 0.2, 0.5, 0.8, 0.95, 0.99, 1.0001]
    print("calibracao (pdf):")
    for a, b in zip(bins[:-1], bins[1:]):
        sel = forte & (oof >= a) & (oof < b)
        if sel.sum():
            print(f"  {a:.2f}-{min(b, 1):.2f}: pares {int(sel.sum()):6d} prob_media {oof[sel].mean():.3f} taxa_real {y[sel].mean():.3f}")


if __name__ == "__main__":
    main()
