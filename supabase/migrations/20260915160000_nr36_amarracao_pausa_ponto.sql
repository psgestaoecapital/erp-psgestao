-- ============================================================
-- SST ③ · amarração pausa × ponto — comprovar as pausas sem hora de saída
-- ============================================================
-- As classes pausa_nao_fechada (>limite, fim suspeito = esquecimento) e pausa_aberta (fim nulo)
-- não têm hora de saída confiável. O sistema SUGERE o fim pela batida do ponto — nunca decide.
-- A responsável confirma. Grava-se sempre a ORIGEM de cada horário (o relatório para o MTE precisa
-- dizer de onde veio cada fim).
--
-- 🔴 FUSO (registrado em contexto): ind_ponto_pausa.inicio/fim é UTC REAL → converter com
--    AT TIME ZONE 'America/Sao_Paulo' para bater com a batida do ponto (raw.points, hora LOCAL).
--    Sem isso, casa a batida errada por 3h. Prova: pausa fechada 10:52 SP = batida 10:52.
--
-- Dois níveis de sugestão, VISUALMENTE distintos (a Técnica precisa ver "o ponto diz" × "estimado"):
--   batida_forte    → há batida dentro de janela_busca_batida_min → fim provável = a batida
--   inferencia_fraca→ a próxima batida só no fim do turno → estimativa = inicio + pausa_min
--                     (nunca sugerir a saída do turno como fim de pausa: daria pausa de horas).
-- Genérico por tenant (qualquer empresa com pausa e ponto).

-- 1) Colunas de amarração (aditivas; RD-30 não toca inicio/fim/duracao/raw).
ALTER TABLE public.ind_ponto_pausa
  ADD COLUMN IF NOT EXISTS fim_origem        text,        -- registrado · confirmado_ponto · confirmado_manual · indeterminado
  ADD COLUMN IF NOT EXISTS fim_sugerido      timestamptz, -- sugestão do motor (UTC)
  ADD COLUMN IF NOT EXISTS fim_sugerido_tipo text,        -- batida_forte · inferencia_fraca
  ADD COLUMN IF NOT EXISTS fim_confirmado    timestamptz; -- fim após confirmação humana (UTC)

COMMENT ON COLUMN public.ind_ponto_pausa.fim_origem IS
  'Origem do fim da pausa (Lei/MTE): registrado (relógio) · confirmado_ponto · confirmado_manual · indeterminado. NULL = pendente de amarração.';

-- 2) Backfill fim_origem: pausas fechadas confiáveis (insuficiente/normal/excesso) = 'registrado'.
--    As pendentes (nao_fechada/aberta) ficam NULL até a responsável confirmar.
UPDATE public.ind_ponto_pausa
   SET fim_origem = 'registrado'
 WHERE fim_origem IS NULL
   AND fim IS NOT NULL AND em_aberto IS NOT TRUE
   AND classe_evento IN ('pausa_insuficiente','pausa_normal','pausa_excesso');

