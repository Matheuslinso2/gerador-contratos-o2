-- Registro de uso diário do Workspace O2 (não é log de LOGIN -- é log de
-- USO real, capturado a cada requisição autenticada no middleware, porque
-- sessão do Supabase persiste por muito tempo e "último login" não reflete
-- quem de fato abriu o sistema num dia específico).
-- Aplicado direto no projeto em 20/08/2026 via MCP do Supabase -- este
-- arquivo é só o registro/documentação, igual aos demais schema_*.sql.
create table if not exists workspace_acessos_diarios (
  email text not null,
  dia date not null,
  primeiro_acesso timestamptz not null default now(),
  ultimo_acesso timestamptz not null default now(),
  qtd_requisicoes integer not null default 1,
  primary key (email, dia)
);

alter table workspace_acessos_diarios enable row level security;

-- Só o Matheus vê essa tela/dado -- ver isMatheus() em src/lib/admin.ts.
create policy "so o matheus le os acessos" on workspace_acessos_diarios
  for select
  using (auth.jwt() ->> 'email' = 'matheus@o2seguros.com.br');

create policy "usuario registra o proprio acesso" on workspace_acessos_diarios
  for insert
  with check (email = auth.jwt() ->> 'email');

create policy "usuario atualiza o proprio acesso do dia" on workspace_acessos_diarios
  for update
  using (email = auth.jwt() ->> 'email')
  with check (email = auth.jwt() ->> 'email');

-- Chamada pelo middleware (proxy.ts) uma vez por dia por usuário (throttled
-- por cookie, não em toda requisição) -- usa o dia calculado em horário de
-- Brasília, não UTC, pra bater com o que a equipe entende como "hoje".
-- SECURITY INVOKER (padrão) de propósito: roda com o JWT de quem chamou,
-- então as políticas de RLS acima continuam valendo -- ninguém registra
-- acesso em nome de outro e-mail.
create or replace function registrar_acesso_diario(p_email text)
returns void
language plpgsql
security invoker
as $$
begin
  insert into workspace_acessos_diarios (email, dia, primeiro_acesso, ultimo_acesso, qtd_requisicoes)
  values (p_email, (now() at time zone 'America/Sao_Paulo')::date, now(), now(), 1)
  on conflict (email, dia) do update
    set ultimo_acesso = now(),
        qtd_requisicoes = workspace_acessos_diarios.qtd_requisicoes + 1;
end;
$$;

grant execute on function registrar_acesso_diario(text) to authenticated;
