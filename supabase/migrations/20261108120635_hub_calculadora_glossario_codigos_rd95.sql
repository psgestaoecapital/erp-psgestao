-- PDCA Hub · Calculadora de Obra (/dashboard/projetos/calculadora) · aud8 90/95 (erp_auditor_matriz_resultados).
-- GAP (RD-95, critério e/h): os códigos técnicos de drywall (ST, RU, RF, F530, PPA, PFM, tabica, junção H, nervura)
--   usados na seleção de sistema/camadas e na lista de compra apareciam SEM "?" nem glossário. Usuário leigo (pilotos
--   Tryo e FC Pisos) não escolhia o sistema certo sozinho. blueprint_tela_requisito "glossário para ST/RU/RF/..." = parcial.
-- CORREÇÃO: a tela ganhou um glossário recolhível ("Entenda os códigos") logo após o seletor de Sistema, com cada código
--   em linguagem do usuário e a cor da face da chapa (padrão ABNT NBR 14715), e um "?" (AjudaCampo) por código + um do
--   glossário. Aqui ficam as 10 chaves novas (texto editável no banco). Definições conferidas no próprio código
--   (src/lib/calculadora/campos-regras.ts, motor.ts): PPA/PFM são parafusos; tabica/junção H/nervura são perfis do forro.
--
-- ADITIVA (RD-94.1-c): só texto de ajuda novo em erp_ajuda_campo; não altera tabela/função nem dado de cliente.
-- Idempotente (ON CONFLICT DO NOTHING). Versão acima da main, faixa de segundos do code-desenvolvedor-3 (:36).

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Glossário técnico', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/calculadora', 'hub', 'publicado'
FROM (VALUES
 ('projetos.calculadora.glossario', 'Entenda os códigos',
  'Nada a preencher: é a lista explicando cada sigla técnica de drywall usada na calculadora (ST, RU, RF, F530, PPA, PFM, tabica, junção H, nervura).',
  'Ajuda quem não é do ramo a escolher o sistema e as chapas certas sem precisar perguntar — cada código tem o "?" com o detalhe.',
  'Em dúvida se usa chapa comum ou verde no banheiro? Abra o glossário e veja RU (resistente à umidade).',
  'Escolher a chapa errada por não saber o código: a verde (RU) é para áreas molhadas; a rosa (RF), para corta-fogo.', 1),
 ('projetos.calculadora.cod.st', 'Chapa ST (Standard)',
  'Nada a preencher: ST é a chapa de gesso comum (Standard), de face cinza/branca.',
  'É a chapa padrão para paredes e forros internos secos — a mais usada e a mais barata.',
  'Parede de quarto ou sala sem umidade: usa chapa ST.',
  'Usar ST em área molhada: no banheiro/cozinha a chapa certa é a RU (resistente à umidade).', 2),
 ('projetos.calculadora.cod.ru', 'Chapa RU (Resistente à Umidade)',
  'Nada a preencher: RU é a chapa resistente à umidade, de face verde.',
  'É a chapa para áreas que pegam água ou vapor — banheiro, cozinha, área de serviço, lavanderia.',
  'Parede de banheiro: usa chapa RU (verde).',
  'Achar que RU é à prova d’água: ela resiste à umidade, mas não substitui a impermeabilização do box.', 3),
 ('projetos.calculadora.cod.rf', 'Chapa RF (Resistente ao Fogo)',
  'Nada a preencher: RF é a chapa resistente ao fogo, de face rosa.',
  'É a chapa exigida em paredes corta-fogo e rotas de fuga, quando a norma pede resistência ao fogo.',
  'Parede corta-fogo entre lojas ou na escada de incêndio: usa chapa RF (rosa).',
  'Trocar RF por ST para economizar: em parede corta-fogo isso reprova na vistoria e põe vidas em risco.', 4),
 ('projetos.calculadora.cod.f530', 'Forro F530',
  'Nada a preencher: F530 é o sistema de forro de gesso acartonado com perfil "F530".',
  'É o perfil metálico que sustenta as chapas do forro suspenso — nomeia o sistema de forro reto de gesso.',
  'Forro de gesso liso de um escritório: sistema F530.',
  'Confundir com o forro aramado: o F530 usa perfis; o aramado usa arame, nervura e junção H.', 5),
 ('projetos.calculadora.cod.ppa', 'Parafuso PPA 25',
  'Nada a preencher: PPA 25 é o parafuso ponta agulha de 25 mm.',
  'É o parafuso que prende a chapa de gesso na estrutura de perfis do drywall.',
  'Fixar a chapa no montante: usa parafuso PPA 25.',
  'Usar o PPA (ponta agulha) para prender perfil no perfil: metal no metal pede o PFM (ponta broca).', 6),
 ('projetos.calculadora.cod.pfm', 'Parafuso PFM 13',
  'Nada a preencher: PFM 13 é o parafuso ponta broca metal de 13 mm.',
  'É o parafuso que une perfil a perfil (metal no metal) da estrutura do drywall/forro.',
  'Travar a guia no montante: usa parafuso PFM 13.',
  'Usar o PFM para fixar a chapa: a chapa no perfil pede o PPA (ponta agulha).', 7),
 ('projetos.calculadora.cod.tabica', 'Tabica',
  'Nada a preencher: tabica é o perfil de acabamento no perímetro do forro, no encontro com a parede.',
  'Dá o arremate da borda do forro e esconde a junta entre o forro e a parede.',
  'A moldura metálica que corre em volta do forro, rente à parede: é a tabica.',
  'Esquecer a tabica no cálculo: sem ela o perímetro do forro fica sem acabamento.', 8),
 ('projetos.calculadora.cod.juncao_h', 'Junção H',
  'Nada a preencher: a junção H é o perfil em formato de "H" que une as placas do forro aramado lado a lado.',
  'Encaixa e alinha duas placas vizinhas do forro aramado, mantendo a junta firme.',
  'No forro aramado, o perfil que emenda uma placa na outra é a junção H.',
  'Trocar junção H por nervura: a nervura é a travessa que sustenta; a junção H é o encaixe entre placas.', 9),
 ('projetos.calculadora.cod.nervura', 'Nervura',
  'Nada a preencher: nervura é a travessa estrutural do forro aramado, que trava e sustenta as placas.',
  'Dá rigidez ao forro aramado e segura as placas no lugar.',
  'As barras transversais que seguram as placas do forro aramado são as nervuras.',
  'Contar nervura no forro F530: a nervura é do forro aramado; o F530 usa perfis, não nervura.', 10)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
