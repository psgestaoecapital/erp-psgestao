-- ARQUITETURA · Grupo empresarial no P&M (tarefa 373a6b77, DECISÃO eng_chefe 08/11) — empresa de PRODUÇÃO do grupo
-- ====================================================================================================================
-- DECISÃO do Eng. Chefe (caixa desenvolvedor_4_g, aviso 46adf4ea): a entidade canônica do grupo é COMPANY_GROUPS.
-- Verificado no banco (RD-38): company_groups (7 linhas) é a referenciada por operator_clients, bpo_sla_config e pela
-- tabela de membros dashboard_grupos_empresas (grupo_id -> company_groups). A tabela dashboard_grupos (7 linhas) é
-- ÓRFÃ (0 FK aponta pra ela) — NÃO é usada aqui e NÃO é tocada (RD-30: não apagar duplicata morta).
--
-- No grupo empresarial do P&M a empresa FATURA onde vende, mas PRODUZ num único CNPJ. Este campo guarda qual é a
-- empresa de PRODUÇÃO padrão do grupo. A empresa de FATURAMENTO continua sendo a company que emite a NF — a entidade
-- FISCAL NÃO é alterada por esta migration.
--
-- SEGURANÇA / RD-38 / RD-41:
--   · ADITIVA e IDEMPOTENTE: só acrescenta 1 coluna NULLABLE + 1 FK + 1 índice, todos IF NOT EXISTS / guardados.
--     Não altera/apaga coluna, dado, RLS, grant, policy ou função existente. Não mexe na entidade fiscal nem no
--     financeiro de cliente. Rodar de novo não faz efeito.
--   · FK NULLABLE -> public.companies(id) com ON DELETE SET NULL (apagar a company de produção só zera o ponteiro do
--     grupo; não cascateia nem apaga o grupo).
--   · company_groups é cadastro de configuração do grupo, não dado financeiro de cliente.

-- Coluna: empresa de PRODUÇÃO padrão do grupo (NULLABLE).
ALTER TABLE public.company_groups
  ADD COLUMN IF NOT EXISTS empresa_producao_id uuid;

-- FK -> companies(id), idempotente (adiciona só se ainda não existir).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'company_groups_empresa_producao_id_fkey'
      AND conrelid = 'public.company_groups'::regclass
  ) THEN
    ALTER TABLE public.company_groups
      ADD CONSTRAINT company_groups_empresa_producao_id_fkey
      FOREIGN KEY (empresa_producao_id) REFERENCES public.companies(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Índice para o join por empresa de produção.
CREATE INDEX IF NOT EXISTS idx_company_groups_empresa_producao
  ON public.company_groups (empresa_producao_id)
  WHERE empresa_producao_id IS NOT NULL;

COMMENT ON COLUMN public.company_groups.empresa_producao_id IS
  'Empresa de PRODUÇÃO padrão do grupo (FK -> companies). A empresa de FATURAMENTO é a company que emite a NF; a entidade fiscal não é afetada por este campo. NULLABLE.';
