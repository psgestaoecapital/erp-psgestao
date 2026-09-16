-- Central de Desenvolvimento — RPC das TRÊS BARRAS por vertical (Construído · Auditado · Em uso)
-- Decisões do CEO (aprovadas):
--   • CONSTRUÍDO = fórmula B por tela: (pronto + parcial×0.5) / telas. Rótulo "estimado". Roadmap é indicador SEPARADO.
--   • AUDITADO   = telas auditáveis pelo robô que já foram validadas / telas auditáveis. Sem auditável → "sem dado" (NUNCA 0% nem 100%).
--   • EM USO     = empresas REAIS (is_demo=false) que escreveram em tabela ESPECÍFICA da vertical nos últimos 30 dias.
--                  Tabelas COMPARTILHADAS (núcleo: erp_receber/erp_pagar/erp_fiscal_*/erp_banco_*/user_companies/...) NÃO contam —
--                  com elas toda vertical marcaria "em uso" e o medidor mediria "a empresa existe", não "a vertical roda".
--   • "sem dado" ≠ 0%. Vertical sem tela mapeada → construído sem dado. Vertical sem tabela própria (GE = núcleo) → em uso sem dado.
--   • Mostrar QUEM (nomes das empresas) e a ÚLTIMA ESCRITA (para distinguir zero-sazonal de zero-morto).
--
-- RD-38: o mapa vertical→tabela abaixo foi PROVADO no schema (tabelas com company_id + timestamp de escrita).
-- Armadilha comprovada: prefixo puro zeraria odonto (erp_odonto_*), agro (erp_pec_*) e pm (prod_*) — por isso o mapa é CURADO.

-- 1) Mapa curado vertical → tabela específica (só tabelas com company_id e timestamp)
CREATE TABLE IF NOT EXISTS public.dev_area_tabela_uso (
  area_slug  text NOT NULL,
  table_name text NOT NULL,
  criado_em  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dev_area_tabela_uso_pk PRIMARY KEY (area_slug, table_name)
);
COMMENT ON TABLE public.dev_area_tabela_uso IS
  'Central de Dev: tabelas ESPECÍFICAS de cada vertical usadas para medir "em uso". Núcleo compartilhado NÃO entra aqui.';

