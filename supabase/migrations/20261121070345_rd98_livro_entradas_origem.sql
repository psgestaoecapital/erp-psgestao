-- RD-98 p3 (origem do dado): classifica /dashboard/commerce/livro-entradas.
-- A tela ja tinha TODAS as fontes registradas (views erp_nfe_recebidas,
-- erp_nfe_recebidas_itens, erp_nfe_recebidas_itens_tributo; rpcs fn_fiscal_livro_entradas,
-- fn_fiscal_exportacao_registrar + ajuda), mas seguia estado_real='desconhecida'. So metadado
-- de registro da tela — NAO altera comportamento, dado de cliente, RLS nem grants.
--
-- Fontes conferidas no codigo (RD-38), src/app/dashboard/commerce/livro-entradas/page.tsx:
--   rpcs: fn_fiscal_livro_entradas, fn_fiscal_exportacao_registrar ; componente AjudaCampo
--         (RD-95, 15 usos): fn_ajuda_campo_listar, fn_ajuda_campo_uso ; as 3 views ja presentes.
-- Nada falta -> apenas classifica estado_real='parcial' SO enquanto ainda 'desconhecida'.
-- ADITIVA e IDEMPOTENTE: reaplicar nao altera nada.
UPDATE public.system_screens
   SET estado_real = 'parcial',
       atualizado_em = now()
 WHERE rota = '/dashboard/commerce/livro-entradas'
   AND estado_real = 'desconhecida';
