-- RBAC Fase 0 — Vocabulário de permissão · Registro de subgrupos + classificação dos 53 órfãos.
-- ESTA FASE NÃO CRIA PERMISSÃO. Arruma o lugar onde a permissão vai se pendurar.
-- Nada de RLS, papel ou tela. Se algum ACESSO mudar de comportamento, a fase falhou.
--
-- Ordem (decisão do CEO): module_subgrupos primeiro (o lugar onde o subgrupo passa a existir),
-- depois Bloco A (classificar), Bloco B (7 subgrupos da Indústria), e a FK por último.
-- Bloco C (validação de domínios + tradução gente/sst) vai em migration própria.

-- ─────────────────────────────────────────────────────────────────────────────
-- REGISTRO · module_subgrupos — subgrupo vira first-class (fecha o mesmo furo do Bloco C:
-- nome inválido deixa de ser gravável, typo para de criar subgrupo fantasma).
-- Chave = o slug (module_catalog.subgrupo referencia por texto). grupo é o dono PRIMÁRIO
-- (NULL para transversais como cadastros/financeiro, que vivem em vários grupos).
CREATE TABLE IF NOT EXISTS public.module_subgrupos (
  id        text PRIMARY KEY,               -- slug (= module_catalog.subgrupo)
  label     text NOT NULL,                  -- rótulo de exibição
  grupo     text,                           -- grupo dono primário (NULL = transversal)
  ordem     integer NOT NULL DEFAULT 99,
  ativo     boolean NOT NULL DEFAULT true,
  descricao text,
  criado_em timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.module_subgrupos FROM PUBLIC;
GRANT SELECT ON public.module_subgrupos TO authenticated, service_role;

-- Semeia TODOS os subgrupos já em uso (para a FK não falhar em nada existente).
INSERT INTO public.module_subgrupos (id, label)
SELECT DISTINCT subgrupo, initcap(replace(subgrupo, '_', ' '))
FROM public.module_catalog
WHERE subgrupo IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- Semeia os subgrupos NOVOS do Bloco A (classificação) e do Bloco B (Indústria).
INSERT INTO public.module_subgrupos (id, label, grupo, descricao) VALUES
  -- Bloco A (novos)
  ('agricultura',          'Agricultura',            'agro',    'Talhão, colheita, safra, insumos, IoT de campo'),
  ('odonto_clinico',       'Clínico',                'odonto',  'Agenda, pacientes, tratamento, materiais'),
  ('odonto_financeiro',    'Financeiro',             'odonto',  'Custeio, rentabilidade, convênios'),
  ('odonto_inteligencia',  'Inteligência',           'odonto',  'Consultor IA, config IA, alertas'),
  ('medica_clinico',       'Clínico',                'medica',  'Agenda, prontuário, prescrições, exames, convênios'),
  ('custeio_operacao',     'Operação de Custeio',    'custeio_a','LDN, rateio, fechamento, dashboard, IA, anomalias'),
  ('custeio_consultoria',  'Consultoria de Custeio', 'custeio_b','Multi-cliente, seats, workflow, billing, white-label'),
  -- Bloco B (Indústria — ficam vazios até o módulo existir; o gancho existe antes do papel apontar)
  ('manutencao',           'Manutenção',             'industrial','Ordens de manutenção, preventiva'),
  ('engenharia',           'Engenharia',             'industrial','Projetos, layout, capacidade'),
  ('qualidade_sif',        'Qualidade / SIF',        'industrial','SIF, condenação, não-conformidade'),
  ('expedicao',            'Expedição',              'industrial','Romaneio, carga, conferência de retorno'),
  ('portaria',             'Portaria',               'industrial','Balança, entrada e saída de veículo'),
  ('rh_ponto',             'RH / Ponto',             'industrial','Ponto, escala, infrações'),
  ('rv',                   'Remuneração Variável',   'industrial','Remuneração variável')
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCO A · classificar os 53 órfãos. Todo módulo ativo/não-legacy precisa de subgrupo.
-- Idempotente: só mexe em quem ainda está NULL (não sobrescreve classificação futura).

-- ↺ REUSO de subgrupo existente
UPDATE public.module_catalog SET subgrupo='administracao'  WHERE subgrupo IS NULL AND id IN ('admin_manual_vivo','convidar_usuarios');
UPDATE public.module_catalog SET subgrupo='compliance_legal' WHERE subgrupo IS NULL AND id='lgpd_meus_dados';
UPDATE public.module_catalog SET subgrupo='operacao'       WHERE subgrupo IS NULL AND id IN ('industrial','industrial_apontamento_mobile');
UPDATE public.module_catalog SET subgrupo='analises'       WHERE subgrupo IS NULL AND id IN ('c8e39e1e-4f4a-45ee-8486-834bdd573e8f','dados');
UPDATE public.module_catalog SET subgrupo='cadastros'      WHERE subgrupo IS NULL AND id='ficha_tecnica';

-- ✚ subgrupos NOVOS
UPDATE public.module_catalog SET subgrupo='agricultura' WHERE subgrupo IS NULL AND id IN
  ('agro_talhao','agro_talhao_cadastro','agro_iot_clima','agro_iot_solo','agro_maquinario','agro_safra_dashboard','agro_insumos','agro_aplicacao_defensivos','agro_colheita');
UPDATE public.module_catalog SET subgrupo='odonto_clinico' WHERE subgrupo IS NULL AND id IN
  ('odonto_pacientes','odonto_agenda','odonto_gestao_agenda','odonto_tratamento','odonto_materiais');
UPDATE public.module_catalog SET subgrupo='odonto_financeiro' WHERE subgrupo IS NULL AND id IN
  ('odonto_custeio','odonto_rentabilidade','odonto_convenios');
UPDATE public.module_catalog SET subgrupo='odonto_inteligencia' WHERE subgrupo IS NULL AND id IN
  ('odonto_consultor_ia','odonto_config_ia','odonto_alertas');
UPDATE public.module_catalog SET subgrupo='medica_clinico' WHERE subgrupo IS NULL AND id IN
  ('medica_agenda','medica_prontuario','medica_prescricoes','medica_convenios','medica_exames');
UPDATE public.module_catalog SET subgrupo='custeio_operacao' WHERE subgrupo IS NULL AND id IN
  ('custeio_a_ldn_config','custeio_a_regras_rateio','custeio_a_classificacao_ia','custeio_a_fechamento_mensal','custeio_a_dashboard_custos','custeio_a_anomaly_detection');
UPDATE public.module_catalog SET subgrupo='custeio_consultoria' WHERE subgrupo IS NULL AND id IN
  ('custeio_b_multi_tenant','custeio_b_seats_config','custeio_b_workflow','custeio_b_relatorios_clientes','custeio_b_billing_consultoria','custeio_b_white_label','custeio_b_diagnostico','custeio_b_recomendacoes');

-- 🪦 legacy=true: âncoras de fragmento (#) e Dev — não são telas, não recebem permissão.
-- NÃO derruba linha (RD-30). Confirmado (RD-38): nenhuma renderiza hoje na sidebar.
UPDATE public.module_catalog SET legacy=true
WHERE COALESCE(legacy,false)=false AND id IN ('negocios','precos','fale_ps','entrada_dados','drilldown','dev');

-- ─────────────────────────────────────────────────────────────────────────────
-- FK por último: agora todo module_catalog.subgrupo (não-nulo) existe no registro.
-- Fecha o furo: subgrupo inválido deixa de ser gravável. NULL continua permitido (legacy).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='module_catalog_subgrupo_fkey') THEN
    ALTER TABLE public.module_catalog
      ADD CONSTRAINT module_catalog_subgrupo_fkey
      FOREIGN KEY (subgrupo) REFERENCES public.module_subgrupos(id);
  END IF;
END $$;
