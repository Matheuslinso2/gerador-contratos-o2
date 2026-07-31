-- Enriquece imobiliarias_conhecidas com dados do CRM (Bitrix24), export
-- de 30/07/2026. Empresas com CNPJ já no CRM que não existiam antes são
-- inseridas; o resto só atualiza classificação/responsável/quantidade de
-- imóveis (sempre) e cidade/uf/bairro (só se estava vazio).

insert into imobiliarias_conhecidas (nome, cnpj, cidade, uf, bairro, classificacao_crm, responsavel_crm, quantidade_imoveis) values
('Alexandre grieco assessoria imobiliaria', '23992271000176', null, null, null, 'Diamante', 'Vanessa Fochi', null),
('C l serviços imobiliários ltda', '13970949000166', null, null, null, 'Diamante', 'Vanessa Fochi', null),
('CLAP IMÓVEIS', '29033830000105', 'Rio de Janeiro', 'RJ', 'Barra da Tijuca', 'Ouro', 'webmaster@o2seguros.com.br', null),
('coluna consultoria imobiliária', '29198769000148', null, null, null, 'Diamante', 'Vanessa Fochi', null),
('Correta friburg empreendimentos imobiliarios ltda', '73586109000126', null, null, null, 'Diamante', 'Vanessa Fochi', null),
('D S de Marins Imobiliária - ME', '27151932000191', 'Angra dos Reis', 'RJ', 'Centro', 'Ouro', 'William Sales', 72),
('Geraldo paes imoveis ltda', '40473059000111', null, null, null, 'Diamante', 'Vanessa Fochi', null),
('Imobiliária Dória', '27618766000190', 'Curitiba', 'PR', 'Juveve', 'Ouro', 'webmaster@o2seguros.com.br', 56),
('Lobo Lobão Imóveis', '21001008000142', 'Taubaté', 'SP', 'Centro', 'Ouro', 'William Sales', null),
('MARGARIDA MEIRELES IMOBILIÁRIA', '21053844000170', 'Rio de Janeiro', 'RJ', 'Flamengo', 'Prata', 'William Sales', null),
('MERITHUN IMOBILIÁRIA', '07816502000134', 'Rio de Janeiro', 'RJ', 'Recreio dos Bandeirantes', 'Ouro', 'William Sales', null),
('MVI Administração de Imóveis Ltda - ME', '26168490000100', 'Rio de Janeiro', 'RJ', 'Sepetiba', 'Bronze', 'webmaster@o2seguros.com.br', null),
('Quartier e Intermediações imobiliárias e corretagem de seguros', '29217308000175', 'Rio de janeiro', 'RJ', 'Recreio dos Bandeirantes', 'Ouro', 'Euzébio Gomes', 10)
on conflict (cnpj) do update set
  classificacao_crm = excluded.classificacao_crm,
  responsavel_crm = excluded.responsavel_crm,
  quantidade_imoveis = coalesce(excluded.quantidade_imoveis, imobiliarias_conhecidas.quantidade_imoveis),
  cidade = coalesce(imobiliarias_conhecidas.cidade, excluded.cidade),
  uf = coalesce(imobiliarias_conhecidas.uf, excluded.uf),
  bairro = coalesce(imobiliarias_conhecidas.bairro, excluded.bairro);