-- 3) Motor: sugere o fim de UMA pausa pendente. jsonb {fim_sugerido, tipo, batida_hora, minutos}.
CREATE OR REPLACE FUNCTION public.fn_nr36_sugerir_fim_pausa(p_pausa_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_p record; v_par jsonb; v_jan numeric; v_pmin numeric;
  v_inicio_local timestamp; v_batida_local timestamp; v_na_janela boolean;
  v_fim_sug timestamptz; v_tipo text;
BEGIN
  SELECT company_id, cpf, data, inicio INTO v_p FROM public.ind_ponto_pausa WHERE id = p_pausa_id;
  IF v_p IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado'); END IF;
  IF NOT (v_p.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT parametros INTO v_par FROM public.nr36_pausa_regra
    WHERE company_id=v_p.company_id AND tipo='termica_253' AND ativo LIMIT 1;
  v_jan  := COALESCE((v_par->>'janela_busca_batida_min')::numeric, 120);
  v_pmin := COALESCE((v_par->>'pausa_min')::numeric, 20);
  v_inicio_local := v_p.inicio AT TIME ZONE 'America/Sao_Paulo';   -- UTC real → wall local
  -- batida do ponto mais próxima DEPOIS do início (hora local; raw.points já é local)
  SELECT min((pt->>'datetime')::timestamp) INTO v_batida_local
    FROM public.ind_ponto_dia d, jsonb_array_elements(d.raw->'points') pt
   WHERE d.company_id=v_p.company_id AND d.cpf=v_p.cpf AND d.data=v_p.data
     AND (pt->>'datetime')::timestamp > v_inicio_local;
  v_na_janela := v_batida_local IS NOT NULL
                 AND v_batida_local <= v_inicio_local + make_interval(mins => v_jan::int);
  IF v_na_janela THEN
    v_fim_sug := v_batida_local AT TIME ZONE 'America/Sao_Paulo';  -- wall local → UTC
    v_tipo := 'batida_forte';
  ELSE
    v_fim_sug := v_p.inicio + make_interval(mins => v_pmin::int);  -- estimativa: inicio + pausa_min
    v_tipo := 'inferencia_fraca';
  END IF;
  RETURN jsonb_build_object('ok', true, 'tipo', v_tipo,
    'fim_sugerido', v_fim_sug,
    'fim_sugerido_local', to_char(v_fim_sug AT TIME ZONE 'America/Sao_Paulo','HH24:MI'),
    'inicio_local', to_char(v_inicio_local,'HH24:MI'),
    'batida_local', CASE WHEN v_na_janela THEN to_char(v_batida_local,'HH24:MI') ELSE NULL END,
    'minutos_ate_batida', CASE WHEN v_batida_local IS NOT NULL THEN round(EXTRACT(EPOCH FROM (v_batida_local - v_inicio_local))/60) ELSE NULL END);
END $fn$;
GRANT EXECUTE ON FUNCTION public.fn_nr36_sugerir_fim_pausa(uuid) TO authenticated;

-- 4) Popula fim_sugerido/tipo dos pendentes (plain UPDATE, sem assert — roda no db push). Genérico.
UPDATE public.ind_ponto_pausa p SET
  fim_sugerido = sub.fim_sug,
  fim_sugerido_tipo = sub.tipo
FROM (
  SELECT p2.id,
    CASE WHEN prox.batida_local IS NOT NULL
              AND prox.batida_local <= (p2.inicio AT TIME ZONE 'America/Sao_Paulo') + make_interval(mins => COALESCE(r.jan,120)::int)
         THEN prox.batida_local AT TIME ZONE 'America/Sao_Paulo'
         ELSE p2.inicio + make_interval(mins => COALESCE(r.pmin,20)::int) END AS fim_sug,
    CASE WHEN prox.batida_local IS NOT NULL
              AND prox.batida_local <= (p2.inicio AT TIME ZONE 'America/Sao_Paulo') + make_interval(mins => COALESCE(r.jan,120)::int)
         THEN 'batida_forte' ELSE 'inferencia_fraca' END AS tipo
  FROM public.ind_ponto_pausa p2
  LEFT JOIN (
    SELECT company_id,
      (parametros->>'janela_busca_batida_min')::numeric AS jan,
      (parametros->>'pausa_min')::numeric AS pmin
    FROM public.nr36_pausa_regra WHERE tipo='termica_253' AND ativo
  ) r ON r.company_id = p2.company_id
  LEFT JOIN LATERAL (
    SELECT min((pt->>'datetime')::timestamp) AS batida_local
    FROM public.ind_ponto_dia d, jsonb_array_elements(d.raw->'points') pt
    WHERE d.company_id=p2.company_id AND d.cpf=p2.cpf AND d.data=p2.data
      AND (pt->>'datetime')::timestamp > (p2.inicio AT TIME ZONE 'America/Sao_Paulo')
  ) prox ON true
  WHERE p2.fim_origem IS NULL   -- só os pendentes (nao_fechada / aberta)
) sub
WHERE sub.id = p.id;

-- 5) Confirmação (a responsável decide). p_acao: confirmar_ponto · confirmar_estimativa · corrigir · indeterminado.
CREATE OR REPLACE FUNCTION public.fn_nr36_confirmar_fim_pausa(p_pausa_id uuid, p_acao text, p_fim_manual timestamptz DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_p record; v_fim timestamptz; v_origem text;
BEGIN
  SELECT company_id, fim_sugerido, fim_sugerido_tipo INTO v_p FROM public.ind_ponto_pausa WHERE id=p_pausa_id;
  IF v_p IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado'); END IF;
  IF NOT (v_p.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_acao = 'confirmar_ponto' THEN
    v_fim := v_p.fim_sugerido; v_origem := 'confirmado_ponto';
  ELSIF p_acao = 'confirmar_estimativa' THEN
    v_fim := v_p.fim_sugerido; v_origem := 'confirmado_manual';   -- estimativa aceita = responsabilidade humana
  ELSIF p_acao = 'corrigir' THEN
    IF p_fim_manual IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'fim_obrigatorio'); END IF;
    v_fim := p_fim_manual; v_origem := 'confirmado_manual';
  ELSIF p_acao = 'indeterminado' THEN
    v_fim := NULL; v_origem := 'indeterminado';
  ELSE
    RETURN jsonb_build_object('ok', false, 'erro', 'acao_invalida');
  END IF;
  -- RD-30: NÃO toca inicio/fim/duracao/raw da pausa importada. Grava só a amarração
  -- (fim_confirmado + fim_origem). O fim EFETIVO na apuração (④) = COALESCE(fim_confirmado, fim).
  -- Isso é o que dá o caminho de volta: desfazer é limpar fim_confirmado/fim_origem, sem perder o original.
  UPDATE public.ind_ponto_pausa
     SET fim_confirmado = v_fim, fim_origem = v_origem
   WHERE id = p_pausa_id;
  RETURN jsonb_build_object('ok', true, 'fim_origem', v_origem, 'fim_confirmado', v_fim);
END $fn$;
GRANT EXECUTE ON FUNCTION public.fn_nr36_confirmar_fim_pausa(uuid, text, timestamptz) TO authenticated;

-- 6) Confirmação em LOTE (546 casos — o lote é obrigatório). Aplica a mesma ação a vários ids.
CREATE OR REPLACE FUNCTION public.fn_nr36_confirmar_fim_lote(p_pausa_ids uuid[], p_acao text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_id uuid; v_r jsonb; v_ok int := 0; v_err int := 0;
BEGIN
  IF p_acao = 'corrigir' THEN RETURN jsonb_build_object('ok', false, 'erro', 'corrigir_nao_em_lote'); END IF;
  FOREACH v_id IN ARRAY p_pausa_ids LOOP
    v_r := public.fn_nr36_confirmar_fim_pausa(v_id, p_acao, NULL);
    IF (v_r->>'ok')::boolean THEN v_ok := v_ok + 1; ELSE v_err := v_err + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'confirmados', v_ok, 'erros', v_err);
