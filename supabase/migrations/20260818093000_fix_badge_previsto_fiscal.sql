-- Fix RD-58 · remove o badge "PREVISTO" de telas fiscais que JÁ funcionam
--
-- Sintoma: todo o grupo "Notas Fiscais" da sidebar mostrava "PREVISTO", mesmo com telas funcionais
-- (NF-e emitidas com notas autorizadas; NF-e recebidas listando as 51 notas · #1042). Badge que mente.
--
-- FONTE (auditada): NÃO é hardcode no frontend. O badge vem da RPC fn_modulos_sidebar_por_area, que
-- deriva o status de feature_catalog:
--     COALESCE((SELECT fc.status FROM feature_catalog fc WHERE fc.module_id = mc.id LIMIT 1), 'previsto')
-- Ou seja: módulo SEM linha no feature_catalog cai no DEFAULT 'previsto'. As telas fiscais funcionais
-- (fiscal_hub, fiscal_nfe_emitidas, fiscal_nfse_emitidas, fiscal_nfe_recebidas) não tinham linha → "Previsto".
--
-- Fix (dado, não código): cadastra essas 4 como status='pronto' → o badge passa a "Pronto" (verde), refletindo
-- a verdade. Os placeholders reais (/previsto/ · ge_prev_nf_importacao, ge_prev_nfse_tomadas, ge_prev_series_nf)
-- JÁ têm status='previsto' e continuam intocados. O badge só é visível a PS_ADMIN (dado interno), mas mentir
-- interno também é proibido (RD-58/RD-51).

INSERT INTO public.feature_catalog (id, module_id, area, titulo, status, percentual_pronto, descricao_executiva, descricao_tecnica, observacao)
VALUES
 ('fiscal_hub',           'fiscal_hub',           'gestao_empresarial', 'Hub Fiscal',     'pronto', 100,
  'Central fiscal com acesso a NF-e/NFS-e emitidas e recebidas.',                 'Landing /dashboard/fiscal.',                    'RD-58: tela funcional; badge deve refletir Pronto, nao Previsto'),
 ('fiscal_nfe_emitidas',  'fiscal_nfe_emitidas',  'gestao_empresarial', 'NFes Emitidas',  'pronto', 100,
  'Emissao e gestao de NF-e (notas autorizadas em uso).',                          'Tela /dashboard/fiscal/nfe.',                   'RD-58: tela funcional'),
 ('fiscal_nfse_emitidas', 'fiscal_nfse_emitidas', 'gestao_empresarial', 'NFSes Emitidas', 'pronto', 100,
  'Emissao e gestao de NFS-e.',                                                    'Tela /dashboard/fiscal/nfse.',                  'RD-58: tela funcional'),
 ('fiscal_nfe_recebidas', 'fiscal_nfe_recebidas', 'gestao_empresarial', 'NF-e Recebidas', 'pronto', 100,
  'Entrada de NF-e recebidas: lista, aplica XML, gera pagar, entrada de estoque e vincula item->OS.',
  'Tela /dashboard/fiscal/nfe-recebidas (#1042).',                                 'RD-58: tela funcional')
ON CONFLICT (id) DO UPDATE SET
  status = 'pronto', module_id = EXCLUDED.module_id, area = EXCLUDED.area, titulo = EXCLUDED.titulo,
  percentual_pronto = 100, descricao_executiva = EXCLUDED.descricao_executiva,
  descricao_tecnica = EXCLUDED.descricao_tecnica, observacao = EXCLUDED.observacao;
