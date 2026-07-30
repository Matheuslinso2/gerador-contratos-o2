-- Preenche lacunas (só onde estava vazio, nunca sobrescreve) de
-- bairro/cidade/uf em imobiliarias_conhecidas, usando o export do CRM
-- (Bitrix24) de 30/07/2026, cruzado por nome com critério rígido
-- (prefixo de palavras) contra o CNPJ já conhecido — 0 casos ambíguos.

update imobiliarias_conhecidas set bairro = coalesce(bairro, 'Botafogo'), cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ') where cnpj = '02038854000192';
update imobiliarias_conhecidas set bairro = coalesce(bairro, 'Barra da Tijuca'), cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ') where cnpj = '13051870000131';
update imobiliarias_conhecidas set bairro = coalesce(bairro, 'Centro'), cidade = coalesce(cidade, 'Cabo Frio'), uf = coalesce(uf, 'RJ') where cnpj = '18785085000126';
update imobiliarias_conhecidas set bairro = coalesce(bairro, 'Centro'), cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ') where cnpj = '32265811000100';
update imobiliarias_conhecidas set bairro = coalesce(bairro, 'Centro'), cidade = coalesce(cidade, 'Tramandai'), uf = coalesce(uf, 'RS') where cnpj = '07197047000136';
update imobiliarias_conhecidas set bairro = coalesce(bairro, 'Copacabana'), cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ') where cnpj = '21162265000166';
update imobiliarias_conhecidas set uf = coalesce(uf, 'RJ') where cnpj = '12003761000186';
update imobiliarias_conhecidas set bairro = coalesce(bairro, 'Centro'), cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ') where cnpj = '28495339000125';
update imobiliarias_conhecidas set bairro = coalesce(bairro, 'Barra da Tijuca'), cidade = coalesce(cidade, 'RJ'), uf = coalesce(uf, 'RJ') where cnpj = '43165381000171';
update imobiliarias_conhecidas set bairro = coalesce(bairro, 'Leblon'), cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ') where cnpj = '42329995000189';
update imobiliarias_conhecidas set bairro = coalesce(bairro, 'Icarai'), cidade = coalesce(cidade, 'Niterói'), uf = coalesce(uf, 'RJ') where cnpj = '31064477000164';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Macaé'), uf = coalesce(uf, 'RJ') where cnpj = '18900531000104';
update imobiliarias_conhecidas set bairro = coalesce(bairro, 'Centro'), cidade = coalesce(cidade, 'Nova Iguaçu'), uf = coalesce(uf, 'RJ') where cnpj = '09590909000111';
update imobiliarias_conhecidas set bairro = coalesce(bairro, 'Felícia'), cidade = coalesce(cidade, 'Vitória da Conquista'), uf = coalesce(uf, 'BA') where cnpj = '31810798000160';
update imobiliarias_conhecidas set bairro = coalesce(bairro, 'Jacarepaguá'), cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ') where cnpj = '18749645000197';
update imobiliarias_conhecidas set uf = coalesce(uf, 'RJ') where cnpj = '54743761000162';
update imobiliarias_conhecidas set bairro = coalesce(bairro, 'Recreio dos Bandeirantes'), cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ') where cnpj = '33691053000155';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Niterói') where cnpj = '31294733000100';
update imobiliarias_conhecidas set bairro = coalesce(bairro, 'Ilha do Governador'), cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ') where cnpj = '34029447000458';
update imobiliarias_conhecidas set bairro = coalesce(bairro, 'Barra da Tijuca'), cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ') where cnpj = '16826220000109';
update imobiliarias_conhecidas set bairro = coalesce(bairro, 'Centro'), cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ') where cnpj = '30565373000170';
update imobiliarias_conhecidas set bairro = coalesce(bairro, 'Centro'), cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ') where cnpj = '24924232000102';
update imobiliarias_conhecidas set bairro = coalesce(bairro, 'Tijuca'), cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ') where cnpj = '13104875000185';
update imobiliarias_conhecidas set bairro = coalesce(bairro, 'Taquara'), cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ') where cnpj = '09108295000199';
update imobiliarias_conhecidas set bairro = coalesce(bairro, 'Recreio'), cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ') where cnpj = '22581681000161';
update imobiliarias_conhecidas set bairro = coalesce(bairro, 'Recreio') where cnpj = '12243351000102';
update imobiliarias_conhecidas set bairro = coalesce(bairro, 'Jundiai'), cidade = coalesce(cidade, 'São Paulo'), uf = coalesce(uf, 'SP') where cnpj = '52362423000155';
update imobiliarias_conhecidas set bairro = coalesce(bairro, 'Vila Valqueire'), cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ') where cnpj = '34717676000112';
update imobiliarias_conhecidas set bairro = coalesce(bairro, 'Centro'), cidade = coalesce(cidade, 'Mesquita'), uf = coalesce(uf, 'RJ') where cnpj = '32195699000189';
update imobiliarias_conhecidas set bairro = coalesce(bairro, 'Grajaú'), cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ') where cnpj = '34182488000137';
update imobiliarias_conhecidas set bairro = coalesce(bairro, 'Barra da Tijuca'), cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ') where cnpj = '42672908000191';
update imobiliarias_conhecidas set bairro = coalesce(bairro, 'Jacarepaguá'), cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ') where cnpj = '13567339000116';
update imobiliarias_conhecidas set bairro = coalesce(bairro, 'Barra da Tijuca'), cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ') where cnpj = '02173548000169';
update imobiliarias_conhecidas set bairro = coalesce(bairro, 'Recreio dos Bandeirantes'), cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ') where cnpj = '27772437000108';
