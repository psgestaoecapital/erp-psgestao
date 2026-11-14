-- Chamado #5167 (CRÍTICO · fiscal) · NF-e de REMESSA de bem do ATIVO IMOBILIZADO (uso fora do estabelecimento)
-- ====================================================================================================================
-- CONTEXTO (auditado pelo eng-chefe): o fn_remessa_* existente é remessa BANCÁRIA (títulos ao banco), não serve.
-- A NF-e de remessa fiscal REUSA o motor de NF-e que já emite (createFiscalService / svc.emitirNFe · Focus NFe), pela
-- rota JÁ existente /api/fiscal/nfe/remessa (+ RemessaClient.tsx). O único bloqueio para a operação de ATIVO
-- IMOBILIZADO era que faltavam os CFOP 5.554/6.554 no catálogo e um "tipo de remessa" que já aponte para eles.
--
-- ETAPA (a) desta sequência de PRs por etapa (revisao-eng-chefe):
--   1) acrescenta os CFOP de SAÍDA 5554 (dentro do estado) e 6554 (fora do estado) ao catálogo GLOBAL
--      erp_fiscal_cfop_saida (mesma forma dos demais: 4 dígitos sem ponto, ativo=true);
--   2) acrescenta um "tipo de remessa" GLOBAL (company_id IS NULL, como Comodato/Conserto/Demonstração) chamado
--      "Ativo imobilizado (uso fora do estabelecimento)" que já preenche natureza + CFOP dentro/fora na tela.
-- Com isso a tela /dashboard/fiscal/nfe/remessa passa a oferecer o atalho e o CFOP correto, sem tocar o emissor.
-- O caminho de RETORNO (entrada 1.554/2.554) e o controle "em remessa" (saiu e não voltou) ficam para a próxima etapa.
--
-- SEGURANÇA / RD-38:
--   · ADITIVA e IDEMPOTENTE: nada apaga/atualiza dado de cliente; só acrescenta linhas de catálogo fiscal NACIONAL
--     (os CFOP e os "tipos de remessa" já são globais — company_id IS NULL — e lidos por toda empresa).
--   · Não cria tabela/função nem toca RLS/grants: só INSERT de referência nos catálogos existentes.
--   · Prova no dado (BEGIN…ROLLBACK, statement_timeout curto): antes cfop{5554,6554}=0 e tipo=0; depois cfop=2 e
--     tipo=1 (total do catálogo 47 -> 49); re-rodar não duplica (ON CONFLICT (cfop) / WHERE NOT EXISTS). A tela leria
--     "Ativo imobilizado (uso fora do estabelecimento) | 5554/6554".
--   · Começa em HOMOLOGAÇÃO (como a emissão da Alliance): este PR não liga produção fiscal real — só habilita a
--     natureza de operação; a emissão segue pelo ambiente já configurado do emissor.

-- 1) CFOP de saída (catálogo global) — remessa de ativo imobilizado p/ uso fora do estabelecimento
INSERT INTO public.erp_fiscal_cfop_saida (cfop, descricao, natureza_sugerida, exige_referenciada, ativo) VALUES
  ('5554', 'Remessa de bem do ativo imobilizado para uso fora do estabelecimento',                    'Remessa de ativo imobilizado', false, true),
  ('6554', 'Remessa de bem do ativo imobilizado para uso fora do estabelecimento (fora do estado)',   'Remessa de ativo imobilizado', false, true)
ON CONFLICT (cfop) DO NOTHING;

-- 2) Tipo de remessa global (atalho da tela): preenche natureza + CFOP dentro/fora automaticamente
INSERT INTO public.erp_fiscal_remessa_tipos (company_id, nome, natureza, cfop_dentro, cfop_fora, ativo)
SELECT NULL,
       'Ativo imobilizado (uso fora do estabelecimento)',
       'Remessa de bem do ativo imobilizado para uso fora do estabelecimento',
       '5554', '6554', true
WHERE NOT EXISTS (
  SELECT 1 FROM public.erp_fiscal_remessa_tipos
   WHERE company_id IS NULL
     AND nome = 'Ativo imobilizado (uso fora do estabelecimento)'
);
