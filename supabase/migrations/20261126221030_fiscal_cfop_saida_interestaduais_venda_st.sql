-- NÚCLEO — completa erp_fiscal_cfop_saida com os CFOPs INTERESTADUAIS (6xxx) de saída que faltavam.
--
-- CAUSA (RD-38): o catálogo tinha só 4 interestaduais (6107, 6108, 6554, 6949) — faltava 6102 (venda a contribuinte
-- de outra UF) e os demais espelhos de venda/transferência/devolução/ST/remessa. O auto-swap por UF (escopoCfop /
-- ajustarCfopEscopo) já deriva o 6xxx do 5xxx escolhido, mas o 6xxx não era SELECIONÁVEL explicitamente no form.
--
-- Aditiva e idempotente: NÃO altera nem remove nenhum dos 49 CFOPs atuais (ON CONFLICT (cfop) DO NOTHING). A tabela já
-- tem RLS/REVOKE (migration 20261027010020) — aqui só entram linhas. O auto-swap por UF segue valendo.
--
-- Espelho 1:1 (6 = 5 com o mesmo final), reaproveitando descrição/natureza/exige_referenciada do interno — com DUAS
-- exceções fiscais, excluídas do espelho automático:
--   • 5405 (ST, contribuinte substituído): o interestadual correto é 6404 (imposto já retido), não 6405 — ver
--     src/lib/fiscal/nfe-builder.ts ("5405 virava 6405, que não existe — o certo é 6404"). 6404 entra explícito.
--   • 5927 (baixa de estoque por perda/roubo/deterioração): operação só interna; não existe 6927.
INSERT INTO public.erp_fiscal_cfop_saida (cfop, descricao, natureza_sugerida, exige_referenciada, ativo)
SELECT '6' || substr(s.cfop, 2),
       s.descricao || ' (operação interestadual)',
       s.natureza_sugerida,
       s.exige_referenciada,
       true
  FROM public.erp_fiscal_cfop_saida s
 WHERE s.cfop LIKE '5%'
   AND s.cfop NOT IN ('5405', '5927')
ON CONFLICT (cfop) DO NOTHING;

-- ST, contribuinte substituído, interestadual (espelho correto do 5405):
INSERT INTO public.erp_fiscal_cfop_saida (cfop, descricao, natureza_sugerida, exige_referenciada, ativo)
VALUES ('6404',
        'Venda de mercadoria sujeita ao regime de substituição tributária, cujo imposto já foi retido anteriormente (operação interestadual)',
        'Venda de mercadoria', false, true)
ON CONFLICT (cfop) DO NOTHING;
