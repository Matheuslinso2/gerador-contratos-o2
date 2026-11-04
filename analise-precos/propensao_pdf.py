"""Relatório PDF do modelo de venda cruzada por cliente (somente agregados: sem CPF nem nomes de clientes)."""
import json, urllib.request, numpy as np, pandas as pd
from sklearn.metrics import roc_auc_score
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import cm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Table, TableStyle, PageBreak
from propensao_modelo import montar, avaliar

AZ = '#1b3a6b'
env = dict(l.strip().split('=', 1) for l in open('.env.local', encoding='utf-8') if '=' in l and not l.startswith('#'))
url = env['NEXT_PUBLIC_SUPABASE_URL'].strip('"'); key = env['SUPABASE_SERVICE_ROLE_KEY'].strip('"')
H = {'apikey': key, 'Authorization': 'Bearer ' + key}
nomes = {}
off = 0
while True:
    d = json.load(urllib.request.urlopen(urllib.request.Request(f"{url}/rest/v1/imobiliarias?select=id,nome,apelido&order=id", headers={**H, 'Range': f'{off}-{off + 999}'})))
    for x in d: nomes[x['id']] = x['apelido'] or x['nome']
    if len(d) < 1000: break
    off += 1000

def n(v, d=1): return f'{v:,.{d}f}'.replace(',', 'X').replace('.', ',').replace('X', '.')

S = getSampleStyleSheet()
Ht = ParagraphStyle('h', parent=S['Heading2'], textColor=colors.HexColor(AZ))
B = ParagraphStyle('b', parent=S['BodyText'], fontSize=10, leading=14)
Sm = ParagraphStyle('s', parent=B, fontSize=8, leading=10)

def tbl(rows, head, fs=8):
    t = Table([head] + rows, repeatRows=1)
    t.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, 0), colors.HexColor(AZ)), ('TEXTCOLOR', (0, 0), (-1, 0), colors.white), ('FONTSIZE', (0, 0), (-1, -1), fs),
        ('GRID', (0, 0), (-1, -1), .25, colors.grey), ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#eef2f8')])]))
    return t

resultados, por_ano, por_imob = [], {}, {}
for base, alvo in [('FIA', 'INC'), ('INC', 'FIA'), ('INC', 'CAP'), ('FIA', 'CAP')]:
    r, d, te = avaliar(base, alvo)
    resultados.append(r)
    if r['ok']:
        linhas = []
        for a in sorted(d.ano.unique()):
            t = d[d.ano == a]
            if t.y.sum() >= 8 and t.y.nunique() > 1 and a >= 2021:
                linhas.append([str(int(a)), n(len(t), 0), n(int(t.y.sum()), 0), n(100 * t.y.mean()) + '%', n(roc_auc_score(t.y, t.imob_taxa_prev), 2)])
        por_ano[r['par']] = linhas
    if (base, alvo) == ('FIA', 'INC'):
        g = d.groupby('imob').y.agg(['mean', 'sum', 'count'])
        por_imob = g[g['count'] >= 40].sort_values('mean', ascending=False)

el = []
P = lambda t, s=B: el.append(Paragraph(t, s))
P('Venda cruzada por cliente: quem compra o segundo produto', S['Title'])
P('Pergunta: entre os clientes que compraram o produto-base, quem compra o produto-alvo nos 12 meses seguintes (descontando quem já veio com o alvo no mesmo pacote, até 30 dias)? '
  'Método de referência: monografia UFRGS 2013 (regressão logística e redes neurais). Aqui testei regressão logística, árvores de decisão (gradient boosting) e a média das duas, '
  'sempre <b>treinando com dados até 2023 e testando em 2024-2025</b>, e comparando com uma regra simples: a taxa histórica de venda cruzada da própria imobiliária do cliente. '
  'Dados: apólices do ERP (clientes pelo cadastro único), 2020 em diante. Sem IA paga; somente números agregados, sem CPF.')
