-- =====================================================================
-- feat(indústria/rh): "um número só" de encargos — Quadro/BI/ficha lêem erp_encargos_empresa + % real da folha (Eng. Chefe 25/11)
-- erp_encargos_empresa/rh_parametro_custo/fn_* não são tabela de domínio (RD-97 ok).
-- =====================================================================

-- (a) % REAL da folha: patronal / proventos da competência, com a lista de verbas classificadas p/ a tela "ver as verbas".
--     numerador = verbas de ENCARGO PATRONAL (INSS empresa, RAT/SAT, terceiros, FGTS); NUNCA INSS/IRRF descontado do
--     empregado (esses são tipo 'desconto'). denominador = PROVENTOS (salário, HE, adicionais, DSR, comissões).
--     Folha é dado sensível (salário): só RH/diretoria (fn__pode_ver_folha).
CREATE OR REPLACE FUNCTION public.fn_rh_folha_encargos_real(p_company_id uuid, p_competencia date DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_interno boolean := coalesce(current_setting('request.jwt.claims', true), '') = '';
  v_comp date; v_enc numeric; v_prov numeric; v_verbas jsonb;
BEGIN
  IF p_company_id IS NULL OR NOT (v_interno OR auth.role() = 'service_role' OR p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  IF NOT (v_interno OR auth.role() = 'service_role' OR public.fn__pode_ver_folha(p_company_id)) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso_folha');
  END IF;
  v_comp := COALESCE(p_competencia, (SELECT max(competencia) FROM folha_verba WHERE company_id = p_company_id));
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', true, 'tem_folha', false); END IF;
  SELECT sum(valor) FILTER (WHERE tipo = 'encargo'), sum(valor) FILTER (WHERE tipo = 'provento')
    INTO v_enc, v_prov FROM folha_verba WHERE company_id = p_company_id AND competencia = v_comp;
  SELECT jsonb_agg(jsonb_build_object('codigo', codigo_verba, 'descricao', descricao, 'tipo', tipo, 'valor', valor)
                   ORDER BY tipo, valor DESC)
    INTO v_verbas FROM (
      SELECT codigo_verba, max(descricao) AS descricao, tipo, round(sum(valor), 2) AS valor
        FROM folha_verba WHERE company_id = p_company_id AND competencia = v_comp AND tipo IN ('encargo', 'provento')
        GROUP BY codigo_verba, tipo) x;
  RETURN jsonb_build_object('ok', true, 'tem_folha', true, 'competencia', v_comp,
    'total_encargo', round(COALESCE(v_enc, 0), 2), 'total_provento', round(COALESCE(v_prov, 0), 2),
    'pct', CASE WHEN COALESCE(v_prov, 0) > 0 THEN round(100.0 * v_enc / v_prov, 2) ELSE NULL END,
    'verbas', COALESCE(v_verbas, '[]'::jsonb));
END $fn$;
REVOKE ALL ON FUNCTION public.fn_rh_folha_encargos_real(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_rh_folha_encargos_real(uuid, date) TO authenticated, service_role;

-- (b) migra o encargos_pct salvo em rh_parametro_custo (2 linhas = 38,35, empresas DEMO) para erp_encargos_empresa,
--     para o custo dessas empresas NÃO mudar quando o Quadro passar a ler erp_encargos_empresa. Breakdown que
--     totaliza o pct: inss 20 + rat 3 + fgts 8 + terceiros (pct-31). [Dado de empresa DEMO; autorizado pelo CEO/Eng.Chefe.]
INSERT INTO public.erp_encargos_empresa
  (company_id, vigencia_inicio, regime, inss_patronal_pct, rat_pct, fap, terceiros_pct, fgts_pct,
   desoneracao, desoneracao_fator_folha, prov_13_pct, prov_ferias_pct, prov_rescisao_pct, observacao)
SELECT pc.company_id, DATE '2020-01-01',
   CASE WHEN lower(coalesce(c.regime_tributario, '')) LIKE '%simples%' THEN 'simples'
        WHEN lower(coalesce(c.regime_tributario, '')) LIKE '%real%' THEN 'real' ELSE 'presumido' END,
   20, 3, 1, round(pc.encargos_pct - 31, 4), 8, false, 1, 8.33, 11.11, 4,
   'Migrado de rh_parametro_custo (encargos_pct=' || pc.encargos_pct || ') — um número só no Quadro/BI/ficha (Eng. Chefe 25/11).'
FROM public.rh_parametro_custo pc JOIN public.companies c ON c.id = pc.company_id
WHERE pc.encargos_pct IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.erp_encargos_empresa e WHERE e.company_id = pc.company_id);

-- (c) fn_rh_quadro_base: o encargo (v_enc) passa a vir de erp_encargos_empresa (via fn_mao_obra_encargos_vigentes,
--     MESMA fonte da ficha/BI), não mais de rh_parametro_custo.encargos_pct/38.35 — "um número só". Troca cirúrgica no
--     fonte vivo (âncora única conferida); horas_mes/fonte_custo seguem de rh_parametro_custo.
DO $do$
DECLARE v_src text; v_n int;
BEGIN
  v_src := pg_get_functiondef('public.fn_rh_quadro_base(uuid,date)'::regprocedure);
  v_n := (length(v_src) - length(replace(v_src, 'v_enc := COALESCE(v_enc,38.35);', ''))) / length('v_enc := COALESCE(v_enc,38.35);');
  IF v_n <> 1 THEN RAISE EXCEPTION 'fn_rh_quadro_base: ancora v_enc 38.35 nao e unica (% ocorrencias) — revise a migration', v_n; END IF;
  EXECUTE replace(v_src, 'v_enc := COALESCE(v_enc,38.35);',
    'v_enc := COALESCE((fn_mao_obra_encargos_vigentes(p_company_id) ->> ''encargos_folha_pct'')::numeric, 38.35);');
END $do$;

-- (d) RD-95 — "?" da aba Folha › Encargos
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
 ('industrial.folha.encargos_pct', '/dashboard/industrial/folha', 'Folha', '% de encargos sobre a folha',
  'O percentual de encargos sobre a folha desta empresa (padrão 36,5%). Editável.',
  'É o mesmo número usado no custo do Quadro, no BI de RH e na ficha de mão de obra — um número só. Grava dentro do detalhamento de encargos da empresa.',
  '36,5%  ·  ou use o "% real" calculado da sua folha.',
  'Confundir com o INSS/IRRF descontado do empregado: aqui é o encargo PATRONAL sobre a folha.', 'industria', 60, 'publicado'),
 ('industrial.folha.encargos_real', '/dashboard/industrial/folha', 'Folha', 'Real da última folha',
  'Nada — é calculado da sua folha importada.',
  'Mostra o encargo patronal real da última competência (INSS empresa, RAT, terceiros, FGTS ÷ proventos). Use "ver as verbas" para conferir cada verba antes de usar esse %.',
  'Ex.: 34,34% calculado da folha 10/2026.',
  'Usar o % real sem abrir a lista de verbas: confira a classificação antes.', 'industria', 61, 'publicado'),
 ('industrial.folha.encargos_verbas', '/dashboard/industrial/folha', 'Folha', 'Ver as verbas',
  'Nada — abre a lista.',
  'Lista cada verba da competência classificada como ENCARGO (patronal) ou PROVENTO, com código e valor, para você conferir o % real antes de usá-lo.',
  'INSS Empresa, RAT, FGTS → encargo; Salário, Horas extras → provento.',
  'Verba classificada errada: fale com o RH/contabilidade para ajustar o layout da folha.', 'industria', 62, 'publicado')
ON CONFLICT (chave) DO UPDATE SET rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve, exemplo = EXCLUDED.exemplo,
  erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical, ordem = EXCLUDED.ordem, status = 'publicado', atualizado_em = now();
