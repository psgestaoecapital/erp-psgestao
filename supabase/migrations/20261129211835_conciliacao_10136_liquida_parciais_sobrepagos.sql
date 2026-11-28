-- NÚCLEO FINANCEIRO · chamado #10136 (Jordana TRAVADA) · correção de dado de cliente
-- CAUSA-RAIZ (RD-38, provada no dado de produção): títulos que receberam o valor original
-- INTEIRO (valor_pago >= valor − desconto) ficaram presos em status='parcial'. Eram fechados
-- antes da regra viva #10136 (migration 20261121130120_status_liquida_valor_original_10136),
-- ou pela conciliação agrupada que só aplicava o juros ao título-âncora. A regra correta já
-- vive em fn_trg_status_lancamento: valor_pago >= valor original líquido ⇒ 'pago' (o juros/multa
-- de atraso NÃO forçam parcial). Esta migration reconcilia os títulos JÁ pagos que ficaram para trás.
--
-- ESCOPO (provado 2026-11-24): só 2 títulos ATIVOS em erp_receber (IGP CEREAIS 138/138;
--   OS-2026-0305 1440/1440). erp_pagar: 0. O título Proplay/MBOX (juros 2289,55) está
--   soft-deletado (deleted_at) e por isso NÃO é tocado (nunca mexemos em dado excluído).
-- Condição idempotente: status='parcial' AND valor_pago >= valor−desconto AND deleted_at IS NULL.
--   Após rodar, 0 linhas batem a condição ⇒ re-execução é no-op.
-- SEGURANÇA: aditiva quanto à estrutura; a única escrita é a CORREÇÃO de status de títulos
--   comprovadamente liquidados por inteiro. Cópia de segurança ANTES (reversível) e o gatilho
--   BEFORE (trg_status_*) revalida a regra viva — status só vira 'pago' se valor_pago>=original.
--   O gatilho só dispara em UPDATE OF status/valor_pago/... (updated_at sozinho não reabre nada).

-- 1) Cópia de segurança (idempotente): guarda o estado ANTES só dos títulos que vão mudar.
CREATE TABLE IF NOT EXISTS public.erp_receber_bkp_10136 (
  id uuid, company_id uuid, valor numeric, desconto numeric, juros numeric, multa numeric,
  valor_pago numeric, status text, data_pagamento date, backup_em timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.erp_pagar_bkp_10136 (
  id uuid, company_id uuid, valor numeric, desconto numeric, juros numeric, multa numeric,
  valor_pago numeric, status text, data_pagamento date, backup_em timestamptz DEFAULT now()
);
REVOKE ALL ON TABLE public.erp_receber_bkp_10136 FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.erp_pagar_bkp_10136   FROM PUBLIC, anon;

INSERT INTO public.erp_receber_bkp_10136 (id, company_id, valor, desconto, juros, multa, valor_pago, status, data_pagamento)
SELECT id, company_id, valor, desconto, juros, multa, valor_pago, status, data_pagamento
  FROM public.erp_receber r
 WHERE r.status='parcial'
   AND round(coalesce(r.valor_pago,0),2) >= round(coalesce(r.valor,0)-coalesce(r.desconto,0),2)
   AND r.deleted_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.erp_receber_bkp_10136 b WHERE b.id = r.id);

INSERT INTO public.erp_pagar_bkp_10136 (id, company_id, valor, desconto, juros, multa, valor_pago, status, data_pagamento)
SELECT id, company_id, valor, desconto, juros, multa, valor_pago, status, data_pagamento
  FROM public.erp_pagar p
 WHERE p.status='parcial'
   AND round(coalesce(p.valor_pago,0),2) >= round(coalesce(p.valor,0)-coalesce(p.desconto,0),2)
   AND p.deleted_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.erp_pagar_bkp_10136 b WHERE b.id = p.id);

-- 2) Correção: marca 'pago' por CONDIÇÃO. O SET status=... dispara trg_status_* (BEFORE), que
--    revalida pela regra viva; data_pagamento preservada quando já existe.
UPDATE public.erp_receber
   SET status='pago', data_pagamento = COALESCE(data_pagamento, CURRENT_DATE), updated_at = now()
 WHERE status='parcial'
   AND round(coalesce(valor_pago,0),2) >= round(coalesce(valor,0)-coalesce(desconto,0),2)
   AND deleted_at IS NULL;

UPDATE public.erp_pagar
   SET status='pago', data_pagamento = COALESCE(data_pagamento, CURRENT_DATE), updated_at = now()
 WHERE status='parcial'
   AND round(coalesce(valor_pago,0),2) >= round(coalesce(valor,0)-coalesce(desconto,0),2)
   AND deleted_at IS NULL;

-- 3) Prova RD-38 (no corpo da PR): após rodar,
--    SELECT count(*) FROM erp_receber WHERE status='parcial' AND valor_pago>=valor-desconto AND deleted_at IS NULL  ⇒ 0
--    (idem erp_pagar). O backup em erp_*_bkp_10136 guarda o estado anterior para reversão.
