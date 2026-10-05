-- =====================================================================================================================
-- (1) fn_atak_status rápida · (2) RLS de agency_equipe + custo/hora protegido (LGPD) — CEO 03/10/2026
-- =====================================================================================================================
-- PARTE 1 — fn_atak_status levava 5–14 s: contava linhas e a maior data por domínio varrendo ind_atak_fato (365 mil
-- linhas, 600 MB de jsonb) e o último ciclo por domínio varrendo erp_sync_log (320 mil linhas). Ela entra no
-- fn_briefing_sessao(), que passava de 7 s com a API cortando em 8 s.
--   · ind_atak_status_resumo (empresa × domínio): linhas, dado_ate (maior data do negócio) e ultimo_ciclo_em.
--     NÃO é a ind_atak_dominio_resumo (já existe, refeita a cada 30 min pelo cron atak-resumo-refresh-30min, sem a
--     data do negócio nem o ciclo) — aquela segue como está.
--   · mantida por gatilhos POR COMANDO (tabelas de transição): inclusão soma, exclusão subtrai, alteração (inclusive o
--     ON CONFLICT DO UPDATE do coletor) acerta a data e a troca de empresa/domínio; a maior data só é recalculada
--     (para aquela empresa × domínio) quando a linha que a detinha saiu ou baixou de data.
--   · erp_sync_log: gatilho de inclusão grava o último ciclo do domínio (coletor_atak%, http_response->>'dominio',
--     qualquer fase — a mesma regra de hoje). Os gravadores do log do coletor só INCLUEM (fn_atak_heartbeat e a
--     função atak-ingest; nenhuma função altera nem apaga linha coletor_atak).
--   · a data do negócio é a MESMA expressão da versão antiga, escrita direto em cada consulta. NUNCA trocar por uma
--     função SQL auxiliar: com SET search_path ela não é embutida e, chamada 365 mil vezes num agregado, estourou a
--     memória e reiniciou o banco na prova de 03/10 (13:08).
--   · fn_atak_status lê o resumo — a saída é a MESMA de hoje (provado: jsonb igual, tirando 'momento'; 10,1 s → 0,06 s;
--     briefing 10,3 s → 0,65 s). Carga inicial: ~2,9 s (ind_atak_fato) + ~0,7 s (erp_sync_log).
-- PARTE 2 — agency_equipe tinha RLS sem nenhuma policy (ninguém logado lia: Equipe, Apontamento, Margem e Serviços do
-- P&M vazios) e o anon com TODOS os direitos.
--   · anon sem nenhum direito; leitura para quem é da empresa; inclusão/alteração/exclusão só para quem vê salário
--     (fn__mao_obra_pode_ver_individual: owner, socio, diretor, gerente, financeiro, admin, adm, acesso_total).
--   · custo_hora (custo por pessoa) sai da leitura direta: o logado lê todas as colunas MENOS custo_hora; o custo vem
--     de fn_pm_equipe_custos(empresa), que só devolve para quem vê salário e registra o acesso.
--   · registro do acesso: pm_equipe_custo_acesso_log (nova). O registro da Mão de obra (erp_mao_obra_acesso_log) exige
--     ficha_id → erp_mao_obra_custo e grupo_id NOT NULL — pessoa da agency_equipe não é ficha; usá-lo pediria
--     derrubar a FK/NOT NULL. Tabela própria, só aditiva.
-- (db push roda cada comando fora de bloco de transação — por isso a criação dos gatilhos de ind_atak_fato e a carga
--  inicial ficam no MESMO bloco DO: o CREATE TRIGGER segura os gravadores até o fim da carga, a contagem sai exata.)
-- =====================================================================================================================

-- ─────────────────────────────────────────────── PARTE 1 ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ind_atak_status_resumo (
  company_id      uuid        NOT NULL,
  dominio         text        NOT NULL,
  linhas          bigint      NOT NULL DEFAULT 0,
  dado_ate        text,
  ultimo_ciclo_em timestamptz,
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, dominio)
);
COMMENT ON TABLE public.ind_atak_status_resumo IS
  'Resumo por empresa × domínio do coletor ATAK para fn_atak_status (linhas e maior data de ind_atak_fato, último ciclo '
  'do erp_sync_log). Mantido por gatilhos; só funções SECURITY DEFINER leem. Migration 20261003107000.';
