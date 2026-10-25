-- ERP O2 — regra de corte das faturas por seguradora (25/10/2026)
-- Inferida dos dados pelo método do Matheus (seguro que entrou × seguro que ficou de fora) e
-- assumida como hipótese de trabalho até dezembro/2026, monitorando faturas e cobranças.
--   POTTENCIAL: fatura emitida no último dia do mês, agrupa as parcelas que vencem no mês,
--               cobrada no dia 15 do mês seguinte → corte = último dia do mês.
--   TOKIO:      todas as parcelas vencem na data da fatura (dia fixo varia por imobiliária:
--               9, 15, 20, 21, 23, 28); seguro novo entra na primeira data fixa que esteja
--               ≥ 8 dias após o início de vigência → corte = vencimento − 8 dias.
--   TOO / PORTO / YELUM: ainda sem regra confirmada (relatório sem datas / demonstrativo no zip / PDF).
alter table erp_seguradoras
  add column if not exists fatura_corte_regra text check (fatura_corte_regra in ('ultimo_dia_mes','vencimento_menos_dias','desconhecida')) default 'desconhecida',
  add column if not exists fatura_corte_dias int,            -- usado quando a regra é vencimento_menos_dias
  add column if not exists fatura_observacao text;

update erp_seguradoras set fatura_corte_regra = 'ultimo_dia_mes', fatura_corte_dias = null,
  fatura_observacao = 'Inferido 25/10/2026 em 634 itens (set–out/26): fatura de 30/09 agrupa parcelas vencendo 01–30/09, cobrada em 15/10. Hipótese até dez/26.'
where abreviacao = 'POTT';
update erp_seguradoras set fatura_corte_regra = 'vencimento_menos_dias', fatura_corte_dias = 8,
  fatura_observacao = 'Inferido 25/10/2026 em 165 seguros novos (fatura 15/10): parcela 1 entra na 1ª data fixa ≥ 8 dias após o início (mediana 24 d). Dia fixo varia por imob (faturas_esperadas.dia_vencimento). Hipótese até dez/26.'
where abreviacao = 'TOKI';
update erp_seguradoras set fatura_observacao = 'Relatório que a equipe sobe não tem datas; corte sai do portal/extrato. A confirmar até dez/26.' where abreviacao = 'TOO';
update erp_seguradoras set fatura_observacao = 'Demonstrativo só no zip do e-mail (senha = 5 primeiros dígitos do CNPJ da O2); 1 fatura lida. A confirmar até dez/26.' where abreviacao = 'PORT';
update erp_seguradoras set fatura_observacao = 'Relatório PDF ainda não analisado. A confirmar até dez/26.' where abreviacao = 'YELU';

-- Conferência mensal do corte: para cada fatura lida no /faturas (Tokio e Pottencial, que têm o nº da
-- apólice nos itens), quais seguros novos (parcela 1) entraram, com o início de vigência de cada um.
-- Serve para repetir o teste "entrou × ficou de fora" todo mês até dezembro.
create or replace view erp_fatura_corte_observado with (security_invoker = true) as
with rel as (
  select f.id fatura_id, f.seguradora, f.competencia, f.vencimento, f.imobiliaria_id, f.texto_bruto_extraido texto
  from faturas f where f.arquivo_nome ilike '%relat%' and f.texto_bruto_extraido is not null and f.seguradora in ('TOKIO','POTTENCIAL')
), tok as (
  select r.fatura_id, m[2] as apolice, m[6]::int as parcela from rel r, regexp_matches(r.texto, '(\d{3});(\d{6,8});(\d+);[^;]*;(\d{2}/\d{2}/\d{4});(\d*);(\d+);(\d+);', 'g') m where r.seguradora = 'TOKIO'
), pot as (
  select r.fatura_id, m[1] as apolice, m[3]::int as parcela from rel r, regexp_matches(r.texto, ',(\d{25}),[^,]*,(\d{2}/\d{2}/\d{4}),(\d+)/(\d+),', 'g') m where r.seguradora = 'POTTENCIAL'
), itens as (select * from tok union all select * from pot)
select r.seguradora, r.competencia, r.vencimento, r.imobiliaria_id, r.fatura_id, i.apolice, i.parcela,
       d.id as documento_id, d.nosso_numero as codigo_o2, d.vigencia_inicio, coalesce(d.dt_emissao, d.dt_proposta) as efetivacao,
       r.vencimento - d.vigencia_inicio as dias_entre_inicio_e_vencimento
from itens i join rel r on r.fatura_id = i.fatura_id
left join erp_documentos d on d.origem = 'corp_import' and (d.numero_apolice = i.apolice or d.numero_apolice = ltrim(right(i.apolice, 9), '0'))
where i.parcela = 1;
grant select on erp_fatura_corte_observado to authenticated;
