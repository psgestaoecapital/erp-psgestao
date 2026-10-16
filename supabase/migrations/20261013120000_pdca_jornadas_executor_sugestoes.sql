-- PDCA automático · fatia C/A (CEO 09/10, msg 5ae18d7b): conferência SQL dos passos das jornadas Hub e GE,
-- executor das jornadas (lê a DEMO da vertical), registro de sugestões com dedup e placar.
-- Aditiva: 1 tabela NOVA (RLS ligada, sem policy, REVOKE anon/authenticated), 2 funções NOVAS e 1 view NOVA.
-- Só SELECT nas DEMOs; o executor roda com timeout curto e só pelo service_role.
-- Code: gilberto-chamados

CREATE TABLE IF NOT EXISTS public.pdca_jornada_resultado (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  passo_id    uuid NOT NULL REFERENCES public.pdca_jornada_passo(id) ON DELETE CASCADE,
  jornada_id  uuid NOT NULL REFERENCES public.pdca_jornada(id) ON DELETE CASCADE,
  vertical    text NOT NULL,
  status      text NOT NULL CHECK (status IN ('verde','vermelho','erro','sem_demo','sem_conferencia')),
  esperado    int,
  encontrado  int,
  diagnostico text,
  avaliado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pdca_jornada_resultado_passo_idx ON public.pdca_jornada_resultado (passo_id, avaliado_em DESC);
ALTER TABLE public.pdca_jornada_resultado ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pdca_jornada_resultado FROM anon, authenticated;

-- Conferências dos passos ($1 = company_id da DEMO; uma linha: esperado, encontrado). Só preenche onde está vazio.
UPDATE public.pdca_jornada_passo p SET sql_confere = c.q
FROM public.pdca_jornada j,
(VALUES
 ('hub-cliente-ate-resultado',1,$q$SELECT 1, (SELECT count(DISTINCT cliente_id) FROM erp_crm_oportunidade WHERE company_id=$1 AND deleted_at IS NULL AND cliente_id IS NOT NULL)::int$q$),
 ('hub-cliente-ate-resultado',2,$q$SELECT 1, (SELECT count(*) FROM erp_crm_oportunidade WHERE company_id=$1 AND deleted_at IS NULL)::int$q$),
 ('hub-cliente-ate-resultado',3,$q$SELECT 1, (SELECT count(*) FROM erp_crm_oportunidade WHERE company_id=$1 AND deleted_at IS NULL AND COALESCE(valor_proposta,0) > 0)::int$q$),
 ('hub-cliente-ate-resultado',4,$q$SELECT 1, (SELECT count(*) FROM projetos_obras WHERE company_id=$1 AND oportunidade_id IS NOT NULL)::int$q$),
 ('hub-cliente-ate-resultado',5,$q$SELECT 1, (SELECT count(*) FROM projetos_obras WHERE company_id=$1 AND COALESCE(custo_realizado,0) > 0)::int$q$),
 ('hub-cliente-ate-resultado',6,$q$SELECT 1, (SELECT count(*) FROM projetos_obras WHERE company_id=$1 AND COALESCE(valor_previsto,0) > 0 AND COALESCE(custo_realizado,0) > 0)::int$q$),
 ('ge-pagar-ate-dre',1,$q$SELECT 1, (SELECT count(*) FROM erp_pagar WHERE company_id=$1 AND deleted_at IS NULL)::int$q$),
 ('ge-pagar-ate-dre',2,$q$SELECT 1, (SELECT count(*) FROM erp_pagar WHERE company_id=$1 AND deleted_at IS NULL AND data_pagamento IS NOT NULL)::int$q$),
 ('ge-pagar-ate-dre',3,$q$SELECT 1, (SELECT count(*) FROM erp_pagar WHERE company_id=$1 AND deleted_at IS NULL AND conciliado IS TRUE)::int$q$)
) AS c(cod, ordem, q)
WHERE j.codigo = c.cod AND p.jornada_id = j.id AND p.ordem = c.ordem AND p.sql_confere IS NULL;

-- ci-sem-guarda: fn_pdca_jornadas_executar — só service_role (rotina/robô); lê a DEMO e grava resultado
CREATE OR REPLACE FUNCTION public.fn_pdca_jornadas_executar(p_vertical text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  p record; v_demo uuid; v_esp int; v_enc int; v_st text; v_dx text;
  v_verde int := 0; v_verm int := 0; v_outro int := 0;
BEGIN
  SET LOCAL statement_timeout = '10s';
  FOR p IN
    SELECT j.id jornada_id, j.vertical, j.codigo, j.empresa_demo_id, s.id passo_id, s.ordem, s.passo, s.rota, s.deve_aparecer, s.sql_confere
    FROM pdca_jornada j JOIN pdca_jornada_passo s ON s.jornada_id = j.id
    WHERE j.ativa AND (p_vertical IS NULL OR j.vertical = p_vertical)
    ORDER BY j.vertical, j.codigo, s.ordem
  LOOP
    v_esp := NULL; v_enc := NULL; v_dx := NULL;
    v_demo := COALESCE(p.empresa_demo_id, fn_demo_da_area(p.vertical));
    IF p.sql_confere IS NULL THEN
      v_st := 'sem_conferencia'; v_dx := 'Passo ainda sem consulta de conferência.';
    ELSIF v_demo IS NULL THEN
      v_st := 'sem_demo'; v_dx := 'Vertical sem empresa DEMO.';
    ELSE
      BEGIN
        EXECUTE p.sql_confere INTO v_esp, v_enc USING v_demo;
        IF COALESCE(v_enc,0) >= COALESCE(v_esp,1) THEN v_st := 'verde';
        ELSE
          v_st := 'vermelho';
          v_dx := format('Falta desenvolver: passo %s "%s" (%s) — deve aparecer: %s. Esperado %s, encontrado %s.', p.ordem, p.passo, p.rota, p.deve_aparecer, v_esp, COALESCE(v_enc,0));
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_st := 'erro'; v_dx := left(SQLERRM, 300);
      END;
    END IF;
    INSERT INTO pdca_jornada_resultado(passo_id, jornada_id, vertical, status, esperado, encontrado, diagnostico)
    VALUES (p.passo_id, p.jornada_id, p.vertical, v_st, v_esp, v_enc, v_dx);
    IF v_st = 'verde' THEN v_verde := v_verde + 1; ELSIF v_st = 'vermelho' THEN v_verm := v_verm + 1; ELSE v_outro := v_outro + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'verde', v_verde, 'vermelho', v_verm, 'erro_sem_demo_ou_sem_conferencia', v_outro);
END $function$;
REVOKE ALL ON FUNCTION public.fn_pdca_jornadas_executar(text) FROM PUBLIC, anon, authenticated;

-- ci-sem-guarda: fn_pdca_sugestao_registrar — só service_role; dedup por (vertical, chave_dedup), nunca duplica
CREATE OR REPLACE FUNCTION public.fn_pdca_sugestao_registrar(
  p_vertical text, p_eixo text, p_titulo text, p_descricao text DEFAULT NULL, p_impacto text DEFAULT NULL,
  p_rota text DEFAULT NULL, p_blueprint_secao text DEFAULT NULL, p_blueprint_texto text DEFAULT NULL, p_ciclo_ref text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_chave text; v_id uuid; v_novo boolean := true;
BEGIN
  IF p_eixo NOT IN ('facilidade','produtividade','custo','vantagem') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'eixo_invalido');
  END IF;
  v_chave := md5(lower(trim(coalesce(p_rota,''))) || '|' || p_eixo || '|' || lower(trim(p_titulo)));
  INSERT INTO pdca_sugestao(vertical, rota, eixo, titulo, descricao, impacto_estimado, blueprint_secao, blueprint_texto_sugerido, ciclo_ref, chave_dedup)
  VALUES (p_vertical, p_rota, p_eixo, p_titulo, p_descricao, p_impacto, p_blueprint_secao, p_blueprint_texto, p_ciclo_ref, v_chave)
  ON CONFLICT (vertical, chave_dedup) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    v_novo := false;
    SELECT id INTO v_id FROM pdca_sugestao WHERE vertical = p_vertical AND chave_dedup = v_chave;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'nova', v_novo);
END $function$;
REVOKE ALL ON FUNCTION public.fn_pdca_sugestao_registrar(text,text,text,text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;

-- Placar das jornadas por vertical (último resultado de cada passo)
CREATE OR REPLACE VIEW public.vw_pdca_jornada_placar WITH (security_invoker = true) AS
SELECT j.vertical,
       count(*) AS passos,
       count(*) FILTER (WHERE r.status = 'verde') AS verdes,
       count(*) FILTER (WHERE r.status = 'vermelho') AS vermelhos,
       count(*) FILTER (WHERE r.status IS DISTINCT FROM 'verde' AND r.status IS DISTINCT FROM 'vermelho') AS sem_prova,
       round(100.0 * count(*) FILTER (WHERE r.status = 'verde') / NULLIF(count(*),0), 1) AS pct_verde
FROM pdca_jornada j
JOIN pdca_jornada_passo s ON s.jornada_id = j.id
LEFT JOIN LATERAL (SELECT status FROM pdca_jornada_resultado WHERE passo_id = s.id ORDER BY avaliado_em DESC LIMIT 1) r ON true
WHERE j.ativa GROUP BY j.vertical;
REVOKE ALL ON public.vw_pdca_jornada_placar FROM anon, authenticated;
