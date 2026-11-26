-- Hub · Cockpit da obra (tela 314/329) — ajuda do indicador "Custo por m²".
-- Blueprint vivo hub_projetos tela 329 (prontuário), requisito cbde929d:
--   "Indicadores da obra: ... custo atualizado por m² ...".
-- Fatia front-only acrescenta o indicador "Custo por m²" no cockpit; esta migration só
-- cadastra o texto do "?" (RD-95) em erp_ajuda_campo. ADITIVA e IDEMPOTENTE: nada é
-- alterado/apagado; re-rodar não duplica (WHERE NOT EXISTS pela chave).
INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, versao, status)
SELECT
  'projetos.cockpit.custo_m2',
  '/dashboard/projetos/obras/[id]/cockpit',
  'Cockpit da obra',
  'Custo por m²',
  'Nada a preencher: é o custo realizado da obra dividido pela área construída da ficha.',
  'Mostra quanto a obra já custou por metro quadrado construído, para comparar com o CUB e com outras obras.',
  'Custo realizado R$ 500.000 ÷ 1.000 m² de área construída = R$ 500,00 por m².',
  'Vir vazio: aparece só quando há custo lançado e a área construída preenchida na Ficha da obra.',
  912,
  1,
  'publicado'
WHERE NOT EXISTS (SELECT 1 FROM erp_ajuda_campo WHERE chave = 'projetos.cockpit.custo_m2');
