-- Portal do cliente da obra (H9) — FUNDAÇÃO V1 (só leitura + acesso por convite)
-- META CEO 02/11 · Gestão de Obras · tela 296 (Portal do cliente da obra)
-- Code: desenvolvedor_5_g
--
-- Esta é a 1ª fatia (dados) do Portal do cliente: uma tabela de ACESSO que liga
-- um usuário autenticado (o cliente convidado) a UMA obra específica. Nunca há
-- link público sem autenticação — o cliente só enxerga a(s) obra(s) para a(s)
-- qual(is) a empresa dona o convidou. Isolamento provado por RLS + função.
--
-- SEGURANÇA/LGPD (crítico): um cliente NUNCA enxerga obra de outra empresa nem de
-- outro cliente. Garantias nesta migration:
--   1) RLS por empresa para a equipe (get_user_company_ids) e leitura do próprio
--      vínculo para o cliente (user_id = auth.uid());
--   2) trigger que impede convidar para obra de empresa diferente (company_id tem
--      de bater com a obra), fechando spoof de company_id;
--   3) REVOKE anon em tabela e função; função SECURITY DEFINER filtra SOMENTE por
--      auth.uid() (impossível ler obra de terceiro).
-- Aditiva: tabela/trigger/função novos; sem UPDATE/DELETE em dado de cliente.

-- ── 1) Tabela de acesso do cliente à obra (convite) ────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_obra_cliente_acesso (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL,
  obra_id         uuid NOT NULL REFERENCES public.projetos_obras(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  email_convite   text,
  papel           text NOT NULL DEFAULT 'cliente_obra',
  convidado_por   uuid REFERENCES public.users(id),
  criado_em       timestamptz NOT NULL DEFAULT now(),
  revogado_em     timestamptz,
  revogado_por    uuid REFERENCES public.users(id),
  revogado_motivo text,
  CONSTRAINT erp_obra_cliente_acesso_uniq UNIQUE (obra_id, user_id),
  CONSTRAINT erp_obra_cliente_acesso_papel_chk CHECK (papel IN ('cliente_obra'))
);

COMMENT ON TABLE public.erp_obra_cliente_acesso IS
  'Portal do cliente da obra (H9): vincula um usuário autenticado (cliente convidado) a uma obra. Acesso só por convite da empresa dona; isolamento por RLS + auth.uid(). Revogação é soft (revogado_em).';

CREATE INDEX IF NOT EXISTS idx_obra_cliente_acesso_user   ON public.erp_obra_cliente_acesso (user_id) WHERE revogado_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_obra_cliente_acesso_obra   ON public.erp_obra_cliente_acesso (obra_id);
CREATE INDEX IF NOT EXISTS idx_obra_cliente_acesso_empresa ON public.erp_obra_cliente_acesso (company_id);

-- ── 2) Guarda: a obra tem de pertencer à MESMA empresa do vínculo ──────────────
-- Fecha o spoof de company_id: equipe não convida cliente para obra de outra empresa.
CREATE OR REPLACE FUNCTION public.trg_obra_cliente_acesso_empresa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.projetos_obras WHERE id = NEW.obra_id;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Obra % não encontrada', NEW.obra_id;
  END IF;
  IF NEW.company_id <> v_company THEN
    RAISE EXCEPTION 'company_id (%) não corresponde à empresa da obra (%)', NEW.company_id, v_company;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_obra_cliente_acesso_empresa() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_obra_cliente_acesso_empresa ON public.erp_obra_cliente_acesso;
CREATE TRIGGER trg_obra_cliente_acesso_empresa
  BEFORE INSERT OR UPDATE OF company_id, obra_id ON public.erp_obra_cliente_acesso
  FOR EACH ROW EXECUTE FUNCTION public.trg_obra_cliente_acesso_empresa();

-- ── 3) RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.erp_obra_cliente_acesso ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_obra_cliente_acesso FROM PUBLIC, anon, authenticated;

-- Equipe da empresa dona gere os convites da própria empresa.
DROP POLICY IF EXISTS erp_obra_cliente_acesso_empresa ON public.erp_obra_cliente_acesso;
CREATE POLICY erp_obra_cliente_acesso_empresa ON public.erp_obra_cliente_acesso FOR ALL TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin())
  WITH CHECK (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());

-- O cliente convidado lê apenas o PRÓPRIO vínculo (para confirmar acesso).
DROP POLICY IF EXISTS erp_obra_cliente_acesso_cliente ON public.erp_obra_cliente_acesso;
CREATE POLICY erp_obra_cliente_acesso_cliente ON public.erp_obra_cliente_acesso FOR SELECT TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE ON public.erp_obra_cliente_acesso TO authenticated;
GRANT ALL ON public.erp_obra_cliente_acesso TO service_role;

-- ── 4) Função de leitura do portal: as obras do cliente logado ─────────────────
-- SECURITY DEFINER, mas filtra SOMENTE por auth.uid() — nunca retorna obra de
-- terceiro. Projeção só de leitura (sem custo/financeiro interno).
CREATE OR REPLACE FUNCTION public.fn_obra_portal_minhas_obras()
RETURNS TABLE (
  obra_id           uuid,
  numero            text,
  nome              text,
  status            text,
  pct_conclusao     integer,
  data_inicio       date,
  data_prevista_fim date,
  cidade            text,
  uf                text,
  cliente_nome      text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT o.id, o.numero, o.nome, o.status, o.pct_conclusao,
         o.data_inicio, o.data_prevista_fim, o.cidade, o.uf, o.cliente_nome
  FROM public.erp_obra_cliente_acesso a
  JOIN public.projetos_obras o ON o.id = a.obra_id
  WHERE a.user_id = auth.uid()
    AND a.revogado_em IS NULL
    AND o.deleted_at IS NULL
  ORDER BY o.data_inicio DESC NULLS LAST, o.numero;
$$;
REVOKE ALL ON FUNCTION public.fn_obra_portal_minhas_obras() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_portal_minhas_obras() TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_obra_portal_minhas_obras() IS
  'Portal do cliente (H9): obras que o usuário logado (cliente) tem acesso ativo. Filtra por auth.uid() — isolamento total entre clientes/empresas.';
