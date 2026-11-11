-- Produtividade · Mapa do fluxo · editor ENTRA/SAI da raia (CEO 11/11, Frioeste)
-- RD-95: o editor novo (origem → saída + rendimento padrão por raia) tem botão e 4 campos. Esta migration
--   semeia os textos de ajuda ("?"). O "?" no .tsx (prod.mapa.entra_sai_editar / es_origem / es_saida /
--   es_tipo / es_rendimento) acompanha nesta mesma PR.
--
-- Aditiva e idempotente (ON CONFLICT DO NOTHING). Só INSERT de texto de ajuda; NÃO altera função, RLS, nem
-- dado de cliente. Faixa de segundos do desenvolvedor_4_g (:45).

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/produtividade/mapa', 'industria', 'publicado'
FROM (VALUES
 ('prod.mapa.entra_sai_editar', 'Entra/Sai', 'Editar Entra / Sai da raia',
  'Toque para abrir o editor e dizer o que ENTRA (produto de origem) e o que SAI (produtos finais) nesta raia, com o rendimento de cada saída.',
  'É o que monta a estrutura de desmontagem da planta (prod_estrutura): origem → saídas com rendimento. Serve de base para o custo por kg do produto final.',
  'Na raia da desossa: entra "Bola" e saem "Coxão mole", "Osso" e "Sebo", cada um com seu rendimento.',
  'Procurar o cadastro de origem/saída em outra tela: aqui, na própria raia, é onde se liga entra e sai.', 10),
 ('prod.mapa.es_origem', 'Entra/Sai', 'Entra (produto de origem)',
  'Escolha o produto que ENTRA nesta raia para ser desmontado. Use a busca por código ou nome.',
  'É o ponto de partida do rendimento: as saídas desta raia são frações deste produto de origem.',
  'Bola com alcatra (código 284).',
  'Escolher um produto final como origem: a origem é a peça que entra inteira, antes de cortar.', 11),
 ('prod.mapa.es_saida', 'Entra/Sai', 'Sai (produto final)',
  'Escolha um produto que SAI desta raia a partir da origem. Repita a ligação para cada saída (pode ter várias).',
  'Cada saída recebe um rendimento; a soma das saídas de uma mesma origem deve ficar perto de 100%.',
  'Coxão mole resfriado (código 47).',
  'Esquecer saídas: osso, sebo e aparas também são saídas — sem elas a soma não fecha 100%.', 12),
 ('prod.mapa.es_tipo', 'Entra/Sai', 'Tipo de saída',
  'Diga se a saída é o produto Principal da raia, um Coproduto (também tem valor) ou um Subproduto (resíduo/aparas).',
  'Classifica o que sai para os relatórios de rendimento e, depois, para ratear o custo entre as saídas.',
  'Coxão mole = Principal; sebo = Subproduto.',
  'Marcar tudo como Principal: o tipo ajuda a separar o que é produto de venda do que é resíduo.', 13),
 ('prod.mapa.es_rendimento', 'Entra/Sai', 'Rendimento padrão (%)',
  'Quanto desta saída rende sobre a origem, em %. Pode deixar em branco ("a medir") e preencher depois.',
  'É o rendimento PADRÃO (teórico/histórico) por par origem→saída; depois o sistema compara com o rendimento REAL do período.',
  'Se de 100 kg de bola saem 47 kg de coxão mole, o rendimento é 47%.',
  'Somar passando de 100%: o sistema avisa quando a soma das saídas de uma origem passa de 100%.', 14)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
