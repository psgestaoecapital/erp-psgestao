-- Indústria › Logística · ajustes do rastreamento ANTES de cadastrar a credencial (pacote Eng. Chefe 27/11, item 4;
-- mapa em erp_contexto_projeto tag 'mapa-brasilsat'). Depende da PR #6406 (frota_rastreio_*). ADITIVA: tabelas e
-- funções novas; só substitui funções NOVAS da própria #6406 (fn_frota_rastreio_painel / _dispatch / _empresas_devidas
-- ainda não usadas: não há credencial). Não toca atak_conexao_config, erp_credencial, erp_sync_log nem o ETL;
-- ind_fin_titulo_mv é só LIDA.
-- Vem DEPOIS da PR-1a (#6417, 20261129040040_frota_rastreio_conversoes_placa: km em metros, motorista, temperatura,
-- fn_placa_mercosul, placa_chave, api_base_url, correção do legado). Esta migration substitui de novo o
-- fn_frota_rastreio_painel da #6417: o casamento passa a ser o fn_frota_rastreio_casamento (vínculo manual > placa do
-- campo > placa achada no NOME, mesma conversão Mercosul do fn_placa_mercosul) e 'divergencias' ganha a sugestão de
-- 1 caractere. A coluna placa_chave da #6417 continua valendo para consultas diretas.
--
-- a) CASAMENTO rastreador × frota: o campo placa do rastreador vem vazio em 16 de 17 → a placa é extraída do NOME do
--    equipamento, com conversão placa antiga ↔ Mercosul (MKS1306 = MKS1D06, 5º caractere 0-9 ↔ A-J). Vínculo manual
--    (frota_rastreio_vinculo) vence o automático. Divergências listadas com sugestão (1 caractere de diferença:
--    MMM-4739 no rastreador × MMM4738 no cadastro) — nunca casadas sozinhas.
-- b) CUSTO POR KM pelos títulos a pagar do ERP de origem (ind_fin_titulo_mv), classificados por regras editáveis
--    (frota_custo_regra: combustível, manutenção, pneus; padrão global + por empresa) e RATEADOS pelo km de cada
--    veículo no mês (erp_hub_frota_custo segue somando quando houver lançamento por veículo).
-- c) CÓPIA DIÁRIA D-1 pelo servidor: rota completa (frota_rastreio_ponto, bruto 90 dias), km oficial do rastreador
--    (frota_km_dia) e viagens/paradas derivadas (frota_viagem / frota_parada). Checkpoint por veículo × dia
--    (frota_copia_dia): na 1ª vez copia até 7 dias para trás; o cron repete de hora em hora entre 04h e 09h até
--    terminar. Flag copia_diaria_habilitada (padrão ligado) — separada de playback_habilitado (consulta na TELA,
--    segue DESLIGADA por decisão do CEO 27/11).
-- d) ALARMES (frota_alarme, a cada leitura) e CERCAS da conta (frota_cerca, 1×/dia). Só leitura da plataforma:
--    nada é escrito no rastreador.
-- e) TOKEN ÚNICO: um token novo derruba o anterior → o token fica no Vault e é reaproveitado até perto de expirar
--    (as leituras de 10 min, a cópia diária e o "Atualizar agora" não se derrubam). Recomendação: subconta de
--    integração dedicada (ajuda log.bi.subconta).

