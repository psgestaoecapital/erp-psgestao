-- RD-98 p3 (origem do dado): classifica /dashboard/commerce/reforma.
-- A tela ja tinha TODAS as fontes registradas (view erp_nfe_recebidas; rpcs
-- fn_fiscal_reforma_painel + ajuda), mas seguia estado_real='desconhecida'. So metadado de
-- registro da tela — NAO altera comportamento, dado de cliente, RLS nem grants.
--
-- Fontes conferidas no codigo (RD-38), src/app/dashboard/commerce/reforma/page.tsx:
--   rpcs: fn_fiscal_reforma_painel ; componente AjudaCampo (RD-95, 8 usos):
--         fn_ajuda_campo_listar, fn_ajuda_campo_uso ; view erp_nfe_recebidas ja presente.
-- Nada falta -> apenas classifica estado_real='parcial' SO enquanto ainda 'desconhecida'.
-- ADITIVA e IDEMPOTENTE: reaplicar nao altera nada.
UPDATE public.system_screens
   SET estado_real = 'parcial',
       atualizado_em = now()
 WHERE rota = '/dashboard/commerce/reforma'
   AND estado_real = 'desconhecida';
