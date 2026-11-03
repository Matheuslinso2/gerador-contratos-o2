import os, sys, json, urllib.request, urllib.parse, pandas as pd
env = dict(l.strip().split('=',1) for l in open('.env.local', encoding='utf-8') if '=' in l and not l.startswith('#'))
url = env['NEXT_PUBLIC_SUPABASE_URL'].strip('"'); key = env['SUPABASE_SERVICE_ROLE_KEY'].strip('"')
h = {'apikey': key, 'Authorization': 'Bearer '+key}
cols = 'id,fonte,status_padrao,data_recebimento,data_efetivacao,seguradora,plano,imobiliaria_texto,aluguel,premio,comissao,extras'
rows = []; off = 0
while True:
    q = urllib.parse.urlencode({'select':cols,'produto':'eq.fianca','fonte':'in.(planilha,bitrix)','order':'id'})
    req = urllib.request.Request(f"{url}/rest/v1/producao_unificada?{q}", headers={**h,'Range':f'{off}-{off+999}'})
    d = json.load(urllib.request.urlopen(req)); rows += d
    if len(d) < 1000: break
    off += 1000
df = pd.DataFrame(rows); df.to_pickle('analise-precos/fianca.pkl'); print(len(df))
print(df.extras.dropna().head(3).tolist())
