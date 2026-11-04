import urllib.request, urllib.error
env = dict(l.strip().split('=',1) for l in open('.env.local', encoding='utf-8') if '=' in l and not l.startswith('#'))
url = env['NEXT_PUBLIC_SUPABASE_URL'].strip('"'); key = env['SUPABASE_SERVICE_ROLE_KEY'].strip('"')
h = {'apikey': key, 'Authorization': 'Bearer '+key, 'Content-Type': 'application/json'}
try:
    print('imobiliarias na tabela:', urllib.request.urlopen(urllib.request.Request(f"{url}/rest/v1/rpc/atualizar_analise_visita", data=b'{}', headers=h, method='POST'), timeout=110).read().decode())
except urllib.error.HTTPError as e: print(e.code, e.read().decode()[:600])
