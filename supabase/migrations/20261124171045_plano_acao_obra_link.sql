-- Hub · Plano de Ação 5W2H na obra (CEO 20/11 13:21, msg eng_chefe 112b6b3a) — FATIA DE BANCO
-- ============================================================================
-- "Passa o 5W2H também para o Hub de Projetos." A tela da Indústria (erp_plano_acao +
-- erp_plano_acao_reuniao) é o motor único — não se cria terceira versão. Esta fatia só
-- ADICIONA o elo opcional com a OBRA do Hub (projetos_obras), para depois a tela do Hub
-- filtrar "por obra" e o Cockpit da obra mostrar "Ações abertas desta obra". A coordenação
-- (msg 3311af33) pede adiantar a parte de banco enquanto a #5676 (gravação IA) não entra.
--
-- ADITIVA e IDEMPOTENTE: coluna nova nullable `obra_id` em ação e reunião, FK para
-- projetos_obras(id) ON DELETE SET NULL (apagar a obra não apaga a ação, só desliga o elo),
-- + índice parcial para o filtro/por-obra. NÃO renomeia nada; a tela da Indústria segue
-- idêntica (coluna opcional, invisível até ser usada). RLS por empresa das 2 tabelas já
-- existe (relrowsecurity=true) e cobre a coluna nova; nenhuma policy nova. Não toca dado
-- de cliente.
-- ============================================================================

-- 1) Ação do 5W2H → obra (opcional)
ALTER TABLE public.erp_plano_acao
  ADD COLUMN IF NOT EXISTS obra_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.erp_plano_acao'::regclass AND conname = 'erp_plano_acao_obra_id_fkey'
  ) THEN
    ALTER TABLE public.erp_plano_acao
      ADD CONSTRAINT erp_plano_acao_obra_id_fkey
      FOREIGN KEY (obra_id) REFERENCES public.projetos_obras(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_erp_plano_acao_obra
  ON public.erp_plano_acao (company_id, obra_id)
  WHERE obra_id IS NOT NULL AND excluido_em IS NULL;

-- 2) Reunião do 5W2H → obra (opcional) — "Onde" sugere a obra da reunião
ALTER TABLE public.erp_plano_acao_reuniao
  ADD COLUMN IF NOT EXISTS obra_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.erp_plano_acao_reuniao'::regclass AND conname = 'erp_plano_acao_reuniao_obra_id_fkey'
  ) THEN
    ALTER TABLE public.erp_plano_acao_reuniao
      ADD CONSTRAINT erp_plano_acao_reuniao_obra_id_fkey
      FOREIGN KEY (obra_id) REFERENCES public.projetos_obras(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_erp_plano_acao_reuniao_obra
  ON public.erp_plano_acao_reuniao (company_id, obra_id)
  WHERE obra_id IS NOT NULL AND excluido_em IS NULL;

COMMENT ON COLUMN public.erp_plano_acao.obra_id IS 'Obra do Hub (projetos_obras) ligada à ação 5W2H — opcional; ON DELETE SET NULL.';
COMMENT ON COLUMN public.erp_plano_acao_reuniao.obra_id IS 'Obra do Hub (projetos_obras) ligada à reunião 5W2H — opcional; ON DELETE SET NULL.';
