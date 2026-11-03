import pandas as pd, numpy as np, matplotlib, os
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import cm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Table, TableStyle, Image, PageBreak

R = pd.read_pickle('analise-precos/etapa1.pkl')
os.makedirs('analise-precos/img', exist_ok=True)
AZ = '#1b3a6b'

f = R['t_faixa']
fig, ax = plt.subplots(figsize=(7, 3.2)); x = range(len(f))
ax.bar(x, f['conversao_%'], color=AZ, label='Fechou')
ax.plot(x, f['recusa_%'], 'o-', color='#c0392b', label='Recusada pela seguradora')
ax.errorbar(x, f['conversao_%'], yerr=[f['conversao_%'] - f.ic95_min, f.ic95_max - f['conversao_%']], fmt='none', ecolor='k', capsize=3)
ax.set_xticks(list(x)); ax.set_xticklabels(f.index, fontsize=8); ax.set_ylabel('% das cotações'); ax.legend(fontsize=8); ax.set_xlabel('Aluguel (R$)')
for i, v in enumerate(f['conversao_%']): ax.text(i, v / 2, f'{v:.0f}%', ha='center', color='w', fontsize=8)
plt.tight_layout(); plt.savefig('analise-precos/img/faixa.png', dpi=150); plt.close()

m = R['t_mes']
fig, ax = plt.subplots(figsize=(7, 2.8)); ax.plot(range(len(m)), m['conversao_%'], color=AZ)
ax.fill_between(range(len(m)), m.ic95_min, m.ic95_max, alpha=.2, color=AZ)
ax.set_xticks(range(0, len(m), 6)); ax.set_xticklabels(m.index[::6], rotation=45, fontsize=7); ax.set_ylabel('% que fechou')
plt.tight_layout(); plt.savefig('analise-precos/img/mes.png', dpi=150); plt.close()

g = R['grade']
fig, ax = plt.subplots(figsize=(7, 3))
ax.plot(g.aluguel, g['chance_fechar_%'], 'o-', color=AZ, label='Entre todas as cotações')
ax.plot(g.aluguel, g['chance_fechar_se_aprovada_%'], 's-', color='#27ae60', label='Se a seguradora aprovou')
ax.set_xlabel('Aluguel (R$)'); ax.set_ylabel('chance de fechar (%)'); ax.legend(fontsize=8)
plt.tight_layout(); plt.savefig('analise-precos/img/modelo.png', dpi=150); plt.close()

S = getSampleStyleSheet()
H = ParagraphStyle('h', parent=S['Heading2'], textColor=colors.HexColor(AZ))
B = ParagraphStyle('b', parent=S['BodyText'], fontSize=10, leading=14)
Sm = ParagraphStyle('s', parent=B, fontSize=8, leading=10)

def tbl(df, fs=8):
    t = Table([list(df.columns)] + df.values.tolist(), repeatRows=1)
    t.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, 0), colors.HexColor(AZ)), ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTSIZE', (0, 0), (-1, -1), fs), ('GRID', (0, 0), (-1, -1), .25, colors.grey),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#eef2f8')])]))
    return t

def n(v, d=0):
    return f'{v:,.{d}f}'.replace(',', 'X').replace('.', ',').replace('X', '.')

def br(df):
    return df.map(lambda v: n(v, 1) if isinstance(v, float) else str(v))

el = []
def P(t, s=B): el.append(Paragraph(t, s))

