# ERP O2 - 02/11/2026: o ENDERECO ajuda a DESEMPATAR candidatas do MESMO segurado? (caso dos "empatados"). Subconjunto: rotulo forte (PDF) + mesmo_locatario=1 + endereco nos dois lados.
# Compara A (so features-base) x B (base + CEP igual / CEP+numero igual / CEP diferente) com validacao cruzada por grupo. NAO usa "sem dado" como feature (evita o viés da disponibilidade do PDF).
# Saida: so numeros agregados. uso: .\.venv-ml\Scripts\python.exe -W ignore -I scripts/ml/vinculo_endereco_desempate.py TREINO-0211
import json
import sys
import urllib.parse
import urllib.request

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import GroupKFold

BASE = ["premio_igual", "premio_sem_dado", "vigencia_igual", "cpf_igual", "cpf_diferente", "nome_igual", "seguradora_igual", "comissao_igual", "ramo_igual", "premio_na_faixa_reajuste"]
END = ["end_cep_igual", "end_cep_numero_igual", "end_cep_diferente"]


def ler_env(c):
    env = {}
    for linha in open(c, encoding="utf-8"):
        linha = linha.strip()
        if linha and not linha.startswith("#") and "=" in linha:
            k, v = linha.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def baixar(lote, env):
    base = env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/") + "/rest/v1/erp_vinculo_treino"
    chave = env["SUPABASE_SERVICE_ROLE_KEY"]
    out, de = [], 0
    while True:
        q = urllib.parse.urlencode({"select": "grupo,rotulo,f,f_end", "lote": "eq." + lote, "tarefa": "eq.renovacao_sucessora", "rotulo_fonte": "eq.pdf", "order": "id"})
        req = urllib.request.Request(base + "?" + q, headers={"apikey": chave, "Authorization": "Bearer " + chave, "Range-Unit": "items", "Range": f"{de}-{de + 999}"})
        with urllib.request.urlopen(req, timeout=60) as r:
            j = json.loads(r.read().decode("utf-8"))
        out.extend(j)
        if len(j) < 1000:
            break
        de += 1000
    return out


def top1(g, p, y):
    ok = tot = 0
    for gr in set(g):
        i = np.where(g == gr)[0]
        if len(i) < 2 or y[i].sum() != 1:
            continue
        tot += 1
        ok += int(y[i][np.argmax(p[i])] == 1)
    return ok, tot


def main():
    env = ler_env(r"C:\Users\O2-Grupo\Desktop\PROJETO CENTRAL DE NEGOCIOS\gerador-contratos\.env.local")
    d = [x for x in baixar(sys.argv[1], env) if x["f"].get("mesmo_locatario") == 1 and (x.get("f_end") or {}).get("end_sem_dado") == 0]
    y = np.array([x["rotulo"] for x in d]); g = np.array([x["grupo"] for x in d])
    XA = np.array([[x["f"].get(k, 0) for k in BASE] for x in d], float)
    XB = np.array([[x["f"].get(k, 0) for k in BASE] + [x["f_end"].get(k, 0) for k in END] for x in d], float)
    print(f"pares: {len(y)} | positivos {int(y.sum())} | negativos (mesmo segurado, apolice errada) {int((1 - y).sum())} | grupos {len(set(g))}")
    for nome, X in [("A_sem_endereco", XA), ("B_com_endereco", XB)]:
        oof = np.zeros(len(y))
        for tr, te in GroupKFold(n_splits=5).split(X, y, g):
            oof[te] = LogisticRegression(C=10, max_iter=5000).fit(X[tr], y[tr]).predict_proba(X[te])[:, 1]
        ll = -np.mean(y * np.log(np.clip(oof, 1e-12, 1)) + (1 - y) * np.log(np.clip(1 - oof, 1e-12, 1)))
        ok, tot = top1(g, oof, y)
        print(f"{nome}: AUC={roc_auc_score(y, oof):.4f} logloss={ll:.4f} | grupos com empate real (>=2 candidatas do mesmo segurado): {tot} | acerta a certa no 1o lugar: {ok} ({100 * ok / max(tot, 1):.1f}%)")
    m = LogisticRegression(C=10, max_iter=5000).fit(XB, y)
    print("coef endereco (modelo B):", {k: round(float(c), 3) for k, c in zip(BASE + END, m.coef_[0]) if k in END})
    # razao de verossimilhanca simples
    for k in END:
        j = END.index(k) + len(BASE)
        p_pos = XB[y == 1, j].mean(); p_neg = XB[y == 0, j].mean()
        print(f"  {k}: positivos {100 * p_pos:.0f}% x negativos {100 * p_neg:.0f}%")


if __name__ == "__main__":
    main()
