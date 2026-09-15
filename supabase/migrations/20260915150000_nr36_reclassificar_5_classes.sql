-- ============================================================
-- SST ② · reclassificar eventos de pausa em 5 CLASSES (substitui a régua de 2 grupos errada)
-- ============================================================
-- A classificação anterior (SST ①) dividia os eventos em pausa (< limite_evento_pausa_min) e
-- EXPOSIÇÃO (>= limite). A premissa estava errada (esclarecido pela responsável de SST): o relógio
-- de pausa registra SÓ pausas; evento longo é ESQUECIMENTO de registro de saída, não exposição.
-- A régua (parâmetro por tenant, nada chumbado): pausa_min=20 · tolerancia_excesso_min=23 ·
-- limite_esquecimento_min=45. Provado no dado do validador: o vale entre 31,4 e 53,1 min separa
-- excesso de esquecimento (corte 45 cai no vazio). Distribuição provada em rollback:
-- insuficiente 95 · normal 260 · excesso 127 · nao_fechada 393 · aberta 153 = 1.028.
--
-- RD-30: NÃO apaga nada. classe_evento é DERIVADO (inicio/fim/duracao/raw intactos). O parâmetro
-- limite_evento_pausa_min fica no JSON (não removido), só deixa de ser usado.
-- Escopo: genérico por tenant (a régua vem de nr36_pausa_regra; sem régua, usa os defaults).
-- A apuração (fn_nr36_apurar, que ainda lê 'exposicao') é atualizada no ⑤; até lá o veredito está
-- SUSPENSO na tela (banner do ①) — RD-51.

-- 1) Classificação em 5 classes (para re-execução interativa; chamada por fn_nr36_apurar).
CREATE OR REPLACE FUNCTION public.fn_nr36_classificar_eventos(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_par jsonb; v_pmin numeric; v_tol numeric; v_esq numeric; v_n int; v_d jsonb;
BEGIN
  PERFORM public.fn_nr36_assert(p_company_id);
  SELECT parametros INTO v_par FROM public.nr36_pausa_regra
    WHERE company_id=p_company_id AND tipo='termica_253' AND ativo LIMIT 1;
  v_pmin := COALESCE((v_par->>'pausa_min')::numeric, 20);
  v_tol  := COALESCE((v_par->>'tolerancia_excesso_min')::numeric, 23);
  v_esq  := COALESCE((v_par->>'limite_esquecimento_min')::numeric, 45);
  UPDATE public.ind_ponto_pausa
     SET classe_evento = CASE
       WHEN fim IS NULL OR em_aberto IS TRUE  THEN 'pausa_aberta'
       WHEN duracao_seg/60.0 < v_pmin         THEN 'pausa_insuficiente'
       WHEN duracao_seg/60.0 < v_tol          THEN 'pausa_normal'
       WHEN duracao_seg/60.0 <= v_esq         THEN 'pausa_excesso'
       ELSE 'pausa_nao_fechada' END
   WHERE company_id = p_company_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  SELECT jsonb_object_agg(classe_evento, n) INTO v_d
    FROM (SELECT classe_evento, count(*) n FROM public.ind_ponto_pausa WHERE company_id=p_company_id GROUP BY 1) x;
  RETURN jsonb_build_object('ok', true, 'classificados', v_n,
    'regua', jsonb_build_object('pausa_min',v_pmin,'tolerancia_excesso_min',v_tol,'limite_esquecimento_min',v_esq),
    'distribuicao', COALESCE(v_d,'{}'::jsonb));
END $function$;

-- 2) Seed padrão (novos tenants) — térmica_253 nasce com os 5-classe params + amarração.
CREATE OR REPLACE FUNCTION public.fn_nr36_regra_seed_padrao(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn_nr36_assert(p_company_id);
  INSERT INTO public.nr36_pausa_regra (company_id, tipo, nome, base_legal, parametros) VALUES
   (p_company_id, 'psicofisiologica', 'Pausa Psicofisiológica', 'NR-36 item 36.13.2',
    '{"faixas":[{"ate_h":6,"min":20},{"ate_h":7.333,"min":45},{"ate_h":8.8,"min":60}],"acima_h":9.1667,"acima_add":10,"unitario_min":10,"unitario_max":20}'::jsonb),
   (p_company_id, 'termica_253', 'Recuperação Térmica', 'Art. 253 CLT + NR-15 Anexo 3 + Súmula 438 TST',
    '{"gatilho_min":100,"pausa_min":20,"continua":true,"tolerancia_excesso_min":23,"limite_esquecimento_min":45,"janela_busca_batida_min":120,"almoco_interrompe_exposicao":true}'::jsonb)
  ON CONFLICT (company_id, tipo) DO NOTHING;
  RETURN (SELECT public.fn_nr36_regra_listar(p_company_id));
END $function$;

-- 3) Backfill ADITIVO dos parâmetros nas réguas térmica_253 existentes (defaults só onde faltam —
--    o que a empresa já tem prevalece; RD-30). Não remove limite_evento_pausa_min.
UPDATE public.nr36_pausa_regra
   SET parametros = '{"tolerancia_excesso_min":23,"limite_esquecimento_min":45,"janela_busca_batida_min":120,"almoco_interrompe_exposicao":true}'::jsonb || parametros
 WHERE tipo = 'termica_253';

-- 4) Reclassifica os eventos já importados nas 5 classes (plain UPDATE, sem assert — roda no db push).
--    Genérico: usa a régua de cada empresa; sem régua, defaults 20/23/45.
UPDATE public.ind_ponto_pausa p
   SET classe_evento = CASE
     WHEN p.fim IS NULL OR p.em_aberto IS TRUE THEN 'pausa_aberta'
     WHEN p.duracao_seg/60.0 < v.pmin          THEN 'pausa_insuficiente'
     WHEN p.duracao_seg/60.0 < v.tol           THEN 'pausa_normal'
     WHEN p.duracao_seg/60.0 <= v.esq          THEN 'pausa_excesso'
     ELSE 'pausa_nao_fechada' END
  FROM (
    SELECT p2.id,
      COALESCE((r.parametros->>'pausa_min')::numeric, 20)              AS pmin,
      COALESCE((r.parametros->>'tolerancia_excesso_min')::numeric, 23) AS tol,
      COALESCE((r.parametros->>'limite_esquecimento_min')::numeric, 45) AS esq
    FROM public.ind_ponto_pausa p2
    LEFT JOIN public.nr36_pausa_regra r
      ON r.company_id = p2.company_id AND r.tipo='termica_253' AND r.ativo
  ) v
 WHERE v.id = p.id;
