# ERP O2 - 02/11/2026: GANHO de usar o ENDERECO (CEP/numero do PDF oficial) como feature na regressao logistica de vinculos (renovacao -> sucessora).
# Compara modelo A (11 features) x modelo B (A + 4 de endereco), validacao cruzada por GRUPO. Saida: so numeros agregados (nenhum endereco/CPF/nome).
# uso: .\.venv-ml\Scripts\python.exe -I scripts/ml/vinculo_regressao_endereco.py TREINO-0211
import json
import sys
import urllib.parse
import urllib.request

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import GroupKFold

BASE = ["premio_igual", "premio_sem_dado", "vigencia_igual", "cpf_igual", "cpf_diferente", "nome_igual",
        "seguradora_igual", "mesmo_locatario", "comissao_igual", "ramo_igual", "premio_na_faixa_reajuste"]
END = ["end_sem_dado", "end_cep_igual", "end_cep_numero_igual", "end_cep_diferente"]


def ler_env(caminho):
    env = {}
    with open(caminho, encoding="utf-8") as f:
        for linha in f:
            linha = linha.strip()
            if linha and not linha.startswith("#") and "=" in linha:
                k, v = linha.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def baixar(lote, tarefa, env):
    base = env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/") + "/rest/v1/erp_vinculo_treino"
    chave = env["SUPABASE_SERVICE_ROLE_KEY"]
    out, de = [], 0
    while True:
        q = urllib.parse.urlencode({"select": "grupo,rotulo,rotulo_fonte,f,f_end,candidata_id", "lote": "eq." + lote, "tarefa": "eq." + tarefa, "order": "id"})
        req = urllib.request.Request(base + "?" + q, headers={"apikey": chave, "Authorization": "Bearer " + chave, "Range-Unit": "items", "Range": f"{de}-{de + 999}"})
        with urllib.request.urlopen(req, timeout=60) as r:
            lote_json = json.loads(r.read().decode("utf-8"))
        out.extend(lote_json)
        if len(lote_json) < 1000:
            break
        de += 1000
    return out


def matriz(dados, cols_base, cols_end):
    X = []
    for d in dados:
        fe = d.get("f_end") or {}
        X.append([float(d["f"].get(k, 0)) for k in cols_base] + [float(fe.get(k, 1 if k == "end_sem_dado" else 0)) for k in cols_end])
    return np.array(X)


def decisao_por_grupo(grupos, p, y=None, corte=0.9, margem=0.3):
    res = {"vincula": 0, "acertos": 0, "empate": 0, "incerto": 0, "sem_candidata": 0}
    for g in set(grupos):
        idx = np.where(grupos == g)[0]
        ps = np.sort(p[idx])[::-1]
        p1, p2 = ps[0], (ps[1] if len(ps) > 1 else 0.0)
        if p1 >= corte and p1 - p2 >= margem:
            res["vincula"] += 1
            if y is not None and y[idx][np.argmax(p[idx])] == 1:
                res["acertos"] += 1
        elif p1 >= corte:
            res["empate"] += 1
        elif p1 >= 0.3:
            res["incerto"] += 1
        else:
            res["sem_candidata"] += 1
    return res


def main():
    lote = sys.argv[1]
    env = ler_env(r"C:\Users\O2-Grupo\Desktop\PROJETO CENTRAL DE NEGOCIOS\gerador-contratos\.env.local")
    rot = baixar(lote, "renovacao_sucessora", env)
    sem = baixar(lote, "renovacao_sucessora_sem_rotulo", env)
    y = np.array([d["rotulo"] for d in rot]); g = np.array([d["grupo"] for d in rot]); fonte = np.array([d["rotulo_fonte"] for d in rot])
    XA = matriz(rot, BASE, []); XB = matriz(rot, BASE, END)
    tem_end = XB[:, BASE.__len__()] == 0  # end_sem_dado == 0
    forte = fonte == "pdf"
    print(f"rotulados: {len(y)} linhas | com endereco nos dois lados: {int(tem_end.sum())} | fortes (pdf): {int(forte.sum())} | fortes com endereco: {int((forte & tem_end).sum())}")
    print("grupos fortes com endereco:", len(set(g[forte & tem_end])), "| positivos fortes com endereco:", int(y[forte & tem_end].sum()))

    resultados = {}
    for nome, X in [("A_sem_endereco", XA), ("B_com_endereco", XB)]:
        oof = np.zeros(len(y))
        for tr, te in GroupKFold(n_splits=5).split(X, y, g):
            m = LogisticRegression(C=1.0 / 0.1, solver="lbfgs", max_iter=5000).fit(X[tr], y[tr])
            oof[te] = m.predict_proba(X[te])[:, 1]
        sel_todos = forte
        sel_end = forte & tem_end
        ll = lambda s: -np.mean(y[s] * np.log(np.clip(oof[s], 1e-12, 1)) + (1 - y[s]) * np.log(np.clip(1 - oof[s], 1e-12, 1)))
        resultados[nome] = {
            "auc_fortes": round(roc_auc_score(y[sel_todos], oof[sel_todos]), 4), "logloss_fortes": round(ll(sel_todos), 5),
            "auc_fortes_com_endereco": round(roc_auc_score(y[sel_end], oof[sel_end]), 4), "logloss_fortes_com_endereco": round(ll(sel_end), 5),
            "decisao_grupos_fortes": decisao_por_grupo(g[sel_todos], oof[sel_todos], y[sel_todos]),
            "decisao_grupos_fortes_com_endereco": decisao_por_grupo(g[sel_end], oof[sel_end], y[sel_end]),
        }
    print(json.dumps(resultados, indent=1))

    # modelos finais (todos os rotulos) e efeito nos grupos SEM rotulo (empates/incertos)
    mA = LogisticRegression(C=10, solver="lbfgs", max_iter=5000).fit(XA, y)
    mB = LogisticRegression(C=10, solver="lbfgs", max_iter=5000).fit(XB, y)
    print("coeficientes de endereco (modelo B):", {k: round(float(c), 3) for k, c in zip(BASE + END, mB.coef_[0]) if k in END})
    gs = np.array([d["grupo"] for d in sem])
    SA = matriz(sem, BASE, []); SB = matriz(sem, BASE, END)
    sem_tem = SB[:, len(BASE)] == 0
    pA = mA.predict_proba(SA)[:, 1]; pB = mB.predict_proba(SB)[:, 1]
    print("grupos sem rotulo:", len(set(gs)), "| com endereco nos dois lados em alguma candidata:", len(set(gs[sem_tem])))
    print("modelo A:", decisao_por_grupo(gs, pA))
    print("modelo B:", decisao_por_grupo(gs, pB))
    # mesmos grupos, so os que tem endereco em alguma candidata
    alvo = np.isin(gs, list(set(gs[sem_tem])))
    print("so grupos com endereco | A:", decisao_por_grupo(gs[alvo], pA[alvo]))
    print("so grupos com endereco | B:", decisao_por_grupo(gs[alvo], pB[alvo]))


if __name__ == "__main__":
    main()