cob = R['cobertura']
P('Fiança: fechamento e preço (Etapa 1)', S['Title'])
P(f"Base: {n(R['n_total'])} cotações de Fiança (planilhas 2020-2026 + Bitrix 2026). Foram analisadas {n(R['n_dec'])} cotações já decididas (fechada, perdida ou recusada) com aluguel válido (R$ 300 a R$ 40.000). Taxa geral de fechamento: <b>{n(R['tx_global'] * 100, 1)}%</b>.")
P('O que descobri (resumo)', H)
for t in [
    'Quanto maior o aluguel, menos fecha: de 29,6% (aluguel abaixo de R$ 1.000) para 13,0% (acima de R$ 8.000). A diferença é grande e não é acaso (as margens de erro não se tocam).',
    'A recusa pela seguradora tem formato de "U": recusa mais nos aluguéis muito baixos (43%) e muito altos (45%); no meio fica perto de 30%. Já a perda (cliente aprovado que não fecha) sobe sempre com o aluguel.',
    'Entre as aprovadas, a chance de fechar cai de 52% (aluguel baixo) para 23% (aluguel alto). É aí que o preço da parcela mais pesa.',
    'A conversão caiu em 2023-2025 (cerca de 22%) e voltou a 28% em 2026. Descontando aluguel e imobiliária, 2023-2025 tiveram cerca de 30% menos chance de fechar que 2020.',
    'A imobiliária importa muito: Monte Alegre, Teruszkin e R&S fecham 40-47%; Rafael Penna (6%), AG Rio (3%), O2 direto (9,5%) e Renascença Campo Grande (9%) fecham quase nada (na maioria, por recusa ou perda). Tabela na seção 3.',
    'Preço: o prêmio anual mediano é de 3,3 a 3,8 aluguéis nas seguradoras principais (Tokio 3,84; Porto Tradicional 3,42; Pottencial Tradicional 3,26) e 1,5 aluguel na Pottencial Taxa Fixa. A parcela mensal (prêmio/12) pesa cerca de 27% a 32% do aluguel, e 12% na Taxa Fixa.',
    'Sobre o pacote de locação (aluguel + condomínio + IPTU), a parcela pesa menos: 19% a 28%.']:
    P('• ' + t)
P('Duas limitações importantes (leia antes de usar os números)', H)
P('1) <b>A seguradora só está preenchida nas cotações fechadas</b> (97% das fechadas, ~1% das perdidas e 0% das recusadas). Por isso não dá para calcular "a conversão de cada seguradora" nem medir diretamente o quanto o preço de cada uma derruba o fechamento. O que dá para medir é o efeito do <b>aluguel</b> (que define o prêmio) e da imobiliária. Para medir preço de verdade, as cotações perdidas precisam guardar a seguradora e o prêmio oferecidos (hoje os cards perdidos do Bitrix não trazem prêmio).')
P(f"2) <b>O prêmio só existe nas planilhas a partir de 2024</b> e nem em todas: de {n(cob['conv_2024mais'])} fechadas em 2024-2026, {n(cob['com_premio'])} têm prêmio. As com prêmio têm aluguel médio um pouco maior (R$ {n(cob['aluguel_medio_com'])} contra R$ {n(cob['aluguel_medio_sem'])}). Para não inclinar o resultado, os preços foram <b>reponderados por faixa de aluguel</b>, de modo que representam todas as fechadas. Também retirei prêmios fora de 0,3 a 12 aluguéis.")
P(f"Datas: {R['datas_ruins']} cotações tinham data impossível (anos 0205, 3036 etc.); ficaram fora das tabelas por mês/ano, mas continuam nas demais.", Sm)
el.append(PageBreak())

P('1. Fechamento por faixa de aluguel', H); el.append(Image('analise-precos/img/faixa.png', 16 * cm, 7.3 * cm))
ft = R['t_faixa'].reset_index(); ft.columns = ['Aluguel', 'Cotações', 'Fechadas', 'Recusadas', 'Perdidas', 'Fechou %', 'Recusa %', 'Fecha se aprovada %', 'IC mín', 'IC máx']
P('"Fecha se aprovada" = fechadas ÷ (fechadas + perdidas), isto é, sem as recusadas pela seguradora. IC = intervalo de confiança de 95%.', Sm)
ft['Aluguel'] = ft['Aluguel'].astype(str); el.append(tbl(br(ft)))
P('2. Fechamento por mês', H); el.append(Image('analise-precos/img/mes.png', 16 * cm, 6.4 * cm))
P('Faixa sombreada = intervalo de confiança de 95%. Só meses com 100+ cotações decididas. Tabela mensal completa em fechamento_mes.csv.', Sm)
a = R['t_ano'].reset_index()[['ano', 'cotacoes', 'fechadas', 'conversao_%', 'recusa_%', 'fecha_se_aprovada_%']]
a['ano'] = a.ano.astype(int).astype(str); a.columns = ['Ano', 'Cotações', 'Fechadas', 'Fechou %', 'Recusa %', 'Fecha se aprovada %']
el.append(tbl(br(a)))
el.append(PageBreak())