update imobiliarias_conhecidas set cidade = coalesce(cidade, 'RIO DE JANEIRO'), uf = coalesce(uf, 'RJ'), classificacao_crm = 'Ouro', responsavel_crm = 'Fernanda Nishikawa', quantidade_imoveis = 28 where cnpj = '03432650000102';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Cidade Nova'), classificacao_crm = 'Bronze', responsavel_crm = 'Henrique Pereira Guterres', quantidade_imoveis = 18 where cnpj = '29620173000194';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Copacabana'), classificacao_crm = 'Ouro', responsavel_crm = 'webmaster@o2seguros.com.br' where cnpj = '28283976000138';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Ipanema'), classificacao_crm = 'Ouro', responsavel_crm = 'webmaster@o2seguros.com.br' where cnpj = '23364560000120';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Porto Alegre'), uf = coalesce(uf, 'RS'), bairro = coalesce(bairro, 'Centro Histórico'), classificacao_crm = 'Ouro', responsavel_crm = 'William Sales', quantidade_imoveis = 210 where cnpj = '13937505000129';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Copacabana'), classificacao_crm = 'Ouro', responsavel_crm = 'webmaster@o2seguros.com.br', quantidade_imoveis = 25 where cnpj = '27671005000100';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Barra da Tijuca'), classificacao_crm = 'Diamante', responsavel_crm = 'Vanessa Fochi' where cnpj = '10945215000139';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Casdadura'), classificacao_crm = 'Prata', responsavel_crm = 'webmaster@o2seguros.com.br' where cnpj = '14034587000164';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Centro'), classificacao_crm = 'Ouro', responsavel_crm = 'webmaster@o2seguros.com.br', quantidade_imoveis = 17 where cnpj = '26840879000173';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Leme'), classificacao_crm = 'Ouro', responsavel_crm = 'webmaster@o2seguros.com.br', quantidade_imoveis = 151025 where cnpj = '26525374000114';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Recreio dos Bandeirantes'), classificacao_crm = 'Ouro', responsavel_crm = 'Henrique Pereira Guterres' where cnpj = '14788026000150';
update imobiliarias_conhecidas set classificacao_crm = 'Diamante', responsavel_crm = 'Vanessa Fochi' where cnpj = '14792464000192';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Cabo Frio'), uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Centro'), classificacao_crm = 'Ouro', responsavel_crm = 'webmaster@o2seguros.com.br', quantidade_imoveis = 172 where cnpj = '25195665000129';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Taquara'), classificacao_crm = 'Ouro', responsavel_crm = 'Vanessa Fochi', quantidade_imoveis = 80 where cnpj = '17857495000172';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Jacarepaguá'), classificacao_crm = 'Ouro', responsavel_crm = 'Vinicius Giangrossi' where cnpj = '33461806000136';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'São Paulo'), uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Broklin'), classificacao_crm = 'Ouro', responsavel_crm = 'Fernanda Nishikawa' where cnpj = '02902950000137';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Del Castilho'), classificacao_crm = 'Prata', responsavel_crm = 'Dayane Lima' where cnpj = '13581336000137';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Centro'), classificacao_crm = 'Ouro', responsavel_crm = 'Henrique Pereira Guterres' where cnpj = '24106984000158';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Cabo Frio'), uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Centro'), classificacao_crm = 'Diamante', responsavel_crm = 'Vanessa Fochi' where cnpj = '29703857000150';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ'), classificacao_crm = 'Prata', responsavel_crm = 'webmaster@o2seguros.com.br' where cnpj = '12461469000107';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Santo Antonio da Patrulha'), uf = coalesce(uf, 'RS'), bairro = coalesce(bairro, 'Pitangueiras'), classificacao_crm = 'Ouro', responsavel_crm = 'webmaster@o2seguros.com.br', quantidade_imoveis = 700 where cnpj = '02435305000151';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Centro'), classificacao_crm = 'Ouro', responsavel_crm = 'webmaster@o2seguros.com.br', quantidade_imoveis = 72 where cnpj = '30726120000131';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Barra da Tijuca'), classificacao_crm = 'Ouro', responsavel_crm = 'webmaster@o2seguros.com.br' where cnpj = '22013191000169';
update imobiliarias_conhecidas set classificacao_crm = 'Ouro', responsavel_crm = 'Vanessa Fochi' where cnpj = '24605124000169';
update imobiliarias_conhecidas set classificacao_crm = 'Ouro', responsavel_crm = 'Livia Soares' where cnpj = '18226743000140';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Botafogo'), classificacao_crm = 'Prata', responsavel_crm = 'webmaster@o2seguros.com.br' where cnpj = '02038854000192';
update imobiliarias_conhecidas set classificacao_crm = 'Prata', responsavel_crm = 'Vanessa Fochi' where cnpj = '31840150000137';
update imobiliarias_conhecidas set classificacao_crm = 'Prata', responsavel_crm = 'Vanessa Fochi' where cnpj = '26456234000131';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Barra da Tijuca'), classificacao_crm = 'Bronze', responsavel_crm = 'Henrique Pereira Guterres' where cnpj = '13051870000131';
update imobiliarias_conhecidas set classificacao_crm = 'Ouro', responsavel_crm = 'Vanessa Fochi' where cnpj = '68799634000190';
update imobiliarias_conhecidas set classificacao_crm = 'Bronze', responsavel_crm = 'Vinicius Giangrossi' where cnpj = '24282729000166';
update imobiliarias_conhecidas set classificacao_crm = 'Ouro', responsavel_crm = 'Vinicius Giangrossi' where cnpj = '42190311000100';
update imobiliarias_conhecidas set classificacao_crm = 'Bronze', responsavel_crm = 'Henrique Pereira Guterres' where cnpj = '47040368000147';
update imobiliarias_conhecidas set classificacao_crm = 'Ouro', responsavel_crm = 'tatiane@o2seguros.com.br' where cnpj = '21050722000120';
update imobiliarias_conhecidas set classificacao_crm = 'Diamante', responsavel_crm = 'Dayane Lima' where cnpj = '35658040000100';
update imobiliarias_conhecidas set responsavel_crm = 'webmaster@o2seguros.com.br' where cnpj = '15168136000182';
update imobiliarias_conhecidas set classificacao_crm = 'Ouro', responsavel_crm = 'webmaster@o2seguros.com.br' where cnpj = '04959687000148';
update imobiliarias_conhecidas set classificacao_crm = 'Bronze', responsavel_crm = 'Dayana Tinoco' where cnpj = '56705788000196';
update imobiliarias_conhecidas set classificacao_crm = 'Bronze', responsavel_crm = 'Dayane Lima' where cnpj = '40448680000125';
update imobiliarias_conhecidas set responsavel_crm = 'webmaster@o2seguros.com.br' where cnpj = '33695446000137';
update imobiliarias_conhecidas set classificacao_crm = 'Ouro', responsavel_crm = 'Dayane Lima' where cnpj = '02713529000188';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Cabo Frio'), uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Centro'), classificacao_crm = 'Ouro', responsavel_crm = 'webmaster@o2seguros.com.br' where cnpj = '18785085000126';
update imobiliarias_conhecidas set classificacao_crm = 'Bronze', responsavel_crm = 'webmaster@o2seguros.com.br' where cnpj = '19217904000100';
update imobiliarias_conhecidas set classificacao_crm = 'Ouro', responsavel_crm = 'Dayane Lima' where cnpj = '30019596000132';
update imobiliarias_conhecidas set classificacao_crm = 'Ouro', responsavel_crm = 'Livia Soares' where cnpj = '13646809000137';
update imobiliarias_conhecidas set classificacao_crm = 'Bronze', responsavel_crm = 'Fernanda Nishikawa' where cnpj = '04253455000170';
update imobiliarias_conhecidas set classificacao_crm = 'Bronze', responsavel_crm = 'Henrique Pereira Guterres' where cnpj = '40922765000101';
update imobiliarias_conhecidas set classificacao_crm = 'Bronze', responsavel_crm = 'Henrique Pereira Guterres' where cnpj = '12083105000130';
update imobiliarias_conhecidas set classificacao_crm = 'Bronze', responsavel_crm = 'Fernanda Nishikawa' where cnpj = '30232619000192';
update imobiliarias_conhecidas set classificacao_crm = 'Prata', responsavel_crm = 'webmaster@o2seguros.com.br' where cnpj = '30122535000104';
update imobiliarias_conhecidas set classificacao_crm = 'Bronze', responsavel_crm = 'Henrique Pereira Guterres' where cnpj = '15369258000137';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Centro'), classificacao_crm = 'Ouro', responsavel_crm = 'webmaster@o2seguros.com.br' where cnpj = '32265811000100';
update imobiliarias_conhecidas set classificacao_crm = 'Ouro', responsavel_crm = 'Fernanda Nishikawa' where cnpj = '44494636000102';
update imobiliarias_conhecidas set classificacao_crm = 'Ouro', responsavel_crm = 'Fernanda Nishikawa' where cnpj = '33254294000137';
update imobiliarias_conhecidas set classificacao_crm = 'Prata', responsavel_crm = 'Dayane Lima' where cnpj = '61510206000156';
update imobiliarias_conhecidas set classificacao_crm = 'Ouro', responsavel_crm = 'Fernanda Nishikawa' where cnpj = '31607153000125';
update imobiliarias_conhecidas set classificacao_crm = 'Platina', responsavel_crm = 'Dayana Tinoco' where cnpj = '14800575000101';
update imobiliarias_conhecidas set classificacao_crm = 'Prata', responsavel_crm = 'Dayane Lima' where cnpj = '45869477000146';
update imobiliarias_conhecidas set classificacao_crm = 'Diamante', responsavel_crm = 'Fernanda Nishikawa' where cnpj = '11263760000108';
update imobiliarias_conhecidas set classificacao_crm = 'Bronze', responsavel_crm = 'Dayane Lima' where cnpj = '13220490000183';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Tramandai'), uf = coalesce(uf, 'RS'), bairro = coalesce(bairro, 'Centro'), classificacao_crm = 'Ouro', responsavel_crm = 'webmaster@o2seguros.com.br' where cnpj = '07197047000136';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Copacabana'), classificacao_crm = 'Ouro', responsavel_crm = 'webmaster@o2seguros.com.br' where cnpj = '21162265000166';
update imobiliarias_conhecidas set responsavel_crm = 'webmaster@o2seguros.com.br' where cnpj = '13525146000100';
update imobiliarias_conhecidas set classificacao_crm = 'Ouro', responsavel_crm = 'Dayane Lima' where cnpj = '39607216000155';
update imobiliarias_conhecidas set classificacao_crm = 'Cobre', responsavel_crm = 'Fernanda Nishikawa' where cnpj = '13534906000138';
update imobiliarias_conhecidas set classificacao_crm = 'Bronze', responsavel_crm = 'Vinicius Giangrossi' where cnpj = '15596924000170';
update imobiliarias_conhecidas set classificacao_crm = 'Ouro', responsavel_crm = 'Dayane Lima' where cnpj = '40182433000120';
update imobiliarias_conhecidas set responsavel_crm = 'webmaster@o2seguros.com.br' where cnpj = '10974555000198';
update imobiliarias_conhecidas set classificacao_crm = 'Diamante', responsavel_crm = 'Fernanda Nishikawa' where cnpj = '34444790000116';
update imobiliarias_conhecidas set classificacao_crm = 'Bronze', responsavel_crm = 'Vanessa Fochi' where cnpj = '05100973000116';
update imobiliarias_conhecidas set classificacao_crm = 'Platina', responsavel_crm = 'Dayane Lima' where cnpj = '19335620000100';
update imobiliarias_conhecidas set classificacao_crm = 'Ouro', responsavel_crm = 'Dayane Lima' where cnpj = '45984651000100';
update imobiliarias_conhecidas set classificacao_crm = 'Ouro', responsavel_crm = 'Dayane Lima' where cnpj = '30076841000143';
update imobiliarias_conhecidas set classificacao_crm = 'Bronze', responsavel_crm = 'Dayane Lima' where cnpj = '21035145000106';
update imobiliarias_conhecidas set uf = coalesce(uf, 'RJ'), responsavel_crm = 'Vinicius Giangrossi' where cnpj = '12003761000186';
update imobiliarias_conhecidas set responsavel_crm = 'webmaster@o2seguros.com.br' where cnpj = '14516115000148';
update imobiliarias_conhecidas set classificacao_crm = 'Prata', responsavel_crm = 'Dayane Lima' where cnpj = '37996027000196';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Centro'), classificacao_crm = 'Ouro', responsavel_crm = 'Fernanda Nishikawa', quantidade_imoveis = 60 where cnpj = '28495339000125';
update imobiliarias_conhecidas set uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Barra da Tijuca'), classificacao_crm = 'Prata', responsavel_crm = 'Vanessa Fochi' where cnpj = '43165381000171';
update imobiliarias_conhecidas set classificacao_crm = 'Diamante', responsavel_crm = 'Dayana Tinoco' where cnpj = '58804110001320';
update imobiliarias_conhecidas set classificacao_crm = 'Prata', responsavel_crm = 'Fernanda Nishikawa' where cnpj = '20254008000191';
update imobiliarias_conhecidas set classificacao_crm = 'Prata', responsavel_crm = 'Vinicius Giangrossi' where cnpj = '34847486000110';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Leblon'), classificacao_crm = 'Ouro', responsavel_crm = 'William Sales', quantidade_imoveis = 90008 where cnpj = '42329995000189';
update imobiliarias_conhecidas set classificacao_crm = 'Ouro', responsavel_crm = 'Fernanda Nishikawa' where cnpj = '54888498000108';
update imobiliarias_conhecidas set classificacao_crm = 'Bronze', responsavel_crm = 'Vanessa Fochi' where cnpj = '00701080000102';
update imobiliarias_conhecidas set classificacao_crm = 'Prata', responsavel_crm = 'webmaster@o2seguros.com.br' where cnpj = '25169393000192';
update imobiliarias_conhecidas set classificacao_crm = 'Prata', responsavel_crm = 'Henrique Pereira Guterres' where cnpj = '48805630000160';
update imobiliarias_conhecidas set classificacao_crm = 'Diamante', responsavel_crm = 'Henrique Pereira Guterres' where cnpj = '31170749000100';
update imobiliarias_conhecidas set classificacao_crm = 'Ouro', responsavel_crm = 'Dayane Lima' where cnpj = '32759506000175';
update imobiliarias_conhecidas set classificacao_crm = 'Ouro', responsavel_crm = 'Henrique Pereira Guterres' where cnpj = '51743167000183';
update imobiliarias_conhecidas set classificacao_crm = 'Ouro', responsavel_crm = 'Vinicius Giangrossi' where cnpj = '33907709000124';
update imobiliarias_conhecidas set classificacao_crm = 'Prata', responsavel_crm = 'Henrique Pereira Guterres' where cnpj = '41714291000167';
update imobiliarias_conhecidas set classificacao_crm = 'Bronze', responsavel_crm = 'Dayane Lima' where cnpj = '27217455000110';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Niterói'), uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Icarai'), classificacao_crm = 'Ouro', responsavel_crm = 'Fernanda Nishikawa' where cnpj = '31064477000164';
update imobiliarias_conhecidas set classificacao_crm = 'Ouro', responsavel_crm = 'Danniel Gomes' where cnpj = '29726960000115';
update imobiliarias_conhecidas set classificacao_crm = 'Ouro', responsavel_crm = 'Henrique Pereira Guterres' where cnpj = '12476687000115';
update imobiliarias_conhecidas set classificacao_crm = 'Ouro', responsavel_crm = 'Henrique Pereira Guterres' where cnpj = '30167027000134';
update imobiliarias_conhecidas set classificacao_crm = 'Ouro', responsavel_crm = 'webmaster@o2seguros.com.br' where cnpj = '08199170000159';
update imobiliarias_conhecidas set classificacao_crm = 'Ouro', responsavel_crm = 'Fernanda Nishikawa' where cnpj = '19069248000137';
update imobiliarias_conhecidas set responsavel_crm = 'webmaster@o2seguros.com.br' where cnpj = '33390626000100';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Macaé'), uf = coalesce(uf, 'RJ'), classificacao_crm = 'Prata', responsavel_crm = 'webmaster@o2seguros.com.br' where cnpj = '18900531000104';
update imobiliarias_conhecidas set classificacao_crm = 'Ouro', responsavel_crm = 'Dayane Lima' where cnpj = '18645318000195';
update imobiliarias_conhecidas set responsavel_crm = 'webmaster@o2seguros.com.br' where cnpj = '01746679000125';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Nova Iguaçu'), uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Centro'), classificacao_crm = 'Ouro', responsavel_crm = 'Dayane Lima' where cnpj = '09590909000111';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Vitória da Conquista'), uf = coalesce(uf, 'BA'), bairro = coalesce(bairro, 'Felícia'), classificacao_crm = 'Bronze', responsavel_crm = 'William Sales', quantidade_imoveis = 18 where cnpj = '31810798000160';
update imobiliarias_conhecidas set classificacao_crm = 'Prata', responsavel_crm = 'lucas@o2seguros.com.br' where cnpj = '03012927000130';
update imobiliarias_conhecidas set classificacao_crm = 'Prata', responsavel_crm = 'Dayane Lima' where cnpj = '44405107000195';
update imobiliarias_conhecidas set classificacao_crm = 'Ouro', responsavel_crm = 'Dayana Tinoco' where cnpj = '38082991000171';
update imobiliarias_conhecidas set classificacao_crm = 'Prata', responsavel_crm = 'Fernanda Nishikawa' where cnpj = '07639582000108';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Jacarepaguá'), classificacao_crm = 'Prata', responsavel_crm = 'webmaster@o2seguros.com.br' where cnpj = '18749645000197';
update imobiliarias_conhecidas set classificacao_crm = 'Prata', responsavel_crm = 'webmaster@o2seguros.com.br' where cnpj = '28661218000106';
update imobiliarias_conhecidas set classificacao_crm = 'Prata', responsavel_crm = 'Dayana Tinoco' where cnpj = '38092715000194';
update imobiliarias_conhecidas set classificacao_crm = 'Ouro', responsavel_crm = 'Dayane Lima' where cnpj = '49405743000130';
update imobiliarias_conhecidas set uf = coalesce(uf, 'RJ'), classificacao_crm = 'Cobre', responsavel_crm = 'Fernanda Nishikawa' where cnpj = '54743761000162';
update imobiliarias_conhecidas set classificacao_crm = 'Diamante', responsavel_crm = 'Dayana Tinoco' where cnpj = '11221526000118';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Recreio dos Bandeirantes'), classificacao_crm = 'Ouro', responsavel_crm = 'webmaster@o2seguros.com.br' where cnpj = '33691053000155';
update imobiliarias_conhecidas set classificacao_crm = 'Prata', responsavel_crm = 'Dayane Lima' where cnpj = '18424592000134';
update imobiliarias_conhecidas set classificacao_crm = 'Prata', responsavel_crm = 'Henrique Pereira Guterres' where cnpj = '11503677000169';
update imobiliarias_conhecidas set classificacao_crm = 'Ouro', responsavel_crm = 'Fernanda Nishikawa' where cnpj = '23961427000151';
update imobiliarias_conhecidas set classificacao_crm = 'Prata', responsavel_crm = 'Dayane Lima' where cnpj = '48529583000179';
update imobiliarias_conhecidas set classificacao_crm = 'Bronze', responsavel_crm = 'Dayane Lima' where cnpj = '38352632000197';
update imobiliarias_conhecidas set classificacao_crm = 'Bronze', responsavel_crm = 'Henrique Pereira Guterres' where cnpj = '42655344000189';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Niterói'), classificacao_crm = 'Bronze', responsavel_crm = 'Dayane Lima' where cnpj = '31294733000100';
update imobiliarias_conhecidas set classificacao_crm = 'Bronze', responsavel_crm = 'Dayane Lima' where cnpj = '18358396000109';
update imobiliarias_conhecidas set classificacao_crm = 'Ouro', responsavel_crm = 'Vanessa Fochi' where cnpj = '31826157000102';
update imobiliarias_conhecidas set classificacao_crm = 'Ouro', responsavel_crm = 'Dayane Lima' where cnpj = '18827850000123';
update imobiliarias_conhecidas set classificacao_crm = 'Prata', responsavel_crm = 'Henrique Pereira Guterres' where cnpj = '21518913000174';
update imobiliarias_conhecidas set classificacao_crm = 'Ouro', responsavel_crm = 'Henrique Pereira Guterres' where cnpj = '48946269000191';
update imobiliarias_conhecidas set classificacao_crm = 'Ouro', responsavel_crm = 'Dayane Lima' where cnpj = '26204358000120';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Ilha do Governador'), classificacao_crm = 'Prata', responsavel_crm = 'webmaster@o2seguros.com.br' where cnpj = '34029447000458';
update imobiliarias_conhecidas set classificacao_crm = 'Bronze', responsavel_crm = 'Vinicius Giangrossi' where cnpj = '41669663000180';
update imobiliarias_conhecidas set responsavel_crm = 'webmaster@o2seguros.com.br' where cnpj = '13407065000106';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Barra da Tijuca'), classificacao_crm = 'Prata', responsavel_crm = 'webmaster@o2seguros.com.br' where cnpj = '16826220000109';
update imobiliarias_conhecidas set classificacao_crm = 'Prata', responsavel_crm = 'webmaster@o2seguros.com.br' where cnpj = '08977564000190';
update imobiliarias_conhecidas set classificacao_crm = 'Ouro', responsavel_crm = 'Dayane Lima' where cnpj = '06179833000148';
update imobiliarias_conhecidas set classificacao_crm = 'Ouro', responsavel_crm = 'Vanessa Fochi' where cnpj = '19157709000123';
update imobiliarias_conhecidas set classificacao_crm = 'Ouro', responsavel_crm = 'Henrique Pereira Guterres' where cnpj = '15385257000186';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Centro'), responsavel_crm = 'webmaster@o2seguros.com.br' where cnpj = '30565373000170';
update imobiliarias_conhecidas set classificacao_crm = 'Prata', responsavel_crm = 'Dayane Lima' where cnpj = '09065083000171';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Centro'), classificacao_crm = 'Prata', responsavel_crm = 'William Sales', quantidade_imoveis = 70 where cnpj = '24924232000102';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Tijuca'), classificacao_crm = 'Bronze', responsavel_crm = 'Fernanda Nishikawa' where cnpj = '13104875000185';
update imobiliarias_conhecidas set classificacao_crm = 'Bronze', responsavel_crm = 'Dayane Lima' where cnpj = '25142831000129';
update imobiliarias_conhecidas set classificacao_crm = 'Bronze', responsavel_crm = 'Vanessa Fochi' where cnpj = '35772754000144';
update imobiliarias_conhecidas set classificacao_crm = 'Prata', responsavel_crm = 'Dayane Lima' where cnpj = '18056412000109';
update imobiliarias_conhecidas set classificacao_crm = 'Prata', responsavel_crm = 'Dayane Lima' where cnpj = '29314297000141';
update imobiliarias_conhecidas set classificacao_crm = 'Prata', responsavel_crm = 'Henrique Pereira Guterres' where cnpj = '39907913000121';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Taquara'), classificacao_crm = 'Prata', responsavel_crm = 'webmaster@o2seguros.com.br' where cnpj = '09108295000199';
update imobiliarias_conhecidas set classificacao_crm = 'Bronze', responsavel_crm = 'Dayana Tinoco' where cnpj = '24404224000127';
update imobiliarias_conhecidas set classificacao_crm = 'Platina', responsavel_crm = 'Dayana Tinoco' where cnpj = '38060834000165';
update imobiliarias_conhecidas set classificacao_crm = 'Prata', responsavel_crm = 'Vanessa Fochi' where cnpj = '15081898000147';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Recreio'), classificacao_crm = 'Ouro', responsavel_crm = 'William Sales' where cnpj = '22581681000161';
update imobiliarias_conhecidas set classificacao_crm = 'Bronze', responsavel_crm = 'Camila Nascimento' where cnpj = '09162151000110';
update imobiliarias_conhecidas set classificacao_crm = 'Platina', responsavel_crm = 'Henrique Pereira Guterres' where cnpj = '36370742000156';
update imobiliarias_conhecidas set classificacao_crm = 'Cobre', responsavel_crm = 'Fernanda Nishikawa' where cnpj = '25404197000155';
update imobiliarias_conhecidas set classificacao_crm = 'Bronze', responsavel_crm = 'Dayana Tinoco' where cnpj = '26935465000128';
update imobiliarias_conhecidas set bairro = coalesce(bairro, 'Recreio'), classificacao_crm = 'Ouro', responsavel_crm = 'Fabrício Esteves', quantidade_imoveis = 250 where cnpj = '12243351000102';
update imobiliarias_conhecidas set classificacao_crm = 'Prata', responsavel_crm = 'Dayane Lima' where cnpj = '61181710000150';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'São Paulo'), uf = coalesce(uf, 'SP'), bairro = coalesce(bairro, 'Jundiai'), classificacao_crm = 'Ouro', responsavel_crm = 'William Sales' where cnpj = '52362423000155';
update imobiliarias_conhecidas set responsavel_crm = 'webmaster@o2seguros.com.br' where cnpj = '19855587000149';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Vila Valqueire'), classificacao_crm = 'Diamante', responsavel_crm = 'Dayane Lima' where cnpj = '34717676000112';
update imobiliarias_conhecidas set classificacao_crm = 'Prata', responsavel_crm = 'Fernanda Nishikawa' where cnpj = '56688290000162';
update imobiliarias_conhecidas set classificacao_crm = 'Cobre', responsavel_crm = 'Fernanda Nishikawa' where cnpj = '23876197000122';
update imobiliarias_conhecidas set classificacao_crm = 'Ouro', responsavel_crm = 'Dayane Lima' where cnpj = '26159794000124';
update imobiliarias_conhecidas set classificacao_crm = 'Ouro', responsavel_crm = 'Fernanda Nishikawa' where cnpj = '41932133000183';
update imobiliarias_conhecidas set classificacao_crm = 'Platina', responsavel_crm = 'Fernanda Nishikawa' where cnpj = '23812329000152';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Mesquita'), uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Centro'), classificacao_crm = 'Ouro', responsavel_crm = 'Claudia Costa' where cnpj = '32195699000189';
update imobiliarias_conhecidas set classificacao_crm = 'Cobre', responsavel_crm = 'Henrique Pereira Guterres' where cnpj = '23876619000160';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Grajaú'), classificacao_crm = 'Platina', responsavel_crm = 'William Sales', quantidade_imoveis = 10 where cnpj = '34182488000137';
update imobiliarias_conhecidas set responsavel_crm = 'webmaster@o2seguros.com.br' where cnpj = '24910720000152';
update imobiliarias_conhecidas set classificacao_crm = 'Ouro', responsavel_crm = 'Fernanda Nishikawa' where cnpj = '16634122000170';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Barra da Tijuca'), classificacao_crm = 'Prata', responsavel_crm = 'webmaster@o2seguros.com.br' where cnpj = '42672908000191';
update imobiliarias_conhecidas set classificacao_crm = 'Bronze', responsavel_crm = 'Dayana Tinoco' where cnpj = '43695217000176';
update imobiliarias_conhecidas set classificacao_crm = 'Bronze', responsavel_crm = 'lucas@o2seguros.com.br' where cnpj = '33693418000180';
update imobiliarias_conhecidas set classificacao_crm = 'Prata', responsavel_crm = 'Vanessa Fochi' where cnpj = '08561009000183';
update imobiliarias_conhecidas set classificacao_crm = 'Bronze', responsavel_crm = 'Dayana Tinoco' where cnpj = '18004237000106';
update imobiliarias_conhecidas set classificacao_crm = 'Prata', responsavel_crm = 'Dayane Lima' where cnpj = '28167170000184';
update imobiliarias_conhecidas set classificacao_crm = 'Bronze', responsavel_crm = 'Dayane Lima' where cnpj = '33735930000142';
update imobiliarias_conhecidas set responsavel_crm = 'webmaster@o2seguros.com.br' where cnpj = '28039184000112';
update imobiliarias_conhecidas set classificacao_crm = 'Prata', responsavel_crm = 'Livia Soares' where cnpj = '57652804000192';
update imobiliarias_conhecidas set classificacao_crm = 'Cobre', responsavel_crm = 'Fernanda Nishikawa' where cnpj = '11001587000170';
update imobiliarias_conhecidas set classificacao_crm = 'Ouro', responsavel_crm = 'Fernanda Nishikawa' where cnpj = '48767810000102';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Jacarepaguá'), classificacao_crm = 'Platina', responsavel_crm = 'Dayane Lima' where cnpj = '13567339000116';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Barra da Tijuca'), classificacao_crm = 'Ouro', responsavel_crm = 'webmaster@o2seguros.com.br' where cnpj = '02173548000169';
update imobiliarias_conhecidas set classificacao_crm = 'Bronze', responsavel_crm = 'Dayane Lima' where cnpj = '13539129000114';
update imobiliarias_conhecidas set classificacao_crm = 'Ouro', responsavel_crm = 'Fernanda Nishikawa' where cnpj = '13928070000156';
update imobiliarias_conhecidas set cidade = coalesce(cidade, 'Rio de Janeiro'), uf = coalesce(uf, 'RJ'), bairro = coalesce(bairro, 'Recreio dos Bandeirantes'), classificacao_crm = 'Ouro', responsavel_crm = 'William Sales', quantidade_imoveis = 35 where cnpj = '27772437000108';