END $fn$;
GRANT EXECUTE ON FUNCTION public.fn_nr36_confirmar_fim_lote(uuid[], text) TO authenticated;

-- 6b) DESFAZER por período (o caminho de volta — 546 confirmações são irreversíveis na prática).
--     Volta ao estado PENDENTE as pausas confirmadas/indeterminadas no período. Como o confirmar
--     nunca tocou o fim original (RD-30), desfazer é só limpar fim_confirmado + fim_origem.
CREATE OR REPLACE FUNCTION public.fn_nr36_desfazer_amarracao_periodo(p_company_id uuid, p_dt_ini date, p_dt_fim date)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_n int;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  UPDATE public.ind_ponto_pausa
     SET fim_confirmado = NULL, fim_origem = NULL
   WHERE company_id = p_company_id
     AND data BETWEEN p_dt_ini AND p_dt_fim
     AND fim_origem IN ('confirmado_ponto','confirmado_manual','indeterminado')
     AND classe_evento IN ('pausa_nao_fechada','pausa_aberta');   -- só as pendentes; nunca as 'registrado'
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'desfeitas', v_n);
END $fn$;
GRANT EXECUTE ON FUNCTION public.fn_nr36_desfazer_amarracao_periodo(uuid, date, date) TO authenticated;

-- 7) Listagem para a tela de conferência: pendentes por colaborador/dia + a sugestão e seu tipo.
CREATE OR REPLACE FUNCTION public.fn_nr36_pausas_pendentes_listar(p_company_id uuid, p_limite int DEFAULT 1000)
 RETURNS TABLE(pausa_id uuid, cpf text, colaborador text, data date, classe_evento text,
   inicio_local text, fim_sugerido_local text, fim_sugerido_tipo text, batida_local text, minutos_ate_batida numeric)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN; END IF;
  RETURN QUERY
  SELECT p.id, p.cpf,
    COALESCE(c.nome, p.cpf) AS colaborador,
    p.data, p.classe_evento,
    to_char(p.inicio AT TIME ZONE 'America/Sao_Paulo','HH24:MI'),
    to_char(p.fim_sugerido AT TIME ZONE 'America/Sao_Paulo','HH24:MI'),
    p.fim_sugerido_tipo,
    CASE WHEN p.fim_sugerido_tipo='batida_forte' THEN to_char(p.fim_sugerido AT TIME ZONE 'America/Sao_Paulo','HH24:MI') ELSE NULL END,
    NULL::numeric
  FROM public.ind_ponto_pausa p
  LEFT JOIN public.ind_ponto_colaborador c ON c.company_id=p.company_id AND c.cpf=p.cpf
  WHERE p.company_id = p_company_id AND p.fim_origem IS NULL
  ORDER BY p.data, p.cpf, p.inicio
  LIMIT p_limite;
END $fn$;
GRANT EXECUTE ON FUNCTION public.fn_nr36_pausas_pendentes_listar(uuid, int) TO authenticated;
