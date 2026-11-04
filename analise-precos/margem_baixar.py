import json, urllib.request, urllib.parse, pandas as pd
env = dict(l.strip().split('=',1) for l in open('.env.local', encoding='utf-8') if '=' in l and not l.startswith('#'))
url = env['NEXT_PUBLIC_SUPABASE_URL'].strip('"'); key = env['SUPABASE_SERVICE_ROLE_KEY'].strip('"')
h = {'apikey': key, 'Authorization': 'Bearer '+key, 'Content-Type': 'application/json'}
r = urllib.request.Request(f"{url}/rest/v1/rpc/atualizar_analise_margem", data=b'{}', headers=h, method='POST')
print('linhas na tabela:', urllib.request.urlopen(r).read().decode())
rows=[]; off=0
while True:
    req = urllib.request.Request(f"{url}/rest/v1/analise_margem?select=*&order=ano", headers={**h,'Range':f'{off}-{off+999}'})
    d = json.load(urllib.request.urlopen(req)); rows += d
    if len(d) < 1000: break
    off += 1000
pd.DataFrame(rows).to_pickle('analise-precos/margem.pkl'); print(len(rows))
