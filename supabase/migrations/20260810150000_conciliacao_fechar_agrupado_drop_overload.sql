-- Hotfix #937: a nova fn_conciliacao_fechar_agrupado (com juros/multa/desconto/ajuste/observação DEFAULT)
-- foi criada como assinatura NOVA, colidindo com a antiga (uuid,uuid,numeric). Uma chamada de 3 args casava
-- com as duas → "function is not unique". Dropa a antiga; a nova cobre 3 args via defaults.
drop function if exists public.fn_conciliacao_fechar_agrupado(uuid, uuid, numeric);
