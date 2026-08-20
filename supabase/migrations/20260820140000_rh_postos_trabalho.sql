-- Módulo RH · 4 tabelas do "Postos de Trabalho" (destino da importação da planilha Frioeste).
-- Genérico (serve qualquer empresa). Pilar 1 (trabalhista/financeiro) + Pilar 2/LGPD (remuneração sensível).
--
-- Decisões do CEO (confirmadas 20/08):
--  • FKs: setor_id → compliance_setores(id) uuid; funcionario_id → compliance_funcionarios(id) uuid.
--  • custo_total (GENERATED): encargos incidem sobre (salario_base + insalubridade), NÃO sobre o vale
--    (vale é benefício). Fórmula: (base+insal)*(1+encargos_pct/100) + vale + outros. O import calcula
--    encargos_pct por linha contra a MESMA base (base+insal) pra reproduzir o R$ TOTAL exato (achado 3).
--  • LGPD: rh_remuneracao só é lida/escrita por RH (rh_industrial) + sócio + admin. Fail-closed.
--    As demais tabelas (posto/alocação/movimentação) = gate multi-tenant padrão (headcount, não salário).

-- ── 1) Posto de trabalho ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rh_posto_trabalho (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL,
  codigo_po         text,
  setor_id          uuid REFERENCES public.compliance_setores(id),
  centro_custo      text,
  categoria_produto text,
  tipo              text,                                   -- Manual / Misto / Adm
  atividade         text,
  supervisao        text,
  qtd_proj_t1       integer NOT NULL DEFAULT 0,
  qtd_proj_t2       integer NOT NULL DEFAULT 0,
  qtd_proj_t3       integer NOT NULL DEFAULT 0,
  qtd_proj_total    integer NOT NULL DEFAULT 0,
  cargo             text,
  custo_projetado   jsonb   NOT NULL DEFAULT '{}'::jsonb,   -- { variavel, insal_pct, ... } (projetado, completa depois)
  ativo             boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rh_posto_company ON public.rh_posto_trabalho(company_id);
CREATE INDEX IF NOT EXISTS idx_rh_posto_setor   ON public.rh_posto_trabalho(setor_id);

-- ── 2) Alocação (funcionário ↔ posto — SEM salário) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.rh_alocacao (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL,
  posto_id       uuid NOT NULL REFERENCES public.rh_posto_trabalho(id) ON DELETE CASCADE,
  funcionario_id uuid REFERENCES public.compliance_funcionarios(id),   -- resolvido por CPF do ponto (achado 2)
  funcao_real    text,
  qtd_real       integer NOT NULL DEFAULT 1,
  turno          text NOT NULL DEFAULT 'T1',                            -- planilha não separa turno no real
  ativo          boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rh_aloc_company ON public.rh_alocacao(company_id);
CREATE INDEX IF NOT EXISTS idx_rh_aloc_posto   ON public.rh_alocacao(posto_id);
CREATE INDEX IF NOT EXISTS idx_rh_aloc_func    ON public.rh_alocacao(funcionario_id);

-- ── 3) Remuneração (SENSÍVEL · LGPD) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rh_remuneracao (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  alocacao_id   uuid NOT NULL REFERENCES public.rh_alocacao(id) ON DELETE CASCADE,
  salario_base  numeric(14,2) NOT NULL DEFAULT 0,
  insalubridade numeric(14,2) NOT NULL DEFAULT 0,
  vale          numeric(14,2) NOT NULL DEFAULT 0,
  outros        numeric(14,2) NOT NULL DEFAULT 0,
  encargos_pct  numeric(7,4)  NOT NULL DEFAULT 43,           -- default só p/ cadastro manual novo; import calcula por linha
  -- Encargos sobre (base+insal); vale/outros somam ao total sem gerar encargo. Escala 2 arredonda no store.
  custo_total   numeric(14,2) GENERATED ALWAYS AS (
                  (salario_base + insalubridade) * (1 + encargos_pct / 100.0) + vale + outros
                ) STORED,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rh_remun_company ON public.rh_remuneracao(company_id);
CREATE INDEX IF NOT EXISTS idx_rh_remun_aloc    ON public.rh_remuneracao(alocacao_id);

-- ── 4) Movimentação (histórico — baseline na importação) ────────────────────
CREATE TABLE IF NOT EXISTS public.rh_movimentacao (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL,
  alocacao_id    uuid REFERENCES public.rh_alocacao(id) ON DELETE SET NULL,
  remuneracao_id uuid REFERENCES public.rh_remuneracao(id) ON DELETE SET NULL,
  tipo           text NOT NULL,                             -- importacao_inicial, admissao, alteracao_salarial, desligamento...
  motivo         text,
  dados          jsonb NOT NULL DEFAULT '{}'::jsonb,        -- snapshot do estado no momento
  registrado_por uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rh_mov_company ON public.rh_movimentacao(company_id);
CREATE INDEX IF NOT EXISTS idx_rh_mov_aloc    ON public.rh_movimentacao(alocacao_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.rh_posto_trabalho ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_alocacao       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_remuneracao    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_movimentacao   ENABLE ROW LEVEL SECURITY;

-- Não-sensíveis: gate multi-tenant padrão (qualquer usuário da empresa).
CREATE POLICY rh_posto_tenant ON public.rh_posto_trabalho FOR ALL
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
CREATE POLICY rh_aloc_tenant ON public.rh_alocacao FOR ALL
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
CREATE POLICY rh_mov_tenant ON public.rh_movimentacao FOR ALL
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- Remuneração (LGPD, fail-closed): só RH (rh_industrial) + sócio + admin — leitura E escrita.
CREATE POLICY rh_remun_rh_only ON public.rh_remuneracao FOR ALL
  USING (
    is_admin() OR EXISTS (
      SELECT 1 FROM user_companies uc
      WHERE uc.company_id = rh_remuneracao.company_id
        AND uc.user_id = auth.uid()
        AND uc.role IN ('rh_industrial', 'socio')
    )
  )
  WITH CHECK (
    is_admin() OR EXISTS (
      SELECT 1 FROM user_companies uc
      WHERE uc.company_id = rh_remuneracao.company_id
        AND uc.user_id = auth.uid()
        AND uc.role IN ('rh_industrial', 'socio')
    )
  );

REVOKE ALL ON public.rh_remuneracao FROM anon;