-- ------------------------------------------------------------------------------------------------------------
-- Config: novas colunas (tabela nova da #6406, sem dado)
-- ------------------------------------------------------------------------------------------------------------
ALTER TABLE public.frota_rastreio_config
  ADD COLUMN IF NOT EXISTS copia_diaria_habilitada boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ultima_copia_em  timestamptz,
  ADD COLUMN IF NOT EXISTS ultimo_alarme_em timestamptz,
  ADD COLUMN IF NOT EXISTS cercas_em        timestamptz,
  ADD COLUMN IF NOT EXISTS token_expira_em  timestamptz;
COMMENT ON COLUMN public.frota_rastreio_config.copia_diaria_habilitada IS
  'Cópia diária D-1 (rota, km oficial, viagens/paradas) pelo servidor. Independe de playback_habilitado (consulta na tela).';

-- ------------------------------------------------------------------------------------------------------------
-- a) Placa: canônica Mercosul + extração do nome
-- ------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_frota_placa_canonica(p text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN x ~ '^[A-Z]{3}[0-9]{4}$' THEN substr(x, 1, 4) || chr(65 + substr(x, 5, 1)::int) || substr(x, 6, 2)  -- antiga → Mercosul
    WHEN x ~ '^[A-Z]{3}[0-9][A-Z][0-9]{2}$' THEN x
    ELSE NULL END
  FROM (SELECT upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')) AS x) s;
$$;
COMMENT ON FUNCTION public.fn_frota_placa_canonica(text) IS 'Placa em forma Mercosul (MKS1306 → MKS1D06); NULL se não for placa.';

CREATE OR REPLACE FUNCTION public.fn_frota_placa_do_texto(p text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO 'public'
AS $$
  SELECT public.fn_frota_placa_canonica((regexp_match(upper(coalesce(p, '')), '(?:^|[^A-Z0-9])([A-Z]{3}[ -]?[0-9][A-Z0-9][0-9]{2})(?:[^A-Z0-9]|$)'))[1]);
$$;
COMMENT ON FUNCTION public.fn_frota_placa_do_texto(text) IS 'Primeira placa (antiga ou Mercosul) achada num texto, em forma canônica.';

-- 1 caractere de diferença entre placas canônicas do mesmo tamanho (sugestão de divergência, nunca casamento sozinho)
CREATE OR REPLACE FUNCTION public.fn_frota_placa_dif(a text, b text)
RETURNS integer LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO 'public'
AS $$
  SELECT CASE WHEN a IS NULL OR b IS NULL OR length(a) <> length(b) THEN 99
              ELSE (SELECT count(*)::int FROM generate_series(1, length(a)) i WHERE substr(a, i, 1) <> substr(b, i, 1)) END;
$$;

REVOKE ALL ON FUNCTION public.fn_frota_placa_canonica(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_frota_placa_do_texto(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_frota_placa_dif(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_frota_placa_canonica(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_frota_placa_do_texto(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_frota_placa_dif(text, text) TO authenticated, service_role;

-- Vínculo manual rastreador × veículo cadastrado (vence o automático). veiculo_id NULL = "não é veículo da frota".
CREATE TABLE IF NOT EXISTS public.frota_rastreio_vinculo (
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  imei        text NOT NULL,
  veiculo_id  uuid REFERENCES public.erp_hub_frota_veiculo(id) ON DELETE CASCADE,
  criado_por  uuid,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, imei)
);

-- Casamento: manual > placa do campo > placa do nome. Lê só tabelas da empresa pedida.
CREATE OR REPLACE FUNCTION public.fn_frota_rastreio_casamento(p_company_id uuid)
RETURNS TABLE (imei text, nome text, placa_rastreador text, veiculo_id uuid, placa_cadastro text, metodo text,
               sugestao_veiculo_id uuid, sugestao_placa text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH cad AS (
    SELECT v.id, v.placa, public.fn_frota_placa_canonica(v.placa) AS canon
      FROM public.erp_hub_frota_veiculo v
     WHERE v.company_id = p_company_id AND v.excluido_em IS NULL AND coalesce(v.ativo, true)
  ), d AS (
    SELECT d.imei, d.nome,
           coalesce(public.fn_frota_placa_canonica(d.placa), public.fn_frota_placa_do_texto(d.nome), public.fn_frota_placa_do_texto(d.placa)) AS canon,
           (public.fn_frota_placa_canonica(d.placa) IS NOT NULL) AS do_campo
      FROM public.frota_rastreio_dispositivo d WHERE d.company_id = p_company_id
  )
  SELECT d.imei, d.nome, d.canon,
         coalesce(vm.veiculo_id, c.id),
         coalesce(cm.placa, c.placa),
         CASE WHEN vm.imei IS NOT NULL THEN CASE WHEN vm.veiculo_id IS NULL THEN 'fora_da_frota' ELSE 'manual' END
              WHEN c.id IS NOT NULL THEN CASE WHEN d.do_campo THEN 'placa' ELSE 'nome' END
              ELSE 'sem_par' END,
         s.id, s.placa
    FROM d
    LEFT JOIN public.frota_rastreio_vinculo vm ON vm.company_id = p_company_id AND vm.imei = d.imei
    LEFT JOIN cad cm ON cm.id = vm.veiculo_id
    LEFT JOIN cad c  ON vm.imei IS NULL AND c.canon IS NOT NULL AND c.canon = d.canon
    LEFT JOIN LATERAL (
      SELECT x.id, x.placa FROM cad x
       WHERE vm.imei IS NULL AND c.id IS NULL AND public.fn_frota_placa_dif(x.canon, d.canon) = 1
       ORDER BY x.placa LIMIT 1) s ON true;
$$;
REVOKE ALL ON FUNCTION public.fn_frota_rastreio_casamento(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_frota_rastreio_casamento(uuid) TO service_role;

-- Confirmar / desfazer vínculo (usuário com a empresa). p_veiculo_id NULL + p_fora_da_frota = marca "não é da frota";
-- p_veiculo_id NULL sem a marca = desfaz (volta ao automático).
CREATE OR REPLACE FUNCTION public.fn_frota_rastreio_vincular(p_company_id uuid, p_imei text, p_veiculo_id uuid, p_fora_da_frota boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre com o seu usuário' USING ERRCODE = '42501'; END IF;
  IF NOT (public.is_admin() OR p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.frota_rastreio_dispositivo WHERE company_id = p_company_id AND imei = p_imei) THEN
    RAISE EXCEPTION 'Rastreador não encontrado nesta empresa.';
  END IF;
  IF p_veiculo_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.erp_hub_frota_veiculo WHERE id = p_veiculo_id AND company_id = p_company_id AND excluido_em IS NULL) THEN
    RAISE EXCEPTION 'Veículo não encontrado na frota desta empresa.';
  END IF;
  IF p_veiculo_id IS NULL AND NOT coalesce(p_fora_da_frota, false) THEN
    DELETE FROM public.frota_rastreio_vinculo WHERE company_id = p_company_id AND imei = p_imei;
    RETURN jsonb_build_object('ok', true, 'acao', 'automatico');
  END IF;
  INSERT INTO public.frota_rastreio_vinculo (company_id, imei, veiculo_id, criado_por)
  VALUES (p_company_id, p_imei, p_veiculo_id, auth.uid())
  ON CONFLICT (company_id, imei) DO UPDATE SET veiculo_id = EXCLUDED.veiculo_id, criado_por = EXCLUDED.criado_por, criado_em = now();
  RETURN jsonb_build_object('ok', true, 'acao', CASE WHEN p_veiculo_id IS NULL THEN 'fora_da_frota' ELSE 'manual' END);
END $$;
REVOKE ALL ON FUNCTION public.fn_frota_rastreio_vincular(uuid, text, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_frota_rastreio_vincular(uuid, text, uuid, boolean) TO authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------
-- b) Regras de custo de frota sobre os títulos a pagar (editáveis sem deploy; company_id NULL = padrão)
-- ------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.frota_custo_regra (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  categoria   text NOT NULL CHECK (categoria IN ('combustivel','manutencao','pneus','excluir')),
  campo       text NOT NULL DEFAULT 'parceiro' CHECK (campo IN ('parceiro','documento')),
  padrao      text NOT NULL,                          -- expressão regular (sem diferenciar maiúsculas)
  ordem       integer NOT NULL DEFAULT 100,           -- menor primeiro: a 1ª regra que casa decide
  ativo       boolean NOT NULL DEFAULT true,
  observacao  text,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_frota_custo_regra ON public.frota_custo_regra
  (coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), categoria, campo, padrao);

INSERT INTO public.frota_custo_regra (company_id, categoria, campo, padrao, ordem, observacao) VALUES
  (NULL, 'excluir',     'documento', '^(ADF|ADS)$', 10, 'Adiantamento a fornecedor não é custo do mês.'),
  (NULL, 'pneus',       'parceiro',  '(pneu|borrach|recap|recauch)', 20, 'Pneus, borracharias e recapagem.'),
  (NULL, 'manutencao',  'parceiro',  '(mec[aâ]nic|auto ?pe[cç]a|autope[cç]a|ret[ií]fica|\mmolas\M|freios?\M|funilaria|el[eé]tric[ao] (auto|diesel)|diesel ?center)', 30, 'Mecânicas, peças e oficinas.'),
  (NULL, 'combustivel', 'parceiro',  '(\mposto\M|auto ?posto|combust[ií]ve|abastecedora|petr[oó]leo|\mpetro\M|\mdiesel\M)', 40, 'Postos e combustível.')
ON CONFLICT DO NOTHING;

-- Custo do mês por categoria (títulos a pagar emitidos no mês, sem cancelados). Leitura de ind_fin_titulo_mv.
CREATE OR REPLACE FUNCTION public.fn_frota_custo_mes(p_company_id uuid, p_mes date)
RETURNS TABLE (categoria text, valor numeric, titulos integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH regra AS (
    SELECT r.* FROM public.frota_custo_regra r
     WHERE r.ativo AND (r.company_id IS NULL OR r.company_id = p_company_id)
  ), t AS (
    SELECT t.id, t.valor,
           (SELECT r.categoria FROM regra r
             WHERE (CASE r.campo WHEN 'documento' THEN t.documento ELSE t.parceiro END) ~* r.padrao
             ORDER BY (r.company_id IS NULL), r.ordem LIMIT 1) AS cat
      FROM public.ind_fin_titulo_mv t
     WHERE t.company_id = p_company_id AND t.ramo = 'pagar' AND t.status IS DISTINCT FROM 'cancelado'
       AND t.emissao >= date_trunc('month', p_mes)::date AND t.emissao < (date_trunc('month', p_mes) + interval '1 month')::date
  )
  SELECT cat, round(sum(valor), 2), count(*)::int FROM t WHERE cat IS NOT NULL AND cat <> 'excluir' GROUP BY cat;
$$;
REVOKE ALL ON FUNCTION public.fn_frota_custo_mes(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_frota_custo_mes(uuid, date) TO service_role;

-- ------------------------------------------------------------------------------------------------------------
-- c) Cópia diária: rota (bruto 90 dias), km oficial, viagens, paradas, checkpoint
-- ------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.frota_rastreio_ponto (
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  imei           text NOT NULL,
  gps_em         timestamptz NOT NULL,
  latitude       numeric(10,7) NOT NULL,
  longitude      numeric(10,7) NOT NULL,
  velocidade_kmh numeric,
  curso          numeric,
  PRIMARY KEY (company_id, imei, gps_em)
);
COMMENT ON TABLE public.frota_rastreio_ponto IS 'Rota completa copiada do rastreador (D-1). Bruto guardado 90 dias (fn_frota_rastreio_purgar).';

CREATE TABLE IF NOT EXISTS public.frota_km_dia (
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  imei        text NOT NULL,
  dia         date NOT NULL,
  km          numeric NOT NULL,
  fonte       text NOT NULL DEFAULT 'rastreador',
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, imei, dia)
);
COMMENT ON TABLE public.frota_km_dia IS 'Km oficial do rastreador por veículo e dia (relatório de quilometragem, em km).';

CREATE TABLE IF NOT EXISTS public.frota_viagem (
  company_id   uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  imei         text NOT NULL,
  dia          date NOT NULL,
  inicio       timestamptz NOT NULL,
  fim          timestamptz NOT NULL,
  km           numeric NOT NULL,
  duracao_min  numeric NOT NULL,
  velocidade_max numeric,
  origem_lat   numeric(10,7), origem_lng numeric(10,7),
  destino_lat  numeric(10,7), destino_lng numeric(10,7),
  origem_cerca text, destino_cerca text,
  PRIMARY KEY (company_id, imei, inicio)
);
CREATE INDEX IF NOT EXISTS idx_frota_viagem_dia ON public.frota_viagem (company_id, dia);

CREATE TABLE IF NOT EXISTS public.frota_parada (
  company_id   uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  imei         text NOT NULL,
  dia          date NOT NULL,
  inicio       timestamptz NOT NULL,
  fim          timestamptz NOT NULL,
  duracao_min  numeric NOT NULL,
  latitude     numeric(10,7) NOT NULL,
  longitude    numeric(10,7) NOT NULL,
  cerca        text,
  PRIMARY KEY (company_id, imei, inicio)
);
CREATE INDEX IF NOT EXISTS idx_frota_parada_dia ON public.frota_parada (company_id, dia);

CREATE TABLE IF NOT EXISTS public.frota_copia_dia (
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  imei        text NOT NULL,
  dia         date NOT NULL,
  status      text NOT NULL CHECK (status IN ('ok','sem_dado','erro')),
  pontos      integer, viagens integer, paradas integer, km numeric,
  erro        text,
  tentativas  integer NOT NULL DEFAULT 1,
  em          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, imei, dia)
);

-- ------------------------------------------------------------------------------------------------------------
-- d) Alarmes e cercas (só leitura da plataforma)
-- ------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.frota_alarme (
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  imei        text NOT NULL,
  tipo        integer NOT NULL,
  tipo_nome   text NOT NULL,
  sistema_em  timestamptz NOT NULL,
  gps_em      timestamptz,
  latitude    numeric(10,7), longitude numeric(10,7),
  velocidade_kmh numeric,
  cerca_id    text, cerca_nome text,
  recebido_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, imei, tipo, sistema_em)
);
CREATE INDEX IF NOT EXISTS idx_frota_alarme_recente ON public.frota_alarme (company_id, sistema_em DESC);

CREATE TABLE IF NOT EXISTS public.frota_cerca (
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cerca_id    text NOT NULL,
  nome        text,
  tipo        text NOT NULL CHECK (tipo IN ('circulo','poligono')),
  centro_lat  numeric(10,7), centro_lng numeric(10,7), raio_m numeric,
  poligono    jsonb,                                  -- [[lng,lat], ...]
  velocidade_max numeric,
  origem      text NOT NULL DEFAULT 'rastreador',
  visto_em    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, cerca_id)
);

-- ------------------------------------------------------------------------------------------------------------
-- RLS / grants das tabelas novas (leitura por empresa; escrita só serviço — exceto regras/vínculo via RPC)
-- ------------------------------------------------------------------------------------------------------------
DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['frota_rastreio_vinculo','frota_rastreio_ponto','frota_km_dia','frota_viagem','frota_parada',
                           'frota_copia_dia','frota_alarme','frota_cerca','frota_custo_regra'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_ler', t);
    IF t = 'frota_custo_regra' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (company_id IS NULL OR company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin())', t || '_ler', t);
    ELSE
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin())', t || '_ler', t);
    END IF;
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, PUBLIC', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $rls$;

-- ------------------------------------------------------------------------------------------------------------
-- e) Token no Vault, reaproveitado até 10 min antes de expirar (só serviço)
-- ------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_frota_rastreio_token_ler(p_company_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'vault', 'pg_temp'
AS $$
DECLARE v text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.frota_rastreio_config WHERE company_id = p_company_id AND token_expira_em > now() + interval '10 minutes') THEN
    RETURN NULL;
  END IF;
  SELECT decrypted_secret INTO v FROM vault.decrypted_secrets WHERE name = 'frota_rastreio_token_' || p_company_id::text;
  RETURN v;
END $$;

-- ci-sem-guarda: fn_frota_rastreio_token_gravar — só service_role (edge do sincronizador); sem EXECUTE para usuário.
CREATE OR REPLACE FUNCTION public.fn_frota_rastreio_token_gravar(p_company_id uuid, p_token text, p_expira_em timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'vault', 'pg_temp'
AS $$
DECLARE v_nome text := 'frota_rastreio_token_' || p_company_id::text; v_id uuid;
BEGIN
  IF p_token IS NULL OR p_token = '' THEN
    UPDATE public.frota_rastreio_config SET token_expira_em = NULL WHERE company_id = p_company_id;
    RETURN;
  END IF;
  SELECT id INTO v_id FROM vault.secrets WHERE name = v_nome;
  IF v_id IS NULL THEN PERFORM vault.create_secret(p_token, v_nome, 'token de sessão do rastreador (2 h)');
  ELSE PERFORM vault.update_secret(v_id, p_token); END IF;
  INSERT INTO public.frota_rastreio_config (company_id, token_expira_em) VALUES (p_company_id, p_expira_em)
  ON CONFLICT (company_id) DO UPDATE SET token_expira_em = EXCLUDED.token_expira_em, atualizado_em = now();
END $$;
REVOKE ALL ON FUNCTION public.fn_frota_rastreio_token_ler(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_frota_rastreio_token_gravar(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_frota_rastreio_token_ler(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_frota_rastreio_token_gravar(uuid, text, timestamptz) TO service_role;

-- ------------------------------------------------------------------------------------------------------------
-- c) Pendências da cópia diária + limpeza do bruto (só serviço)
-- ------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_frota_rastreio_copias_pendentes(p_limite integer DEFAULT 500)
RETURNS TABLE (company_id uuid, imei text, dia date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH emp AS (
    SELECT e.company_id FROM public.erp_credencial e
     WHERE e.provider = 'brasilsat' AND e.escopo = 'empresa' AND e.ativo AND e.chave IN ('account','senha') AND e.company_id IS NOT NULL
     GROUP BY e.company_id HAVING count(DISTINCT e.chave) = 2
  ), ontem AS (SELECT ((now() AT TIME ZONE 'America/Sao_Paulo')::date - 1) AS d)
  SELECT d.company_id, d.imei, g.dia::date
    FROM emp
    JOIN public.frota_rastreio_config f ON f.company_id = emp.company_id AND f.ativo AND f.copia_diaria_habilitada
    JOIN public.frota_rastreio_dispositivo d ON d.company_id = emp.company_id
    CROSS JOIN ontem
    CROSS JOIN LATERAL generate_series(ontem.d - 6, ontem.d, interval '1 day') g(dia)
    LEFT JOIN public.frota_copia_dia c ON c.company_id = d.company_id AND c.imei = d.imei AND c.dia = g.dia::date
   WHERE c.imei IS NULL OR (c.status = 'erro' AND c.tentativas < 3 AND c.em < now() - interval '50 minutes')
   ORDER BY g.dia DESC, d.company_id, d.imei
   LIMIT p_limite;
$$;

CREATE OR REPLACE FUNCTION public.fn_frota_rastreio_purgar()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE n_ponto int; n_pos int;
BEGIN
  DELETE FROM public.frota_rastreio_ponto  WHERE gps_em < now() - interval '90 days';
  GET DIAGNOSTICS n_ponto = ROW_COUNT;
  DELETE FROM public.frota_rastreio_posicao WHERE gps_em < now() - interval '90 days';
  GET DIAGNOSTICS n_pos = ROW_COUNT;
  RETURN jsonb_build_object('pontos', n_ponto, 'posicoes', n_pos);
END $$;
REVOKE ALL ON FUNCTION public.fn_frota_rastreio_copias_pendentes(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_frota_rastreio_purgar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_frota_rastreio_copias_pendentes(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_frota_rastreio_purgar() TO service_role;

CREATE OR REPLACE FUNCTION public.fn_frota_rastreio_dispatch_diario()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $$
DECLARE v_key text; v_pend int; v_req bigint;
BEGIN
  SELECT count(*) INTO v_pend FROM public.fn_frota_rastreio_copias_pendentes(1);
  IF v_pend = 0 THEN RETURN jsonb_build_object('ok', true, 'pendentes', 0, 'pulado', true); END IF;
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY_FOR_WORKER';
  IF v_key IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'service_role ausente no vault'); END IF;
  SELECT net.http_post(
    url := 'https://horsymhsinqcimflrtjo.supabase.co/functions/v1/frota-rastreio-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := jsonb_build_object('origem', 'cron', 'modo', 'diario'),
    timeout_milliseconds := 150000) INTO v_req;
  RETURN jsonb_build_object('ok', true, 'request_id', v_req, 'ts', now());
END $$;
REVOKE ALL ON FUNCTION public.fn_frota_rastreio_dispatch_diario() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_frota_rastreio_dispatch_diario() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'frota-rastreio-diario') THEN PERFORM cron.unschedule('frota-rastreio-diario'); END IF;
END $$;
-- 04h10 a 09h10 (Brasília) de hora em hora: cada rodada copia o que couber e a próxima continua. Sem credencial = nada.
SELECT cron.schedule('frota-rastreio-diario', '10 7-12 * * *', $cron$ SELECT public.fn_frota_rastreio_dispatch_diario(); $cron$);

-- ------------------------------------------------------------------------------------------------------------
-- Painel (substitui a versão da #6406): casamento, custo por km do ERP, km oficial, alarmes, ontem, divergências
-- ------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_frota_rastreio_painel(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_cfg public.frota_rastreio_config;
  v_cred boolean;
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_mes date := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date)::date;
  v_mes_ant date := (date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date) - interval '1 month')::date;
  v_veic jsonb; v_kpi jsonb; v_custo jsonb; v_div jsonb; v_alarme jsonb; v_ontem jsonb;
BEGIN
  IF auth.uid() IS NULL AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Entre com o seu usuário' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_admin() OR auth.role() = 'service_role' OR p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  v_cred := public.fn_frota_rastreio_tem_credencial(p_company_id);
  SELECT * INTO v_cfg FROM public.frota_rastreio_config WHERE company_id = p_company_id;

  -- custo do ERP de origem por mês (mês corrente parcial e mês anterior) × km oficial do mesmo mês
  WITH meses AS (SELECT unnest(ARRAY[v_mes, v_mes_ant]) AS mes),
  cm AS (SELECT m.mes, c.categoria, c.valor, c.titulos FROM meses m CROSS JOIN LATERAL public.fn_frota_custo_mes(p_company_id, m.mes) c),
  km AS (SELECT date_trunc('month', k.dia)::date AS mes, sum(k.km) AS km FROM public.frota_km_dia k
          WHERE k.company_id = p_company_id AND k.dia >= v_mes_ant GROUP BY 1)
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'mes', m.mes, 'km', round(coalesce(km.km, 0), 1),
           'combustivel', coalesce((SELECT valor FROM cm WHERE cm.mes = m.mes AND categoria = 'combustivel'), 0),
           'manutencao',  coalesce((SELECT valor FROM cm WHERE cm.mes = m.mes AND categoria = 'manutencao'), 0),
           'pneus',       coalesce((SELECT valor FROM cm WHERE cm.mes = m.mes AND categoria = 'pneus'), 0),
           'total',       coalesce((SELECT sum(valor) FROM cm WHERE cm.mes = m.mes), 0),
           'titulos',     coalesce((SELECT sum(titulos) FROM cm WHERE cm.mes = m.mes), 0),
           'custo_km',    CASE WHEN coalesce(km.km, 0) > 0 THEN round(coalesce((SELECT sum(valor) FROM cm WHERE cm.mes = m.mes), 0) / km.km, 2) END,
           'parcial',     m.mes = v_mes
         ) ORDER BY m.mes DESC), '[]'::jsonb)
    INTO v_custo
    FROM meses m LEFT JOIN km ON km.mes = m.mes;

  WITH ult AS (
    SELECT DISTINCT ON (p.imei) p.*
      FROM public.frota_rastreio_posicao p
     WHERE p.company_id = p_company_id AND p.gps_em > now() - interval '30 days'
     ORDER BY p.imei, p.gps_em DESC
  ), km30 AS (
    SELECT k.imei, sum(k.km) AS km_30d, sum(k.km) FILTER (WHERE k.dia >= v_mes) AS km_mes,
           sum(k.km) FILTER (WHERE k.dia >= v_mes_ant AND k.dia < v_mes) AS km_mes_ant
      FROM public.frota_km_dia k WHERE k.company_id = p_company_id AND k.dia >= least(v_hoje - 30, v_mes_ant) GROUP BY 1
  ), kmfrota AS (SELECT coalesce(sum(km_mes_ant), 0) AS km_ant FROM km30),
  custo_ant AS (SELECT coalesce(sum(valor), 0) AS v FROM public.fn_frota_custo_mes(p_company_id, v_mes_ant)),
  casa AS (SELECT * FROM public.fn_frota_rastreio_casamento(p_company_id)),
  cad AS (SELECT v.id, v.placa, v.modelo, v.marca, v.ano, v.tipo FROM public.erp_hub_frota_veiculo v WHERE v.company_id = p_company_id),
  custo_lanc AS (
    SELECT c.veiculo_id, sum(c.valor) AS v FROM public.erp_hub_frota_custo c
     WHERE c.company_id = p_company_id AND c.excluido_em IS NULL AND c.data_custo > v_hoje - 30 GROUP BY 1
  ), linhas AS (
    SELECT d.imei, coalesce(cs.placa_cadastro, cs.placa_rastreador, nullif(d.placa, ''), d.nome, d.imei) AS rotulo,
           d.placa, d.nome, cs.metodo, cs.placa_rastreador,
           u.gps_em, u.latitude, u.longitude, u.velocidade_kmh, u.curso, u.ignicao, u.km_hoje, u.odometro, u.motorista,
           CASE WHEN u.gps_em IS NULL OR u.gps_em < now() - interval '1 hour' THEN 'sem_sinal'
                WHEN coalesce(u.velocidade_kmh, 0) > 3 THEN 'em_movimento'
                WHEN u.ignicao THEN 'ligado_parado'
                ELSE 'parado' END AS situacao,
           k.km_30d, k.km_mes_ant, cs.veiculo_id, c.modelo, c.marca, c.ano, c.tipo,
           -- rateio do custo do mês anterior (títulos do ERP) pelo km do veículo no mês + o que foi lançado no veículo
           CASE WHEN kf.km_ant > 0 AND coalesce(k.km_mes_ant, 0) > 0 THEN round(ca.v * k.km_mes_ant / kf.km_ant, 2) END AS custo_rateado_mes_ant,
           cl.v AS custo_lancado_30d
      FROM public.frota_rastreio_dispositivo d
      LEFT JOIN casa cs ON cs.imei = d.imei
      LEFT JOIN ult u ON u.imei = d.imei
      LEFT JOIN km30 k ON k.imei = d.imei
      LEFT JOIN cad c ON c.id = cs.veiculo_id
      LEFT JOIN custo_lanc cl ON cl.veiculo_id = cs.veiculo_id
      CROSS JOIN kmfrota kf CROSS JOIN custo_ant ca
     WHERE d.company_id = p_company_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'imei', imei, 'rotulo', rotulo, 'placa', placa, 'nome', nome, 'metodo', metodo, 'placa_rastreador', placa_rastreador,
           'gps_em', gps_em, 'latitude', latitude, 'longitude', longitude, 'velocidade_kmh', velocidade_kmh,
           'curso', curso, 'ignicao', ignicao, 'km_hoje', km_hoje, 'odometro', odometro, 'motorista', motorista,
           'situacao', situacao, 'km_30d', km_30d, 'km_mes_ant', km_mes_ant,
           'cadastrado', veiculo_id IS NOT NULL, 'veiculo_id', veiculo_id, 'modelo', modelo, 'marca', marca, 'ano', ano, 'tipo', tipo,
           'custo_rateado_mes_ant', custo_rateado_mes_ant, 'custo_lancado_30d', custo_lancado_30d,
           'custo_30d', coalesce(custo_lancado_30d, 0) + coalesce(custo_rateado_mes_ant, 0),
           'custo_km_30d', CASE WHEN coalesce(km_mes_ant, 0) > 0 AND custo_rateado_mes_ant IS NOT NULL THEN round(custo_rateado_mes_ant / km_mes_ant, 2) END
         ) ORDER BY CASE situacao WHEN 'em_movimento' THEN 1 WHEN 'ligado_parado' THEN 2 WHEN 'parado' THEN 3 ELSE 4 END, rotulo), '[]'::jsonb),
         jsonb_build_object(
           'total', count(*),
           'em_movimento', count(*) FILTER (WHERE situacao = 'em_movimento'),
           'ligado_parado', count(*) FILTER (WHERE situacao = 'ligado_parado'),
           'parado', count(*) FILTER (WHERE situacao = 'parado'),
           'sem_sinal', count(*) FILTER (WHERE situacao = 'sem_sinal'),
           'km_hoje', round(coalesce(sum(km_hoje) FILTER (WHERE gps_em >= (v_hoje::timestamp AT TIME ZONE 'America/Sao_Paulo')), 0), 1),
           'km_30d', round(coalesce(sum(km_30d), 0), 1),
           'cadastrados', count(*) FILTER (WHERE veiculo_id IS NOT NULL),
           'custo_30d', round(coalesce(sum(coalesce(custo_lancado_30d, 0) + coalesce(custo_rateado_mes_ant, 0)), 0), 2))
    INTO v_veic, v_kpi
    FROM linhas;

  -- divergências: rastreador sem par (com sugestão) e veículo ativo sem rastreador
  WITH casa AS (SELECT * FROM public.fn_frota_rastreio_casamento(p_company_id)),
  cad AS (SELECT v.id, v.placa, v.tipo FROM public.erp_hub_frota_veiculo v
           WHERE v.company_id = p_company_id AND v.excluido_em IS NULL AND coalesce(v.ativo, true))
  SELECT jsonb_build_object(
    'rastreador_sem_par', coalesce((SELECT jsonb_agg(jsonb_build_object('imei', imei, 'nome', nome, 'placa_rastreador', placa_rastreador,
                              'sugestao_veiculo_id', sugestao_veiculo_id, 'sugestao_placa', sugestao_placa) ORDER BY nome)
                            FROM casa WHERE metodo = 'sem_par'), '[]'::jsonb),
    'veiculo_sem_rastreador', coalesce((SELECT jsonb_agg(jsonb_build_object('veiculo_id', c.id, 'placa', c.placa, 'tipo', c.tipo) ORDER BY c.placa)
                            FROM cad c WHERE NOT EXISTS (SELECT 1 FROM casa WHERE casa.veiculo_id = c.id)), '[]'::jsonb),
    'casados', (SELECT count(*) FROM casa WHERE veiculo_id IS NOT NULL),
    'fora_da_frota', (SELECT count(*) FROM casa WHERE metodo = 'fora_da_frota'))
    INTO v_div;

  SELECT jsonb_build_object(
    'ultimas_24h', (SELECT count(*) FROM public.frota_alarme a WHERE a.company_id = p_company_id AND a.sistema_em > now() - interval '24 hours'),
    'por_tipo', coalesce((SELECT jsonb_agg(jsonb_build_object('tipo', tipo_nome, 'n', n) ORDER BY n DESC)
                  FROM (SELECT tipo_nome, count(*) n FROM public.frota_alarme a
                         WHERE a.company_id = p_company_id AND a.sistema_em > now() - interval '7 days' GROUP BY 1) x), '[]'::jsonb),
    'recentes', coalesce((SELECT jsonb_agg(r) FROM (
                  SELECT jsonb_build_object('imei', a.imei, 'tipo', a.tipo_nome, 'em', a.sistema_em, 'cerca', a.cerca_nome,
                                            'velocidade_kmh', a.velocidade_kmh) AS r
                    FROM public.frota_alarme a WHERE a.company_id = p_company_id ORDER BY a.sistema_em DESC LIMIT 15) y), '[]'::jsonb))
    INTO v_alarme;

  SELECT jsonb_build_object(
    'dia', v_hoje - 1,
    'km', (SELECT round(coalesce(sum(km), 0), 1) FROM public.frota_km_dia WHERE company_id = p_company_id AND dia = v_hoje - 1),
    'viagens', (SELECT count(*) FROM public.frota_viagem WHERE company_id = p_company_id AND dia = v_hoje - 1),
    'paradas', (SELECT count(*) FROM public.frota_parada WHERE company_id = p_company_id AND dia = v_hoje - 1),
    'horas_rodando', (SELECT round(coalesce(sum(duracao_min), 0) / 60.0, 1) FROM public.frota_viagem WHERE company_id = p_company_id AND dia = v_hoje - 1),
    'copiados', (SELECT count(*) FROM public.frota_copia_dia WHERE company_id = p_company_id AND dia = v_hoje - 1 AND status IN ('ok','sem_dado')),
    'cercas', (SELECT count(*) FROM public.frota_cerca WHERE company_id = p_company_id))
    INTO v_ontem;

  RETURN jsonb_build_object(
    'tem_credencial', v_cred,
    'config', jsonb_build_object(
      'cadencia_min', coalesce(v_cfg.cadencia_min, 10),
      'playback_habilitado', coalesce(v_cfg.playback_habilitado, false),
      'copia_diaria_habilitada', coalesce(v_cfg.copia_diaria_habilitada, true),
      'ultima_sync_em', v_cfg.ultima_sync_em,
      'ultima_sync_ok_em', v_cfg.ultima_sync_ok_em,
      'ultima_copia_em', v_cfg.ultima_copia_em,
      'ultimo_status', v_cfg.ultimo_status,
      'ultimo_erro', v_cfg.ultimo_erro),
    'frota_cadastrada', (SELECT count(*) FROM public.erp_hub_frota_veiculo v
                          WHERE v.company_id = p_company_id AND v.excluido_em IS NULL AND coalesce(v.ativo, true)),
    'kpis', v_kpi,
    'custo_mes', v_custo,
    'divergencias', v_div,
    'alarmes', v_alarme,
    'ontem', v_ontem,
    'veiculos', v_veic);
END $$;
REVOKE ALL ON FUNCTION public.fn_frota_rastreio_painel(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_frota_rastreio_painel(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------
-- "?" das partes novas da tela (RD-95)
-- ------------------------------------------------------------------------------------------------------------
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'BI de Logística', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/inteligencia/logistica', 'industrial', 'publicado'
FROM (VALUES
 ('log.bi.subconta', 'Conta de integração', 'Peça ao fornecedor do rastreamento uma subconta só para o sistema e cadastre essa conta em Conectores › Logística.', 'O rastreador aceita uma sessão ativa por conta: cada entrada nova derruba a anterior. Com uma conta própria para a integração, ninguém da equipe é desconectado da plataforma e as leituras não se atrapalham.', 'Conta "integracao.frioeste" só com permissão de leitura.', 'Usar a mesma conta e senha do gestor da frota: ele passa a cair da plataforma a cada leitura.', 14),
 ('log.bi.casamento', 'Rastreador × frota cadastrada', 'Confira os pares. Quando houver sugestão, toque em "Confirmar" para ligar o rastreador ao veículo.', 'Liga cada rastreador ao veículo cadastrado pela placa escrita no nome do equipamento, aceitando placa antiga e Mercosul (MKS1306 = MKS1D06). É o que permite somar custo, km e viagens por veículo.', 'Rastreador "MMM-4739 Atego" sugere o veículo MMM4738 (1 caractere diferente).', 'Confirmar sugestão sem conferir: 1 caractere diferente pode ser outro caminhão. Corrija o nome no rastreador ou a placa no cadastro.', 15),
 ('log.bi.sem_rastreador', 'Veículos sem rastreador', 'Nada a preencher.', 'Veículos ativos da frota cadastrada que nenhum rastreador ligou. Ficam fora do km e do rateio de custo.', 'LYX1048 e os 4 carros sem equipamento.', 'Achar que está faltando dado: o veículo pode simplesmente não ter rastreador.', 16),
 ('log.bi.custo_mes', 'Custo da frota por km', 'Nada a preencher: o custo vem dos títulos a pagar do ERP (postos, oficinas, pneus), pelas regras de classificação.', 'Soma do mês dos títulos de combustível, manutenção e pneus dividida pelo km oficial da frota no mesmo mês. O custo de cada veículo é rateado pelo km que ele rodou.', 'Outubro: R$ 117 mil ÷ 45.253 km = R$ 2,59/km.', 'Comparar o mês corrente (ainda aberto) com um mês fechado; ou esquecer que título sem placa é rateado, não é custo exato do caminhão.', 17),
 ('log.bi.ontem', 'Ontem (cópia diária)', 'Nada a preencher.', 'Toda madrugada o sistema copia do rastreador a rota completa do dia anterior, o km oficial e separa viagens e paradas. O histórico fica guardado aqui, sem o limite de 30 dias da plataforma.', 'Ontem: 1.480 km, 64 viagens, 120 paradas, 38 h rodando.', 'Esperar o dia de hoje: a cópia é do dia anterior; o de hoje entra amanhã cedo.', 18),
 ('log.bi.alarmes', 'Alarmes do rastreador', 'Nada a preencher: os alarmes são configurados na plataforma do rastreador.', 'Mostra os alarmes que o rastreador gerou (velocidade, cerca, ignição, marcha lenta, desligamento…) nas últimas leituras.', '3 alarmes de velocidade nas últimas 24 h.', 'Achar que não há risco com zero alarmes: sem alarme configurado na plataforma, nada é gerado.', 19)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
