"""Baixa do ERP os dados para o modelo de venda cruzada por cliente (somente leitura, roda local)."""
import json, urllib.request, urllib.parse, pandas as pd

env = dict(l.strip().split('=', 1) for l in open('.env.local', encoding='utf-8') if '=' in l and not l.startswith('#'))
url = env['NEXT_PUBLIC_SUPABASE_URL'].strip('"'); key = env['SUPABASE_SERVICE_ROLE_KEY'].strip('"')
H = {'apikey': key, 'Authorization': 'Bearer ' + key}


def pegar(tabela, select, filtros=None, ordem='id'):
    saida, off = [], 0
    while True:
        q = {'select': select, 'order': ordem}
        q.update(filtros or {})
        req = urllib.request.Request(f"{url}/rest/v1/{tabela}?{urllib.parse.urlencode(q)}", headers={**H, 'Range': f'{off}-{off + 999}'})
        d = json.load(urllib.request.urlopen(req, timeout=120))
        saida += d
        if len(d) < 1000:
            return saida
        off += 1000


ramos = {r['id']: r['nome'] for r in pegar('erp_ramos', 'id,nome')}
segs = {r['id']: r['nome'] for r in pegar('erp_seguradoras', 'id,nome')}
docs = pegar('erp_documentos', 'id,locatario_id,imobiliaria_principal_id,ramo_id,seguradora_id,vigencia_inicio,premio_liquido,forma_pagamento,qtd_parcelas,situacao',
             {'tipo': 'eq.A', 'situacao': 'in.(vigente,vencido,cancelado)', 'vigencia_inicio': 'gte.2020-01-01'})
itens = pegar('erp_documento_itens', 'documento_id,valor_aluguel,uf', ordem='documento_id')
df = pd.DataFrame(docs)
df['ramo'] = df.ramo_id.map(ramos)
df['seguradora'] = df.seguradora_id.map(segs)
it = pd.DataFrame(itens)
it['valor_aluguel'] = pd.to_numeric(it.valor_aluguel, errors='coerce')
it = it.groupby('documento_id').agg(aluguel=('valor_aluguel', 'median'), uf=('uf', 'first')).reset_index().rename(columns={'documento_id': 'id'})
df = df.merge(it, on='id', how='left')
df.to_pickle('analise-precos/propensao_docs.pkl')
print(len(df), df.locatario_id.notna().sum())
