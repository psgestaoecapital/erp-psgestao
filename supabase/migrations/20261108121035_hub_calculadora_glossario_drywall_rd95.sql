-- Hub · Calculadora de Obra (/dashboard/projetos/calculadora) · RD-95 glossário técnico (aud8 90/95).
-- GAP (aud8, critério e/h): os códigos técnicos de drywall (ST, RU, RF, PPA, PFM, F530, tabica, junção H, nervura)
-- aparecem na tela sem "?" nem glossário — o usuário leigo (pilotos FC Pisos / Tryo) não escolhe/entende o sistema
-- sozinho. A tela agora traz um glossário com um "?" por termo; o texto vem do banco (erp_ajuda_campo), editável sem
-- deploy, padrão RD-95.
--
-- IDEMPOTENTE / ADITIVA: as 10 chaves já existem na produção (seed direto por sessão anterior, FORA de migration — esta
-- migration apenas as REGISTRA no repo para o gate check-ajuda-campo.ts (que valida as chaves pelos arquivos de migration,
-- "Sem rede") e para que um banco novo seja semeado corretamente. ON CONFLICT (chave) DO NOTHING: não altera o texto vivo.
-- Prova RD-38 (produção): SELECT count(*) WHERE chave LIKE 'projetos.calculadora.cod.%' OR chave='projetos.calculadora.glossario' => 10.
-- Nada de dado de cliente é tocado. Faixa de segundos do code-desenvolvedor-3 (:35).

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/calculadora', 'hub', 'publicado'
FROM (VALUES
 ('projetos.calculadora.glossario', 'Glossário técnico', 'Termos técnicos (drywall)',
  'Lista rápida do que cada código ou peça de drywall significa, em linguagem simples.',
  'Ajuda você a reconhecer os itens da lista de compra e a escolher o sistema certo sem depender de um técnico.',
  'Abra para ver o que são ST, PPA25, F530, tabica, junção H, nervura etc.',
  'Comprar a chapa errada para o ambiente (ex.: chapa comum em área molhada).', 1),
 ('projetos.calculadora.cod.st', 'Glossário técnico', 'Chapa ST (Standard)',
  'Placa de gesso comum: miolo de gesso entre duas folhas de cartão, cor marfim/cinza.',
  'Uso geral em ambientes SECOS — quartos, salas, corredores.',
  'Divisória de um quarto.',
  'Usar a ST em banheiro, cozinha ou área de serviço — nesses lugares vai a RU.', 2),
 ('projetos.calculadora.cod.ru', 'Glossário técnico', 'Chapa RU (resistente à umidade)',
  'Placa com o miolo tratado contra umidade; normalmente verde.',
  'Áreas úmidas: banheiro, cozinha, área de serviço, lavanderia.',
  'Parede do box do banheiro (com a devida impermeabilização).',
  'Achar que a RU é à prova d''água — ela resiste à umidade, não à imersão; ainda precisa de impermeabilização.', 3),
 ('projetos.calculadora.cod.rf', 'Glossário técnico', 'Chapa RF (resistente ao fogo)',
  'Placa com fibra de vidro no miolo, que segura mais tempo o fogo; normalmente rosa.',
  'Paredes corta-fogo e onde a norma exige resistência ao fogo.',
  'Parede separativa entre unidades ou na rota de saída de emergência.',
  'Trocar a RF por uma chapa comum para economizar — perde a proteção que a norma exige.', 4),
 ('projetos.calculadora.cod.ppa', 'Glossário técnico', 'Parafuso PPA25 / PPA35',
  'Parafuso de ponta agulha que prende a CHAPA de gesso ao perfil metálico. 25 mm para uma chapa; 35 mm para a segunda chapa.',
  'Fixa as placas na estrutura; a quantidade entra na lista de compra.',
  'PPA25 na parede de uma chapa; PPA35 na 2ª chapa de uma parede dupla.',
  'Usar o PPA (chapa-metal) para unir dois perfis — aí o certo é o PFM.', 5),
 ('projetos.calculadora.cod.pfm', 'Glossário técnico', 'Parafuso PFM13',
  'Parafuso metal-metal (ponta broca), 13 mm, para unir PERFIL com PERFIL da estrutura.',
  'Monta a estrutura (guias e montantes) antes de aparafusar as chapas.',
  'Fixar a guia no montante.',
  'Usar o PFM para prender a chapa — a chapa vai no PPA.', 6),
 ('projetos.calculadora.cod.f530', 'Glossário técnico', 'Perfil F530',
  'Perfil de forro (teto) no qual as chapas de gesso são aparafusadas.',
  'Forma a estrutura do forro F530 — o teto de drywall.',
  'Teto de gesso de uma sala.',
  'Confundir com o perfil de parede (montante/guia): o F530 é de forro.', 7),
 ('projetos.calculadora.cod.tabica', 'Glossário técnico', 'Tabica',
  'Perfil de acabamento no perímetro do forro, no encontro do teto com a parede.',
  'Fecha a borda do forro e dá o acabamento; entra pelo perímetro do ambiente.',
  'A moldura em volta de um teto de gesso.',
  'Esquecer o perímetro e faltar tabica no acabamento.', 8),
 ('projetos.calculadora.cod.nervura', 'Glossário técnico', 'Nervura',
  'Barra que forma a estrutura do forro aramado, posicionada ao longo do comprimento.',
  'Sustenta as chapas no forro aramado.',
  'Forro aramado de uma área externa coberta.',
  'Confundir forro aramado com o F530 — a nervura é do aramado.', 9),
 ('projetos.calculadora.cod.juncao_h', 'Glossário técnico', 'Junção H',
  'Peça em formato de H que une duas chapas do forro aramado lado a lado.',
  'Emenda as placas do forro aramado mantendo o alinhamento.',
  'O encontro de duas chapas no meio do forro aramado.',
  'Deixar a emenda sem a junção H — as chapas desalinham.', 10)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
