-- #1672 (Gean/Jordana; vale p/ FC Pisos e FCR) · BLOQUEAR/DESBLOQUEAR pagamento de conta a pagar — recurso do NÚCLEO.
-- Aditiva: colunas novas em erp_pagar, tabela de histórico (RLS por empresa), função com guarda de papel Master,
-- e triggers que impedem remessa/baixa de título bloqueado (a UI avisa antes; o banco é a última trava).
-- Nenhuma função existente é reescrita (fn_pagar_baixar_pagamento / fn_remessa_marcar_incluidos ficam como estão).

ALTER TABLE public.erp_pagar
  ADD COLUMN IF NOT EXISTS bloqueado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bloqueado_motivo text,
  ADD COLUMN IF NOT EXISTS bloqueado_por uuid,
  ADD COLUMN IF NOT EXISTS bloqueado_em timestamptz;

CREATE INDEX IF NOT EXISTS idx_erp_pagar_bloqueado ON public.erp_pagar (company_id) WHERE bloqueado;

CREATE TABLE IF NOT EXISTS public.erp_pagar_bloqueio_historico (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL,
  pagar_id    uuid NOT NULL REFERENCES public.erp_pagar(id) ON DELETE CASCADE,
  acao        text NOT NULL CHECK (acao IN ('bloquear','desbloquear')),
  motivo      text NOT NULL,
  user_id     uuid,
  user_email  text,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pagar_bloqueio_hist_pagar ON public.erp_pagar_bloqueio_historico (pagar_id, criado_em DESC);

ALTER TABLE public.erp_pagar_bloqueio_historico ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pagar_bloqueio_hist_select ON public.erp_pagar_bloqueio_historico;
CREATE POLICY pagar_bloqueio_hist_select ON public.erp_pagar_bloqueio_historico
  FOR SELECT TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());
REVOKE ALL ON public.erp_pagar_bloqueio_historico FROM anon, public;
REVOKE INSERT, UPDATE, DELETE ON public.erp_pagar_bloqueio_historico FROM authenticated;
GRANT SELECT ON public.erp_pagar_bloqueio_historico TO authenticated;
GRANT ALL ON public.erp_pagar_bloqueio_historico TO service_role;

-- "Master" = papéis socio/acesso_total/admin/adm na empresa, ou o nível Master da empresa (CLIENT_OWNER = a coroa).
CREATE OR REPLACE FUNCTION public.fn_pagar_usuario_master(p_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(public.is_admin(), false)
      OR EXISTS (SELECT 1 FROM public.user_companies uc
                  WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id
                    AND lower(uc.role) IN ('socio','sócio','acesso_total','admin','adm'))
      OR EXISTS (SELECT 1 FROM public.tenant_user_roles t
                  WHERE t.user_id = auth.uid() AND t.company_id = p_company_id
                    AND t.role = 'CLIENT_OWNER' AND t.is_active = true)
$$;
REVOKE EXECUTE ON FUNCTION public.fn_pagar_usuario_master(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_pagar_usuario_master(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_pagar_bloquear(p_id uuid, p_bloquear boolean, p_motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_p record; v_email text; v_motivo text := btrim(COALESCE(p_motivo,''));
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING errcode='42501'; END IF;
  SELECT id, company_id, status, bloqueado INTO v_p FROM public.erp_pagar WHERE id = p_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Conta a pagar não encontrada'); END IF;
  IF NOT public.fn_pagar_usuario_master(v_p.company_id) THEN
    RAISE EXCEPTION 'Somente Master (sócio/gerente com nível Master) pode bloquear ou desbloquear pagamento' USING errcode='42501';
  END IF;
  IF length(v_motivo) < 3 THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe o motivo'); END IF;
  IF p_bloquear THEN
    IF v_p.bloqueado THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Conta já está bloqueada'); END IF;
    IF v_p.status IN ('pago','cancelado') THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Conta já quitada/cancelada não pode ser bloqueada'); END IF;
    IF v_p.status IN ('incluido_remessa','agendado') THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'Conta já está em remessa/agendada: remova da remessa antes de bloquear');
    END IF;
  ELSE
    IF NOT v_p.bloqueado THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Conta não está bloqueada'); END IF;
  END IF;
  SELECT email INTO v_email FROM public.users WHERE id = auth.uid();
  UPDATE public.erp_pagar
     SET bloqueado = p_bloquear,
         bloqueado_motivo = CASE WHEN p_bloquear THEN v_motivo ELSE NULL END,
         bloqueado_por = CASE WHEN p_bloquear THEN auth.uid() ELSE NULL END,
         bloqueado_em = CASE WHEN p_bloquear THEN now() ELSE NULL END
   WHERE id = p_id;
  INSERT INTO public.erp_pagar_bloqueio_historico (company_id, pagar_id, acao, motivo, user_id, user_email)
  VALUES (v_p.company_id, p_id, CASE WHEN p_bloquear THEN 'bloquear' ELSE 'desbloquear' END, v_motivo, auth.uid(), v_email);
  RETURN jsonb_build_object('sucesso', true, 'bloqueado', p_bloquear);
END $$;
REVOKE EXECUTE ON FUNCTION public.fn_pagar_bloquear(uuid, boolean, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_pagar_bloquear(uuid, boolean, text) TO authenticated, service_role;

-- Última trava: título bloqueado não entra em remessa nem é baixado/agendado (a UI pede o desbloqueio antes).
CREATE OR REPLACE FUNCTION public.fn_trg_remessa_item_bloqueado()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.erp_pagar WHERE id = NEW.erp_pagar_id AND bloqueado) THEN
    RAISE EXCEPTION 'Conta bloqueada para pagamento: desbloqueie antes de incluir em remessa' USING errcode='P0001';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_remessa_item_bloqueado ON public.erp_remessa_pagamento_item;
CREATE TRIGGER trg_remessa_item_bloqueado BEFORE INSERT ON public.erp_remessa_pagamento_item
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_remessa_item_bloqueado();

CREATE OR REPLACE FUNCTION public.fn_trg_pagar_bloqueado_baixa()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.bloqueado AND OLD.bloqueado
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('pago','parcial','incluido_remessa','agendado') THEN
    RAISE EXCEPTION 'Conta bloqueada para pagamento: desbloqueie antes de baixar ou incluir em remessa' USING errcode='P0001';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pagar_bloqueado_baixa ON public.erp_pagar;
CREATE TRIGGER trg_pagar_bloqueado_baixa BEFORE UPDATE ON public.erp_pagar
  FOR EACH ROW WHEN (OLD.bloqueado AND NEW.bloqueado) EXECUTE FUNCTION public.fn_trg_pagar_bloqueado_baixa();
REVOKE EXECUTE ON FUNCTION public.fn_trg_remessa_item_bloqueado() FROM anon, public, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_trg_pagar_bloqueado_baixa() FROM anon, public, authenticated;
