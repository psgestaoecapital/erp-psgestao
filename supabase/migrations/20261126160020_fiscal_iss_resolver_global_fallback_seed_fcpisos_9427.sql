-- #9427 (Canal PS / jordana-manual) · PR-A da Fatia 2 (parte SEM certificado), ADITIVA e idempotente.
--
-- O quê:
--  1) fn_fiscal_iss_resolver passa a usar a tabela GLOBAL nacional (fiscal_iss_municipio_aliquota)
--     como FALLBACK, com esta precedência: manual da EMPRESA > manual GLOBAL (fiscal_iss_municipio)
--     > tabela nacional. Da tabela nacional, SOMENTE linhas com status_validacao='validada' E com
--     aliquota preenchida entram no cálculo. Linhas 'sem_fonte_oficial'/'pendente' ou sem alíquota
--     NUNCA entram — mantém a doutrina "só alíquota validada vai para a nota".
--  2) Carga inicial (worklist): os 107 municípios com cliente ativo da FC Pisos (b202b50f-…) ×
--     subitens 07.05.01 e 07.05.02, como status_validacao='sem_fonte_oficial', SEM alíquota e SEM
--     fonte — a lista a ser preenchida pela rotina da API (PR-B). Os 4 municípios sem IBGE no cadastro
--     (Itapejara d'Oeste/PR 4111209, São Jorge d'Oeste/PR 4125209, Herval d'Oeste/SC 4206702,
--     Estrela d'Oeste/SP 3515202) foram resolvidos pela tabela oficial erp_gov_nfse_municipios.
--  3) Os cadastros manuais do contador (fiscal_iss_municipio: Lages, Paraíso, Ponta Grossa) ficam
--     INTACTOS e continuam com prioridade sobre a tabela nacional.
--
-- Prova (RD-38): SELECT count(*) FROM fiscal_iss_municipio_aliquota era 0; manual = 3 linhas.
-- RD-38 (não inventar): nenhuma alíquota é gravada aqui — só a lista de municípios sem fonte.
--
--  4) Granularidade 07.05 x 07.05.01/07.05.02: o cadastro de serviço (erp_servicos) guarda só o nível
--     "pai" da LC 116 ('07.05') e fn_nfse_validar_emissao chama o resolver com esse código; a tabela
--     nacional é por subitem ('07.05.01','07.05.02'). O fallback nacional passa a: (a) casar exato quando
--     o código já vem no subitem; (b) quando vem o pai de 2 níveis, agregar os subitens validados do
--     município — alíquota única usa; alíquotas divergentes devolve ok:false pedindo o subitem (nunca
--     chuta); nenhum subitem validado mantém o ok:false 'aliquota_nao_cadastrada'. O manual (07.05 exato
--     da empresa) continua com prioridade.
--
-- Observações para a revisão (não alteram esta PR):
--  - A tabela nacional ainda não é lida por nenhuma tela; estas linhas são worklist no banco. Exibir
--    na tela "ISS por município" é slice seguinte.
--  - fn_nfse_validar_emissao NÃO muda: ela já chama o resolver com o codigo_lc116 e só olha o 'ok'.

-- 1) Permitir representar "sem fonte oficial" de forma honesta (tabela hoje vazia; mudança aditiva e
--    idempotente — DROP NOT NULL é no-op se já estiver nulável; os CHECK de range/enum já passam em NULL).
ALTER TABLE public.fiscal_iss_municipio_aliquota ALTER COLUMN aliquota DROP NOT NULL;
ALTER TABLE public.fiscal_iss_municipio_aliquota ALTER COLUMN fonte    DROP NOT NULL;

COMMENT ON COLUMN public.fiscal_iss_municipio_aliquota.aliquota IS
  'Alíquota de ISS (%). NULL enquanto não há fonte oficial (status_validacao=sem_fonte_oficial). Só linha validada e com alíquota vai para a nota.';
COMMENT ON COLUMN public.fiscal_iss_municipio_aliquota.fonte IS
  'Origem da alíquota: api_nacional, prefeitura ou contador. NULL enquanto não há fonte (worklist sem fonte oficial).';

