-- Chamado #3269 (Tryo) — validade do orçamento = emissão + N dias, configurável por empresa.
-- RD-97: ADITIVO. Coluna nova NULLABLE sem default em tabela existente; NULL = comportamento atual (15 dias).
-- Nenhuma empresa muda sem configurar. Plano de volta: ALTER TABLE ... DROP COLUMN validade_dias (ninguém depende
-- dela fora da tela de orçamentos; limpar o valor na tela já devolve o padrão de 15 dias).
ALTER TABLE public.erp_orcamento_numeracao
  ADD COLUMN IF NOT EXISTS validade_dias integer;
ALTER TABLE public.erp_orcamento_numeracao
  DROP CONSTRAINT IF EXISTS erp_orcamento_numeracao_validade_dias_chk;
ALTER TABLE public.erp_orcamento_numeracao
  ADD CONSTRAINT erp_orcamento_numeracao_validade_dias_chk
  CHECK (validade_dias IS NULL OR validade_dias BETWEEN 1 AND 365);

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT 'orcamento.validade_dias', 'Orçamento', 'Validade (dias)',
  'Quantos dias o orçamento vale a partir da emissão. Deixe vazio para manter o padrão de 15 dias.',
  'A data de validade de todo orçamento novo da empresa sai sozinha como emissão + estes dias. Orçamentos já criados não mudam.',
  'Preencheu 5: orçamento emitido em 20/10 vence em 25/10.',
  'Achar que muda os orçamentos antigos: só vale para os novos, e a data ainda pode ser ajustada em cada orçamento.',
  20, '/dashboard/orcamentos', 'hub', 'publicado'
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