ALTER TABLE public.ind_atak_status_resumo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ind_atak_status_resumo FROM PUBLIC, anon, authenticated;

-- inclusão em ind_atak_fato (no upsert do coletor, só as linhas de fato INCLUÍDAS chegam aqui)
CREATE OR REPLACE FUNCTION public.fn__atak_resumo_fato_inc()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO ind_atak_status_resumo AS r (company_id, dominio, linhas, dado_ate, atualizado_em)
  SELECT n.company_id, n.dominio, count(*), max(left(COALESCE(n.raw->>'DATA_MOVTO', n.raw->>'Data_movto', n.raw->>'DATA_ESTOQUE', n.raw->>'Data_estoque', n.raw->>'DATA_ABATE', n.raw->>'TITULO.DATA VENCTO', n.raw->>'Data_cadastro'), 10)), now()
    FROM novas n
   GROUP BY n.company_id, n.dominio
  ON CONFLICT (company_id, dominio) DO UPDATE
     SET linhas = r.linhas + EXCLUDED.linhas,
         dado_ate = GREATEST(r.dado_ate, EXCLUDED.dado_ate),
         atualizado_em = now();
  RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION public.fn__atak_resumo_fato_inc() FROM PUBLIC, anon;

-- alteração (inclusive o ON CONFLICT DO UPDATE do coletor): contagem líquida por empresa × domínio (só muda se a linha
-- trocou de empresa/domínio), a data sobe se preciso; recálculo só onde a linha que detinha a maior data baixou/saiu
CREATE OR REPLACE FUNCTION public.fn__atak_resumo_fato_alt()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  WITH v AS (SELECT company_id, dominio, count(*) AS n FROM velhas GROUP BY 1, 2),
       n AS (SELECT company_id, dominio, count(*) AS n, max(left(COALESCE(raw->>'DATA_MOVTO', raw->>'Data_movto', raw->>'DATA_ESTOQUE', raw->>'Data_estoque', raw->>'DATA_ABATE', raw->>'TITULO.DATA VENCTO', raw->>'Data_cadastro'), 10)) AS mx FROM novas GROUP BY 1, 2),
       g AS (SELECT COALESCE(n.company_id, v.company_id) AS company_id, COALESCE(n.dominio, v.dominio) AS dominio,
                    COALESCE(n.n, 0) - COALESCE(v.n, 0) AS dn, n.mx
               FROM n FULL JOIN v ON v.company_id = n.company_id AND v.dominio = n.dominio)
  INSERT INTO ind_atak_status_resumo AS r (company_id, dominio, linhas, dado_ate, atualizado_em)
  SELECT g.company_id, g.dominio, g.dn, g.mx, now() FROM g
  ON CONFLICT (company_id, dominio) DO UPDATE
     SET linhas = r.linhas + EXCLUDED.linhas,
         dado_ate = GREATEST(r.dado_ate, EXCLUDED.dado_ate),
         atualizado_em = now();

  WITH v AS (SELECT company_id, dominio, max(left(COALESCE(raw->>'DATA_MOVTO', raw->>'Data_movto', raw->>'DATA_ESTOQUE', raw->>'Data_estoque', raw->>'DATA_ABATE', raw->>'TITULO.DATA VENCTO', raw->>'Data_cadastro'), 10)) AS mx FROM velhas GROUP BY 1, 2),
       n AS (SELECT company_id, dominio, max(left(COALESCE(raw->>'DATA_MOVTO', raw->>'Data_movto', raw->>'DATA_ESTOQUE', raw->>'Data_estoque', raw->>'DATA_ABATE', raw->>'TITULO.DATA VENCTO', raw->>'Data_cadastro'), 10)) AS mx FROM novas GROUP BY 1, 2)
  UPDATE ind_atak_status_resumo r
     SET dado_ate = (SELECT max(left(COALESCE(f.raw->>'DATA_MOVTO', f.raw->>'Data_movto', f.raw->>'DATA_ESTOQUE', f.raw->>'Data_estoque', f.raw->>'DATA_ABATE', f.raw->>'TITULO.DATA VENCTO', f.raw->>'Data_cadastro'), 10)) FROM ind_atak_fato f
                      WHERE f.company_id = r.company_id AND f.dominio = r.dominio),
         atualizado_em = now()
    FROM v LEFT JOIN n ON n.company_id = v.company_id AND n.dominio = v.dominio
   WHERE r.company_id = v.company_id AND r.dominio = v.dominio
     AND v.mx >= r.dado_ate AND (n.mx IS NULL OR n.mx < r.dado_ate);
  RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION public.fn__atak_resumo_fato_alt() FROM PUBLIC, anon;

