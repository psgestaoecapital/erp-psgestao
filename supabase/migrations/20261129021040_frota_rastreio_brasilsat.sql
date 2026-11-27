-- Indústria › Logística · Rastreamento de frota (SPEC única 27/11, PARTE E — integração do rastreador "brasilsat").
-- ADITIVA: só tabelas/funções/cron NOVOS. Não toca atak_conexao_config, erp_credencial (só LÊ pelo leitor do Cofre
-- fn_credencial_ler, service_role), erp_sync_log nem o pipeline ETL.
--
-- (1) Cofre: provider técnico `brasilsat` (tipo tecnica, escopo empresa) com DUAS chaves, gravadas PELA TELA de
--     conectores (fn_credencial_salvar → Vault): `account` (conta) e `senha`. Esta migration NÃO grava segredo.
-- (2) frota_rastreio_config (1 linha por empresa: cadência, flag do histórico, último status da sincronização),
--     frota_rastreio_dispositivo (frota do rastreador: imei, placa, nome) e frota_rastreio_posicao (posições).
--     RLS por empresa (só leitura para quem tem a empresa), escrita só pela conexão de serviço, REVOKE anon.
-- (3) Portas SECURITY DEFINER com guarda de empresa:
--       fn_frota_rastreio_painel(company)  → BI de Logística (posição atual + cruzamento com a frota cadastrada e custo)
--       fn_frota_brasilsat_status(company) → leitura de status p/ o card do painel de conectores ("Conectado")
--       fn_frota_rastreio_acesso(company)  → a edge confere o acesso do usuário (sincronizar agora / rota histórica)
-- (4) Agenda: cron a cada 5 min chama fn_frota_rastreio_dispatch(), que só aciona a edge `frota-rastreio-sync`
--     quando alguma empresa com credencial passou da SUA cadência.
--
-- ┌─ PARÂMETROS A DEFINIR PELO CEO (pendentes) ──────────────────────────────────────────────────────────────────┐
-- │ CADÊNCIA  → default PROVISÓRIO 10 min (coluna cadencia_min). Trocar por empresa, sem deploy:                 │
-- │             UPDATE frota_rastreio_config SET cadencia_min = 5 WHERE company_id = '<empresa>';                │
-- │             (mínimo efetivo = 5 min, que é o passo do cron 'frota-rastreio-sync').                           │
-- │ HISTÓRICO → rota histórica (playback) DESLIGADA por padrão (coluna playback_habilitado = false). Ligar:      │
-- │             UPDATE frota_rastreio_config SET playback_habilitado = true WHERE company_id = '<empresa>';      │
-- └──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

-- ------------------------------------------------------------------------------------------------------------
-- (2) Tabelas
-- ------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.frota_rastreio_config (
  company_id          uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  provider            text NOT NULL DEFAULT 'brasilsat',
  ativo               boolean NOT NULL DEFAULT true,
  cadencia_min        integer NOT NULL DEFAULT 10 CHECK (cadencia_min BETWEEN 5 AND 1440),  -- CADÊNCIA (provisório)
  playback_habilitado boolean NOT NULL DEFAULT false,                                      -- HISTÓRICO (provisório)
  ultima_sync_em      timestamptz,
  ultima_sync_ok_em   timestamptz,
  ultimo_status       text CHECK (ultimo_status IN ('ok','sem_credencial','erro_autenticacao','erro')),
  ultimo_erro         text,
  veiculos            integer,
  posicoes_ultima     integer,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  atualizado_em       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.frota_rastreio_config IS
  'Rastreamento de frota por empresa: cadência da sincronização (cadencia_min, default provisório 10), flag da rota '
  'histórica (playback_habilitado, default desligado) e último status. Escrita só pela conexão de serviço.';

CREATE TABLE IF NOT EXISTS public.frota_rastreio_dispositivo (
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  imei           text NOT NULL,
  nome           text,
  placa          text,
  placa_norm     text GENERATED ALWAYS AS (upper(regexp_replace(coalesce(placa, ''), '[^A-Za-z0-9]', '', 'g'))) STORED,
  tipo           text,
  ativado_em     timestamptz,
  vence_em       timestamptz,
  visto_em       timestamptz NOT NULL DEFAULT now(),
  criado_em      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, imei)
);
CREATE INDEX IF NOT EXISTS idx_frota_rastreio_disp_placa ON public.frota_rastreio_dispositivo (company_id, placa_norm);

