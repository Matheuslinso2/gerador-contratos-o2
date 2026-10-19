-- Módulo Sinistro (Seguro Fiança) -- Fase 1: abertura pela imobiliária +
-- fila/pré-análise da O2. Plano completo em
-- entregaveis/modulo-sinistro/Modulo Sinistro - Planejamento.pdf.
-- Aplicado direto no projeto via MCP -- este arquivo é o registro.
--
-- Acesso: a imobiliária (titular ou membro, via imobiliarias_do_usuario())
-- vê só os próprios sinistros e só edita enquanto está com ela
-- (rascunho/pendência). Colaborador O2 tem ALL desde o início (lição de
-- permissao_colaborador_o2_imobiliarias).

create table if not exists sinistros (
  id uuid primary key default gen_random_uuid(),
  codigo bigint generated always as identity unique,
  imobiliaria_id uuid not null references imobiliarias(id),
  criado_por uuid default auth.uid(),
  criado_por_email text default (auth.jwt() ->> 'email'),
  origem text not null default 'workspace' check (origem in ('workspace', 'email')),

  tipo text not null check (tipo in ('ocupado', 'chaves_sem_danos', 'chaves_com_danos')),
  etapa text not null default 'rascunho' check (etapa in (
    'rascunho', 'pre_analise', 'pendencia_imobiliaria', 'na_seguradora',
    'em_indenizacao', 'acordo_judicial', 'encerrado', 'cancelado'
  )),
  desfecho text check (desfecho in ('indenizado', 'sem_indenizacao')),
  motivo_encerramento text,
  encerrado_em date,

  -- Contrato / apólice (digitado pela imobiliária na Fase 1)
  seguradora text not null,
  numero_apolice text,
  vigencia_inicio date,
  vigencia_fim date,
  locador_nome text not null,
  locador_documento text,
  locatario_nome text not null,
  locatario_documento text,
  locatario_telefone text,
  locatario_email text,
  imovel_cep text,
  imovel_logradouro text,
  imovel_numero text,
  imovel_complemento text,
  imovel_bairro text,
  imovel_cidade text,
  imovel_uf text,

  -- Situação / prazos
  data_primeiro_vencimento date,
  data_segundo_vencimento date,
  data_entrega_chaves date,
  locatario_assinou_documentos boolean,
  pintura_vistoria_nova boolean,
  pintura_vistoria_assinada boolean,
  coberturas text[] not null default '{}',
  prazo_aviso date,
  aviso_fora_prazo boolean not null default false,
  justificativa_fora_prazo text,
  observacoes text,

  -- Favorecido da indenização
  favorecido_eh_segurado boolean,
  favorecido_nome text,
  favorecido_documento text,
  favorecido_banco text,
  favorecido_agencia text,
  favorecido_conta text,

  -- Termo de ciência (R11)
  ciencia_texto text,
  ciencia_aceita_em timestamptz,
  ciencia_aceita_por text,

  -- Envio / O2
  enviado_em timestamptz,
  valor_avisado numeric(14,2),
  responsavel_o2 text,
  pre_analise_desde timestamptz,
  pendencia_desde timestamptz,
  pendencia_prazo date,
  numero_sinistro_seguradora text,
  data_abertura_seguradora date,
  documentacao_completa_em date,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sinistros_imob_idx on sinistros(imobiliaria_id, etapa);
create index if not exists sinistros_etapa_idx on sinistros(etapa);

create table if not exists sinistro_debitos (
  id uuid primary key default gen_random_uuid(),
  sinistro_id uuid not null references sinistros(id) on delete cascade,
  discriminacao text not null,
  vencimento date,
  competencia text,
  valor numeric(14,2) not null default 0,
  multa numeric(14,2) not null default 0,
  acrescimos numeric(14,2) not null default 0,
  ordem integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists sinistro_debitos_sin_idx on sinistro_debitos(sinistro_id);

create table if not exists sinistro_documentos (
  id uuid primary key default gen_random_uuid(),
  sinistro_id uuid not null references sinistros(id) on delete cascade,
  tipo text not null,
  arquivo_path text not null,
  nome_arquivo text not null,
  tamanho bigint,
  enviado_por_email text default (auth.jwt() ->> 'email'),
  enviado_em timestamptz not null default now(),
  situacao text not null default 'enviado' check (situacao in ('enviado', 'aprovado', 'recusado', 'substituido')),
  motivo_recusa text,
  analisado_por text,
  analisado_em timestamptz
);
create index if not exists sinistro_documentos_sin_idx on sinistro_documentos(sinistro_id);

create table if not exists sinistro_historico (
  id uuid primary key default gen_random_uuid(),
  sinistro_id uuid not null references sinistros(id) on delete cascade,
  criado_em timestamptz not null default now(),
  autor_email text default (auth.jwt() ->> 'email'),
  autor_tipo text not null check (autor_tipo in ('imobiliaria', 'o2', 'sistema')),
  referente text check (referente in ('imobiliaria', 'seguradora', 'locatario', 'escritorio', 'interno')),
  texto text not null,
  visivel_imobiliaria boolean not null default true,
  etapa_de text,
  etapa_para text
);
create index if not exists sinistro_historico_sin_idx on sinistro_historico(sinistro_id, criado_em);

-- Helpers (security definer, mesmo padrão de imobiliarias_do_usuario()).
create or replace function sinistro_da_imobiliaria_do_usuario(sid uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from sinistros s
    where s.id = sid and s.imobiliaria_id in (select imobiliarias_do_usuario())
  );
$$;

create or replace function sinistro_editavel_pela_imobiliaria(sid uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from sinistros s
    where s.id = sid
      and s.imobiliaria_id in (select imobiliarias_do_usuario())
      and s.etapa in ('rascunho', 'pendencia_imobiliaria')
  );
$$;

-- Storage: pasta = id do sinistro. Texto não-uuid simplesmente não casa.
create or replace function sinistro_pasta_acessivel(pasta text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select case
    when pasta ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then sinistro_da_imobiliaria_do_usuario(pasta::uuid)
    else false
  end;
$$;

create or replace function sinistros_touch_updated_at()
returns trigger language plpgsql set search_path to 'public' as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists sinistros_updated_at on sinistros;
create trigger sinistros_updated_at before update on sinistros
  for each row execute function sinistros_touch_updated_at();

alter table sinistros enable row level security;
alter table sinistro_debitos enable row level security;
alter table sinistro_documentos enable row level security;
alter table sinistro_historico enable row level security;

-- sinistros
drop policy if exists "sinistros o2" on sinistros;
create policy "sinistros o2" on sinistros for all to authenticated
  using (is_colaborador_o2()) with check (is_colaborador_o2());
drop policy if exists "sinistros imob select" on sinistros;
create policy "sinistros imob select" on sinistros for select to authenticated
  using (imobiliaria_id in (select imobiliarias_do_usuario()));
drop policy if exists "sinistros imob insert" on sinistros;
create policy "sinistros imob insert" on sinistros for insert to authenticated
  with check (imobiliaria_id in (select imobiliarias_do_usuario()) and etapa = 'rascunho');
drop policy if exists "sinistros imob update" on sinistros;
create policy "sinistros imob update" on sinistros for update to authenticated
  using (imobiliaria_id in (select imobiliarias_do_usuario()) and etapa in ('rascunho', 'pendencia_imobiliaria'))
  with check (imobiliaria_id in (select imobiliarias_do_usuario()) and etapa in ('rascunho', 'pendencia_imobiliaria', 'pre_analise', 'cancelado'));

-- sinistro_debitos
drop policy if exists "sinistro_debitos o2" on sinistro_debitos;
create policy "sinistro_debitos o2" on sinistro_debitos for all to authenticated
  using (is_colaborador_o2()) with check (is_colaborador_o2());
drop policy if exists "sinistro_debitos imob select" on sinistro_debitos;
create policy "sinistro_debitos imob select" on sinistro_debitos for select to authenticated
  using (sinistro_da_imobiliaria_do_usuario(sinistro_id));
drop policy if exists "sinistro_debitos imob escrita" on sinistro_debitos;
create policy "sinistro_debitos imob escrita" on sinistro_debitos for all to authenticated
  using (sinistro_editavel_pela_imobiliaria(sinistro_id))
  with check (sinistro_editavel_pela_imobiliaria(sinistro_id));

-- sinistro_documentos
drop policy if exists "sinistro_documentos o2" on sinistro_documentos;
create policy "sinistro_documentos o2" on sinistro_documentos for all to authenticated
  using (is_colaborador_o2()) with check (is_colaborador_o2());
drop policy if exists "sinistro_documentos imob select" on sinistro_documentos;
create policy "sinistro_documentos imob select" on sinistro_documentos for select to authenticated
  using (sinistro_da_imobiliaria_do_usuario(sinistro_id));
drop policy if exists "sinistro_documentos imob insert" on sinistro_documentos;
create policy "sinistro_documentos imob insert" on sinistro_documentos for insert to authenticated
  with check (sinistro_editavel_pela_imobiliaria(sinistro_id) and situacao = 'enviado');
-- Reenvio: a imobiliária só pode marcar o próprio arquivo como substituído.
drop policy if exists "sinistro_documentos imob substituir" on sinistro_documentos;
create policy "sinistro_documentos imob substituir" on sinistro_documentos for update to authenticated
  using (sinistro_editavel_pela_imobiliaria(sinistro_id) and situacao in ('enviado', 'recusado'))
  with check (sinistro_editavel_pela_imobiliaria(sinistro_id) and situacao = 'substituido');

-- sinistro_historico
drop policy if exists "sinistro_historico o2" on sinistro_historico;
create policy "sinistro_historico o2" on sinistro_historico for all to authenticated
  using (is_colaborador_o2()) with check (is_colaborador_o2());
drop policy if exists "sinistro_historico imob select" on sinistro_historico;
create policy "sinistro_historico imob select" on sinistro_historico for select to authenticated
  using (visivel_imobiliaria and sinistro_da_imobiliaria_do_usuario(sinistro_id));
drop policy if exists "sinistro_historico imob insert" on sinistro_historico;
create policy "sinistro_historico imob insert" on sinistro_historico for insert to authenticated
  with check (sinistro_da_imobiliaria_do_usuario(sinistro_id) and autor_tipo = 'imobiliaria' and visivel_imobiliaria);

-- Bucket privado dos documentos (até 50 MB por arquivo).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sinistros', 'sinistros', false, 52428800,
  array[
    'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'
  ]
)
on conflict (id) do nothing;

drop policy if exists "sinistros storage select" on storage.objects;
create policy "sinistros storage select" on storage.objects for select to authenticated
  using (bucket_id = 'sinistros' and (is_colaborador_o2() or sinistro_pasta_acessivel((storage.foldername(name))[1])));
drop policy if exists "sinistros storage insert" on storage.objects;
create policy "sinistros storage insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'sinistros' and (is_colaborador_o2() or sinistro_pasta_acessivel((storage.foldername(name))[1])));

-- Helpers só fazem sentido pra quem está logado.
revoke execute on function sinistro_da_imobiliaria_do_usuario(uuid) from anon, public;
revoke execute on function sinistro_editavel_pela_imobiliaria(uuid) from anon, public;
revoke execute on function sinistro_pasta_acessivel(text) from anon, public;
grant execute on function sinistro_da_imobiliaria_do_usuario(uuid) to authenticated;
grant execute on function sinistro_editavel_pela_imobiliaria(uuid) to authenticated;
grant execute on function sinistro_pasta_acessivel(text) to authenticated;
