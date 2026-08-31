-- FIX (RD-57) · cap_pagamento (remessa CNAB) NÃO pode ser alterada pela RPC de credencial de API.
-- INCIDENTE 31/08: fn_banco_salvar_credencial (RPC das telas de config de API) fazia, no UPDATE,
--   cap_pagamento = COALESCE(p_cap_pagamento, ...cap_pagamento)
-- e as telas mandavam p_cap_pagamento=false HARDCODED → todo save da config de API desligava a
-- remessa CNAB da empresa (quebrou a KGF/Jordana). COALESCE só protege contra NULL, não contra o
-- false explícito. Trava na RAIZ: a RPC de credencial de API deixa de tocar cap_pagamento no UPDATE.
-- cap_pagamento é capacidade de ARQUIVO CNAB — set/alterada por outro fluxo, nunca por esta RPC.
-- O INSERT (config nova) mantém COALESCE(p_cap_pagamento, false) — default seguro para config nova.
-- Idempotente: se a linha do UPDATE já não existir, não faz nada.

DO $$
DECLARE v_def text; v_new text; v_oc int;
  ancora text := E'\n      cap_pagamento = COALESCE(p_cap_pagamento, public.erp_banco_provider_config.cap_pagamento),';
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc
   WHERE proname='fn_banco_salvar_credencial' AND pronamespace='public'::regnamespace;
  IF v_def IS NULL THEN RAISE EXCEPTION 'fn_banco_salvar_credencial nao encontrada'; END IF;
  v_oc := (length(v_def) - length(replace(v_def, ancora, ''))) / length(ancora);
  IF v_oc = 0 THEN RETURN; END IF;                       -- já corrigida
  IF v_oc <> 1 THEN RAISE EXCEPTION 'esperava 1 ancora do UPDATE cap_pagamento, achei %', v_oc; END IF;
  v_new := replace(v_def, ancora, '');
  IF position('COALESCE(p_cap_pagamento, false)' IN v_new) = 0 THEN
    RAISE EXCEPTION 'removeria tambem o INSERT — abortado'; END IF;
  EXECUTE v_new;
END $$;