INSERT INTO public.dev_area_tabela_uso (area_slug, table_name) VALUES
  -- oficina
  ('oficina','erp_os'),('oficina','erp_os_apontamento'),('oficina','erp_os_aprovacao'),
  ('oficina','erp_os_diagnostico_item'),('oficina','erp_os_link_publico'),('oficina','erp_os_mecanico'),
  ('oficina','erp_os_peca_solicitacao'),('oficina','erp_os_recepcao'),('oficina','erp_os_registro_foto'),
  ('oficina','erp_oficina_comissao_regra'),('oficina','erp_oficina_contato'),
  -- compliance
  ('compliance','compliance_acidentes'),('compliance','compliance_calendar_tarefas'),
  ('compliance','compliance_consulta_config'),('compliance','compliance_consultas'),
  ('compliance','compliance_dispensas'),('compliance','compliance_documentos'),
  ('compliance','compliance_epi_assinatura_tokens'),('compliance','compliance_funcionarios'),
  ('compliance','compliance_prestadores'),('compliance','compliance_responsaveis'),('compliance','compliance_setores'),
  -- bpo
  ('bpo','bpo_alertas'),('bpo','bpo_canais_cliente'),('bpo','bpo_classificacoes'),
  ('bpo','bpo_companies_assignment'),('bpo','bpo_contratos'),('bpo','bpo_conversas'),
  ('bpo','bpo_execucoes'),('bpo','bpo_fechamento_mensal'),('bpo','bpo_inbox_items'),
  ('bpo','bpo_rotinas'),('bpo','bpo_sla_config'),('bpo','bpo_sync_log'),('bpo','bpo_tarefas'),
  -- hub (construção)
  ('hub','projetos_obras'),('hub','projetos_mao_obra'),('hub','erp_obra_planta'),('hub','erp_obra_planta_ambiente'),
  -- industrial
  ('industrial','ind_abate_evento'),('industrial','ind_gestor_escopo'),('industrial','ind_ponto_colaborador'),
  ('industrial','ind_ponto_dia'),('industrial','ind_ponto_horas'),('industrial','ind_ponto_marcacao'),
  ('industrial','ind_ponto_provider_config'),('industrial','ind_ponto_regra'),('industrial','ind_turnos'),
  ('industrial','ind_unidades'),('industrial','ind_venda'),('industrial','industrial_plants'),
  -- revenda_veiculos
  ('revenda_veiculos','veic_config'),('revenda_veiculos','veic_custo'),('revenda_veiculos','veic_modelo_catalogo'),
  ('revenda_veiculos','veic_proposta'),('revenda_veiculos','veic_proposta_troca'),('revenda_veiculos','veic_reserva'),
  ('revenda_veiculos','veic_veiculo'),('revenda_veiculos','veic_veiculo_foto'),('revenda_veiculos','veic_venda'),
  ('revenda_veiculos','veic_venda_recebimento'),
  -- wealth
  ('wealth','wealth_clients'),('wealth','wealth_consultores'),('wealth','wealth_pluggy_consents'),('wealth','wealth_pluggy_items'),
  -- odonto (armadilha: prefixo erp_odonto_*)
  ('odonto','erp_odonto_agendamento'),('odonto','erp_odonto_anamnese'),('odonto','erp_odonto_anamnese_modelo'),
  ('odonto','erp_odonto_cadeira'),('odonto','erp_odonto_documento'),('odonto','erp_odonto_documento_modelo'),
  ('odonto','erp_odonto_imagem'),('odonto','erp_odonto_odontograma'),('odonto','erp_odonto_paciente'),
  ('odonto','erp_odonto_plano_fase'),('odonto','erp_odonto_plano_item'),('odonto','erp_odonto_plano_tratamento'),
  ('odonto','erp_odonto_procedimento'),('odonto','erp_odonto_procedimento_insumo'),('odonto','erp_odonto_profissional'),
  ('odonto','erp_odonto_prontuario'),('odonto','erp_odonto_proposta_link'),
  -- agro (armadilha: prefixo erp_pec_*)
  ('agro','erp_pec_animal'),('agro','erp_pec_area'),('agro','erp_pec_custo_animal'),('agro','erp_pec_custo_lancamento'),
  ('agro','erp_pec_forrageira'),('agro','erp_pec_lote'),('agro','erp_pec_movimentacao'),('agro','erp_pec_pesagem'),
  ('agro','erp_pec_producao_evento'),('agro','erp_pec_propriedade'),('agro','erp_pec_repro_evento'),('agro','erp_propriedade_area'),
  -- pm (armadilha: prefixo prod_*)
  ('pm','prod_cargo'),('pm','prod_cargo_vinculo'),('pm','prod_conversao'),('pm','prod_fluxo'),('pm','prod_fluxo_etapa'),
  ('pm','prod_fonte_dados'),('pm','prod_posto'),('pm','prod_posto_turno'),('pm','prod_setor'),('pm','prod_setor_vinculo'),
  ('pm','prod_tempo_padrao'),('pm','prod_tipo_posto'),('pm','prod_unidade_medida')
  -- gestao_empresarial, custeio_a, custeio_b, medica: SEM tabela própria (núcleo/backlog) → "em uso" fica "sem dado".
ON CONFLICT (area_slug, table_name) DO NOTHING;