CREATE TABLE IF NOT EXISTS public.frota_rastreio_posicao (
  id             bigserial PRIMARY KEY,
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  imei           text NOT NULL,
  gps_em         timestamptz NOT NULL,
  servidor_em    timestamptz,
  latitude       numeric(10,7) NOT NULL,
  longitude      numeric(10,7) NOT NULL,
  velocidade_kmh numeric,
  curso          numeric,
  ignicao        boolean,
  odometro       numeric,
  km_hoje        numeric,
  combustivel    numeric,
  temperatura    numeric,
  motorista      text,
  recebido_em    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ux_frota_rastreio_posicao UNIQUE (company_id, imei, gps_em)
);
CREATE INDEX IF NOT EXISTS idx_frota_rastreio_pos_ultima ON public.frota_rastreio_posicao (company_id, imei, gps_em DESC);

ALTER TABLE public.frota_rastreio_config     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.frota_rastreio_dispositivo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.frota_rastreio_posicao    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS frota_rastreio_config_ler ON public.frota_rastreio_config;
CREATE POLICY frota_rastreio_config_ler ON public.frota_rastreio_config FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
DROP POLICY IF EXISTS frota_rastreio_dispositivo_ler ON public.frota_rastreio_dispositivo;
CREATE POLICY frota_rastreio_dispositivo_ler ON public.frota_rastreio_dispositivo FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
DROP POLICY IF EXISTS frota_rastreio_posicao_ler ON public.frota_rastreio_posicao;
CREATE POLICY frota_rastreio_posicao_ler ON public.frota_rastreio_posicao FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());

REVOKE ALL ON public.frota_rastreio_config, public.frota_rastreio_dispositivo, public.frota_rastreio_posicao FROM anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.frota_rastreio_config, public.frota_rastreio_dispositivo, public.frota_rastreio_posicao FROM authenticated;
GRANT SELECT ON public.frota_rastreio_config, public.frota_rastreio_dispositivo, public.frota_rastreio_posicao TO authenticated;
GRANT ALL ON public.frota_rastreio_config, public.frota_rastreio_dispositivo, public.frota_rastreio_posicao TO service_role;
REVOKE ALL ON SEQUENCE public.frota_rastreio_posicao_id_seq FROM anon, PUBLIC, authenticated;
GRANT USAGE ON SEQUENCE public.frota_rastreio_posicao_id_seq TO service_role;

-- ------------------------------------------------------------------------------------------------------------
-- (3) Portas
-- ------------------------------------------------------------------------------------------------------------