-- 2) Resolver com fallback para a tabela nacional (manual tem prioridade; nacional só se validada).
CREATE OR REPLACE FUNCTION public.fn_fiscal_iss_resolver(p_company_id uuid, p_codigo_ibge text, p_codigo_lc116 text, p_data date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lc   text := btrim(COALESCE(p_codigo_lc116, ''));
  v_ibge text := btrim(COALESCE(p_codigo_ibge, ''));
  v_data date := COALESCE(p_data, CURRENT_DATE);
  v_mun text; v_uf text; v_label text; r record; g record;
  v_n int; v_nd int;  -- agregação de subitens quando o serviço vem no nível "pai" (ex.: 07.05)
BEGIN
  -- d) guard de tenant
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'sem_acesso');
  END IF;

  -- servico sem LC116 nao tem como resolver
  IF v_lc = '' THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'servico_sem_lc116',
      'acao', 'Cadastre o codigo da LC 116 no servico antes de emitir.');
  END IF;

  SELECT nome_municipio, uf INTO v_mun, v_uf
    FROM erp_gov_nfse_municipios WHERE codigo_ibge = v_ibge;
  v_label := COALESCE(NULLIF(v_mun, '') || '/' || v_uf, NULLIF(v_ibge, ''), '—');

  -- 1) cadastro manual (contador) · precedencia empresa > global · PRIORIDADE sobre a tabela nacional
  SELECT * INTO r
    FROM fiscal_iss_municipio m
   WHERE m.codigo_ibge = v_ibge AND m.codigo_lc116 = v_lc
     AND m.vigencia_inicio <= v_data
     AND (m.vigencia_fim IS NULL OR m.vigencia_fim >= v_data)
     AND (m.company_id = p_company_id OR m.company_id IS NULL)
   ORDER BY (m.company_id = p_company_id) DESC NULLS LAST, m.vigencia_inicio DESC
   LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'aliquota', r.aliquota, 'fonte', r.fonte,
      'retido_na_fonte', r.retido_na_fonte, 'vigencia_inicio', r.vigencia_inicio,
      'municipio', v_label, 'codigo_lc116', v_lc, 'informado_por', r.informado_por,
      'origem', 'manual');
  END IF;

  -- 2) fallback: tabela nacional (fiscal_iss_municipio_aliquota). SO linha VALIDADA e com alíquota.
  --    'sem_fonte_oficial'/'pendente' ou alíquota nula NUNCA entram no cálculo.
  -- 2a) casamento EXATO (quando o serviço já traz o subitem, ex.: 07.05.01).
  SELECT * INTO g
    FROM fiscal_iss_municipio_aliquota a
   WHERE a.codigo_ibge = v_ibge AND a.codigo_lc116 = v_lc
     AND a.status_validacao = 'validada'
     AND a.aliquota IS NOT NULL
     AND a.vigencia_inicio <= v_data
     AND (a.vigencia_fim IS NULL OR a.vigencia_fim >= v_data)
   ORDER BY a.vigencia_inicio DESC
   LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'aliquota', g.aliquota, 'fonte', g.fonte,
      'retido_na_fonte', g.retido_na_fonte, 'vigencia_inicio', g.vigencia_inicio,
      'municipio', v_label, 'codigo_lc116', v_lc, 'informado_por', NULL,
      'origem', 'nacional');
  END IF;

  -- 2b) o cadastro do serviço guarda só o nível "pai" da LC 116 (ex.: 07.05), mas a tabela nacional é
  --     por subitem (07.05.01, 07.05.02). Se o código recebido é um pai de 2 níveis, agrega os subitens
  --     VALIDADOS do município: alíquota única -> usa; alíquotas divergentes -> NÃO escolhe (pede o subitem,
  --     nunca chuta); nenhum subitem validado -> cai no ok:false padrão abaixo.
  IF v_lc ~ '^[0-9]{2}\.[0-9]{2}$' THEN
    SELECT count(*), count(DISTINCT a.aliquota) INTO v_n, v_nd
      FROM fiscal_iss_municipio_aliquota a
     WHERE a.codigo_ibge = v_ibge AND a.codigo_lc116 LIKE v_lc || '.%'
       AND a.status_validacao = 'validada'
       AND a.aliquota IS NOT NULL
       AND a.vigencia_inicio <= v_data
       AND (a.vigencia_fim IS NULL OR a.vigencia_fim >= v_data);

    IF v_n > 0 AND v_nd = 1 THEN
      -- alíquota igual em todos os subitens -> usa a linha vigente mais recente
      SELECT * INTO g
        FROM fiscal_iss_municipio_aliquota a
       WHERE a.codigo_ibge = v_ibge AND a.codigo_lc116 LIKE v_lc || '.%'
         AND a.status_validacao = 'validada'
         AND a.aliquota IS NOT NULL
         AND a.vigencia_inicio <= v_data
         AND (a.vigencia_fim IS NULL OR a.vigencia_fim >= v_data)
       ORDER BY a.vigencia_inicio DESC
       LIMIT 1;
      RETURN jsonb_build_object('ok', true, 'aliquota', g.aliquota, 'fonte', g.fonte,
        'retido_na_fonte', g.retido_na_fonte, 'vigencia_inicio', g.vigencia_inicio,
        'municipio', v_label, 'codigo_lc116', v_lc, 'informado_por', NULL,
        'origem', 'nacional_agregado');
    ELSIF v_n > 0 AND v_nd > 1 THEN
      -- divergência entre subitens -> não escolhe; pede o subitem exato
      RETURN jsonb_build_object('ok', false, 'motivo', 'subitem_necessario',
        'municipio', v_label, 'codigo_lc116', v_lc,
        'acao', 'Este município tem alíquotas diferentes por subitem de ' || v_lc
                || '. Informe o subitem exato do serviço (ex.: ' || v_lc || '.01).');
    END IF;
  END IF;

  -- 3) sem cadastro conhecido -> ok:false (nunca um numero padrao)
  RETURN jsonb_build_object('ok', false, 'motivo', 'aliquota_nao_cadastrada',
    'municipio', v_label, 'codigo_lc116', v_lc,
    'acao', 'Informe a aliquota deste municipio ou consulte o contador.');
