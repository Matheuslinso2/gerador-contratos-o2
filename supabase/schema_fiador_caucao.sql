-- Fiador e Caução como garantias locatícias além dos produtos de seguro.
-- Diferente de seguro fiança/incêndio, essas duas não têm uma seguradora por
-- trás, então a seguradora do produto passa a ser opcional.

alter table produtos alter column seguradora_id drop not null;

-- Dados que só existem quando a garantia escolhida é Fiador ou Caução.
alter table contratos add column if not exists fiador text;
alter table contratos add column if not exists valor_caucao numeric;

-- Já deixamos os tipos cadastrados; falta você (admin) entrar em /clausulas e
-- cadastrar o "produto" de cada um com o texto real da cláusula (sem
-- seguradora), igual já fizemos pros tipos baseados em seguro.
insert into tipos_garantia (nome) values ('Fiador'), ('Caução')
on conflict (nome) do nothing;
