-- Chat interno da equipe O2 (Workspace + ERP) -- Fase 1: conversa individual entre colaboradores.
-- Só equipe (is_equipe_o2). Imobiliárias nunca enxergam nada daqui. Modelo já preparado para grupos (Fase 3).
-- Quem está online NÃO fica em tabela: usa Realtime Presence no navegador.

create table if not exists public.chat_conversas (
  id uuid primary key default gen_random_uuid(),
  tipo text not null default 'direta' check (tipo in ('direta','grupo')),
  nome text,
  chave text unique,               -- direta: e-mails ordenados "a|b" (evita conversa duplicada)
  criado_em timestamptz not null default now()
);

create table if not exists public.chat_participantes (
  conversa_id uuid not null references public.chat_conversas(id) on delete cascade,
  email text not null,
  lido_ate timestamptz not null default now(),
  primary key (conversa_id, email)
);
create index if not exists chat_participantes_email_idx on public.chat_participantes (email);

create table if not exists public.chat_mensagens (
  id uuid primary key default gen_random_uuid(),
  conversa_id uuid not null references public.chat_conversas(id) on delete cascade,
  autor_email text not null,
  texto text not null check (length(texto) between 1 and 4000),
  criado_em timestamptz not null default now()
);
create index if not exists chat_mensagens_conversa_idx on public.chat_mensagens (conversa_id, criado_em desc);

create or replace function public.chat_participa(p_conversa uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.chat_participantes
    where conversa_id = p_conversa and lower(email) = lower(auth.jwt() ->> 'email')
  );
$$;

alter table public.chat_conversas enable row level security;
alter table public.chat_participantes enable row level security;
alter table public.chat_mensagens enable row level security;

create policy chat_conversas_ver on public.chat_conversas for select
  using ((select public.is_equipe_o2()) and (select public.chat_participa(id)));
create policy chat_participantes_ver on public.chat_participantes for select
  using ((select public.is_equipe_o2()) and (select public.chat_participa(conversa_id)));
create policy chat_participantes_lido on public.chat_participantes for update
  using (lower(email) = lower(auth.jwt() ->> 'email'))
  with check (lower(email) = lower(auth.jwt() ->> 'email'));
create policy chat_mensagens_ver on public.chat_mensagens for select
  using ((select public.is_equipe_o2()) and (select public.chat_participa(conversa_id)));
create policy chat_mensagens_enviar on public.chat_mensagens for insert
  with check ((select public.is_equipe_o2())
    and lower(autor_email) = lower(auth.jwt() ->> 'email')
    and (select public.chat_participa(conversa_id)));

-- Lista de colegas (só e-mail e nome) -- auth.users não é legível pelo navegador.
create or replace function public.chat_equipe()
returns table (email text, nome text) language sql stable security definer set search_path to 'public' as $$
  select u.email::text, coalesce(nullif(u.raw_user_meta_data ->> 'nome',''), nullif(u.raw_user_meta_data ->> 'full_name',''))::text
  from auth.users u
  where (select public.is_equipe_o2())
    and (lower(u.email) like '%@o2seguros.com.br' or lower(u.email) like '%@nichoos.com')
    and lower(u.email) <> lower(auth.jwt() ->> 'email')
  order by u.email;
$$;

-- Abre (ou reaproveita) a conversa individual com um colega.
create or replace function public.chat_abrir_conversa(p_outro text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  eu text := lower(auth.jwt() ->> 'email');
  outro text := lower(p_outro);
  k text;
  cid uuid;
begin
  if not public.is_equipe_o2() then raise exception 'sem acesso'; end if;
  if outro = eu or not (outro like '%@o2seguros.com.br' or outro like '%@nichoos.com') then
    raise exception 'colega inválido';
  end if;
  k := case when eu < outro then eu || '|' || outro else outro || '|' || eu end;
  select id into cid from public.chat_conversas where chave = k;
  if cid is null then
    insert into public.chat_conversas (tipo, chave) values ('direta', k) returning id into cid;
    insert into public.chat_participantes (conversa_id, email) values (cid, eu), (cid, outro);
  end if;
  return cid;
end $$;

revoke all on function public.chat_equipe() from public, anon;
revoke all on function public.chat_abrir_conversa(text) from public, anon;
grant execute on function public.chat_equipe() to authenticated;
grant execute on function public.chat_abrir_conversa(text) to authenticated;

alter publication supabase_realtime add table public.chat_mensagens;
