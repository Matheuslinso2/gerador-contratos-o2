-- ERP O2 — alertas de fatura (25/10/2026)
-- Matheus: proposta efetivada em modo fatura é OBRIGATÓRIO que entre na fatura; a seguradora precisa
-- dar destino à proposta (aceitar/recusar, emitir ou não, entrar na fatura ou não) em até ~10 dias
-- (regra SUSEP recente) e nós controlamos esse fluxo. Dois alertas:
--   A) "fora da fatura": seguro novo de imobiliária com fatura naquela seguradora, cuja fatura
--      prevista pela regra de corte já foi carregada no /faturas e NÃO contém a apólice;
--   B) "sem destino da seguradora": efetivada há mais de 10 dias, ainda sem nº de apólice
--      (não emitiu nem recusou) e sem aparecer em fatura.
-- Por enquanto cobre Tokio e Pottencial (relatórios com nº da apólice). Hipótese de corte até dez/26.

create or replace function erp_fatura_prevista(p_seguradora text, p_inicio date, p_dia_fixo int)
returns date language sql immutable as $$
  select case
    -- Pottencial: 1ª parcela = início + 30; fatura agrupa o mês dessa parcela; cobra dia 15 do mês seguinte
    when p_seguradora = 'POTTENCIAL' then (date_trunc('month', p_inicio + 30) + interval '1 month' + interval '14 days')::date
    -- Tokio: primeira data fixa da imobiliária que esteja ≥ 8 dias após o início
    when p_seguradora = 'TOKIO' then (
      with base as (select coalesce(p_dia_fixo, 15) as dia, p_inicio + 8 as minimo)
      select case when extract(day from minimo) <= dia
                  then (date_trunc('month', minimo) + ((dia - 1) || ' days')::interval)::date
                  else (date_trunc('month', minimo) + interval '1 month' + ((dia - 1) || ' days')::interval)::date
             end from base)
    else null end
$$;

create or replace view erp_alertas_fatura with (security_invoker = true) as
with segmap as (
  select * from (values ('TOKI','TOKIO'), ('POTT','POTTENCIAL')) as v(abrev, nome_fatura)
), esperadas as (
  -- uma linha por imobiliária × seguradora (o cadastro pode ter mais de uma, por código de produtor)
  select distinct on (imobiliaria_id, seguradora) imobiliaria_id, seguradora, dia_vencimento
  from faturas_esperadas where ativo order by imobiliaria_id, seguradora, (dia_vencimento is null), aprendido_em desc
), novos as (
  select d.id as documento_id, d.nosso_numero as codigo_o2, d.nosso_numero_corp, d.numero_apolice, d.situacao, d.vigencia_inicio,
         coalesce(d.dt_emissao, d.dt_proposta, d.digitado_em::date) as efetivacao, d.imobiliaria_principal_id, i.nome as imobiliaria,
         sm.nome_fatura as seguradora, fe.dia_vencimento,
         erp_fatura_prevista(sm.nome_fatura, d.vigencia_inicio, fe.dia_vencimento) as fatura_prevista
  from erp_documentos d
  join erp_seguradoras s on s.id = d.seguradora_id
  join segmap sm on sm.abrev = s.abreviacao
  join esperadas fe on fe.imobiliaria_id = d.imobiliaria_principal_id and fe.seguradora = sm.nome_fatura
  join imobiliarias i on i.id = d.imobiliaria_principal_id
  left join erp_canais c on c.id = d.canal_id
  where d.tipo = 'A' and d.tipo_corp in ('NOVO','RENV') and d.situacao in ('digitado','emitido','vigente')
    and d.vigencia_inicio >= '2026-08-01'
    -- seguro que vem pelo Segimob é faturado pelo Segimob, não pela fatura da O2
    and coalesce(c.nome, '') <> 'Segimob'
), faturas_carregadas as (
  select f.imobiliaria_id, f.seguradora, f.vencimento, length(f.texto_bruto_extraido) >= 19900 as relatorio_incompleto, f.texto_bruto_extraido as texto from faturas f
  where f.arquivo_nome ilike '%relat%' and f.texto_bruto_extraido is not null and f.status <> 'cancelada'
)
select n.documento_id, n.codigo_o2, n.nosso_numero_corp, n.numero_apolice, n.situacao, n.vigencia_inicio, n.efetivacao, n.imobiliaria_principal_id, n.imobiliaria, n.seguradora, n.dia_vencimento, n.fatura_prevista,
  case
    when n.numero_apolice is not null and exists (
      -- a apólice aparece em qualquer fatura carregada da imobiliária nessa seguradora (qualquer parcela)
      select 1 from faturas_carregadas f where f.imobiliaria_id = n.imobiliaria_principal_id and f.seguradora = n.seguradora
        and (f.texto like '%;' || ltrim(n.numero_apolice, '0') || ';%' or f.texto like '%,' || n.numero_apolice || ',%' or f.texto like '%' || n.numero_apolice || '%')) then 'ok'
    when n.numero_apolice is null and n.efetivacao < current_date - 10 then 'sem_destino_seguradora'
    when n.numero_apolice is null then 'aguardando_fatura'
    when fc.vencimento is not null and fc.relatorio_incompleto then 'relatorio_incompleto'  -- texto cortado em ~20 mil caracteres pelo /faturas
    when fc.vencimento is not null then 'fora_da_fatura'
    when n.fatura_prevista < current_date then 'fatura_prevista_nao_carregada'
    else 'aguardando_fatura'
  end as alerta,
  fc.vencimento as fatura_carregada_vencimento
