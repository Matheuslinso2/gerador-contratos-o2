-- Lista tabelas/colunas do schema public para o Robô O2 montar a consulta geral. Só o service_role executa.
create or replace function public.chat_robo_colunas()
returns table (tabela text, coluna text, tipo text)
language sql stable security definer set search_path to 'public' as $$
  select c.table_name::text, c.column_name::text, c.data_type::text
  from information_schema.columns c
  where c.table_schema = 'public'
  order by c.table_name, c.ordinal_position;
$$;
revoke all on function public.chat_robo_colunas() from public, anon, authenticated;
grant execute on function public.chat_robo_colunas() to service_role;
