-- Ajustes do Workspace de Campanhas (27/10/2026, documento "Prompt ajuste workspace").
--
-- 1) Gestor da conta por imobiliária DENTRO da campanha, separado do
--    Responsável O2 (campanhas_metas.responsavel_email). Decisão do Matheus:
--    fica na campanha, não na ficha da imobiliária.
-- 2) Funil da campanha passa a devolver tipo (novo/renovacao) e locatario_id,
--    para a meta contar só contratos NOVOS (renovações ficam à parte) e para
--    mostrar o nome do pretendente nas oportunidades em aberto. O corpo é o
--    mesmo da versão anterior (campanha_programa_funil_com_card); só ganha as
--    duas colunas no fim. Mudar as colunas de retorno exige drop + create.

alter table public.campanhas_metas add column if not exists gestor_conta_email text;

drop function if exists public.campanha_programa_funil(uuid[], text[], date);

create function public.campanha_programa_funil(p_imobs uuid[], p_produtos text[], p_desde date)
 returns table(
   id uuid, chave_caso text, imobiliaria_id uuid, produto text, status_padrao text,
   data_recebimento date, data_efetivacao date, premio numeric, comissao numeric,
   herdada boolean, fonte text, origem_bitrix_id text, valor_titulo numeric,
   tipo text, locatario_id uuid
 )
 language sql
 stable
 set search_path to 'public'
as $function$
  with chaves as (
    select distinct r.fonte, k.texto
    from imobiliaria_registros_fonte r
    cross join lateral (values (r.chave_externa), (r.nome_original)) as k(texto)
    where r.imobiliaria_id = any (p_imobs) and r.situacao = 'confirmado' and k.texto is not null
  )
  select p.id, p.chave_caso, v.imobiliaria_id, p.produto, p.status_padrao,
         p.data_recebimento, p.data_efetivacao, p.premio, p.comissao, p.herdada,
         p.fonte, p.origem_bitrix_id::text,
         case when (p.extras ->> 'valor_titulo') ~ '^[0-9]+(\.[0-9]+)?$' then (p.extras ->> 'valor_titulo')::numeric end,
         p.tipo, p.locatario_id
  from chaves c
  join producao_unificada p on p.fonte_vinculo = c.fonte and p.imobiliaria_texto = c.texto
  cross join lateral (
    select r.imobiliaria_id
    from imobiliaria_registros_fonte r
    where r.fonte = p.fonte_vinculo and r.situacao = 'confirmado'
      and (r.chave_externa = p.imobiliaria_texto or r.nome_original = p.imobiliaria_texto)
    order by (r.chave_externa = p.imobiliaria_texto) desc
    limit 1
  ) v
  where p.fonte in ('planilha', 'bitrix')
    and p.produto = any (p_produtos)
    and (p.data_recebimento >= p_desde or p.data_efetivacao >= p_desde)
    and not coalesce(p.imobiliaria_texto ~* '^O2 CORRETORA', false)
    and v.imobiliaria_id = any (p_imobs);
$function$;

-- Mesmas permissões da versão anterior (postgres, authenticated, service_role).
revoke all on function public.campanha_programa_funil(uuid[], text[], date) from public, anon;
grant execute on function public.campanha_programa_funil(uuid[], text[], date) to authenticated, service_role;
