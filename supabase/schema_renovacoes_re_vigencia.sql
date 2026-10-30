-- Renovações de RE separadas pela VIGÊNCIA (30/10/2026, reunião Kamila):
-- competência = mês da vigência. O /producao mostra "com vigência no período"
-- x "de outros meses" ao lado dos totais (por mês de criação do card).
-- Aplicado direto via MCP do Supabase; este arquivo é o registro.
create or replace function public.renovacoes_re_vigencia(p_de date, p_ate date)
returns jsonb
language sql
stable
security invoker
as $$
  with b as (
    select competencia_arquivo as comp,
           left(coalesce(nullif(extras->>'fim_vigencia',''), competencia_arquivo), 7) as vig,
           left(coalesce(extras->>'data_conversao',''), 7) as conv,
           left(coalesce(extras->>'data_perda',''), 7) as perda
    from producao_unificada
    where produto = 're' and tipo = 'renovacao'
  ), j as (select to_char(p_de, 'YYYY-MM') as a, to_char(p_ate, 'YYYY-MM') as z)
  select jsonb_build_object(
    'entradas',        count(*) filter (where b.comp between j.a and j.z),
    'entradas_vig',    count(*) filter (where b.comp between j.a and j.z and b.vig between j.a and j.z),
    'conversoes',      count(*) filter (where b.conv between j.a and j.z and b.conv <> ''),
    'conversoes_vig',  count(*) filter (where b.conv between j.a and j.z and b.conv <> '' and b.vig between j.a and j.z),
    'perdas',          count(*) filter (where b.perda between j.a and j.z and b.perda <> ''),
    'perdas_vig',      count(*) filter (where b.perda between j.a and j.z and b.perda <> '' and b.vig between j.a and j.z)
  ) from b, j;
$$;
grant execute on function public.renovacoes_re_vigencia(date, date) to authenticated;
