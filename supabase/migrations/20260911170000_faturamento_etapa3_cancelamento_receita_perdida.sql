-- ============================================================
-- Faturamento #18 v2 · ETAPA 3 — passo 4: CANCELAMENTO → RECEITA PERDIDA (motivo por CADASTRO)
-- ============================================================
-- SPEC §3 + decisões do CEO. Cancelar um pedido NUNCA toca parcela já EFETIVADA (tem nota fiscal atrás —
-- cancelar o financeiro sem cancelar a nota é o inverso do AUTORIZADA_SEM_FINANCEIRO). Só as PREVISTAS
-- viram 'cancelado' + motivo → entram na "receita perdida". Estados: sem efetivada → 'cancelado' (total,
-- some do fluxo); com efetivada → 'cancelado_parcial' (não some; as efetivadas seguem receita real).
--
-- MOTIVO por CADASTRO (não texto livre) — o valor está em responder "por que estamos perdendo", que só
-- sai se AGRUPA. erp_motivo_perda por empresa, editável, com flag exige_descricao (o "Outro" pede texto).
-- Regra (validada NA FUNÇÃO, não só na tela): motivo_perda_id sempre obrigatório; se exige_descricao, o
-- texto (motivo_perda) também.

-- ------------------------------------------------------------
-- (1) Cadastro de motivos de perda (por empresa)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.erp_motivo_perda (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  nome text NOT NULL,
  exige_descricao boolean NOT NULL DEFAULT false,   -- true = "Outro" → exige texto
  ativo boolean NOT NULL DEFAULT true,
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, nome)
);
CREATE INDEX IF NOT EXISTS ix_motivo_perda_company ON public.erp_motivo_perda (company_id, ativo, ordem);
ALTER TABLE public.erp_motivo_perda ENABLE ROW LEVEL SECURITY;
DO $rls$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.erp_motivo_perda'::regclass AND polname='p_motivo_perda_sel') THEN
    CREATE POLICY p_motivo_perda_sel ON public.erp_motivo_perda FOR SELECT USING ((company_id IN (SELECT get_user_company_ids())) OR is_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.erp_motivo_perda'::regclass AND polname='p_motivo_perda_rw') THEN
    CREATE POLICY p_motivo_perda_rw ON public.erp_motivo_perda FOR ALL
      USING ((company_id IN (SELECT get_user_company_ids())) OR is_admin())
      WITH CHECK ((company_id IN (SELECT get_user_company_ids())) OR is_admin());
  END IF;
END $rls$;

-- Lista os motivos da empresa; se ainda não houver nenhum, semeia os defaults (lazy — cobre empresa nova).
CREATE OR REPLACE FUNCTION public.fn_motivo_perda_listar(p_company_id uuid)
RETURNS SETOF public.erp_motivo_perda
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.erp_motivo_perda WHERE company_id = p_company_id) THEN
    INSERT INTO public.erp_motivo_perda (company_id, nome, exige_descricao, ordem) VALUES
      (p_company_id, 'Cliente desistiu', false, 1),
      (p_company_id, 'Obra suspensa', false, 2),
      (p_company_id, 'Perdemos para concorrente', false, 3),
      (p_company_id, 'Preço', false, 4),
      (p_company_id, 'Problema de prazo', false, 5),
      (p_company_id, 'Outro', true, 6)
    ON CONFLICT (company_id, nome) DO NOTHING;
  END IF;
  RETURN QUERY SELECT * FROM public.erp_motivo_perda WHERE company_id = p_company_id AND ativo ORDER BY ordem, nome;
END $fn$;
GRANT EXECUTE ON FUNCTION public.fn_motivo_perda_listar(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- (2) erp_receber ganha o motivo por cadastro (o texto motivo_perda, do passo 1, fica só para o "Outro")
-- ------------------------------------------------------------
ALTER TABLE public.erp_receber ADD COLUMN IF NOT EXISTS motivo_perda_id uuid;
CREATE INDEX IF NOT EXISTS ix_receber_motivo_perda ON public.erp_receber (motivo_perda_id) WHERE motivo_perda_id IS NOT NULL;
COMMENT ON COLUMN public.erp_receber.motivo_perda_id IS 'ETAPA3 passo4: motivo (cadastro erp_motivo_perda) da previsão cancelada. motivo_perda(texto) só quando o motivo exige_descricao (Outro).';

-- ------------------------------------------------------------
-- (3) estado 'cancelado_parcial' no pedido (idempotente)
-- ------------------------------------------------------------
DO $chk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c WHERE c.conname='chk_pedidos_status' AND pg_get_constraintdef(c.oid) ILIKE '%cancelado_parcial%'
  ) THEN
    ALTER TABLE public.erp_pedidos DROP CONSTRAINT IF EXISTS chk_pedidos_status;
    ALTER TABLE public.erp_pedidos ADD CONSTRAINT chk_pedidos_status
      CHECK ((status)::text = ANY (ARRAY[
        'aberto','em_separacao','expedido','entregue','faturamento_parcial','faturado','cancelado_parcial','cancelado'
      ]::text[]));
  END IF;
