-- Indústria › Logística · ajuste do sincronizador do rastreador (PR-1a do épico Logística V2; blueprint industria V16.7).
-- Prova RD-38 (FRIOESTE, 27/11, erp_contexto_projeto 156a6a5a): as 76 posições gravadas pela 1ª versão têm
--   (a) odometro/km_hoje em METROS (a Open API manda metros; o painel somava como km → 163.906 "km" num dia),
--   (b) motorista "[object Object]" (driver é objeto {id,name}), (c) temperatura 0 falsa (temperature [] = sem sonda);
--   (d) o painel casava o rastreador com o cadastro pelo campo placa, vazio em 16 de 17 → 1/17 casado.
-- Esta migration: (1) fn_placa_mercosul (placa antiga → Mercosul, só letras/números, maiúsculas); (2) coluna gerada
-- frota_rastreio_dispositivo.placa_chave = Mercosul(placa ou, se vazia, o NOME do equipamento); (3) painel casa por
-- placa_chave e devolve 'divergencias'; (4) frota_rastreio_config.api_base_url (endereço da API por empresa, família
-- Protrack; vazio = padrão); (5) fn_frota_rastreio_corrigir_legado() corrige as linhas da 1ª versão (marcador
-- motorista = '[object Object]'; idempotente) e é chamada aqui. A edge (protocolo.ts) passa a gravar km, motorista e
-- temperatura certos. ADITIVA: não toca coleta ATAK, cofre nem erp_sync_log.

-- (1) placa antiga (AAA9999) → Mercosul (AAA9X99: 5º caractere 0..9 → A..J). Qualquer outro formato: só normaliza.
CREATE OR REPLACE FUNCTION public.fn_placa_mercosul(p text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO 'public'
AS $$
  SELECT CASE WHEN n ~ '^[A-Z]{3}[0-9]{4}$'
              THEN substr(n, 1, 4) || chr(65 + substr(n, 5, 1)::int) || substr(n, 6, 2)
              ELSE n END
    FROM (SELECT upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')) AS n) x;
$$;
COMMENT ON FUNCTION public.fn_placa_mercosul(text) IS
  'Normaliza placa (maiúsculas, só letras/números) e converte o padrão antigo AAA9999 para Mercosul AAA9X99. Ex.: MKS-1306 → MKS1D06.';
REVOKE ALL ON FUNCTION public.fn_placa_mercosul(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_placa_mercosul(text) TO authenticated, service_role;

-- (2) chave de casamento do rastreador: placa informada no rastreador ou, se vazia, o nome do equipamento.
ALTER TABLE public.frota_rastreio_dispositivo
  ADD COLUMN IF NOT EXISTS placa_chave text
  GENERATED ALWAYS AS (public.fn_placa_mercosul(coalesce(nullif(placa, ''), nome))) STORED;
CREATE INDEX IF NOT EXISTS idx_frota_rastreio_disp_placa_chave ON public.frota_rastreio_dispositivo (company_id, placa_chave);

-- (4) endereço da API por empresa (vazio = https://api.brasilsatgps.com.br).
ALTER TABLE public.frota_rastreio_config ADD COLUMN IF NOT EXISTS api_base_url text;
COMMENT ON COLUMN public.frota_rastreio_config.api_base_url IS
  'Endereço https da Open API do rastreador desta empresa (família Protrack). Vazio = BrasilSat (https://api.brasilsatgps.com.br).';

-- (5) correção das linhas gravadas pela 1ª versão do sincronizador (idempotente: só toca linhas com o marcador).
CREATE OR REPLACE FUNCTION public.fn_frota_rastreio_corrigir_legado()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_n integer;
BEGIN
  UPDATE public.frota_rastreio_posicao
     SET km_hoje     = CASE WHEN km_hoje  IS NULL OR km_hoje  < 0 THEN NULL ELSE round(km_hoje  / 1000.0, 3) END,
         odometro    = CASE WHEN odometro IS NULL OR odometro < 0 THEN NULL ELSE round(odometro / 1000.0, 3) END,
         motorista   = NULL,
         temperatura = NULL
   WHERE motorista = '[object Object]';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.fn_frota_rastreio_corrigir_legado() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_frota_rastreio_corrigir_legado() TO service_role;
SELECT public.fn_frota_rastreio_corrigir_legado();

-- (3) painel: casa pela placa_chave (Mercosul) e devolve as divergências de cadastro.
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
           public.fn_placa_mercosul(v.placa) AS placa_chave
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
      LEFT JOIN cad c   ON c.placa_chave <> '' AND c.placa_chave = d.placa_chave
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
    'veiculos', v_veic,
    -- Divergências de cadastro (RD-38): rastreador sem veículo no cadastro e caminhão cadastrado sem rastreador.
    'divergencias', jsonb_build_object(
      'rastreador_sem_cadastro', coalesce((
        SELECT jsonb_agg(jsonb_build_object('imei', d.imei, 'nome', d.nome, 'placa_chave', d.placa_chave) ORDER BY d.nome)
          FROM public.frota_rastreio_dispositivo d
         WHERE d.company_id = p_company_id
           AND NOT EXISTS (SELECT 1 FROM public.erp_hub_frota_veiculo v
                            WHERE v.company_id = p_company_id AND v.excluido_em IS NULL AND coalesce(v.ativo, true)
                              AND public.fn_placa_mercosul(v.placa) = d.placa_chave)), '[]'::jsonb),
      'cadastro_sem_rastreador', coalesce((
        SELECT jsonb_agg(jsonb_build_object('veiculo_id', v.id, 'placa', v.placa, 'tipo', v.tipo) ORDER BY v.placa)
          FROM public.erp_hub_frota_veiculo v
         WHERE v.company_id = p_company_id AND v.excluido_em IS NULL AND coalesce(v.ativo, true)
           AND NOT EXISTS (SELECT 1 FROM public.frota_rastreio_dispositivo d
                            WHERE d.company_id = p_company_id AND d.placa_chave = public.fn_placa_mercosul(v.placa))), '[]'::jsonb)));
END $$;
REVOKE ALL ON FUNCTION public.fn_frota_rastreio_painel(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_frota_rastreio_painel(uuid) TO authenticated, service_role;