-- exclusão: subtrai; se levou a maior data, recalcula só aquela empresa × domínio
CREATE OR REPLACE FUNCTION public.fn__atak_resumo_fato_exc()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  WITH v AS (SELECT company_id, dominio, count(*) AS n, max(left(COALESCE(raw->>'DATA_MOVTO', raw->>'Data_movto', raw->>'DATA_ESTOQUE', raw->>'Data_estoque', raw->>'DATA_ABATE', raw->>'TITULO.DATA VENCTO', raw->>'Data_cadastro'), 10)) AS mx FROM velhas GROUP BY 1, 2)
  UPDATE ind_atak_status_resumo r
     SET linhas = r.linhas - v.n,
         dado_ate = CASE WHEN v.mx >= r.dado_ate
                         THEN (SELECT max(left(COALESCE(f.raw->>'DATA_MOVTO', f.raw->>'Data_movto', f.raw->>'DATA_ESTOQUE', f.raw->>'Data_estoque', f.raw->>'DATA_ABATE', f.raw->>'TITULO.DATA VENCTO', f.raw->>'Data_cadastro'), 10)) FROM ind_atak_fato f
                                WHERE f.company_id = r.company_id AND f.dominio = r.dominio)
                         ELSE r.dado_ate END,
         atualizado_em = now()
    FROM v
   WHERE r.company_id = v.company_id AND r.dominio = v.dominio;
  RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION public.fn__atak_resumo_fato_exc() FROM PUBLIC, anon;

-- esvaziamento da tabela inteira
CREATE OR REPLACE FUNCTION public.fn__atak_resumo_fato_zerar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE ind_atak_status_resumo SET linhas = 0, dado_ate = NULL, atualizado_em = now()
   WHERE linhas <> 0 OR dado_ate IS NOT NULL;
  RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION public.fn__atak_resumo_fato_zerar() FROM PUBLIC, anon;

-- último ciclo do coletor por domínio (mesma regra de hoje: coletor_atak%, qualquer fase, max(iniciado_em))
CREATE OR REPLACE FUNCTION public.fn__atak_resumo_ciclo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO ind_atak_status_resumo AS r (company_id, dominio, ultimo_ciclo_em, atualizado_em)
  SELECT n.company_id, n.http_response->>'dominio', max(n.iniciado_em), now()
    FROM novas n
   WHERE n.trigger_type LIKE 'coletor_atak%' AND n.http_response->>'dominio' IS NOT NULL
   GROUP BY n.company_id, n.http_response->>'dominio'
  ON CONFLICT (company_id, dominio) DO UPDATE
     SET ultimo_ciclo_em = GREATEST(r.ultimo_ciclo_em, EXCLUDED.ultimo_ciclo_em),
         atualizado_em = now();
  RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION public.fn__atak_resumo_ciclo() FROM PUBLIC, anon;

