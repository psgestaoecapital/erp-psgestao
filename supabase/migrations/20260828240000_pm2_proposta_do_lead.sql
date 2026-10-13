-- SPEC PM-2 · o botão "Proposta" do CRM abre a proposta EXISTENTE (por cascata) ou cria pré-preenchida.
--
-- AUDITORIA (RD-38/44/45) — o motor JÁ existia e estava religado ao botão, mas fraco:
--   · fn_agency_lead_proposta casava SÓ por lead_id (4 de 10 propostas). A do Findler ("Painel de Led")
--     está ligada por erp_cliente_id, não por lead_id → o botão NÃO a achava e o front caía em
--     fn_agency_lead_proposta_criar, gerando uma PROPOSTA DUPLICADA. Esse é o bug real de hoje.
--   · fn_agency_lead_proposta_criar semeava valor_total = valor_estimado — o que agora VIOLA a trava do
--     PR-B (o total vem dos itens). Corrigido aqui: não semear valor_total.
-- RD-52 (motor único): em vez de um resolvedor paralelo, o botão passa a chamar UMA RPC de cascata.
-- RD-26 (reusar): a criação continua na fn_agency_lead_proposta_criar (só corrigida), que já grava lead_id.

-- ── ENTREGA 1 · resolvedor por CASCATA (lead_id → erp_cliente_id → título) ─────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pm_proposta_do_lead(p_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_lead record; v_props jsonb;
BEGIN
  SELECT * INTO v_lead FROM agency_leads WHERE id = p_lead_id AND deleted_at IS NULL;
  IF v_lead.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'lead_nao_encontrado'); END IF;
  IF NOT (v_lead.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  -- cascata: do vínculo mais forte (lead_id) para o mais fraco (título). O título nunca abre direto (front).
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'criterio', (x->>'created_at') DESC), '[]'::jsonb)
    INTO v_props
  FROM (
    SELECT jsonb_build_object(
             'id', p.id, 'titulo', p.titulo, 'status', p.status,
             'valor_total', p.valor_total, 'created_at', p.created_at,
             'criterio', CASE
               WHEN p.lead_id = v_lead.id                                        THEN '1_lead'
               WHEN v_lead.erp_cliente_id IS NOT NULL
                    AND p.erp_cliente_id = v_lead.erp_cliente_id                 THEN '2_cliente'
               ELSE '3_titulo' END
           ) AS x
      FROM agency_propostas p
     WHERE p.company_id = v_lead.company_id
       AND p.deleted_at IS NULL
       AND (
            p.lead_id = v_lead.id
         OR (v_lead.erp_cliente_id IS NOT NULL AND p.erp_cliente_id = v_lead.erp_cliente_id)
         OR (v_lead.empresa IS NOT NULL AND length(btrim(v_lead.empresa)) >= 3
             AND unaccent(lower(p.titulo)) LIKE '%'||unaccent(lower(btrim(v_lead.empresa)))||'%')
       )
  ) s;

  RETURN jsonb_build_object(
    'ok', true,
    'lead', jsonb_build_object(
      'id', v_lead.id, 'nome', v_lead.nome, 'empresa', v_lead.empresa,
      'erp_cliente_id', v_lead.erp_cliente_id, 'valor_estimado', v_lead.valor_estimado,
      'contato_email', v_lead.contato_email, 'contato_telefone', v_lead.contato_telefone,
      'origem', v_lead.origem, 'responsavel_id', v_lead.responsavel_id),
    'propostas', v_props,
    'total', jsonb_array_length(v_props)
  );
END $function$;
REVOKE ALL ON FUNCTION public.fn_pm_proposta_do_lead(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_pm_proposta_do_lead(uuid) TO authenticated, service_role;

-- ── ENTREGA 3 · criação pré-preenchida SEM violar a trava do PR-B (não semear valor_total) ─────────
-- O total sai dos itens (o editor adiciona os itens). valor_estimado do lead é só dica no front.
CREATE OR REPLACE FUNCTION public.fn_agency_lead_proposta_criar(p_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_lead record; v_res jsonb; v_id uuid;
BEGIN
  SELECT * INTO v_lead FROM agency_leads WHERE id = p_lead_id;
  IF v_lead.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'lead_nao_encontrado'); END IF;
  IF NOT (v_lead.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  -- pré-preenche cliente (erp_cliente_id), título e responsável. NÃO passa valor_total: o total vem dos itens.
  v_res := fn_agency_proposta_criar(jsonb_build_object(
    'company_id', v_lead.company_id,
    'titulo', 'Proposta · ' || COALESCE(NULLIF(btrim(v_lead.empresa), ''), NULLIF(btrim(v_lead.nome), ''), 'lead'),
    'erp_cliente_id', v_lead.erp_cliente_id,
    'responsavel_id', v_lead.responsavel_id
  ));
  IF NOT COALESCE((v_res->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'erro', COALESCE(v_res->>'erro', 'falha_ao_criar')); END IF;

  v_id := NULLIF(v_res->>'id', '')::uuid;
  UPDATE agency_propostas SET lead_id = p_lead_id, updated_at = now() WHERE id = v_id;   -- 🔑 vínculo sempre

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'criada', true);
END $function$;

-- ── ENTREGA 3.2 · BACKFILL conservador do lead_id (RD-51: não adivinhar em ambiguidade) ────────────
-- Só grava quando lead_id é nulo E existe EXATAMENTE UM lead com o mesmo erp_cliente_id na mesma empresa.
-- Auditado (28/08): 2 vinculáveis (Gestão de Rede Social, Painel de Led/Findler), 0 ambíguas.
WITH cand AS (
  SELECT p.id AS proposta_id,
    (SELECT l.id FROM agency_leads l
      WHERE l.deleted_at IS NULL AND l.company_id = p.company_id AND l.erp_cliente_id = p.erp_cliente_id
      LIMIT 2) AS um_lead,
    (SELECT count(*) FROM agency_leads l
      WHERE l.deleted_at IS NULL AND l.company_id = p.company_id AND l.erp_cliente_id = p.erp_cliente_id) AS n_leads
  FROM agency_propostas p
  WHERE p.deleted_at IS NULL AND p.lead_id IS NULL AND p.erp_cliente_id IS NOT NULL
)
UPDATE agency_propostas p
   SET lead_id = c.um_lead, updated_at = now()
  FROM cand c
 WHERE p.id = c.proposta_id AND c.n_leads = 1;   -- ambíguos (n_leads > 1) ficam nulos de propósito

-- ROLLBACK (se necessário):
--   DROP FUNCTION IF EXISTS public.fn_pm_proposta_do_lead(uuid);
--   -- fn_agency_lead_proposta_criar: restaurar a versão anterior (que semeava valor_total) — ver migração original.
--   -- backfill: não é revertido automaticamente (só preencheu lead_id nulos de forma inequívoca).
