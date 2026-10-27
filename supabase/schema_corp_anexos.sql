-- Anexos dos documentos do Corp (27/10/2026, pedido do Matheus): "vincular todos os
-- anexos baixados ao nosso número, vamos deixar todos os anexos expostos no ERP O2 para
-- consulta exatamente como está no Corp. A ideia da transição é não perder nenhum
-- documento e nenhuma informação."
--
-- O robô scripts/robo-corp/anexos.ts abre cada documento no Corp e baixa TODOS os
-- arquivos da aba Anexos; scripts/robo-corp/enviar-anexos.ts guarda cada arquivo no
-- bucket privado "corp-anexos" (<Nosso Nº>/<ordem>__<nome>) e uma linha aqui, na mesma
-- ordem e com o mesmo nome do Corp. O tipo de cada linha ("Apólice", "Proposta"...) é
-- imagem no Corp: guardamos o recorte (corp_anexos_tipos.imagem_path) e, quando
-- conhecido, o nome do tipo — o ERP mostra o nome ou, sem ele, o próprio recorte.
-- Arquivos são de terceiros (LGPD): só equipe O2; o ERP abre por link assinado de curta duração.
-- Aplicado via MCP.

create table if not exists corp_anexos_tipos (
  rotulo_id text primary key,               -- sha1 (12) do recorte do rótulo na tela do Corp
  tipo text,                                -- "Apólice", "Proposta"... (null = ainda sem nome; mostra a imagem)
  imagem_path text not null,                -- recorte no bucket corp-anexos (_tipos/<id>.png)
  visto_em timestamptz not null default now()
);

create table if not exists corp_anexos (
  id uuid primary key default gen_random_uuid(),
  nosso_numero text not null,               -- documento do Corp onde o arquivo está anexado
  ordem smallint not null,                  -- posição na aba Anexos do Corp (1, 2, 3...)
  nome text not null,                       -- nome do arquivo exatamente como no Corp
  rotulo_id text references corp_anexos_tipos(rotulo_id),
  apolice boolean not null default false,   -- rótulo "Apólice" (vai também para o acervo apolice_documentos)
  bytes bigint,
  sha256 text,
  mime text,
  storage_path text not null,               -- bucket corp-anexos
  visto_em timestamptz not null,            -- quando o robô viu a lista no Corp
  gravado_em timestamptz not null default now(),
  unique (nosso_numero, ordem)
);
create index if not exists corp_anexos_tipo_idx on corp_anexos (rotulo_id);

-- Só equipe O2 (regra: tabela nova já nasce com ALL para is_colaborador_o2).
alter table corp_anexos enable row level security;
alter table corp_anexos_tipos enable row level security;
drop policy if exists "corp_anexos o2" on corp_anexos;
create policy "corp_anexos o2" on corp_anexos for all to authenticated
  using ((select is_colaborador_o2())) with check ((select is_colaborador_o2()));
drop policy if exists "corp_anexos_tipos o2" on corp_anexos_tipos;
create policy "corp_anexos_tipos o2" on corp_anexos_tipos for all to authenticated
  using ((select is_colaborador_o2())) with check ((select is_colaborador_o2()));

-- Bucket privado (sem política de leitura pública: o servidor gera link assinado).
insert into storage.buckets (id, name, public)
values ('corp-anexos', 'corp-anexos', false)
on conflict (id) do nothing;