-- gatilhos de ind_atak_fato + carga inicial NO MESMO comando (contagem exata: os gravadores esperam o fim da carga)
DO $carga$
BEGIN
  CREATE OR REPLACE TRIGGER trg_atak_resumo_fato_inc AFTER INSERT ON public.ind_atak_fato
    REFERENCING NEW TABLE AS novas FOR EACH STATEMENT EXECUTE FUNCTION public.fn__atak_resumo_fato_inc();
  CREATE OR REPLACE TRIGGER trg_atak_resumo_fato_alt AFTER UPDATE ON public.ind_atak_fato
    REFERENCING OLD TABLE AS velhas NEW TABLE AS novas FOR EACH STATEMENT EXECUTE FUNCTION public.fn__atak_resumo_fato_alt();
  CREATE OR REPLACE TRIGGER trg_atak_resumo_fato_exc AFTER DELETE ON public.ind_atak_fato
    REFERENCING OLD TABLE AS velhas FOR EACH STATEMENT EXECUTE FUNCTION public.fn__atak_resumo_fato_exc();
  CREATE OR REPLACE TRIGGER trg_atak_resumo_fato_zerar AFTER TRUNCATE ON public.ind_atak_fato
    FOR EACH STATEMENT EXECUTE FUNCTION public.fn__atak_resumo_fato_zerar();

  INSERT INTO public.ind_atak_status_resumo AS r (company_id, dominio, linhas, dado_ate, atualizado_em)
  SELECT f.company_id, f.dominio, count(*), max(left(COALESCE(f.raw->>'DATA_MOVTO', f.raw->>'Data_movto', f.raw->>'DATA_ESTOQUE', f.raw->>'Data_estoque', f.raw->>'DATA_ABATE', f.raw->>'TITULO.DATA VENCTO', f.raw->>'Data_cadastro'), 10)), now()
    FROM public.ind_atak_fato f
   GROUP BY f.company_id, f.dominio
  ON CONFLICT (company_id, dominio) DO UPDATE
     SET linhas = EXCLUDED.linhas, dado_ate = EXCLUDED.dado_ate, atualizado_em = now();

  -- reexecução: empresa × domínio que não tem mais linha nenhuma volta a zero
  UPDATE public.ind_atak_status_resumo r SET linhas = 0, dado_ate = NULL, atualizado_em = now()
   WHERE (r.linhas <> 0 OR r.dado_ate IS NOT NULL)
     AND NOT EXISTS (SELECT 1 FROM public.ind_atak_fato f WHERE f.company_id = r.company_id AND f.dominio = r.dominio);
END
$carga$;

-- último ciclo: o gatilho primeiro, depois a carga (máximo é idempotente — nada se perde nem se conta duas vezes)
CREATE OR REPLACE TRIGGER trg_atak_resumo_ciclo AFTER INSERT ON public.erp_sync_log
  REFERENCING NEW TABLE AS novas FOR EACH STATEMENT EXECUTE FUNCTION public.fn__atak_resumo_ciclo();

INSERT INTO public.ind_atak_status_resumo AS r (company_id, dominio, ultimo_ciclo_em, atualizado_em)
SELECT s.company_id, s.http_response->>'dominio', max(s.iniciado_em), now()
  FROM public.erp_sync_log s
 WHERE s.trigger_type LIKE 'coletor_atak%' AND s.http_response->>'dominio' IS NOT NULL
 GROUP BY s.company_id, s.http_response->>'dominio'
ON CONFLICT (company_id, dominio) DO UPDATE
   SET ultimo_ciclo_em = GREATEST(r.ultimo_ciclo_em, EXCLUDED.ultimo_ciclo_em), atualizado_em = now();