from novos n
left join lateral (
  select vencimento, relatorio_incompleto from faturas_carregadas f
  where f.imobiliaria_id = n.imobiliaria_principal_id and f.seguradora = n.seguradora
    and f.vencimento between n.fatura_prevista - 3 and n.fatura_prevista + 3
  order by abs(f.vencimento - n.fatura_prevista) limit 1
) fc on true;
grant select on erp_alertas_fatura to authenticated;

-- A view é pesada demais para a tela (limite de 8 s do papel authenticated): gera-se a lista pronta
-- de hora em hora (cron /api/cron/erp-bitrix?spa=1042 chama erp_atualizar_alertas_fatura) e a
-- tela /erp/conferencia só lê erp_alertas_fatura_pronto — mesma regra dos painéis (retrato pronto).
create table if not exists erp_alertas_fatura_pronto (
  documento_id uuid primary key,
  codigo_o2 bigint, nosso_numero_corp bigint, numero_apolice text, situacao text, vigencia_inicio date, efetivacao date,
  imobiliaria_principal_id uuid, imobiliaria text, seguradora text, dia_vencimento int, fatura_prevista date,
  alerta text not null, fatura_carregada_vencimento date, gerado_em timestamptz not null default now()
);
alter table erp_alertas_fatura_pronto enable row level security;
drop policy if exists erp_alertas_fatura_pronto_o2 on erp_alertas_fatura_pronto;
create policy erp_alertas_fatura_pronto_o2 on erp_alertas_fatura_pronto for select to authenticated using ((select is_colaborador_o2()));
create index if not exists erp_alertas_fatura_pronto_alerta_idx on erp_alertas_fatura_pronto(alerta, fatura_prevista desc);

create or replace function erp_atualizar_alertas_fatura() returns table (linhas int, alertas int)
language plpgsql security definer set search_path = public as $$
declare v_l int; v_a int;
begin
  truncate erp_alertas_fatura_pronto;
  insert into erp_alertas_fatura_pronto (documento_id, codigo_o2, nosso_numero_corp, numero_apolice, situacao, vigencia_inicio, efetivacao, imobiliaria_principal_id, imobiliaria, seguradora, dia_vencimento, fatura_prevista, alerta, fatura_carregada_vencimento)
  select documento_id, codigo_o2, nosso_numero_corp, numero_apolice, situacao, vigencia_inicio, efetivacao, imobiliaria_principal_id, imobiliaria, seguradora, dia_vencimento, fatura_prevista, alerta, fatura_carregada_vencimento
  from erp_alertas_fatura;
  get diagnostics v_l = row_count;
  select count(*) into v_a from erp_alertas_fatura_pronto where alerta not in ('ok','aguardando_fatura');
  return query select v_l, v_a;
end $$;
revoke all on function erp_atualizar_alertas_fatura() from public;
grant execute on function erp_atualizar_alertas_fatura() to service_role;
