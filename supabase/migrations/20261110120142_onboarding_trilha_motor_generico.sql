-- Onboarding guiado · Fase 1 (parte 2) — MOTOR GENÉRICO da trilha (CEO 07/11).
-- REUSA a fundação da parte 1 (erp_onboarding_etapa_config / fn_onboarding_etapas) e cruza com o PROGRESSO real
-- (erp_onboarding_progresso) + DETECÇÃO PELO DADO REAL (mesma lógica de fn_ge_onboarding_status/fn_onboarding_maturidade:
-- erp_banco_contas, erp_plano_contas, erp_clientes, user_companies, companies).
-- O motor é GENÉRICO: lê a config declarativa e, por passo, resolve "concluído" via deteccao_chave — adicionar
-- vertical/passo = adicionar LINHAS na config; adicionar um DETECTOR novo = um WHEN a mais aqui.
--
-- Decisões do CEO respeitadas:
--   (a) GE primeiro — já embutido na ordem da config;
--   (b) de-para contábil vem PRÉ-PREENCHIDO (pendencia_decisao=true) — o passo fica "pendência aberta" até o dado existir;
--   (c) todo passo é PULÁVEL — um passo pulado (erp_onboarding_progresso.pulado) mostra estado 'pulado', mas se for
--       pendência de decisão o AVISO (pendencia_aberta) PERMANECE enquanto o dado real não estiver lá.
--
-- SENSÍVEL (lê dado por empresa): SECURITY DEFINER com guarda multi-tenant fn__guarda_empresa no topo (mesmo padrão
-- já aprovado na PR #4117). Nenhuma leitura de empresa alheia: a guarda levanta 42501 para usuário fora da empresa;
-- service_role (auth.uid() NULL) passa — e este motor NÃO é chamado por cron/edge com company alheio (é tela).
-- ADITIVA (RD-94.1c no espírito; porém marcada revisao-eng-chefe por ser leitura multi-tenant): função NOVA, não
-- altera/apaga nada do que existe.

CREATE OR REPLACE FUNCTION public.fn_onboarding_trilha(
  p_company_id uuid,
  p_vertical   text DEFAULT 'gestao_empresarial'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_empresa_nome text;
  v_passos       jsonb;
  v_total        int;
  v_concluidos   int;
  v_pendencias   int;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('erro', true,
      'mensagem', 'Selecione uma empresa para ver a trilha de primeiros passos');
  END IF;

  -- guarda multi-tenant: só o dono (ou service_role) lê a trilha desta empresa
  PERFORM public.fn__guarda_empresa(p_company_id);

  SELECT razao_social INTO v_empresa_nome FROM companies WHERE id = p_company_id;
  IF v_empresa_nome IS NULL THEN
    RETURN jsonb_build_object('erro', true, 'mensagem', 'Empresa não encontrada');
  END IF;

  WITH etapas AS (
    SELECT * FROM public.fn_onboarding_etapas(p_vertical)
  ),
  avaliado AS (
    SELECT e.*,
      COALESCE(pr.concluido, false) AS reg_concluido,
      COALESCE(pr.pulado, false)    AS reg_pulado,
      -- "concluído pelo DADO REAL" — detector nomeado na config:
      CASE e.deteccao_chave
        WHEN 'ge_empresa'      THEN EXISTS (SELECT 1 FROM companies c
                                              WHERE c.id = p_company_id
                                                AND c.cnpj IS NOT NULL
                                                AND c.razao_social IS NOT NULL)
        WHEN 'ge_usuarios'     THEN (SELECT count(*) FROM user_companies uc
                                       WHERE uc.company_id = p_company_id) >= 2
        WHEN 'ge_contas'       THEN EXISTS (SELECT 1 FROM erp_banco_contas b
                                              WHERE b.company_id = p_company_id)
        WHEN 'ge_plano_contas' THEN EXISTS (SELECT 1 FROM erp_plano_contas pc
                                              WHERE pc.company_id = p_company_id)
        WHEN 'ge_cadastros'    THEN EXISTS (SELECT 1 FROM erp_clientes cl
                                              WHERE cl.company_id = p_company_id)
        ELSE false  -- detector desconhecido: motor cai no registro manual (reg_concluido)
      END AS dado_ok
    FROM etapas e
    LEFT JOIN public.erp_onboarding_progresso pr
      ON pr.company_id = p_company_id
     AND pr.modulo     = e.modulo
     AND pr.passo      = e.passo
  ),
  final AS (
    SELECT a.*,
      (a.dado_ok OR a.reg_concluido)                               AS concluido,
      (NOT (a.dado_ok OR a.reg_concluido) AND a.reg_pulado)        AS pulado
    FROM avaliado a
  )
  SELECT
    count(*)::int,
    count(*) FILTER (WHERE f.concluido)::int,
    count(*) FILTER (WHERE f.pendencia_decisao AND NOT f.concluido)::int,
    jsonb_agg(jsonb_build_object(
      'modulo',             f.modulo,
      'passo',              f.passo,
      'ordem',              f.ordem,
      'titulo',             f.titulo,
      'orientacao',         f.orientacao,
      'rota_destino',       f.rota_destino,
      'pulavel',            f.pulavel,
      'pendencia_decisao',  f.pendencia_decisao,
      'concluido',          f.concluido,
      'pulado',             f.pulado,
      'detectado_por_dado', f.dado_ok,
      'estado',             CASE WHEN f.concluido THEN 'concluido'
                                 WHEN f.pulado    THEN 'pulado'
                                 ELSE 'pendente' END,
      -- o aviso de pendência fica até o dado existir, mesmo que o passo tenha sido pulado
      'pendencia_aberta',   (f.pendencia_decisao AND NOT f.concluido)
    ) ORDER BY f.ordem)
  INTO v_total, v_concluidos, v_pendencias, v_passos
  FROM final f;

  IF COALESCE(v_total, 0) = 0 THEN
    RETURN jsonb_build_object('erro', true,
      'mensagem', 'Nenhuma trilha configurada para esta vertical',
      'vertical', p_vertical);
  END IF;

  RETURN jsonb_build_object(
    'company_id',        p_company_id,
    'empresa_nome',      v_empresa_nome,
    'vertical',          p_vertical,
    'total_passos',      v_total,
    'passos_concluidos', v_concluidos,
    'pendencias_abertas',v_pendencias,
    'progresso_label',   v_concluidos || ' de ' || v_total,
    'pct_completo',      ROUND((v_concluidos * 100.0) / v_total, 0),
    'completo',          v_concluidos = v_total,
    'passos',            v_passos
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_onboarding_trilha(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_onboarding_trilha(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_onboarding_trilha(uuid, text) IS
  'Onboarding guiado Fase 1 parte 2 (CEO 07/11): motor genérico da trilha. Cruza a config declarativa '
  '(fn_onboarding_etapas) com o progresso registrado (erp_onboarding_progresso) e a detecção pelo DADO REAL. '
  'Retorna X de N, passos com estado (concluido/pulado/pendente) e pendência aberta. Guarda multi-tenant fn__guarda_empresa.';