END $function$;

-- 3) Carga inicial (worklist) dos municípios da FC Pisos × 07.05.01/07.05.02 como "sem fonte oficial".
--    Idempotente: só insere o par (município × subitem) que ainda não existe — não duplica em re-execução
--    nem sobrescreve linha futura preenchida pela API. NÃO grava alíquota (RD-38).
INSERT INTO public.fiscal_iss_municipio_aliquota
  (codigo_ibge, codigo_lc116, aliquota, fonte, retido_na_fonte, vigencia_inicio, status_validacao, observacao)
SELECT ibge, sub, NULL, NULL, NULL, DATE '2026-11-24', 'sem_fonte_oficial',
       'FC Pisos (#9427): município com cliente ativo, aguardando fonte oficial de alíquota (API Nacional NFS-e). Sem alíquota: não entra no cálculo.'
FROM unnest(ARRAY[
  '1504208','2602100','2905701','2910727','2916401','3154606','3167202','3170206','3170701','3205002',
  '3502101','3503307','3505807','3515004','3515202','3517505','3519006','3525201','3525904','3541604',
  '3550308','3554003','4101507','4103602','4104006','4104303','4104659','4105300','4105508','4105607',
  '4106902','4107207','4107652','4108403','4109906','4110409','4111209','4111902','4112009','4112405',
  '4112801','4113007','4113205','4113502','4113700','4115200','4118006','4118402','4118501','4119152',
  '4119905','4120101','4120853','4122404','4123402','4125209','4125506','4127106','4127205','4127700',
  '4202008','4202156','4202404','4203600','4203808','4203907','4204202','4204301','4204905','4206702',
  '4207650','4207684','4207700','4208401','4209300','4211009','4211603','4212239','4212601','4212908',
  '4213500','4216255','4216602','4217204','4218756','4219507','4300059','4300406','4300471','4301602',
  '4305702','4306320','4307708','4308706','4309654','4311809','4312401','4320800','5000708','5003702',
  '5004601','5007695','5007901','5103205','5106752','5203906','5214507'
]::text[]) AS ibge
CROSS JOIN unnest(ARRAY['07.05.01','07.05.02']::text[]) AS sub
WHERE NOT EXISTS (
  SELECT 1 FROM public.fiscal_iss_municipio_aliquota x
  WHERE x.codigo_ibge = ibge AND x.codigo_lc116 = sub
);