-- 2) RPC das três barras
CREATE OR REPLACE FUNCTION public.fn_dev_central_barras()
RETURNS TABLE (
  area_slug            text,
  status_comercial     text,
  telas                integer,
  construido_pct       numeric,
  construido_sem_dado  boolean,
  auditavel            integer,
  auditado_pct         numeric,
  auditado_sem_dado    boolean,
  tem_tabelas_proprias boolean,
  em_uso_empresas      integer,
  em_uso_nomes         text[],
  em_uso_ultima_escrita date,
  em_uso_sem_dado      boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r            record;
  v_created    boolean;
  v_updated    boolean;
  v_company    boolean;
  v_expr       text;
BEGIN
  CREATE TEMP TABLE _uso (area_slug text, company_id uuid, ultima timestamptz) ON COMMIT DROP;

  FOR r IN SELECT m.area_slug, m.table_name FROM public.dev_area_tabela_uso m LOOP
    SELECT bool_or(column_name = 'created_at'),
           bool_or(column_name = 'updated_at'),
           bool_or(column_name = 'company_id')
      INTO v_created, v_updated, v_company
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = r.table_name;

    -- tabela inexistente ou sem company_id/timestamp: ignora (o mapa pode citar tabela ainda não criada)
    IF COALESCE(v_company, false) = false OR COALESCE(v_created, false) = false AND COALESCE(v_updated, false) = false THEN
      CONTINUE;
    END IF;

    v_expr := CASE
      WHEN COALESCE(v_created, false) AND COALESCE(v_updated, false) THEN 'GREATEST(created_at, updated_at)'
      WHEN COALESCE(v_updated, false) THEN 'updated_at'
      ELSE 'created_at'
    END;

    EXECUTE format(
      'INSERT INTO _uso(area_slug, company_id, ultima)
         SELECT %L, company_id, max(%s) FROM public.%I WHERE company_id IS NOT NULL GROUP BY company_id',
      r.area_slug, v_expr, r.table_name);
  END LOOP;

  RETURN QUERY
  WITH scr AS (
    -- alias explícito (aprovado pelo CEO): system_screens usa 'hub_construcao'/'revenda';
    -- area_menu_config usa 'hub'/'revenda_veiculos'. Sem isto, hub e revenda apareceriam como "sem dado".
    SELECT CASE s.area
             WHEN 'hub_construcao' THEN 'hub'
             WHEN 'revenda'        THEN 'revenda_veiculos'
             ELSE s.area
           END AS a,
           count(*)::int AS telas,
           round(100.0 * (count(*) FILTER (WHERE s.estado_real = 'pronto')
                          + 0.5 * count(*) FILTER (WHERE s.estado_real = 'parcial'))
                 / NULLIF(count(*), 0), 0) AS construido,
           count(*) FILTER (WHERE s.auditavel_robo)::int AS auditavel,
           round(100.0 * count(*) FILTER (WHERE s.auditavel_robo AND s.ultima_validacao_visual_em IS NOT NULL)
                 / NULLIF(count(*) FILTER (WHERE s.auditavel_robo), 0), 0) AS auditado
    FROM public.system_screens s
    GROUP BY 1
  ),
  uso AS (
    SELECT u.area_slug,
           count(DISTINCT u.company_id) FILTER (WHERE u.ultima >= now() - interval '30 days')::int AS empresas,
           array_agg(DISTINCT COALESCE(c.nome_fantasia, c.razao_social))
             FILTER (WHERE u.ultima >= now() - interval '30 days') AS nomes,
           max(u.ultima)::date AS ultima
    FROM _uso u
    JOIN public.companies c ON c.id = u.company_id AND COALESCE(c.is_demo, false) = false
    GROUP BY u.area_slug
  ),
  tem_tab AS (SELECT DISTINCT d.area_slug FROM public.dev_area_tabela_uso d)
  SELECT
    amc.area_slug,
    amc.status_comercial,
    COALESCE(scr.telas, 0),
    scr.construido,
    (scr.telas IS NULL OR scr.telas = 0),
    COALESCE(scr.auditavel, 0),
    scr.auditado,
    (COALESCE(scr.auditavel, 0) = 0),
    (tt.area_slug IS NOT NULL),
    CASE WHEN tt.area_slug IS NULL THEN NULL ELSE COALESCE(uso.empresas, 0) END,
    uso.nomes,
    uso.ultima,
    (tt.area_slug IS NULL)
  FROM public.area_menu_config amc
  LEFT JOIN scr     ON scr.a = amc.area_slug
  LEFT JOIN uso     ON uso.area_slug = amc.area_slug
  LEFT JOIN tem_tab tt ON tt.area_slug = amc.area_slug
  WHERE amc.ativo = true
  ORDER BY amc.area_slug;
END;
$$;

COMMENT ON FUNCTION public.fn_dev_central_barras() IS
  'Central de Dev: três barras por vertical ativa. Construído=fórmula B (estimado); Auditado=validadas/auditáveis (sem dado se 0 auditável); Em uso=empresas reais (is_demo=false) que escreveram em tabela específica nos últimos 30d (sem dado se a vertical não tem tabela própria).';

GRANT EXECUTE ON FUNCTION public.fn_dev_central_barras() TO authenticated, service_role;
