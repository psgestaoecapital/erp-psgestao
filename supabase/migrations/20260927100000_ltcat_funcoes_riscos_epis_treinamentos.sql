-- #77 / #53 · LTCAT passo 2: por SETOR → FUNÇÃO, cadastrar descrição, RISCOS, EPIs obrigatórios e TREINAMENTOS.
--
-- Chamados: #53 "campos para acrescentar descrição das funções de cada setor, riscos, EPIs e treinamentos
-- obrigatórios" · #77 "após importar os setores não existe a aba para preenchimento dos riscos, EPI e treinamentos".
-- Hoje a tela SST só faz o passo 1 (setores do ponto → prod_setor). A cadeia já existe no banco e está vazia
-- (#20260908120000): prod_setor → prod_posto (a função/posto) → prod_posto_risco / prod_posto_epi. Faltava:
--   • a descrição da função (prod_posto.descricao_funcao);
--   • o vínculo função → treinamento (prod_posto_treinamento → nr_treinamento_tipo, o cadastro de treinamentos NR);
--   • as RPCs da tela: fn_ltcat_painel (tudo numa chamada) e fn_ltcat_funcao_salvar (uma função inteira por vez:
--     descrição + riscos + EPIs + treinamentos, atômico) e fn_ltcat_funcao_excluir (inativa, não apaga).
-- Guarda: só empresa do usuário (get_user_company_ids) ou admin; REVOKE anon. O sistema ORGANIZA a informação —
-- o laudo é assinado pelo engenheiro/médico do trabalho (grau de insalubridade é ato do profissional; NULL = não
-- classificado, nunca zero).

ALTER TABLE public.prod_posto ADD COLUMN IF NOT EXISTS descricao_funcao text;
COMMENT ON COLUMN public.prod_posto.descricao_funcao IS
  'LTCAT (#53): descrição das atividades da função/posto — o que a pessoa faz, onde e com o quê.';

CREATE TABLE IF NOT EXISTS public.prod_posto_treinamento (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  posto_id    uuid NOT NULL REFERENCES public.prod_posto(id) ON DELETE CASCADE,
  tipo_id     uuid NOT NULL REFERENCES public.nr_treinamento_tipo(id) ON DELETE CASCADE,
  obrigatorio boolean NOT NULL DEFAULT true,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (posto_id, tipo_id)
);
COMMENT ON TABLE public.prod_posto_treinamento IS
  'LTCAT (#77): treinamento NR obrigatório da função/posto (nr_treinamento_tipo).';
ALTER TABLE public.prod_posto_treinamento ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prod_posto_treinamento_rw ON public.prod_posto_treinamento;
CREATE POLICY prod_posto_treinamento_rw ON public.prod_posto_treinamento FOR ALL
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
REVOKE ALL ON public.prod_posto_treinamento FROM anon;

-- ── fn_ltcat_painel: setores da empresa com as funções e seus vínculos + listas dos selects ─────────────────
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

-- ── fn_ltcat_funcao_salvar: uma função inteira (descrição + riscos + EPIs + treinamentos), atômico ──────────
-- p_dados: {id?, company_id, setor_id, nome, descricao, riscos:[{tipo,descricao,grau}], epis:[uuid], treinamentos:[uuid]}
-- Os três conjuntos são SUBSTITUÍDOS pelo que a tela mandou (o que saiu da lista sai do cadastro).
CREATE OR REPLACE FUNCTION public.fn_ltcat_funcao_salvar(p_dados jsonb)
 RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id     uuid := NULLIF(p_dados->>'id', '')::uuid;
  v_comp   uuid := NULLIF(p_dados->>'company_id', '')::uuid;
  v_setor  uuid := NULLIF(p_dados->>'setor_id', '')::uuid;
  v_nome   text := btrim(coalesce(p_dados->>'nome', ''));
  v_desc   text := NULLIF(btrim(coalesce(p_dados->>'descricao', '')), '');
  v_plant  uuid; v_num int; v_r jsonb; v_tipo text; v_rdesc text; v_x uuid;
  v_epis   uuid[] := ARRAY(SELECT DISTINCT x::uuid FROM jsonb_array_elements_text(coalesce(p_dados->'epis', '[]'::jsonb)) x);
  v_trein  uuid[] := ARRAY(SELECT DISTINCT x::uuid FROM jsonb_array_elements_text(coalesce(p_dados->'treinamentos', '[]'::jsonb)) x);
BEGIN
  IF v_id IS NOT NULL THEN
    SELECT company_id, setor_id, plant_id INTO v_comp, v_setor, v_plant FROM prod_posto WHERE id = v_id;
    IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'funcao_nao_encontrada'); END IF;
  ELSE
    SELECT plant_id INTO v_plant FROM prod_setor WHERE id = v_setor AND company_id = v_comp;
    IF v_plant IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'setor_invalido'); END IF;
  END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  IF v_nome = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'nome_obrigatorio'); END IF;

  -- validações antes de gravar qualquer coisa
  FOR v_r IN SELECT * FROM jsonb_array_elements(coalesce(p_dados->'riscos', '[]'::jsonb)) LOOP
    IF coalesce(v_r->>'tipo', '') NOT IN ('fisico','quimico','biologico','ergonomico','acidente') THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'risco_tipo_invalido');
    END IF;
    IF btrim(coalesce(v_r->>'descricao', '')) = '' THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'risco_sem_descricao');
    END IF;
  END LOOP;
  FOREACH v_x IN ARRAY v_epis LOOP
    IF NOT EXISTS (SELECT 1 FROM epi_catalogo WHERE id = v_x AND (company_id = v_comp OR is_global)) THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'epi_de_outra_empresa');
    END IF;
  END LOOP;
  FOREACH v_x IN ARRAY v_trein LOOP
    IF NOT EXISTS (SELECT 1 FROM nr_treinamento_tipo WHERE id = v_x AND company_id = v_comp) THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'treinamento_de_outra_empresa');
    END IF;
  END LOOP;

  IF v_id IS NULL THEN
    -- número automático por setor: F01, F02… (a chave única do posto é empresa+planta+setor+número)
    SELECT coalesce(max(NULLIF(regexp_replace(numero, '\D', '', 'g'), '')::int), 0) + 1 INTO v_num
      FROM prod_posto WHERE company_id = v_comp AND plant_id = v_plant AND setor_id = v_setor AND numero ~ '^F\d+$';
    INSERT INTO prod_posto (company_id, plant_id, setor_id, numero, atividade, descricao_funcao, ordem_linha, ativo)
    VALUES (v_comp, v_plant, v_setor, 'F' || lpad(v_num::text, 2, '0'), v_nome, v_desc, v_num, true)
    RETURNING id INTO v_id;
  ELSE
    UPDATE prod_posto SET atividade = v_nome, descricao_funcao = v_desc, updated_at = now() WHERE id = v_id;
  END IF;

  DELETE FROM prod_posto_risco WHERE posto_id = v_id;
  FOR v_r IN SELECT * FROM jsonb_array_elements(coalesce(p_dados->'riscos', '[]'::jsonb)) LOOP
    v_tipo := v_r->>'tipo'; v_rdesc := btrim(v_r->>'descricao');
    INSERT INTO prod_posto_risco (company_id, posto_id, tipo, descricao, grau)
    VALUES (v_comp, v_id, v_tipo, v_rdesc, NULLIF(btrim(coalesce(v_r->>'grau', '')), ''));
  END LOOP;

  DELETE FROM prod_posto_epi WHERE posto_id = v_id AND NOT (catalogo_id = ANY (v_epis));
  INSERT INTO prod_posto_epi (company_id, posto_id, catalogo_id, obrigatorio)
  SELECT v_comp, v_id, x, true FROM unnest(v_epis) x ON CONFLICT (posto_id, catalogo_id) DO NOTHING;

  DELETE FROM prod_posto_treinamento WHERE posto_id = v_id AND NOT (tipo_id = ANY (v_trein));
  INSERT INTO prod_posto_treinamento (company_id, posto_id, tipo_id, obrigatorio)
  SELECT v_comp, v_id, x, true FROM unnest(v_trein) x ON CONFLICT (posto_id, tipo_id) DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'id', v_id,
    'riscos', (SELECT count(*) FROM prod_posto_risco WHERE posto_id = v_id),
    'epis', (SELECT count(*) FROM prod_posto_epi WHERE posto_id = v_id),
    'treinamentos', (SELECT count(*) FROM prod_posto_treinamento WHERE posto_id = v_id));
END $function$;

-- ── fn_ltcat_funcao_excluir: inativa a função (o histórico e o que a Produtividade usa ficam) ──────────────
CREATE OR REPLACE FUNCTION public.fn_ltcat_funcao_excluir(p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid;
BEGIN
  SELECT company_id INTO v_comp FROM prod_posto WHERE id = p_id;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'funcao_nao_encontrada'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  UPDATE prod_posto SET ativo = false, updated_at = now() WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.fn_ltcat_painel(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_ltcat_funcao_salvar(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_ltcat_funcao_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ltcat_painel(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_ltcat_funcao_salvar(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_ltcat_funcao_excluir(uuid) TO authenticated, service_role;