P('Resumo', Ht)
fi = resultados[0]; inf = resultados[1]
for t in [
    f"<b>Fiança → Incêndio:</b> {n(fi['n'],0)} clientes candidatos, {n(fi['pos'],0)} compraram Incêndio em até 12 meses ({n(100*fi['taxa'])}%). No teste (2024-2025) a regra simples da imobiliária acerta com AUC {n(fi['auc_regra'],2)}; a logística {n(fi['auc_lr'],2)}, as árvores {n(fi['auc_gb'],2)} e a média {n(fi['auc_par'],2)}. <b>Nenhum modelo supera a regra simples</b>; a logística fica abaixo do acaso porque a relação mudou entre o período de treino e o de teste.",
    f"<b>Incêndio → Fiança:</b> {n(inf['n'],0)} candidatos, só {n(inf['pos'],0)} compraram Fiança ({n(100*inf['taxa'])}%). Regra simples AUC {n(inf['auc_regra'],2)}, árvores {n(inf['auc_gb'],2)}, média {n(inf['auc_par'],2)}. As árvores empatam com a regra simples, sem ganho real. O ganho de quem está no topo da lista é de cerca de {n(inf['lift10'],1)}x a média.",
    "<b>Incêndio → Capitalização e Fiança → Capitalização:</b> poucos casos (26 e 14 compras em 12 meses). Não dá para testar nem modelar com segurança.",
    "<b>Conclusão prática:</b> o que separa quem compra o segundo produto é principalmente <b>a imobiliária do cliente</b> (algumas têm 25% a 30% de venda cruzada, outras perto de zero). Características do cliente (prêmio, parcelas, aluguel, seguradora) não acrescentaram poder. Uma rede neural não se justifica com tão poucos casos. Recomendo usar a taxa histórica por imobiliária, como lista priorizada, e não um modelo complexo."]:
    P('• ' + t)
P('Cuidados', Ht)
P('1) <b>A regra por imobiliária também é instável no tempo</b> (tabela abaixo): em 2021-2023 ela tinha acerto abaixo do acaso e só em 2024-2025 passou a ordenar bem. Pode ter mudado o jeito de vender (pacotes) ou a qualidade do cadastro; trate o AUC de 0,75 como otimista. '
  '2) 2020 não entra: é o primeiro ano dos dados e não dá para saber o que o cliente já tinha antes. 3) O cliente é o cadastro único de pessoas do ERP; um mesmo cliente com mais de um cadastro vira dois. '
  '4) Compra no mesmo pacote (até 30 dias) não é venda cruzada e foi excluída.')
el.append(PageBreak())
P('Desempenho por par de produtos (teste em 2024-2025)', Ht)
rows = []
for r in resultados:
    rows.append([r['par'], n(r['n'], 0), n(r['pos'], 0), n(100 * r['taxa']) + '%', n(r['n_te'], 0),
                 n(r['auc_regra'], 2) if r['ok'] else '—', n(r['auc_lr'], 2) if r['ok'] else '—', n(r['auc_gb'], 2) if r['ok'] else '—', n(r['auc_par'], 2) if r['ok'] else 'poucos casos'])
el.append(tbl(rows, ['Par', 'Candidatos', 'Compraram', 'Taxa', 'No teste', 'Regra imob.', 'Logística', 'Árvores', 'Média']))
P('AUC: 0,5 = chute; 1 = perfeito. “Regra imob.” = taxa de venda cruzada da imobiliária calculada só com desfechos já conhecidos na data da compra (sem olhar o futuro).', Sm)
for par, linhas in por_ano.items():
    P(f'Estabilidade da regra por imobiliária, ano a ano: {par}', Ht)
    el.append(tbl(linhas, ['Ano da compra-base', 'Candidatos', 'Compraram', 'Taxa', 'AUC da regra']))
el.append(PageBreak())
P('Fiança → Incêndio: venda cruzada por imobiliária (40+ candidatos)', Ht)
rows = [[nomes.get(i, '?')[:34], n(int(x['count']), 0), n(int(x['sum']), 0), n(100 * x['mean']) + '%'] for i, x in por_imob.head(12).iterrows()]
rows += [['…', '', '', '']] + [[nomes.get(i, '?')[:34], n(int(x['count']), 0), n(int(x['sum']), 0), n(100 * x['mean']) + '%'] for i, x in por_imob.tail(8).iterrows()]
el.append(tbl(rows, ['Imobiliária', 'Clientes com Fiança', 'Compraram Incêndio em 12 meses', 'Taxa']))
P('Mostra as 12 imobiliárias com maior e as 8 com menor taxa. Esse é o número que mais separa os clientes: o mesmo cliente tem chances muito diferentes conforme a imobiliária pela qual contrata.', Sm)
SimpleDocTemplate('analise-precos/Etapa4_Venda_cruzada_por_cliente.pdf', pagesize=A4, leftMargin=1.8 * cm, rightMargin=1.8 * cm, topMargin=1.5 * cm, bottomMargin=1.5 * cm).build(el)
print('ok')
