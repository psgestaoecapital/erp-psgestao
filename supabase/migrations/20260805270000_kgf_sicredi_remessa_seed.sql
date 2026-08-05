-- RD-41 · KGF (a462e13f) · Sicredi 748 — número sequencial da remessa (NSA) editável, com SEED.
-- Problema (RD-38): o Sicredi controla a remessa pelo Número Sequencial do Arquivo (NSA, header pos 158-163).
-- O sistema anterior (Omie) já enviou até a remessa 47. Nosso erp_remessa_pagamento está vazio, então
-- fn_remessa_proxima_numeracao (max+1) geraria 1 → o Sicredi recusa por número fora de sequência.
--
-- FIX1: campo de partida por provider (remessa_ultimo_numero) + a próxima numeração passa a ser
--       GREATEST(max(numero_sequencial nosso), seed do provider) + 1. Semeamos a KGF/Sicredi com 47 → próxima = 48.
--       Depois que a 48 for gravada, max=48 assume o controle e o seed vira irrelevante (sequência mantida).

-- 1) Coluna de partida (bridge da numeração do sistema anterior). Idempotente.
ALTER TABLE public.erp_banco_provider_config
  ADD COLUMN IF NOT EXISTS remessa_ultimo_numero integer;

COMMENT ON COLUMN public.erp_banco_provider_config.remessa_ultimo_numero IS
  'Último NSA (número sequencial de remessa) já enviado ao banco por FORA do ERP (ex.: sistema anterior). '
  'Piso para fn_remessa_proxima_numeracao; após a 1ª remessa gerada aqui, o histórico assume o controle.';

-- 2) Seed KGF/Sicredi = 47 (Omie: "Última Remessa Enviada: 47" → próxima 48). Só semeia se ainda estiver vazio,
--    para não sobrescrever um valor já ajustado manualmente pela Jordana.
UPDATE public.erp_banco_provider_config
   SET remessa_ultimo_numero = 47, updated_at = now()
 WHERE company_id = 'a462e13f-0f51-4c54-abe8-4474b591633b'
   AND provider   = 'sicredi'
   AND remessa_ultimo_numero IS NULL;

-- 3) Próxima numeração = GREATEST(nosso histórico, seed do provider) + 1.
CREATE OR REPLACE FUNCTION public.fn_remessa_proxima_numeracao(p_company uuid, p_banco uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT GREATEST(
    coalesce((SELECT max(numero_sequencial)
                FROM public.erp_remessa_pagamento
               WHERE company_id = p_company
                 AND banco_provider_id IS NOT DISTINCT FROM p_banco), 0),
    coalesce((SELECT remessa_ultimo_numero
                FROM public.erp_banco_provider_config
               WHERE id = p_banco), 0)
  ) + 1;
$function$;
