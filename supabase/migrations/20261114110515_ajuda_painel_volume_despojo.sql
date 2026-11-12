-- Painel de vendas Frioeste · ajuda "?" do card de Volume explica o DESPOJO (CEO 12/11, tarefa b231e426)
-- O card passou a mostrar "Volume sem despojo" (entra na análise de preço) com a linha
-- "total com despojo" (inclui couro, osso, sebo, vísceras e aparas do abate). O "?" precisa
-- dizer o que é despojo e por que o preço médio (R$/kg) usa o volume SEM despojo.
--
-- Aditiva e idempotente: só reescreve o texto de ajuda da chave JÁ EXISTENTE
-- 'com.painel.volume' (catálogo global de ajuda — não há dado de cliente aqui).
-- RD-38: a prova de 1 linha afetada está no corpo da PR (BEGIN/ROLLBACK).

UPDATE public.erp_ajuda_campo
SET
  o_que_preencher = 'Indicador calculado — não se preenche.',
  para_que_serve  = 'Peso vendido no período. "Volume sem despojo" é o peso que entra na análise de preço (a carne e os produtos finais). O "total com despojo" soma também couro, osso, sebo, vísceras e aparas — o que sobra do abate e vale pouco por quilo. O preço médio (R$/kg) usa o volume SEM despojo para não ser puxado para baixo por esses subprodutos.',
  exemplo         = 'Sem despojo 351,6 t · total com despojo 599,4 t.',
  erro_comum      = 'Dividir o faturamento pelo volume TOTAL (com despojo) dá um preço médio artificialmente baixo. O preço usa só o volume sem despojo.',
  atualizado_em   = now()
WHERE chave = 'com.painel.volume';
