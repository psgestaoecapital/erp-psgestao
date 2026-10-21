-- Hub HB2 · Calculadora de Obra (fatia 5b): "?" (RD-95) e cadastro da tela de regras da empresa. Aditiva (só linhas novas). Faixa 05.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Regras da calculadora', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/calculadora/regras', 'hub', 'publicado'
FROM (VALUES
 ('projetos.calculadora.regra.areaChapa','Área da chapa','Área útil de uma chapa, em m².','Divide a área da obra para achar o número de chapas.','2,16 (1,80 × 1,20)','Usar a medida da chapa de outro fabricante sem ajustar.',30),
 ('projetos.calculadora.regra.baldeKg','Balde de massa','Quilos de massa em cada balde vendido.','Converte quilos em baldes inteiros.','22','Informar o peso bruto.',31),
 ('projetos.calculadora.regra.chapasPorFace','Chapas por face','Camadas de chapa em cada lado da parede.','Multiplica as chapas necessárias.','1','Informar o total das duas faces.',32),
 ('projetos.calculadora.regra.comprimentoBarra','Comprimento da barra','Metros de cada barra de perfil.','Converte metros de perfil em barras inteiras.','3','Informar a medida da peça cortada.',33),
 ('projetos.calculadora.regra.fitaMM2','Fita por m²','Metros de fita de junta por m².','Define quantos rolos de fita comprar.','3','Confundir com metros do rolo.',34),
 ('projetos.calculadora.regra.massaKgM2','Massa por m²','Quilos de massa de acabamento por m² de superfície.','Define quantos baldes comprar.','0,94','Esquecer que vale para as duas faces.',35),
 ('projetos.calculadora.regra.parafusoPFM13PorM2','Parafuso FM13 por m²','Parafusos FM13 por m² de forro.','Define a compra de parafusos.','2','Confundir com o parafuso PA25.',36),
 ('projetos.calculadora.regra.parafusoPPA25PorM2','Parafuso PA25 por m²','Parafusos PA25 por m² de forro.','Define a compra de parafusos.','13','Confundir com o parafuso FM13.',37),
 ('projetos.calculadora.regra.pendularPorM2','Pendural por m²','Penduras por m² de forro.','Define a quantidade de penduras.','1,25','Usar o valor de outro tipo de forro.',38),
 ('projetos.calculadora.regra.perda','Fator de perda','Multiplicador de desperdício aplicado às chapas e materiais. 1,05 = 5% a mais.','Garante que a compra cubra cortes e quebras.','1,05','Digitar 5 em vez de 1,05.',39),
 ('projetos.calculadora.regra.perfilF530MM2','Perfil F530 por m²','Metros de perfil F530 por m² de forro.','Define as barras de perfil.','1,7','Ignorar o espaçamento real do projeto.',40),
 ('projetos.calculadora.regra.rolobandaM','Rolo de banda acústica','Metros em cada rolo de banda.','Converte metros de banda em rolos.','10','Usar a largura em vez do comprimento.',41),
 ('projetos.calculadora.regra.rolofitaM','Rolo de fita','Metros de fita em cada rolo.','Converte metros em rolos inteiros.','150','Usar valor do rolo de outra marca.',42),
 ('projetos.calculadora.regra.tiranteUnPorM2','Tirante por m²','Tirantes por m² de forro.','Define a quantidade de tirantes.','1,25','Misturar com pendurais.',43),
 ('projetos.calculadora.regra.uniaoPorM2','União por m²','Uniões de perfil por m².','Define a quantidade de uniões.','0,45','Esquecer as emendas das barras.',44),
 ('projetos.calculadora.regra.validada','Validada com o fabricante','Marque quando o fabricante confirmou estes valores.','Tira o aviso de referência a validar da calculadora.','Marcada','Marcar sem ter conferido.',45),
 ('projetos.calculadora.regra.restaurar','Voltar à referência','Nada a preencher: o botão remove as regras próprias.','Devolve a calculadora aos valores de referência de mercado.','—','Clicar sem querer: os valores próprios são perdidos.',46)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, estado_real, auditavel_robo, auditabilidade_em, criado_em, atualizado_em)
SELECT 'dashboard.projetos.calculadora.regras', '/dashboard/projetos/calculadora/regras', 'projetos', 'Hub · Regras da Calculadora',
       'Edita perda, rendimentos e embalagens da calculadora de obra por empresa, com volta à referência de mercado.', 'pronto', true, now(), now(), now()
WHERE NOT EXISTS (SELECT 1 FROM public.system_screens s WHERE s.rota = '/dashboard/projetos/calculadora/regras');