P('3. Fechamento por imobiliária (150+ cotações decididas)', H)
im = R['t_imob'].reset_index()[['imob', 'cotacoes', 'fechadas', 'conversao_%', 'ic95_min', 'ic95_max', 'recusa_%', 'fecha_se_aprovada_%', 'conversao_ajustada_%']]
im['imob'] = im.imob.str.replace('�', '?').str[:24]
im.columns = ['Imobiliária (nome nas planilhas)', 'Cot.', 'Fech.', 'Fechou %', 'IC mín', 'IC máx', 'Recusa %', 'Fecha se aprov. %', 'Fechou % ajust.']
el.append(tbl(br(im), fs=7))
P('"Ajustado" puxa levemente imobiliárias com poucas cotações para a média, evitando exagero. Os nomes vêm do texto das planilhas; o vínculo com a ficha única (imobiliaria_id) entra na Etapa 3. Lista completa em fechamento_imobiliaria.csv.', Sm)
el.append(PageBreak())

P('4. Modelo da chance de fechar (regressão logística)', H)
P(f"Variáveis: aluguel (escala logarítmica), residencial/comercial, ano e as 20 imobiliárias com mais cotações. Testado <b>para frente no tempo</b>: treinei com dados até 2025 e testei em 2026. Poder de acerto (AUC) = <b>{n(R['aucA'], 2)}</b> (0,5 = chute; 1 = perfeito). É modesto: aluguel e imobiliária explicam parte do fechamento, mas o resto depende de fatores que não estão na base (perfil do cliente, concorrência, atendimento). Serve para entender tendências, não para prever uma cotação individual.")
el.append(Image('analise-precos/img/modelo.png', 15 * cm, 6.4 * cm))
gg = R['grade'].copy(); gg.columns = ['Aluguel (R$)', 'Chance de fechar % (todas)', 'Chance de fechar % (se aprovada)']
gg['Aluguel (R$)'] = gg['Aluguel (R$)'].astype(int).astype(str); el.append(tbl(br(gg)))
P('Cliente de referência: locação residencial em 2026, imobiliária fora das 20 maiores. A cada vez que o aluguel dobra, a chance de fechar cai cerca de 20% em termos relativos (razão de chances de cerca de 0,72 por dobro, ajustada). Só entre as aprovadas o efeito é mais forte (cerca de 0,60 por dobro): o preço da parcela pesa na decisão do cliente.')
el.append(PageBreak())

P('5. Preço praticado por seguradora', H)
s = R['t_seg'][['seguradora', 'apolices', 'premio_mediano', 'premio_em_alugueis_mediano', 'p25', 'p75', 'parcela_mensal_sobre_aluguel_pct', 'n_com_pacote', 'parcela_sobre_pacote_pct']].copy()
s.columns = ['Seguradora/plano', 'Apólices', 'Prêmio anual mediano R$', 'Prêmio em aluguéis (mediana)', '25%', '75%', 'Parcela/aluguel %', 'Com pacote', 'Parcela/pacote %']
s['Apólices'] = s['Apólices'].astype(int).astype(str); s['Com pacote'] = s['Com pacote'].astype(int).astype(str)
el.append(tbl(br(s), fs=7))
P('"Prêmio em aluguéis" = prêmio anual ÷ aluguel (fechadas de 2024-2026, reponderado). "Parcela" = prêmio ÷ 12. "Pacote" = aluguel + condomínio + IPTU; existe em ~60% das fechadas de 2024+ e, quando existe, é cerca de 1,43 vez o aluguel.', Sm)
sh = R['share'].reset_index(); sh['ano'] = sh.ano.astype(int).astype(str)
P('Participação de cada seguradora nas apólices fechadas (%), por ano:')
el.append(tbl(br(sh), fs=7))
P('A Pottencial Tradicional caiu de ~54% (2020) para 26% (2026); a Pottencial Taxa Fixa já é 21% em 2026; Tokio subiu para 15%. "Porto Essencial" reúne Porto Essencial e Essencial 20/30.')

SimpleDocTemplate('analise-precos/Etapa1_Fianca_fechamento_e_preco.pdf', pagesize=A4, leftMargin=1.8 * cm, rightMargin=1.8 * cm, topMargin=1.5 * cm, bottomMargin=1.5 * cm).build(el)
for k, nm in [('t_mes', 'fechamento_mes'), ('t_imob', 'fechamento_imobiliaria'), ('t_faixa', 'fechamento_faixa'), ('t_seg', 'preco_seguradora')]:
    R[k].to_csv(f'analise-precos/{nm}.csv', encoding='utf-8-sig')
print('ok')