END $chk$;

-- ------------------------------------------------------------
-- (4) fn_pedido_cancelar — só previstas viram perda; efetivadas intactas; motivo validado NA FUNÇÃO
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_pedido_cancelar(
  p_pedido_id uuid, p_motivo_perda_id uuid, p_motivo_texto text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_ped record; v_exige boolean; v_n_perda int; v_tem_efet boolean; v_novo_status text;
BEGIN
  SELECT * INTO v_ped FROM public.erp_pedidos WHERE id = p_pedido_id;
  IF v_ped IS NULL THEN RAISE EXCEPTION 'Pedido nao encontrado'; END IF;
  IF v_ped.status IN ('cancelado','cancelado_parcial') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Pedido já cancelado'); END IF;

  -- motivo por cadastro é OBRIGATÓRIO e tem que ser da empresa do pedido
  IF p_motivo_perda_id IS NULL THEN RAISE EXCEPTION 'Escolha o motivo da perda.'; END IF;
  SELECT exige_descricao INTO v_exige FROM public.erp_motivo_perda
    WHERE id = p_motivo_perda_id AND company_id = v_ped.company_id AND ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Motivo de perda inválido para esta empresa.'; END IF;
  -- "Outro" (exige_descricao) → o texto também é obrigatório (validado aqui, não só na tela)
  IF v_exige AND COALESCE(btrim(p_motivo_texto),'') = '' THEN
    RAISE EXCEPTION 'Este motivo exige uma descrição — diga o que aconteceu.'; END IF;

  -- só PREVISTAS viram cancelado + motivo (NUNCA toca efetivada — ela tem nota atrás)
  UPDATE public.erp_receber
     SET status = 'cancelado', motivo_perda_id = p_motivo_perda_id,
         motivo_perda = CASE WHEN v_exige THEN btrim(p_motivo_texto) ELSE motivo_perda END,
         cancelado_em = now(), updated_at = now()
   WHERE pedido_id = p_pedido_id AND status = 'previsto' AND deleted_at IS NULL;
  GET DIAGNOSTICS v_n_perda = ROW_COUNT;

  -- tem parcela efetivada (título real, não-previsto e não-cancelado)?
  v_tem_efet := EXISTS (
    SELECT 1 FROM public.erp_receber
     WHERE pedido_id = p_pedido_id AND deleted_at IS NULL AND status NOT IN ('previsto','cancelado'));
  v_novo_status := CASE WHEN v_tem_efet THEN 'cancelado_parcial' ELSE 'cancelado' END;

  UPDATE public.erp_pedidos SET status = v_novo_status, updated_at = now() WHERE id = p_pedido_id;

  RETURN jsonb_build_object('ok', true, 'pedido_id', p_pedido_id, 'status', v_novo_status,
    'parcelas_perdidas', v_n_perda, 'tem_efetivadas', v_tem_efet);
END $fn$;
GRANT EXECUTE ON FUNCTION public.fn_pedido_cancelar(uuid, uuid, text) TO authenticated, service_role;

-- ------------------------------------------------------------
-- (5) fn_receita_perdida — só as previsões canceladas (cancelado + data_emissao NULL), agrupadas por motivo
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_receita_perdida(p_company_id uuid, p_inicio date, p_fim date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_por_motivo jsonb; v_total numeric; v_qtd int;
BEGIN
  -- "receita perdida" = previsão que NUNCA virou nota (cancelado + data_emissao IS NULL). Efetivada-depois-
  -- cancelada tem data_emissao setada → NÃO entra aqui. Agrupa por data_vencimento (quando SERIA recebida).
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'valor')::numeric DESC), '[]'::jsonb),
         COALESCE(sum((x->>'valor')::numeric),0), COALESCE(sum((x->>'qtd')::int),0)
    INTO v_por_motivo, v_total, v_qtd
  FROM (
    SELECT jsonb_build_object(
             'motivo_id', r.motivo_perda_id,
             'motivo', COALESCE(m.nome, '(sem motivo)'),
             'qtd', count(*),
             'valor', sum(r.valor)
           ) AS x
    FROM public.erp_receber r
    LEFT JOIN public.erp_motivo_perda m ON m.id = r.motivo_perda_id
    WHERE r.company_id = p_company_id
      AND r.status = 'cancelado' AND r.data_emissao IS NULL AND r.deleted_at IS NULL
      AND r.data_vencimento BETWEEN p_inicio AND p_fim
    GROUP BY r.motivo_perda_id, m.nome
  ) s;

  RETURN jsonb_build_object('ok', true, 'company_id', p_company_id, 'inicio', p_inicio, 'fim', p_fim,
    'total_perdido', v_total, 'qtd_titulos', v_qtd, 'por_motivo', v_por_motivo);
END $fn$;
GRANT EXECUTE ON FUNCTION public.fn_receita_perdida(uuid, date, date) TO authenticated, service_role;
