import json, urllib.request, pandas as pd, matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import cm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Table, TableStyle, Image, PageBreak

AZ = '#1b3a6b'
env = dict(l.strip().split('=', 1) for l in open('.env.local', encoding='utf-8') if '=' in l and not l.startswith('#'))
url = env['NEXT_PUBLIC_SUPABASE_URL'].strip('"'); key = env['SUPABASE_SERVICE_ROLE_KEY'].strip('"')
h = {'apikey': key, 'Authorization': 'Bearer ' + key}
nomes = {}
off = 0
while True:
    req = urllib.request.Request(f"{url}/rest/v1/imobiliarias?select=id,nome,apelido&order=id", headers={**h, 'Range': f'{off}-{off + 999}'})
    d = json.load(urllib.request.urlopen(req))
    for x in d: nomes[x['id']] = x['apelido'] or x['nome']
    if len(d) < 1000: break
    off += 1000

m = pd.read_pickle('analise-precos/margem.pkl')
for c in ['premio_liquido', 'comissao', 'repasse', 'pro_labore', 'pro_labore_inferido']: m[c] = m[c].astype(float)
m['margem'] = m.comissao - m.repasse

def res(g):
    s = g[['apolices', 'premio_liquido', 'comissao', 'repasse', 'margem']].sum()
    return pd.Series({
        'apolices': s.apolices, 'premio': s.premio_liquido, 'comissao': s.comissao, 'repasse': s.repasse, 'margem': s.margem,
        'com_pct_premio': 100 * s.comissao / s.premio_liquido if s.premio_liquido else float('nan'),
        'repasse_pct_com': 100 * s.repasse / s.comissao if s.comissao else float('nan'),
        'margem_pct_com': 100 * s.margem / s.comissao if s.comissao else float('nan'),
        'margem_apolice': s.margem / s.apolices if s.apolices else float('nan')})

def n(v, d=0):
    if pd.isna(v): return '—'
    return f'{v:,.{d}f}'.replace(',', 'X').replace('.', ',').replace('X', '.')

r = m[m.ano.isin([2025, 2026])]
por_ano = m.groupby('ano').apply(res, include_groups=False)
por_prod = r.groupby('produto').apply(res, include_groups=False).sort_values('margem', ascending=False)
princ = ['Fiança', 'Incêndio imobiliário', 'Capitalização']
por_seg = r[r.produto.isin(princ)].groupby(['produto', 'seguradora']).apply(res, include_groups=False)
por_seg = por_seg[por_seg.apolices >= 30].reset_index()
por_imob = r.dropna(subset=['imobiliaria_id']).groupby('imobiliaria_id').apply(res, include_groups=False)
por_imob['nome'] = [nomes.get(i, '?') for i in por_imob.index]
por_imob.to_csv('analise-precos/margem_imobiliaria_2025_2026.csv', encoding='utf-8-sig')
por_prod.to_csv('analise-precos/margem_produto_2025_2026.csv', encoding='utf-8-sig')
por_seg.to_csv('analise-precos/margem_seguradora_2025_2026.csv', index=False, encoding='utf-8-sig')

p = por_prod[por_prod.margem > 20000]
fig, ax = plt.subplots(figsize=(7, 3))
ax.barh(p.index[::-1], p.margem[::-1] / 1000, color=AZ)
ax.set_xlabel('Margem em 2025-2026 (R$ mil)')
for i, v in enumerate(p.margem[::-1] / 1000): ax.text(v, i, f' {v:,.0f}'.replace(',', '.'), va='center', fontsize=8)
plt.tight_layout(); plt.savefig('analise-precos/img/margem_prod.png', dpi=150); plt.close()

S = getSampleStyleSheet()
H = ParagraphStyle('h', parent=S['Heading2'], textColor=colors.HexColor(AZ))
B = ParagraphStyle('b', parent=S['BodyText'], fontSize=10, leading=14)
Sm = ParagraphStyle('s', parent=B, fontSize=8, leading=10)

def tbl(rows, head, fs=8):
    t = Table([head] + rows, repeatRows=1)
    t.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, 0), colors.HexColor(AZ)), ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTSIZE', (0, 0), (-1, -1), fs), ('GRID', (0, 0), (-1, -1), .25, colors.grey),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#eef2f8')])]))
    return t

def linhas(df, nome_col):
    return [[nome_col(i, x), n(x.apolices), n(x.premio), n(x.comissao), n(x.repasse), n(x.margem), n(x.com_pct_premio, 1), n(x.repasse_pct_com, 1), n(x.margem_apolice)] for i, x in df.iterrows()]

cab = ['', 'Apólices', 'Prêmio líq. R$', 'Comissão R$', 'Repasse R$', 'Margem R$', 'Comissão % prêmio', 'Repasse % comissão', 'Margem por apólice R$']
el = []
def P(t, s=B): el.append(Paragraph(t, s))