-- Credencial completa (as DUAS chaves ativas) da empresa no Cofre — só metadado, nunca o valor.
CREATE OR REPLACE FUNCTION public.fn_frota_rastreio_tem_credencial(p_company_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT count(DISTINCT c.chave) = 2
    FROM public.erp_credencial c
   WHERE c.provider = 'brasilsat' AND c.escopo = 'empresa' AND c.company_id = p_company_id
     AND c.ativo AND c.chave IN ('account', 'senha');
$$;
REVOKE ALL ON FUNCTION public.fn_frota_rastreio_tem_credencial(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_frota_rastreio_tem_credencial(uuid) TO service_role;

-- A edge confere, COMO o usuário, se ele tem a empresa (sincronizar agora / rota histórica).
CREATE OR REPLACE FUNCTION public.fn_frota_rastreio_acesso(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_cfg public.frota_rastreio_config;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('acesso', false); END IF;
  IF NOT (public.is_admin() OR p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('acesso', false);
  END IF;
  SELECT * INTO v_cfg FROM public.frota_rastreio_config WHERE company_id = p_company_id;
  RETURN jsonb_build_object('acesso', true, 'playback_habilitado', coalesce(v_cfg.playback_habilitado, false),
    'ultima_sync_em', v_cfg.ultima_sync_em);
END $$;
REVOKE ALL ON FUNCTION public.fn_frota_rastreio_acesso(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_frota_rastreio_acesso(uuid) TO authenticated, service_role;

-- Status para o card do painel de conectores (Parte D): leitura pura.
CREATE OR REPLACE FUNCTION public.fn_frota_brasilsat_status(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_cfg public.frota_rastreio_config; v_cred boolean;
BEGIN
  IF NOT (public.is_admin() OR p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  v_cred := public.fn_frota_rastreio_tem_credencial(p_company_id);
  SELECT * INTO v_cfg FROM public.frota_rastreio_config WHERE company_id = p_company_id;
  RETURN jsonb_build_object(
    'tem_credencial', v_cred,
    'conectado', v_cred AND v_cfg.ultima_sync_ok_em IS NOT NULL
                 AND v_cfg.ultima_sync_ok_em > now() - make_interval(mins => greatest(3 * coalesce(v_cfg.cadencia_min, 10), 30)),
    'ultimo_status', v_cfg.ultimo_status,
    'ultimo_erro', v_cfg.ultimo_erro,
    'ultima_sync_em', v_cfg.ultima_sync_em,
    'ultima_sync_ok_em', v_cfg.ultima_sync_ok_em,
    'veiculos', v_cfg.veiculos,
    'cadencia_min', coalesce(v_cfg.cadencia_min, 10));
END $$;
REVOKE ALL ON FUNCTION public.fn_frota_brasilsat_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_frota_brasilsat_status(uuid) TO authenticated, service_role;

-- BI de Logística: posição atual de cada veículo + cruzamento com a frota cadastrada (placa) e o custo lançado.
CREATE OR REPLACE FUNCTION public.fn_frota_rastreio_painel(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_cfg public.frota_rastreio_config;
  v_cred boolean;
  v_veic jsonb;
  v_kpi jsonb;
BEGIN
  IF auth.uid() IS NULL AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Entre com o seu usuário' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_admin() OR auth.role() = 'service_role' OR p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  v_cred := public.fn_frota_rastreio_tem_credencial(p_company_id);
  SELECT * INTO v_cfg FROM public.frota_rastreio_config WHERE company_id = p_company_id;

  WITH ult AS (
    SELECT DISTINCT ON (p.imei) p.*
      FROM public.frota_rastreio_posicao p
     WHERE p.company_id = p_company_id AND p.gps_em > now() - interval '30 days'
     ORDER BY p.imei, p.gps_em DESC
  ), km AS (                                   -- km do mês: soma do maior "km do dia" de cada dia (rastreador)
    SELECT imei, sum(km_dia) AS km_30d FROM (
      SELECT p.imei, (p.gps_em AT TIME ZONE 'America/Sao_Paulo')::date AS dia, max(p.km_hoje) AS km_dia
        FROM public.frota_rastreio_posicao p
       WHERE p.company_id = p_company_id AND p.gps_em > now() - interval '30 days'
       GROUP BY 1, 2) d
     GROUP BY imei
  ), cad AS (
    SELECT v.id, v.placa, v.modelo, v.marca, v.ano, v.tipo,
           upper(regexp_replace(coalesce(v.placa, ''), '[^A-Za-z0-9]', '', 'g')) AS placa_norm
      FROM public.erp_hub_frota_veiculo v
     WHERE v.company_id = p_company_id AND v.excluido_em IS NULL AND coalesce(v.ativo, true)
  ), custo AS (
    SELECT c.veiculo_id, sum(c.valor) AS custo_30d
      FROM public.erp_hub_frota_custo c
     WHERE c.company_id = p_company_id AND c.excluido_em IS NULL AND c.data_custo > current_date - 30
     GROUP BY 1
  ), linhas AS (
    SELECT d.imei, coalesce(nullif(d.placa, ''), d.nome, d.imei) AS rotulo, d.placa, d.nome,
           u.gps_em, u.latitude, u.longitude, u.velocidade_kmh, u.curso, u.ignicao, u.km_hoje, u.odometro, u.motorista,
           CASE WHEN u.gps_em IS NULL OR u.gps_em < now() - interval '1 hour' THEN 'sem_sinal'
                WHEN coalesce(u.velocidade_kmh, 0) > 3 THEN 'em_movimento'
                WHEN u.ignicao THEN 'ligado_parado'
                ELSE 'parado' END AS situacao,
           k.km_30d, c.id AS veiculo_id, c.modelo, c.marca, c.ano, c.tipo, cu.custo_30d
      FROM public.frota_rastreio_dispositivo d
      LEFT JOIN ult u   ON u.imei = d.imei
      LEFT JOIN km k    ON k.imei = d.imei
      LEFT JOIN cad c   ON c.placa_norm <> '' AND c.placa_norm = d.placa_norm
      LEFT JOIN custo cu ON cu.veiculo_id = c.id
     WHERE d.company_id = p_company_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'imei', imei, 'rotulo', rotulo, 'placa', placa, 'nome', nome,
           'gps_em', gps_em, 'latitude', latitude, 'longitude', longitude, 'velocidade_kmh', velocidade_kmh,
           'curso', curso, 'ignicao', ignicao, 'km_hoje', km_hoje, 'odometro', odometro, 'motorista', motorista,
           'situacao', situacao, 'km_30d', km_30d,
           'cadastrado', veiculo_id IS NOT NULL, 'veiculo_id', veiculo_id, 'modelo', modelo, 'marca', marca, 'ano', ano, 'tipo', tipo,
           'custo_30d', custo_30d,
           'custo_km_30d', CASE WHEN coalesce(km_30d, 0) > 0 AND custo_30d IS NOT NULL THEN round(custo_30d / km_30d, 2) END
         ) ORDER BY CASE situacao WHEN 'em_movimento' THEN 1 WHEN 'ligado_parado' THEN 2 WHEN 'parado' THEN 3 ELSE 4 END, rotulo), '[]'::jsonb),
         jsonb_build_object(
           'total', count(*),
           'em_movimento', count(*) FILTER (WHERE situacao = 'em_movimento'),
           'ligado_parado', count(*) FILTER (WHERE situacao = 'ligado_parado'),
           'parado', count(*) FILTER (WHERE situacao = 'parado'),
           'sem_sinal', count(*) FILTER (WHERE situacao = 'sem_sinal'),
           'km_hoje', round(coalesce(sum(km_hoje) FILTER (WHERE gps_em >= date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'), 0), 1),
           'km_30d', round(coalesce(sum(km_30d), 0), 1),
           'cadastrados', count(*) FILTER (WHERE veiculo_id IS NOT NULL),
           'custo_30d', round(coalesce(sum(custo_30d), 0), 2))
    INTO v_veic, v_kpi
    FROM linhas;

  RETURN jsonb_build_object(
    'tem_credencial', v_cred,
    'config', jsonb_build_object(
      'cadencia_min', coalesce(v_cfg.cadencia_min, 10),
      'playback_habilitado', coalesce(v_cfg.playback_habilitado, false),
      'ultima_sync_em', v_cfg.ultima_sync_em,
      'ultima_sync_ok_em', v_cfg.ultima_sync_ok_em,
      'ultimo_status', v_cfg.ultimo_status,
      'ultimo_erro', v_cfg.ultimo_erro),
    'frota_cadastrada', (SELECT count(*) FROM public.erp_hub_frota_veiculo v
                          WHERE v.company_id = p_company_id AND v.excluido_em IS NULL AND coalesce(v.ativo, true)),
    'kpis', v_kpi,
    'veiculos', v_veic);
END $$;
REVOKE ALL ON FUNCTION public.fn_frota_rastreio_painel(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_frota_rastreio_painel(uuid) TO authenticated, service_role;

-- Empresas devidas (credencial completa + passou da cadência). Só a conexão de serviço (edge/cron).
CREATE OR REPLACE FUNCTION public.fn_frota_rastreio_empresas_devidas()
RETURNS TABLE (company_id uuid, cadencia_min integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT c.company_id, coalesce(f.cadencia_min, 10)
    FROM (SELECT e.company_id FROM public.erp_credencial e
           WHERE e.provider = 'brasilsat' AND e.escopo = 'empresa' AND e.ativo AND e.chave IN ('account','senha')
             AND e.company_id IS NOT NULL
           GROUP BY e.company_id HAVING count(DISTINCT e.chave) = 2) c
    LEFT JOIN public.frota_rastreio_config f ON f.company_id = c.company_id
   WHERE coalesce(f.ativo, true)
     -- 30 s de folga: o cron é de 5 em 5 min e a última rodada pode ter terminado alguns segundos depois do passo
     AND (f.ultima_sync_em IS NULL OR f.ultima_sync_em < now() - make_interval(mins => coalesce(f.cadencia_min, 10)) + interval '30 seconds');
$$;
REVOKE ALL ON FUNCTION public.fn_frota_rastreio_empresas_devidas() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_frota_rastreio_empresas_devidas() TO service_role;

-- ------------------------------------------------------------------------------------------------------------
-- (4) Agenda: dispatcher + cron (padrão fn_dfe_distribuicao_auto_dispatch)
-- ------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_frota_rastreio_dispatch()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_service_role text;
  v_url_base     text := 'https://horsymhsinqcimflrtjo.supabase.co';
  v_devidas      int;
  v_request_id   bigint;
BEGIN
  SELECT count(*) INTO v_devidas FROM public.fn_frota_rastreio_empresas_devidas();
  IF v_devidas = 0 THEN
    RETURN jsonb_build_object('ok', true, 'devidas', 0, 'pulado', true);
  END IF;

  SELECT decrypted_secret INTO v_service_role FROM vault.decrypted_secrets
   WHERE name = 'SUPABASE_SERVICE_ROLE_KEY_FOR_WORKER';
  IF v_service_role IS NULL THEN
    RAISE WARNING 'fn_frota_rastreio_dispatch: vault secret SUPABASE_SERVICE_ROLE_KEY_FOR_WORKER ausente';
    RETURN jsonb_build_object('ok', false, 'erro', 'service_role ausente no vault');
  END IF;

  SELECT net.http_post(
    url     := v_url_base || '/functions/v1/frota-rastreio-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_role),
    body    := jsonb_build_object('origem', 'cron'),
    timeout_milliseconds := 120000
  ) INTO v_request_id;

  RETURN jsonb_build_object('ok', true, 'devidas', v_devidas, 'request_id', v_request_id, 'ts', now());
END $$;
REVOKE ALL ON FUNCTION public.fn_frota_rastreio_dispatch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_frota_rastreio_dispatch() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'frota-rastreio-sync') THEN
    PERFORM cron.unschedule('frota-rastreio-sync');
  END IF;
END $$;
-- Passo de 5 min = cadência mínima. A cadência real é por empresa (frota_rastreio_config.cadencia_min).
SELECT cron.schedule('frota-rastreio-sync', '*/5 * * * *', $cron$ SELECT public.fn_frota_rastreio_dispatch(); $cron$);

-- ------------------------------------------------------------------------------------------------------------
-- Tela no catálogo + "?" (RD-95)
-- ------------------------------------------------------------------------------------------------------------
INSERT INTO public.system_screens (id, rota, area, modulo, titulo, descricao_funcional, estado_real, prioridade_monitoramento, rpcs_chamadas, views_consumidas, componentes_principais, features_relacionadas)
VALUES ('dashboard.inteligencia_logistica', '/dashboard/inteligencia/logistica', 'industrial', NULL, 'BI de Logística · rastreamento da frota',
  'Posição atual de cada veículo vinda do rastreador da empresa (sincronizada pela cadência configurada), situação (em movimento, ligado parado, parado, sem sinal), km do dia e do mês, cruzamento com a frota cadastrada pela placa e custo lançado nos últimos 30 dias. Rota histórica sob demanda quando habilitada. Sem credencial: estado vazio com o caminho para cadastrar.',
  'parcial', 'media', ARRAY['fn_frota_rastreio_painel', 'fn_ajuda_campo_listar']::text[],
  ARRAY['frota_rastreio_posicao', 'frota_rastreio_dispositivo', 'erp_hub_frota_veiculo', 'erp_hub_frota_custo']::text[],
  ARRAY['BiLogistica']::text[], ARRAY[]::text[])
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'BI de Logística', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/inteligencia/logistica', 'industrial', 'publicado'
FROM (VALUES
 ('log.bi.conexao', 'Conexão com o rastreador', 'Nada a preencher aqui: a conta e a senha do rastreador são cadastradas uma vez em Conectores › Logística.', 'Mostra se a empresa tem a credencial salva no cofre, quando foi a última leitura e se ela deu certo. A leitura se repete sozinha na cadência configurada.', 'Última leitura 09:40 · 22 veículos · a cada 10 min.', 'Esperar dado logo depois de salvar a senha: use "Atualizar agora" ou aguarde a próxima leitura.', 1),
 ('log.bi.atualizar', 'Atualizar agora', 'Toque para buscar as posições no rastreador neste momento.', 'Faz uma leitura fora da agenda (frota e posição atual) e recarrega a tela. Pode ser usado no máximo uma vez por minuto.', 'Depois de cadastrar a credencial, toque para ver os veículos sem esperar.', 'Tocar várias vezes seguidas: dentro de 1 minuto a tela só recarrega o que já foi lido.', 2),
 ('log.bi.total', 'Veículos rastreados', 'Indicador calculado.', 'Quantidade de equipamentos que o rastreador devolve para a conta da empresa.', '22 veículos.', 'Comparar com a frota cadastrada sem ver as placas: equipamento sem placa no rastreador não cruza.', 3),
 ('log.bi.movimento', 'Em movimento', 'Indicador calculado.', 'Veículos com posição da última hora e velocidade acima de 3 km/h.', '9 rodando agora.', 'Ler como entregas em curso: inclui deslocamento vazio e captação.', 4),
 ('log.bi.parado', 'Parados', 'Indicador calculado.', 'Veículos com posição da última hora sem velocidade, separando os que estão com a ignição ligada (motor ligado parado gasta diesel).', '3 parados com motor ligado.', 'Achar que parado é problema: pode ser carga, descarga ou pátio.', 5),
 ('log.bi.sem_sinal', 'Sem sinal', 'Indicador calculado.', 'Veículos cuja última posição tem mais de 1 hora: rastreador desligado, sem cobertura ou equipamento com defeito.', '2 sem sinal desde ontem.', 'Confundir com veículo parado: sem sinal quer dizer que não sabemos onde está.', 6),
 ('log.bi.km', 'Km rodados', 'Indicador calculado.', 'Km do dia informados pelo rastreador e soma do mês (maior km de cada dia, últimos 30 dias).', '1.240 km hoje · 31.800 km no mês.', 'Somar com o hodômetro do painel do caminhão: a fonte aqui é o rastreador.', 7),
 ('log.bi.custo', 'Custo × km (30 dias)', 'Nada a preencher aqui: os custos vêm dos lançamentos da frota (combustível, manutenção, pneus).', 'Cruza o custo lançado no veículo cadastrado com a mesma placa e os km do rastreador nos últimos 30 dias, para mostrar o custo por km.', 'R$ 8.400 em 4.200 km = R$ 2,00/km.', 'Ver custo vazio: o veículo não está cadastrado na frota com a mesma placa ou não tem custo lançado no período.', 8),
 ('log.bi.lista', 'Veículos e posição atual', 'Nada a preencher. Toque em um veículo para abrir a posição no mapa.', 'Lista cada veículo com a situação, a hora da última posição, a velocidade, o km do dia e o cruzamento com a frota cadastrada.', 'ABC1D23 · em movimento · 62 km/h · há 3 min.', 'Achar que a posição é ao vivo: ela é a da última leitura (veja a hora em cada linha).', 9),
 ('log.bi.busca', 'Buscar veículo', 'Digite parte da placa, do nome do veículo ou do motorista.', 'Filtra a lista abaixo sem recarregar a tela.', '"ABC" mostra as placas que começam com ABC.', 'Buscar pelo modelo: a busca olha placa, nome e motorista.', 10),
 ('log.bi.situacao', 'Filtro por situação', 'Escolha uma situação para ver só os veículos nela.', 'Ajuda a achar rapidamente quem está sem sinal ou parado com motor ligado.', 'Toque em "Sem sinal" para ver quem precisa de verificação.', 'Esquecer o filtro ligado e achar que a frota diminuiu.', 11),
 ('log.bi.rota', 'Rota histórica', 'Escolha o veículo e o período (até 3 dias) e toque em "Ver rota".', 'Busca no rastreador o caminho percorrido no período e mostra distância aproximada, velocidade máxima e os pontos no mapa. Não fica gravado: é consulta sob demanda.', 'Ontem das 06:00 às 18:00: 412 km, máx. 88 km/h.', 'Pedir período longo demais: o rastreador devolve até alguns milhares de pontos por consulta.', 12),
 ('log.bi.rota_periodo', 'Período da rota', 'Informe o início e o fim da rota (data e hora).', 'Define o intervalo consultado no rastreador. Máximo de 3 dias por consulta.', '27/11 06:00 até 27/11 18:00.', 'Colocar o fim antes do início.', 13)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
