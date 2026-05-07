-- supabase/migrations/20260507130755_pr_w4_parte_0_foundational_operadores.sql
-- PR-W4 BLOCO 1 (PARTE 0) — Foundational Operadores Wealth MFO
--
-- Cria wealth_consultores (papeis: consultor/operador/compliance), corrige
-- Airton (company_id NULL), trava wealth_clients.company_id NOT NULL,
-- substitui RLS legacy "consultor" por nova RLS "operador" via funcao
-- fn_wealth_user_eh_operador, e cadastra Stephany e Gilberto como
-- consultores PS + wealth_clients PF (carteiras piloto OFX/Pluggy).
--
-- Autorizacao: CEO Gilberto Paravizi (Estrela Polar Secao 4 V1.2).

BEGIN;

-- 0.1 Tabela wealth_consultores
CREATE TABLE IF NOT EXISTS wealth_consultores (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  papel         text NOT NULL CHECK (papel IN ('consultor', 'operador', 'compliance')),
  certificacao  jsonb DEFAULT '{}'::jsonb,
  ativo         boolean NOT NULL DEFAULT true,
  observacoes   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, user_id, papel)
);

CREATE INDEX IF NOT EXISTS idx_wealth_consultores_user
  ON wealth_consultores (user_id) WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_wealth_consultores_company
  ON wealth_consultores (company_id) WHERE ativo = true;

ALTER TABLE wealth_consultores ENABLE ROW LEVEL SECURITY;

CREATE POLICY wealth_consultores_admin_all
  ON wealth_consultores FOR ALL
  USING (fn_wealth_user_pode_ver_tudo());

CREATE POLICY wealth_consultores_self_select
  ON wealth_consultores FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY wealth_consultores_company_select
  ON wealth_consultores FOR SELECT
  USING (
    company_id IN (
      SELECT company_id FROM wealth_consultores
      WHERE user_id = auth.uid() AND ativo = true
    )
  );

CREATE OR REPLACE FUNCTION fn_wealth_consultores_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_wealth_consultores_updated_at ON wealth_consultores;
CREATE TRIGGER trg_wealth_consultores_updated_at
  BEFORE UPDATE ON wealth_consultores
  FOR EACH ROW EXECUTE FUNCTION fn_wealth_consultores_updated_at();

-- 0.2 Backfill Airton (corrige company_id NULL)
UPDATE wealth_clients
SET company_id = '25305b15-09e1-4abe-944f-9bff31743350'
WHERE id = '7498f718-2770-4541-9ee9-b451d5ffa247'
  AND company_id IS NULL;

-- 0.3 Travar company_id como NOT NULL
ALTER TABLE wealth_clients
  ALTER COLUMN company_id SET NOT NULL;

-- 0.4 Funcao fn_wealth_user_eh_operador
CREATE OR REPLACE FUNCTION fn_wealth_user_eh_operador(p_client_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM wealth_clients wc
    WHERE wc.id = p_client_id
      AND (
        wc.consultor_responsavel = auth.uid()
        OR
        EXISTS (
          SELECT 1 FROM wealth_consultores cons
          WHERE cons.user_id = auth.uid()
            AND cons.company_id = wc.company_id
            AND cons.ativo = true
            AND cons.papel IN ('consultor', 'operador')
        )
      )
  );
$$;

-- 0.5 Atualizar policies wealth_clients
-- Drop legacy consultor policies (nomes existentes auditados)
DROP POLICY IF EXISTS wealth_clients_consultor_select ON wealth_clients;
DROP POLICY IF EXISTS wealth_clients_consultor_modify ON wealth_clients;

CREATE POLICY wealth_clients_operador_select
  ON wealth_clients FOR SELECT
  USING (fn_wealth_user_eh_operador(id));

CREATE POLICY wealth_clients_operador_modify
  ON wealth_clients FOR ALL
  USING (fn_wealth_user_eh_operador(id))
  WITH CHECK (fn_wealth_user_eh_operador(id));

-- 0.6 Atualizar policies de positions, transactions, dividends, snapshots
-- Nomes legacy reais (auditados): wealth_xxx_admin e wealth_xxx_consultor
-- (sem sufixo _all)
DROP POLICY IF EXISTS wealth_positions_consultor ON wealth_positions;
DROP POLICY IF EXISTS wealth_positions_admin ON wealth_positions;
DROP POLICY IF EXISTS wealth_positions_consultor_all ON wealth_positions;
DROP POLICY IF EXISTS wealth_positions_admin_all ON wealth_positions;

CREATE POLICY wealth_positions_admin_all
  ON wealth_positions FOR ALL
  USING (fn_wealth_user_pode_ver_tudo());

CREATE POLICY wealth_positions_operador_all
  ON wealth_positions FOR ALL
  USING (fn_wealth_user_eh_operador(client_id))
  WITH CHECK (fn_wealth_user_eh_operador(client_id));

DROP POLICY IF EXISTS wealth_transactions_consultor ON wealth_transactions;
DROP POLICY IF EXISTS wealth_transactions_admin ON wealth_transactions;
DROP POLICY IF EXISTS wealth_transactions_consultor_all ON wealth_transactions;
DROP POLICY IF EXISTS wealth_transactions_admin_all ON wealth_transactions;

CREATE POLICY wealth_transactions_admin_all
  ON wealth_transactions FOR ALL
  USING (fn_wealth_user_pode_ver_tudo());

CREATE POLICY wealth_transactions_operador_all
  ON wealth_transactions FOR ALL
  USING (fn_wealth_user_eh_operador(client_id))
  WITH CHECK (fn_wealth_user_eh_operador(client_id));

