-- CEO 02/11 · Blueprint P&M §3 — "Medição de tempo configurável por etapa e por cliente" · PR2 (escrita + leitura).
-- PR1 (#3735, mergeada) criou a tabela aditiva agency_etapa_medicao_config (sem UI, sem grant de escrita).
-- Esta PR entrega as RPCs que a tela de configuração usa e as chaves de ajuda ("?", RD-95). Aditiva (RD-94.1 c):
-- nenhuma tabela/coluna alterada, nenhum dado de cliente tocado, cálculo de custo INALTERADO (isso é a PR3).

-- ── Leitura: etapas (do timesheet + já configuradas) com o "medir" RESOLVIDO (cliente > agência > sistema) ──
-- SECURITY INVOKER (padrão): respeita a RLS por empresa das duas tabelas (ambas já têm GRANT SELECT a authenticated).
CREATE OR REPLACE FUNCTION public.fn_agency_etapa_medicao_listar(
  p_company_id uuid,
  p_cliente_id uuid DEFAULT NULL
) RETURNS TABLE(etapa_tipo text, medir boolean, origem text)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH etapas AS (
    SELECT DISTINCT t.etapa_tipo
    FROM agency_timesheet t
    WHERE t.company_id = p_company_id AND t.etapa_tipo IS NOT NULL AND btrim(t.etapa_tipo) <> ''
    UNION
    SELECT c.etapa_tipo
    FROM agency_etapa_medicao_config c
    WHERE c.company_id = p_company_id
  )
  SELECT
    e.etapa_tipo,
    COALESCE(cli.medir, ag.medir, true) AS medir,
    CASE
      WHEN cli.medir IS NOT NULL THEN 'cliente'
      WHEN ag.medir IS NOT NULL THEN 'agencia'
      ELSE 'sistema'
    END AS origem
  FROM etapas e
  LEFT JOIN agency_etapa_medicao_config ag
    ON ag.company_id = p_company_id AND ag.cliente_id IS NULL AND ag.etapa_tipo = e.etapa_tipo
  LEFT JOIN agency_etapa_medicao_config cli
    ON p_cliente_id IS NOT NULL
   AND cli.company_id = p_company_id AND cli.cliente_id = p_cliente_id AND cli.etapa_tipo = e.etapa_tipo
  ORDER BY e.etapa_tipo;
$function$;

REVOKE ALL ON FUNCTION public.fn_agency_etapa_medicao_listar(uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_agency_etapa_medicao_listar(uuid, uuid) TO authenticated, service_role;

-- ── Escrita: upsert do "medir" por etapa, no padrão da agência (cliente_id NULL) ou como regra do cliente ──
-- SECURITY DEFINER com GUARDA explícita (a tabela só concede SELECT; escrita só por aqui). Sem leak cross-tenant:
-- exige a empresa do usuário (ou admin) e, para regra de cliente, que o cliente seja da MESMA empresa.
CREATE OR REPLACE FUNCTION public.fn_agency_etapa_medicao_salvar(
  p_company_id uuid,
  p_etapa_tipo text,
  p_medir boolean,
  p_cliente_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_etapa text := NULLIF(btrim(p_etapa_tipo), '');
  v_id uuid;
BEGIN
  IF p_company_id IS NULL OR v_etapa IS NULL OR p_medir IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'company_id, etapa_tipo e medir são obrigatórios');
  END IF;
  IF NOT is_admin() AND p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso');
  END IF;
  IF p_cliente_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM agency_clientes c WHERE c.id = p_cliente_id AND c.company_id = p_company_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'cliente não pertence à empresa');
  END IF;

  IF p_cliente_id IS NULL THEN
    INSERT INTO agency_etapa_medicao_config (company_id, cliente_id, etapa_tipo, medir)
    VALUES (p_company_id, NULL, v_etapa, p_medir)
    ON CONFLICT (company_id, etapa_tipo) WHERE cliente_id IS NULL
    DO UPDATE SET medir = EXCLUDED.medir, updated_at = now()
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO agency_etapa_medicao_config (company_id, cliente_id, etapa_tipo, medir)
    VALUES (p_company_id, p_cliente_id, v_etapa, p_medir)
    ON CONFLICT (company_id, cliente_id, etapa_tipo) WHERE cliente_id IS NOT NULL
    DO UPDATE SET medir = EXCLUDED.medir, updated_at = now()
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_agency_etapa_medicao_salvar(uuid, text, boolean, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_agency_etapa_medicao_salvar(uuid, text, boolean, uuid) TO authenticated, service_role;

-- ── RD-95: "?" dos campos da nova aba "Medição" (texto em linguagem do usuário) ─────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
  ('pm.config.medicao_cliente', '/dashboard/pm/configuracoes', 'Configurações · Medição', 'Escopo da regra',
   'Escolha "Padrão da agência" para valer em todos os clientes, ou um cliente específico para uma exceção só dele.',
   'A regra do cliente tem prioridade sobre o padrão da agência; sem regra, a etapa conta como custo (padrão do sistema).',
   'Padrão da agência: "reunião" não conta; no cliente X, "reunião" conta.',
   'Definir só no cliente e esquecer o padrão da agência — o padrão vale para todos os outros clientes.',
   'pm', 1, 'publicado'),
  ('pm.config.medicao_etapa', '/dashboard/pm/configuracoes', 'Configurações · Medição', 'Etapa conta como custo?',
   'Ligue para a etapa entrar no custo direto do cliente; desligue para ela não pesar no cálculo de margem.',
   'Controla quais etapas do apontamento de horas viram custo direto (consumido no cálculo de custo por cliente).',
   'Desligar "comercial/pré-venda" para não cobrar do cliente horas que são investimento da agência.',
   'Desligar uma etapa que de fato é entregue ao cliente — a margem fica inflada.',
   'pm', 2, 'publicado')
ON CONFLICT (chave) DO NOTHING;
