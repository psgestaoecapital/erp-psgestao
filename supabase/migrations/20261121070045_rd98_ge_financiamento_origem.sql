-- RD-98 p3 (origem do dado): classifica /dashboard/gestao-empresarial/financiamento.
-- A tela ja tinha TODAS as fontes registradas (views e rpcs), incluindo as dos componentes
-- filhos, mas seguia estado_real='desconhecida'. So metadado de registro da tela — NAO altera
-- comportamento, dado de cliente, RLS nem grants.
--
-- Fontes conferidas no codigo (RD-38):
--   src/app/dashboard/gestao-empresarial/financiamento/page.tsx:
--     views: financiamento_parcelas, financiamentos ; rpcs: fn_financiamento_gerar_cronograma,
--     fn_financiamento_gerar_pagar, fn_financiamento_recalcular, fn_financiamento_situacao,
--     fn_financiamentos_kpis
--   componente AjudaCampo (RD-95): fn_ajuda_campo_listar, fn_ajuda_campo_uso
--   componente FinanciamentoFormModal: from('financiamentos'), rpc fn_financiamento_gerar_cronograma,
--     fn_financiamento_recalcular
--   (erp_lancamentos ja presente no registro) — todas ja estao em views_consumidas/rpcs_chamadas.
--
-- Como nada falta, esta migration apenas classifica estado_real='parcial' SO enquanto ainda
-- 'desconhecida'. ADITIVA e IDEMPOTENTE: reaplicar nao altera nada.
UPDATE public.system_screens
   SET estado_real = 'parcial',
       atualizado_em = now()
 WHERE rota = '/dashboard/gestao-empresarial/financiamento'
   AND estado_real = 'desconhecida';
