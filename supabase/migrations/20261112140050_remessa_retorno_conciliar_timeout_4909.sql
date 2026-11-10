-- #4909 (URGENTE Gean): "Importar retorno" (remessa de pagamento CNAB) dava
-- "canceling statement due to statement timeout" ao confirmar a baixa e NADA era gravado.
-- Causa: a função orquestradora fn_remessa_retorno_conciliar_auto roda sob o
-- statement_timeout do papel authenticated (8s). É um lote financeiro: para cada item
-- casa o título, consulta o efeito da ocorrência (fn_remessa_ocorrencia_efeito) e baixa
-- (fn_pagar_baixar_pagamento), que dispara vários triggers AFTER UPDATE em erp_pagar
-- (auditoria, outbox, fila PSGC, guarda de valor_pago). Sob contenção, o lote de ~10
-- pagamentos pode ultrapassar 8s e é morto no meio — como a função é UMA chamada
-- (SELECT fn(...)), o timeout reverte TUDO (nenhuma baixa parcial), e o usuário fica sem
-- conseguir importar o retorno.
-- Prova (RD-38, 10/11, cópia de produção, BEGIN…ROLLBACK): uma baixa real da Gean com
-- todos os triggers = 25,3 ms; o SELECT de casamento usa índice (pkey de erp_pagar), custo ~116.
-- Ou seja, o caminho é barato hoje; o 8s genérico da web é o teto que mata o lote num pico.
-- Correção (aditiva, mínima, não muda o corpo): dar à função SECURITY DEFINER o seu próprio
-- statement_timeout=60s (e lock_timeout=15s), que prevalece sobre os 8s do papel enquanto ela
-- executa. Não altera numeração, séries, triggers nem o resultado — só o teto de tempo.
-- Idempotente: ALTER FUNCTION ... SET sobrescreve o valor existente.
ALTER FUNCTION public.fn_remessa_retorno_conciliar_auto(uuid, jsonb, boolean)
  SET statement_timeout = '60s';
ALTER FUNCTION public.fn_remessa_retorno_conciliar_auto(uuid, jsonb, boolean)
  SET lock_timeout = '15s';
