-- Chamado #9427 (FC Pisos) — "ISS por município" só permitia cadastrar; depois de salvo, não dava
-- para alterar. A Jordana cadastrou Ponta Grossa (IBGE 4119905, 07.05, 3%) e precisa corrigir a
-- retenção na fonte e a observação após a confirmação do contador.
--
-- Esta migration é ADITIVA:
--   1) colunas de auditoria em fiscal_iss_municipio (quem alterou, quando e o valor anterior),
--      preservando o histórico sem apagar nada;
--   2) fn_fiscal_iss_alterar — edição de um cadastro existente (alíquota, retenção, vigência,
--      fonte, quem informou e observação), com a MESMA validação e o MESMO guard de tenant do
--      fn_fiscal_iss_cadastrar, gravando quem editou e o valor anterior.
--
-- A emissão (fn_fiscal_iss_resolver) continua resolvendo pela vigência da data do fato gerador;
-- notas já emitidas guardam o valor da época no próprio documento e não são afetadas.

-- 1) auditoria no próprio registro (aditiva) --------------------------------------------------
ALTER TABLE public.fiscal_iss_municipio
  ADD COLUMN IF NOT EXISTS editado_em     timestamptz,
  ADD COLUMN IF NOT EXISTS editado_por    uuid,
  ADD COLUMN IF NOT EXISTS valor_anterior jsonb;

COMMENT ON COLUMN public.fiscal_iss_municipio.editado_em     IS 'Quando o cadastro foi alterado pela última vez (fn_fiscal_iss_alterar).';
COMMENT ON COLUMN public.fiscal_iss_municipio.editado_por    IS 'Usuário que fez a última alteração (auth.uid()).';
COMMENT ON COLUMN public.fiscal_iss_municipio.valor_anterior IS 'Snapshot dos valores antes da última alteração (histórico).';

-- 2) função de alteração ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_fiscal_iss_alterar(
  p_id              uuid,
  p_aliquota        numeric,
  p_retido_na_fonte boolean DEFAULT NULL::boolean,
  p_vigencia_inicio date    DEFAULT NULL::date,
  p_vigencia_fim    date    DEFAULT NULL::date,
  p_fonte           text    DEFAULT NULL::text,
  p_informado_por   text    DEFAULT NULL::text,
  p_observacao      text    DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r        fiscal_iss_municipio%ROWTYPE;
  v_fonte  text := btrim(COALESCE(p_fonte, ''));
  v_ini    date;
  v_ant    jsonb;
BEGIN
  SELECT * INTO r FROM fiscal_iss_municipio WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'cadastro nao encontrado');
  END IF;

  -- guard de tenant: só a própria empresa (ou admin). Catálogo global (company_id NULL)
  -- não é editável por aqui.
  IF NOT (r.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;

  IF p_aliquota IS NULL OR p_aliquota < 0 OR p_aliquota > 10 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'aliquota fora da faixa (0 a 10%)');
  END IF;

  v_fonte := COALESCE(NULLIF(v_fonte, ''), r.fonte);
  IF v_fonte NOT IN ('api_nacional','cadastro_empresa','acordo_coletivo','contador') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'fonte invalida');
  END IF;

  v_ini := COALESCE(p_vigencia_inicio, r.vigencia_inicio);
  IF p_vigencia_fim IS NOT NULL AND p_vigencia_fim < v_ini THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'vigencia_fim anterior ao inicio');
  END IF;

  -- snapshot do valor anterior (histórico)
  v_ant := jsonb_build_object(
    'aliquota',        r.aliquota,
    'retido_na_fonte', r.retido_na_fonte,
    'vigencia_inicio', r.vigencia_inicio,
    'vigencia_fim',    r.vigencia_fim,
    'fonte',           r.fonte,
    'informado_por',   r.informado_por,
    'observacao',      r.observacao
  );

  UPDATE fiscal_iss_municipio SET
    aliquota        = round(p_aliquota, 4),
    retido_na_fonte = p_retido_na_fonte,
    vigencia_inicio = v_ini,
    vigencia_fim    = p_vigencia_fim,
    fonte           = v_fonte,
    informado_por   = NULLIF(btrim(COALESCE(p_informado_por, '')), ''),
    observacao      = NULLIF(btrim(COALESCE(p_observacao, '')), ''),
    editado_em      = now(),
    editado_por     = auth.uid(),
    valor_anterior  = v_ant
  WHERE id = p_id;

  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (
    r.company_id, auth.uid(), 'fiscal_iss_municipio', p_id::text, 'fiscal_iss_alterar', v_ant,
    jsonb_build_object(
      'aliquota',        round(p_aliquota, 4),
      'retido_na_fonte', p_retido_na_fonte,
      'vigencia_inicio', v_ini,
      'vigencia_fim',    p_vigencia_fim,
      'fonte',           v_fonte,
      'informado_por',   NULLIF(btrim(COALESCE(p_informado_por, '')), ''),
      'observacao',      NULLIF(btrim(COALESCE(p_observacao, '')), '')
    )
  );

  RETURN jsonb_build_object('ok', true, 'id', p_id,
    'aliquota', round(p_aliquota, 4), 'fonte', v_fonte,
    'vigencia_inicio', v_ini, 'vigencia_fim', p_vigencia_fim);
END $function$;

REVOKE ALL ON FUNCTION public.fn_fiscal_iss_alterar(uuid, numeric, boolean, date, date, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_fiscal_iss_alterar(uuid, numeric, boolean, date, date, text, text, text) TO authenticated, service_role;

-- 3) ajuda do campo (RD-95) para a nova ação "Editar" ----------------------------------------
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES (
  'fiscal.iss.editar',
  '/dashboard/configuracoes/fiscal/iss-municipios',
  'Configuração Fiscal',
  'Editar alíquota',
  'Abre o cadastro já salvo para corrigir a alíquota, a retenção na fonte, a vigência, a origem do número, quem informou e a observação.',
  'Permite corrigir um cadastro de ISS após a confirmação do contador sem recadastrar. Ao salvar, o sistema guarda quem alterou, quando e o valor anterior (histórico). Notas já emitidas mantêm o valor da época.',
  'Ex.: corrigir "ISS retido na fonte" de não para sim depois que o contador confirmou a retenção no município.',
  'Mudança de alíquota por início de nova vigência: prefira cadastrar uma nova linha (que encerra a anterior) em vez de sobrescrever a histórica.',
  'fiscal',
  10
)
ON CONFLICT (chave) DO NOTHING;
