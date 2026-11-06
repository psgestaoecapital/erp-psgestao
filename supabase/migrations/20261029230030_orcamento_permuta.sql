-- Chamado #5165 (Tryo Gesso) · Controle de permuta no orçamento.
-- Aditiva: 2 colunas novas em erp_orcamentos (default false / nula) — nenhum dado existente muda.
-- RLS/policies da tabela não são tocadas.
ALTER TABLE public.erp_orcamentos
  ADD COLUMN IF NOT EXISTS eh_permuta boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS permuta_percentual numeric(5,2);

ALTER TABLE public.erp_orcamentos
  DROP CONSTRAINT IF EXISTS erp_orcamentos_permuta_pct_chk;
ALTER TABLE public.erp_orcamentos
  ADD CONSTRAINT erp_orcamentos_permuta_pct_chk
  CHECK (permuta_percentual IS NULL OR (permuta_percentual >= 0 AND permuta_percentual <= 100)) NOT VALID;

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, status) VALUES
 ('orcamentos.campo.eh_permuta', '/dashboard/orcamentos', 'Orçamento', 'Condição de permuta',
  'Marque se o pagamento deste orçamento será feito, no todo ou em parte, por permuta (troca de bens ou serviços).',
  'Não altera o total do orçamento; registra a condição para o fechamento e para a conferência do financeiro.',
  'Obra paga 30% em troca de materiais → marque Permuta e informe 30.',
  'Marcar permuta e esquecer o percentual: informe quanto do valor é pago por troca.',
  'gestao_empresarial', 'publicado'),
 ('orcamentos.campo.permuta_percentual', '/dashboard/orcamentos', 'Orçamento', 'Percentual de permuta',
  'Quanto do valor do orçamento é pago por permuta, de 0 a 100%.',
  'Fica registrado no orçamento; o total continua o mesmo.',
  '30 → 30% do valor é pago por troca.',
  'Digitar o valor em reais em vez do percentual.',
  'gestao_empresarial', 'publicado')
ON CONFLICT (chave) DO NOTHING;