tot = res(r)
P('Margem por apólice vendida (Etapa 2)', S['Title'])
P(f"<b>Margem = comissão da apólice − repasse previsto à imobiliária, já incluindo o pró-labore</b> (que é repasse negociado com a imobiliária; só muda o caminho do dinheiro). Base: apólices (não endossos) vigentes ou vencidas do ERP, pelo início de vigência, 2025 e 2026 até outubro. São {n(tot.apolices)} apólices, comissão de R$ {n(tot.comissao)}, repasse de R$ {n(tot.repasse)} e margem de <b>R$ {n(tot.margem)}</b> ({n(tot.margem_pct_com, 1)}% da comissão).")
P('O que descobri', H)
f = por_prod.loc['Fiança']; i = por_prod.loc['Incêndio imobiliário']; c = por_prod.loc['Capitalização']
for t in [
    f"<b>Fiança dá a maior margem por apólice:</b> R$ {n(f.margem_apolice)} em média ({n(f.apolices)} apólices, margem total R$ {n(f.margem)}). A comissão é {n(f.com_pct_premio, 1)}% do prêmio e o repasse leva {n(f.repasse_pct_com, 1)}% dela.",
    f"<b>Incêndio imobiliário dá o maior volume, mas por apólice é pequeno:</b> R$ {n(i.margem_apolice)} cada, em {n(i.apolices)} apólices, margem total R$ {n(i.margem)}. É a maior fonte de margem total junto com a Fiança.",
    f"<b>Capitalização:</b> R$ {n(c.margem_apolice)} por título; a comissão é só {n(c.com_pct_premio, 1)}% do valor, mas o valor é alto. Repasse de {n(c.repasse_pct_com, 1)}% da comissão.",
    "<b>Entre seguradoras de Fiança</b> (tabela na seção 3): a Tokio rende a maior margem por apólice (R$ 2.326, prêmios maiores); Too R$ 1.426, Porto R$ 1.280 e Pottencial R$ 1.138. O repasse (com pró-labore) varia de 9,5% (Pottencial) a 14,3% (Porto) da comissão.",
    f"<b>O repasse caiu ao longo dos anos:</b> {n(por_ano.loc[2020].repasse_pct_com, 0)}% da comissão em 2020 contra {n(por_ano.loc[2025].repasse_pct_com, 0)}% em 2025. Pode ser mudança de acordos, mas também falta de registro do repasse previsto nos anos antigos; vale conferir antes de usar a série histórica.",
]: P('• ' + t)
P('Limites (leia antes de usar)', H)
P(f'1) É margem de <b>comissão</b>, não lucro: não desconta custos da operação nem impostos. 2) O repasse é o <b>previsto</b> nas regras do ERP, não o efetivamente pago. O pró-labore entra como % do prêmio líquido, lido do extrato Segimob ou da regra confirmada da imobiliária com a seguradora (R$ {n(r.pro_labore.sum())} em 2025-2026); Em {n(r.apolices_pl_inferido.sum())} apólices o % não estava lido e usei a taxa fixa negociada daquela imobiliária com a seguradora no produto (vista nos extratos: 78 de 106 combinações têm uma taxa só); são R$ {n(r.pro_labore_inferido.sum())}, marcados como inferidos. {n(r.sem_pct_pro_labore.sum())} apólices têm pró-labore indicado e nenhuma taxa conhecida: ficaram com zero, o que pode superestimar a margem delas. 3) Apólices canceladas ficam de fora (cerca de 1/3 dos documentos desde 2020). 4) Uma apólice com mais de um produtor soma todos os repasses. 5) Vínculo com a imobiliária pelo cadastro único (imobiliaria_principal); 595 das 21.070 apólices de 2025-2026 não têm imobiliária (clientes diretos).')
el.append(PageBreak())
P('1. Por produto (2025-2026)', H)
el.append(Image('analise-precos/img/margem_prod.png', 15 * cm, 6.4 * cm))
el.append(tbl(linhas(por_prod, lambda i, x: i), ['Produto'] + cab[1:], fs=7))
P('2. Por ano (todos os produtos)', H)
el.append(tbl(linhas(por_ano, lambda i, x: str(int(i))), ['Ano'] + cab[1:], fs=7))
P('2026 vai só até outubro.', Sm)
el.append(PageBreak())
P('3. Por seguradora, nos três produtos principais (2025-2026, 30+ apólices)', H)
rows = [[f"{x.produto} · {x.seguradora}", n(x.apolices), n(x.premio), n(x.comissao), n(x.repasse), n(x.margem), n(x.com_pct_premio, 1), n(x.repasse_pct_com, 1), n(x.margem_apolice)] for _, x in por_seg.iterrows()]
el.append(tbl(rows, ['Produto · seguradora'] + cab[1:], fs=7))
el.append(PageBreak())
P('4. Por imobiliária (2025-2026): as 25 com maior margem', H)
top = por_imob.sort_values('margem', ascending=False).head(25)
el.append(tbl(linhas(top, lambda i, x: x.nome[:26]), ['Imobiliária'] + cab[1:], fs=7))
P('Lista completa (354 imobiliárias) em margem_imobiliaria_2025_2026.csv. Esses números alimentam a ficha de visita (Etapa 3), na tabela analise_margem.', Sm)

SimpleDocTemplate('analise-precos/Etapa2_Margem_por_apolice.pdf', pagesize=A4, leftMargin=1.6 * cm, rightMargin=1.6 * cm, topMargin=1.5 * cm, bottomMargin=1.5 * cm).build(el)
print('ok', len(por_imob))
