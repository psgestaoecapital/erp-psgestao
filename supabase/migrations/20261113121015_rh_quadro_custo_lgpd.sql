-- Tarefa 029fd118 (decisão 2 · CEO 06/11) — exibição do custo de MO por setor/centro/supervisor com LGPD.
--
-- Regra adotada (default seguro; o CEO pode trocar):
--   • gestor/supervisor vê custo de MO AGREGADO por setor, centro de custo e supervisor;
--   • setor/centro/supervisor com MENOS DE 3 pessoas aparece somado num grupo "Apoio"
--     para quem NÃO é RH/diretoria (k-anonimato k>=3);
--   • custo médio por pessoa (que permite deduzir salário individual) só quando o grupo
--     tem >=3 pessoas OU o usuário é RH/diretoria;
--   • fail-closed: sem acesso à empresa => sem_acesso; papel desconhecido => vê só o agregado.
--
-- RD-26/RD-71: REUSA a regra já provada em fn_rh_custo_por e o gate fn__rh_pode_custo
-- (rh_industrial/socio/admin). A diferença é a FONTE: aqui o custo vem da VISÃO QUADRO
-- (prod_posto + prod_posto_custo + prod_posto_pessoa), que é a mesma origem da tela de
-- Postos (tarefa 1e6da564). É o backend que a tela Quadro consome (nunca esconder só no front).
-- RD-97: ADITIVA — função NOVA, não altera assinatura nem comportamento de nada existente.
-- SECURITY DEFINER com guarda de empresa + REVOKE anon (padrão do núcleo de postos).
--
-- RD-38 (provado antes do merge, BEGIN/ROLLBACK, DEMO Indústria b0700000-...-005):
--   Agregação real por setor: Abate 5 pessoas / R$ 32.592 ; Desossa 3 pessoas / R$ 24.024.
--   k-anonimato (caso sintético): grupos de 1 e 2 pessoas são somados em "Apoio (menos de 3
--   pessoas)" (3 pessoas) para quem não pode; quem pode (RH/diretoria) vê os grupos separados.

CREATE OR REPLACE FUNCTION public.fn_rh_quadro_custo(
  p_company_id uuid,
  p_agrupar    text DEFAULT 'setor'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pode   boolean;
  v_grupos jsonb;
BEGIN
  -- fail-closed: só quem tem a empresa (ou admin)
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;

  IF p_agrupar NOT IN ('setor','centro','supervisor') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'agrupar_invalido');
  END IF;

  -- RH/diretoria/admin => pode ver detalhe (salário individual). Papel desconhecido => false.
  v_pode := fn__rh_pode_custo(p_company_id);

  WITH custo AS (  -- custo MO vigente por posto: a vigência mais recente, não excluída
    SELECT DISTINCT ON (pc.posto_id) pc.posto_id,
           COALESCE(pc.mao_obra_mes,0) * (1 + COALESCE(pc.encargos_pct,0)/100.0) AS custo_mes
    FROM prod_posto_custo pc
    WHERE pc.company_id = p_company_id AND pc.deleted_at IS NULL
    ORDER BY pc.posto_id, pc.vigencia_inicio DESC NULLS LAST
  ),
  base AS (
    SELECT
      CASE p_agrupar
        WHEN 'setor'      THEN COALESCE(st.nome,'(sem setor)')
        WHEN 'centro'     THEN COALESCE(NULLIF(btrim(p.centro_custo),''),'(sem centro de custo)')
        ELSE                   COALESCE(NULLIF(btrim(p.supervisor_nome),''),'(sem supervisor)')
      END AS grupo,
      COALESCE(cu.custo_mes,0) AS custo_mes,
      (SELECT count(DISTINCT COALESCE(pp.funcionario_id::text, pp.cpf, pp.id::text))
         FROM prod_posto_pessoa pp
        WHERE pp.posto_id = p.id
          AND (pp.vigencia_fim IS NULL OR pp.vigencia_fim >= CURRENT_DATE)) AS pessoas_posto
    FROM prod_posto p
    LEFT JOIN prod_setor st ON st.id = p.setor_id
    LEFT JOIN custo      cu ON cu.posto_id = p.id
    WHERE p.company_id = p_company_id AND p.ativo
  ),
  g1 AS (
    SELECT grupo, sum(pessoas_posto)::bigint AS pessoas, sum(custo_mes) AS custo_total
    FROM base GROUP BY grupo
  ),
  g2 AS (  -- LGPD: quem não pode, grupos <3 somados em "Apoio (menos de 3 pessoas)"
    SELECT CASE WHEN v_pode OR pessoas >= 3 THEN grupo ELSE 'Apoio (menos de 3 pessoas)' END AS grupo,
           pessoas, custo_total
    FROM g1
  ),
  g3 AS (
    SELECT grupo, sum(pessoas)::bigint AS pessoas, sum(custo_total) AS custo_total
    FROM g2 GROUP BY grupo
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'grupo',       grupo,
    'pessoas',     pessoas,
    'custo_total', round(custo_total, 2),
    -- custo médio (≈ salário individual) só com >=3 pessoas ou RH/diretoria
    'custo_medio', CASE WHEN v_pode OR pessoas >= 3
                        THEN round(custo_total / NULLIF(pessoas,0), 2) ELSE NULL END
  ) ORDER BY custo_total DESC), '[]'::jsonb)
  INTO v_grupos FROM g3;

  RETURN jsonb_build_object(
    'ok', true,
    'agrupar', p_agrupar,
    'pode_detalhe', v_pode,
    'grupos', v_grupos
  );
END;
$function$;

REVOKE ALL    ON FUNCTION public.fn_rh_quadro_custo(uuid, text) FROM PUBLIC;
REVOKE ALL    ON FUNCTION public.fn_rh_quadro_custo(uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_rh_quadro_custo(uuid, text) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_rh_quadro_custo(uuid, text) TO service_role;

COMMENT ON FUNCTION public.fn_rh_quadro_custo(uuid, text) IS
  'Tarefa 029fd118 decisão 2 (LGPD): custo de MO do QUADRO (prod_posto/prod_posto_custo) agregado por setor|centro|supervisor; k-anonimato k>=3 (grupos menores somados em "Apoio") para quem não é RH/diretoria; custo médio só >=3 ou RH/diretoria; fail-closed.';
