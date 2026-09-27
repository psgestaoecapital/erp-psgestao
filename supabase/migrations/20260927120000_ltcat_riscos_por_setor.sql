-- #77 / #53 · LTCAT: os RISCOS são do SETOR (valem para todas as funções); EPIs e treinamentos seguem por FUNÇÃO.
--
-- Correção do #1846 (20260927100000), que cadastrava o risco por função. A responsável de SST da Frioeste respondeu
-- QUATRO vezes no chamado (15/09, 17/09 e 22/09): "Os riscos são iguais para todo o setor, porém com EPIs diferentes
-- para as funções dentro do setor." Com o risco por função ela teria de repetir o mesmo risco em cada função.
-- Nenhuma empresa real tinha função cadastrada (conferido 27/09: 0 fora da demo) — nada a migrar.
--
--   • prod_setor_risco (setor → tipo/descrição/grau), RLS por empresa, REVOKE anon;
--   • fn_ltcat_setor_riscos_salvar(setor, riscos[]): substitui o conjunto do setor (atômico, valida o tipo);
--   • fn_ltcat_painel passa a devolver setor.riscos (o resto igual).
-- prod_posto_risco continua existindo (a RPC da função ainda aceita risco específico), mas a tela não o usa mais.
-- O grau de insalubridade/periculosidade é ato do engenheiro: NULL = não classificado, nunca zero.

CREATE TABLE IF NOT EXISTS public.prod_setor_risco (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  setor_id    uuid NOT NULL REFERENCES public.prod_setor(id) ON DELETE CASCADE,
  tipo        text NOT NULL,
  descricao   text NOT NULL,
  grau        text,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prod_setor_risco_tipo_chk CHECK (tipo IN ('fisico','quimico','biologico','ergonomico','acidente'))
);
COMMENT ON TABLE public.prod_setor_risco IS
  'LTCAT (#77/#53): risco do SETOR — vale para todas as funções do setor (resposta da responsável de SST).';
ALTER TABLE public.prod_setor_risco ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prod_setor_risco_rw ON public.prod_setor_risco;
CREATE POLICY prod_setor_risco_rw ON public.prod_setor_risco FOR ALL
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
REVOKE ALL ON public.prod_setor_risco FROM anon;

-- ── fn_ltcat_setor_riscos_salvar: substitui os riscos do setor pelo que a tela mandou ─────────────────────
CREATE OR REPLACE FUNCTION public.fn_ltcat_setor_riscos_salvar(p_setor_id uuid, p_riscos jsonb)
 RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_r jsonb;
BEGIN
  SELECT company_id INTO v_comp FROM prod_setor WHERE id = p_setor_id;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'setor_invalido'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  FOR v_r IN SELECT * FROM jsonb_array_elements(coalesce(p_riscos, '[]'::jsonb)) LOOP
    IF coalesce(v_r->>'tipo', '') NOT IN ('fisico','quimico','biologico','ergonomico','acidente') THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'risco_tipo_invalido');
    END IF;
    IF btrim(coalesce(v_r->>'descricao', '')) = '' THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'risco_sem_descricao');
    END IF;
  END LOOP;

  DELETE FROM prod_setor_risco WHERE setor_id = p_setor_id;
  INSERT INTO prod_setor_risco (company_id, setor_id, tipo, descricao, grau)
  SELECT v_comp, p_setor_id, r->>'tipo', btrim(r->>'descricao'), NULLIF(btrim(coalesce(r->>'grau', '')), '')
  FROM jsonb_array_elements(coalesce(p_riscos, '[]'::jsonb)) r;

  RETURN jsonb_build_object('ok', true, 'riscos', (SELECT count(*) FROM prod_setor_risco WHERE setor_id = p_setor_id));
END $function$;

-- ── fn_ltcat_painel: igual ao #1846 + setor.riscos ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ltcat_painel(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_setores jsonb; v_epis jsonb; v_trein jsonb;
BEGIN
  IF p_company_id IS NULL OR NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', s.id, 'nome', s.nome,
      'riscos', (SELECT COALESCE(jsonb_agg(jsonb_build_object('tipo', r.tipo, 'descricao', r.descricao, 'grau', r.grau)
                   ORDER BY r.tipo, r.descricao), '[]'::jsonb) FROM prod_setor_risco r WHERE r.setor_id = s.id),
      'funcoes', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', p.id, 'numero', p.numero, 'nome', p.atividade, 'descricao', p.descricao_funcao,
          'riscos', (SELECT COALESCE(jsonb_agg(jsonb_build_object('tipo', r.tipo, 'descricao', r.descricao, 'grau', r.grau)
                       ORDER BY r.tipo, r.descricao), '[]'::jsonb) FROM prod_posto_risco r WHERE r.posto_id = p.id),
          'epis', (SELECT COALESCE(jsonb_agg(jsonb_build_object('catalogo_id', k.id, 'nome', k.nome, 'ca', k.ca_numero)
                       ORDER BY k.nome), '[]'::jsonb)
                   FROM prod_posto_epi e JOIN epi_catalogo k ON k.id = e.catalogo_id WHERE e.posto_id = p.id),
          'treinamentos', (SELECT COALESCE(jsonb_agg(jsonb_build_object('tipo_id', t.id, 'nome', t.nome, 'nr', t.nr_codigo)
                       ORDER BY t.nr_codigo, t.nome), '[]'::jsonb)
                   FROM prod_posto_treinamento pt JOIN nr_treinamento_tipo t ON t.id = pt.tipo_id WHERE pt.posto_id = p.id)
        ) ORDER BY p.ordem_linha, p.numero), '[]'::jsonb)
        FROM prod_posto p WHERE p.setor_id = s.id AND p.ativo IS NOT FALSE)
    ) ORDER BY s.ordem, s.nome), '[]'::jsonb)
  INTO v_setores
  FROM prod_setor s WHERE s.company_id = p_company_id AND s.ativo IS NOT FALSE;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', k.id, 'nome', k.nome, 'ca', k.ca_numero, 'global', k.is_global)
           ORDER BY k.is_global, k.nome), '[]'::jsonb)
  INTO v_epis FROM epi_catalogo k
  WHERE k.ativo IS NOT FALSE AND (k.company_id = p_company_id OR k.is_global);

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', t.id, 'nome', t.nome, 'nr', t.nr_codigo) ORDER BY t.nr_codigo, t.nome), '[]'::jsonb)
  INTO v_trein FROM nr_treinamento_tipo t WHERE t.company_id = p_company_id AND t.ativo;

  RETURN jsonb_build_object('ok', true, 'setores', v_setores,
    'listas', jsonb_build_object('epis', v_epis, 'treinamentos', v_trein));
END $function$;

REVOKE ALL ON FUNCTION public.fn_ltcat_setor_riscos_salvar(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_ltcat_painel(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ltcat_setor_riscos_salvar(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_ltcat_painel(uuid) TO authenticated, service_role;