DROP POLICY IF EXISTS wealth_dividends_consultor ON wealth_dividends;
DROP POLICY IF EXISTS wealth_dividends_admin ON wealth_dividends;
DROP POLICY IF EXISTS wealth_dividends_consultor_all ON wealth_dividends;
DROP POLICY IF EXISTS wealth_dividends_admin_all ON wealth_dividends;

CREATE POLICY wealth_dividends_admin_all
  ON wealth_dividends FOR ALL
  USING (fn_wealth_user_pode_ver_tudo());

CREATE POLICY wealth_dividends_operador_all
  ON wealth_dividends FOR ALL
  USING (fn_wealth_user_eh_operador(client_id))
  WITH CHECK (fn_wealth_user_eh_operador(client_id));

DROP POLICY IF EXISTS wealth_snapshots_consultor ON wealth_snapshots;
DROP POLICY IF EXISTS wealth_snapshots_admin ON wealth_snapshots;
DROP POLICY IF EXISTS wealth_snapshots_consultor_all ON wealth_snapshots;
DROP POLICY IF EXISTS wealth_snapshots_admin_all ON wealth_snapshots;

CREATE POLICY wealth_snapshots_admin_all
  ON wealth_snapshots FOR ALL
  USING (fn_wealth_user_pode_ver_tudo());

CREATE POLICY wealth_snapshots_operador_all
  ON wealth_snapshots FOR ALL
  USING (fn_wealth_user_eh_operador(client_id))
  WITH CHECK (fn_wealth_user_eh_operador(client_id));

-- 0.7 Cadastros operacionais
INSERT INTO wealth_consultores (company_id, user_id, papel, certificacao, ativo, observacoes)
VALUES (
  '25305b15-09e1-4abe-944f-9bff31743350',
  '4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb',
  'consultor',
  '{"cvm_19": true, "cargo": "CEO", "fundador": true}'::jsonb,
  true,
  'CEO PS Gestao e Capital - consultor responsavel por toda carteira Wealth'
)
ON CONFLICT (company_id, user_id, papel) DO UPDATE
  SET ativo = true, updated_at = now();

INSERT INTO wealth_consultores (company_id, user_id, papel, certificacao, ativo, observacoes)
VALUES (
  '25305b15-09e1-4abe-944f-9bff31743350',
  'ef06f426-c001-41dc-bd56-adac0cc08085',
  'consultor',
  '{"cargo": "Co-fundadora Marketing", "atuacao_wealth": "operacao_diaria"}'::jsonb,
  true,
  'Stephany Malfatti Paravizi - co-fundadora, opera Wealth como consultora junto com CEO'
)
ON CONFLICT (company_id, user_id, papel) DO UPDATE
  SET ativo = true, updated_at = now();

-- Stephany como wealth_client (carteira piloto OFX)
-- cpf_cnpj com sufixo distinto: wealth_clients_cpf_cnpj_key e UNIQUE
INSERT INTO wealth_clients (
  company_id, nome, cpf_cnpj, tipo, email,
  perfil_risco, status, pep, investidor_qualificado,
  consultor_responsavel, notas
) VALUES (
  '25305b15-09e1-4abe-944f-9bff31743350',
  'Stephany Malfatti Paravizi',
  'PENDENTE_CADASTRAR_STEPHANY',
  'PF',
  'stephanypsconsultoria@gmail.com',
  'moderado', 'ativo', false, false,
  '4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb',
  'Carteira piloto OFX - cliente Rico/XP. Cadastrada via PR-W4. CPF a ser preenchido.'
)
ON CONFLICT DO NOTHING;

-- CEO como wealth_client (carteira piloto Pluggy BB PF)
INSERT INTO wealth_clients (
  company_id, nome, cpf_cnpj, tipo, email,
  perfil_risco, status, pep, investidor_qualificado,
  consultor_responsavel, notas
) VALUES (
  '25305b15-09e1-4abe-944f-9bff31743350',
  'Gilberto Paravizi',
  'PENDENTE_CADASTRAR_CEO',
  'PF',
  'gilberto.paravizi@gmail.com',
  'moderado', 'ativo', false, false,
  'ef06f426-c001-41dc-bd56-adac0cc08085',
  'Carteira piloto Pluggy - conta Banco do Brasil PF. Consultora responsavel = Stephany para evitar auto-recomendacao (CVM 19). CPF a ser preenchido.'
)
ON CONFLICT DO NOTHING;

-- 0.8 Validacoes
DO $$
DECLARE
  v_consultores int;
  v_clients int;
  v_airton_company uuid;
BEGIN
  SELECT COUNT(*) INTO v_consultores FROM wealth_consultores WHERE ativo = true;
  SELECT COUNT(*) INTO v_clients FROM wealth_clients;
  SELECT company_id INTO v_airton_company FROM wealth_clients WHERE id = '7498f718-2770-4541-9ee9-b451d5ffa247';

  IF v_consultores < 2 THEN
    RAISE EXCEPTION 'Erro: deveriam existir pelo menos 2 consultores ativos, encontrados %', v_consultores;
  END IF;
  IF v_clients < 3 THEN
    RAISE EXCEPTION 'Erro: deveriam existir pelo menos 3 clients (Airton + Stephany + CEO), encontrados %', v_clients;
  END IF;
  IF v_airton_company IS NULL THEN
    RAISE EXCEPTION 'Erro: Airton ainda esta com company_id NULL';
  END IF;
  RAISE NOTICE 'PARTE 0 OK: % consultores, % clientes, Airton company_id=%', v_consultores, v_clients, v_airton_company;
END $$;

COMMIT;