-- fn_atak_status: mesma saída, lida do resumo (abate por cabeça e carcaça seguem como estavam: ~0,1 s)
CREATE OR REPLACE FUNCTION public.fn_atak_status(p_company_id uuid DEFAULT '975365cc-9e5a-4251-9022-68c6bfde10d8'::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hb_ultimo timestamptz; v_hb_min numeric; v_dominios jsonb;
  v_ok int := 0; v_alerta int := 0; v_parado int := 0; v_vazio int := 0;
  v_abate_cabecas int; v_abate_dia date; v_carcaca_dia date; v_veredito text;
BEGIN
  SELECT max(iniciado_em) INTO v_hb_ultimo
    FROM erp_sync_log
   WHERE company_id = p_company_id AND trigger_type LIKE 'coletor_atak%' AND fase = 'sucesso';
  v_hb_min := round(extract(epoch FROM (now() - v_hb_ultimo))/60);

  -- linhas / dado_ate / último ciclo por domínio: ind_atak_status_resumo (gatilhos em ind_atak_fato e erp_sync_log)
  WITH base AS (
    SELECT m.dominio, m.tabela_origem, m.full_refresh,
           COALESCE(r.linhas, 0) AS linhas,
           r.dado_ate AS data_neg,
           r.ultimo_ciclo_em AS hb
      FROM atak_fonte_mapa m
      LEFT JOIN ind_atak_status_resumo r ON r.company_id = p_company_id AND r.dominio = m.dominio
     WHERE m.ativo
  ), classificado AS (
    SELECT b.*,
      CASE
        WHEN b.linhas = 0 THEN 'VAZIO'
        WHEN b.hb IS NULL OR b.hb < now()-interval '3 hours' THEN 'PARADO'
        WHEN b.linhas < 100 THEN 'SUSPEITO'
        ELSE 'OK'
      END AS status,
      CASE b.dominio
        WHEN 'miudos_5quarto'     THEN 'NOME ERRADO: e ABATE POR CABECA (RAA/ABT0103, unidade CB)'
        WHEN 'abate_pesagem'      THEN 'NOME ERRADO: e EXPEDICAO DE VENDA (ROS/VDA0501)'
        WHEN 'tipificacao_carcaca' THEN 'NOME ERRADO: tbClassifAnimal traz classificacao de COURO'
        WHEN 'sif_condenacao'     THEN 'NOME ERRADO: e cadastro de produto com SIF, nao condenacao'
        WHEN 'contabil_dre'       THEN 'CHAVE QUEBRADA: Num_lancto colide, so 11 linhas sobrevivem'
        ELSE NULL
      END AS ressalva
    FROM base b
  )
  SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'dominio', dominio, 'status', status, 'linhas', linhas,
           'dado_ate', data_neg, 'origem', tabela_origem, 'ressalva', ressalva))
         ORDER BY CASE status WHEN 'VAZIO' THEN 1 WHEN 'PARADO' THEN 2 WHEN 'SUSPEITO' THEN 3 ELSE 4 END, dominio),
         count(*) FILTER (WHERE status='OK'), count(*) FILTER (WHERE status='SUSPEITO'),
         count(*) FILTER (WHERE status='PARADO'), count(*) FILTER (WHERE status='VAZIO')
    INTO v_dominios, v_ok, v_alerta, v_parado, v_vazio
    FROM classificado;

  SELECT count(*), max(left(raw->>'DATA_ABATE',10)::date)
    INTO v_abate_cabecas, v_abate_dia
    FROM ind_atak_fato
   WHERE company_id=p_company_id AND dominio='miudos_5quarto'
     AND raw->>'COD_UNIDADE_PRI'='CB'
     AND left(raw->>'DATA_ABATE',10)::date = (SELECT max(left(raw->>'DATA_ABATE',10)::date)
                                                FROM ind_atak_fato WHERE dominio='miudos_5quarto');

  SELECT max(data_abate) INTO v_carcaca_dia FROM ind_abate_atak WHERE company_id=p_company_id;

  v_veredito := CASE
    WHEN v_hb_min IS NULL THEN 'COLETOR NUNCA REPORTOU'
    WHEN v_hb_min > 180 THEN 'COLETOR PARADO ha ' || v_hb_min || ' min'
    ELSE 'COLETOR VIVO (ultimo ciclo ha ' || v_hb_min || ' min) · ' ||
         v_ok || ' dominios OK · ' || v_alerta || ' suspeitos · ' ||
         v_parado || ' parados · ' || v_vazio || ' vazios'
  END;

  RETURN jsonb_build_object(
    'momento', now(),
    'veredito', v_veredito,
    'coletor_ultimo_ciclo_min', v_hb_min,
    'abate_por_cabeca', jsonb_build_object(
        'onde', 'ind_atak_fato · dominio=miudos_5quarto (NOME ERRADO) · COD_UNIDADE_PRI=CB',
        'ultimo_dia', v_abate_dia, 'cabecas_no_dia', v_abate_cabecas),
    'carcaca_detalhada', jsonb_build_object(
        'onde', 'ind_abate_atak (peso meia-carcaca, arroba, SISBOV)',
        'ultimo_dia', v_carcaca_dia,
        'estado', CASE WHEN v_carcaca_dia < current_date - 7
                       THEN 'PARADA desde ' || v_carcaca_dia || ' — dominio abate saiu da lista em atak_conexao_config (07/08/2026)'
                       ELSE 'ok' END),
    'dominios', v_dominios,
    'leia_tambem', 'erp_contexto_projeto tag atak-verdade'
  );
