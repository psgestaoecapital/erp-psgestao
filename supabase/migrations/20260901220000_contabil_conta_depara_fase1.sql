-- Contábil · Fase 1 — Importador de plano de contas do contador (de-para de contas).
-- Decisão do CEO (§2 = Híbrido): a contabilidade nasce da operação, MAS só classifica quando a
-- origem determina a conta sem ambiguidade; o resto vira FILA DE PENDENTES nomeada. Aqui, na base:
-- o de-para casa a conta do PS (código hierárquico, ex. 1.01.01) com o código que o contador importa
-- (ex. 142). Casa SÓ o exato; sem match, plano_conta_id fica NULL = pendente (nunca um padrão
-- genérico — isso é o catalogo[0] de novo, RD-51). Numeração é POR EMPRESA (o 142 de um cliente não
-- é o 142 de outro) — daí o UNIQUE(company_id, codigo_externo) e a guarda de mesma empresa no vínculo.
-- Vale sozinho e é pré-requisito de tudo (§6 Fase 1). Não constrói o gerador antes disto.

CREATE TABLE IF NOT EXISTS public.contabil_conta_depara (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  escritorio_id     uuid REFERENCES public.escritorios_contabeis(id),
  plano_conta_id    uuid REFERENCES public.erp_plano_contas(id),   -- NULL = pendente (não casado)
  codigo_externo    text NOT NULL,                                 -- código que o contador importa (ex. '142')
  descricao_externa text,
  analitica         boolean,                                       -- só analítica aceita lançamento (vem do CSV)
  ativo             boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, codigo_externo)
);

ALTER TABLE public.contabil_conta_depara ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contabil_depara_rw ON public.contabil_conta_depara;
CREATE POLICY contabil_depara_rw ON public.contabil_conta_depara
  FOR ALL
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- Importa o plano do contador e monta o de-para. Cada linha: codigo_externo (obrigatório),
-- descricao_externa, analitica, e codigo_estruturado (opcional — o código hierárquico do PS, quando
-- o export do contador o traz). Casa por código estruturado EXATO; sem isso, fica pendente.
CREATE OR REPLACE FUNCTION public.fn_contabil_depara_importar(p_company_id uuid, p_escritorio_id uuid, p_rows jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r jsonb; v_cod_ext text; v_desc text; v_anal boolean; v_estrut text; v_plano uuid;
        v_import int := 0; v_casadas int := 0; v_pend int := 0;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_escritorio_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM escritorios_contabeis WHERE id = p_escritorio_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'escritorio_inexistente'); END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
    v_cod_ext := NULLIF(trim(r->>'codigo_externo'), '');
    CONTINUE WHEN v_cod_ext IS NULL;                 -- linha sem código externo não vira de-para
    v_desc    := NULLIF(trim(r->>'descricao_externa'), '');
    v_estrut  := NULLIF(trim(r->>'codigo_estruturado'), '');
    v_anal    := CASE
                   WHEN lower(r->>'analitica') IN ('true','t','a','analitica','analítica','1') THEN true
                   WHEN lower(r->>'analitica') IN ('false','f','s','sintetica','sintética','0') THEN false
                   ELSE NULL END;

    -- casamento EXATO (RD-55: nunca por semelhança). Só liga quando o código estruturado bate.
    v_plano := NULL;
    IF v_estrut IS NOT NULL THEN
      SELECT id INTO v_plano FROM erp_plano_contas
       WHERE company_id = p_company_id AND codigo = v_estrut LIMIT 1;
    END IF;

    INSERT INTO contabil_conta_depara(company_id, escritorio_id, plano_conta_id, codigo_externo, descricao_externa, analitica, ativo)
    VALUES (p_company_id, p_escritorio_id, v_plano, v_cod_ext, v_desc, v_anal, true)
    ON CONFLICT (company_id, codigo_externo) DO UPDATE
      SET descricao_externa = COALESCE(EXCLUDED.descricao_externa, contabil_conta_depara.descricao_externa),
          analitica         = COALESCE(EXCLUDED.analitica, contabil_conta_depara.analitica),
          -- não desfaz um vínculo já feito à mão; só preenche se ainda estava pendente
          plano_conta_id    = COALESCE(contabil_conta_depara.plano_conta_id, EXCLUDED.plano_conta_id),
          escritorio_id     = COALESCE(EXCLUDED.escritorio_id, contabil_conta_depara.escritorio_id),
          updated_at        = now();

    v_import := v_import + 1;
    IF v_plano IS NOT NULL THEN v_casadas := v_casadas + 1; ELSE v_pend := v_pend + 1; END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'importadas', v_import, 'casadas_exato', v_casadas, 'pendentes', v_pend);
END $function$;

-- Lista o de-para (pendentes primeiro) + totais. Fonte da fila de pendentes que a Jordana/contador resolve.
CREATE OR REPLACE FUNCTION public.fn_contabil_depara_listar(p_company_id uuid, p_somente_pendentes boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT jsonb_build_object(
    'ok', true,
    'linhas', COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.pendente DESC, t.codigo_externo)
      FROM (
        SELECT d.id, d.codigo_externo, d.descricao_externa, d.analitica, d.ativo,
               d.plano_conta_id, p.codigo AS plano_codigo, p.descricao AS plano_descricao,
               (d.plano_conta_id IS NULL) AS pendente
        FROM contabil_conta_depara d
        LEFT JOIN erp_plano_contas p ON p.id = d.plano_conta_id
        WHERE d.company_id = p_company_id
          AND (NOT p_somente_pendentes OR d.plano_conta_id IS NULL)
      ) t), '[]'::jsonb),
    'totais', (SELECT jsonb_build_object(
        'total', count(*),
        'pendentes', count(*) FILTER (WHERE plano_conta_id IS NULL),
        'casadas', count(*) FILTER (WHERE plano_conta_id IS NOT NULL)
      ) FROM contabil_conta_depara WHERE company_id = p_company_id)
  ) INTO v;
  RETURN v;
END $function$;

-- Vincula (ou desvincula, com código vazio) uma conta pendente a uma conta do plano PS pelo CÓDIGO.
-- Resolve o código dentro da MESMA empresa do de-para — cross-empresa é impossível por construção
-- (RD-51: o 142 de um cliente não é o de outro). A tela busca por fn_plano_contas_buscar (devolve código).
CREATE OR REPLACE FUNCTION public.fn_contabil_depara_vincular(p_depara_id uuid, p_plano_codigo text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_plano uuid; v_cod text := NULLIF(trim(p_plano_codigo), '');
BEGIN
  SELECT company_id INTO v_comp FROM contabil_conta_depara WHERE id = p_depara_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'depara_nao_encontrado'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_cod IS NOT NULL THEN
    SELECT id INTO v_plano FROM erp_plano_contas WHERE company_id = v_comp AND codigo = v_cod LIMIT 1;
    IF v_plano IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'conta_nao_encontrada_nesta_empresa'); END IF;
  END IF;  -- código vazio → desvincula (volta a pendente)
  UPDATE contabil_conta_depara SET plano_conta_id = v_plano, updated_at = now() WHERE id = p_depara_id;
  RETURN jsonb_build_object('ok', true, 'pendente', v_plano IS NULL);
END $function$;

REVOKE ALL ON FUNCTION public.fn_contabil_depara_importar(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_contabil_depara_listar(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_contabil_depara_vincular(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_contabil_depara_importar(uuid, uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_contabil_depara_listar(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_contabil_depara_vincular(uuid, text) TO authenticated, service_role;