END $function$;
REVOKE ALL ON FUNCTION public.fn_atak_status(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_atak_status(uuid) FROM authenticated;

-- ─────────────────────────────────────────────── PARTE 2 ───────────────────────────────────────────────────────────

-- anon: nada. Logado: lê tudo MENOS custo_hora (direito por coluna); grava conforme as policies abaixo.
REVOKE ALL ON TABLE public.agency_equipe FROM anon;
REVOKE ALL ON TABLE public.agency_equipe FROM authenticated;
GRANT SELECT (id, company_id, user_id, nome, cargo, setor, jornada_horas_dia, ativo, created_at, updated_at)
  ON public.agency_equipe TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.agency_equipe TO authenticated;

ALTER TABLE public.agency_equipe ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agency_equipe_ler ON public.agency_equipe;
CREATE POLICY agency_equipe_ler ON public.agency_equipe FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());

DROP POLICY IF EXISTS agency_equipe_incluir ON public.agency_equipe;
CREATE POLICY agency_equipe_incluir ON public.agency_equipe FOR INSERT TO authenticated
  WITH CHECK (public.fn__mao_obra_pode_ver_individual(company_id));

DROP POLICY IF EXISTS agency_equipe_alterar ON public.agency_equipe;
CREATE POLICY agency_equipe_alterar ON public.agency_equipe FOR UPDATE TO authenticated
  USING (public.fn__mao_obra_pode_ver_individual(company_id))
  WITH CHECK (public.fn__mao_obra_pode_ver_individual(company_id));

DROP POLICY IF EXISTS agency_equipe_excluir ON public.agency_equipe;
CREATE POLICY agency_equipe_excluir ON public.agency_equipe FOR DELETE TO authenticated
  USING (public.fn__mao_obra_pode_ver_individual(company_id));

-- registro de quem viu o custo/hora por pessoa (LGPD)
CREATE TABLE IF NOT EXISTS public.pm_equipe_custo_acesso_log (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id uuid        NOT NULL REFERENCES public.companies(id),
  user_id    uuid        NOT NULL,
  membros    integer     NOT NULL,
  em         timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.pm_equipe_custo_acesso_log IS
  'Quem leu o custo/hora por pessoa da equipe do P&M (fn_pm_equipe_custos) e quando. Migration 20261003107000.';
CREATE INDEX IF NOT EXISTS ix_pm_equipe_custo_acesso_log_empresa ON public.pm_equipe_custo_acesso_log (company_id, em DESC);
ALTER TABLE public.pm_equipe_custo_acesso_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pm_equipe_custo_acesso_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pm_equipe_custo_acesso_log TO authenticated;
DROP POLICY IF EXISTS pm_equipe_custo_acesso_log_ler ON public.pm_equipe_custo_acesso_log;
CREATE POLICY pm_equipe_custo_acesso_log_ler ON public.pm_equipe_custo_acesso_log FOR SELECT TO authenticated
  USING ((company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin())
         AND public.fn__mao_obra_pode_ver_individual(company_id));

-- custo/hora por pessoa: só para quem vê salário (e fica registrado); os demais recebem nada por pessoa
CREATE OR REPLACE FUNCTION public.fn_pm_equipe_custos(p_company_id uuid)
 RETURNS TABLE(id uuid, custo_hora numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE v_n int;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() AND p_company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  IF NOT public.fn__mao_obra_pode_ver_individual(p_company_id) THEN
    RETURN;
  END IF;
  IF auth.uid() IS NOT NULL THEN
    SELECT count(*) INTO v_n FROM agency_equipe e WHERE e.company_id = p_company_id;
    INSERT INTO pm_equipe_custo_acesso_log (company_id, user_id, membros) VALUES (p_company_id, auth.uid(), v_n);
  END IF;
  RETURN QUERY SELECT e.id, e.custo_hora FROM agency_equipe e WHERE e.company_id = p_company_id;
END $function$;
REVOKE ALL ON FUNCTION public.fn_pm_equipe_custos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_equipe_custos(uuid) TO authenticated, service_role;
