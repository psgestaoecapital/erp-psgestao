-- PS CRM · Onda 1 — vertical NOVA vendável sozinha (Admin + CRM, sem financeiro). Code: code-desenvolvedor-3 (faixa :40).
--
-- Auditoria RD-26/RD-38 (16/11, no banco de produção, antes de escrever):
--   * erp_crm_oportunidade (2.886 linhas, Hub), erp_crm_lead (0), erp_crm_interacao, erp_crm_visita,
--     erp_crm_oportunidade_historico (+ gatilho trg_crm_oport_historico), erp_crm_anexo, crm_alerta_config → REUSADAS.
--   * funil_etapa (genérica: company_id, tipo_funil, chave, rotulo, ordem, cor, tipo_etapa normal/ganho/perda; usada pelo
--     P&M com tipo_funil='leads') → REUSADA para as etapas do CRM (tipo_funil = 'crm:<funil_id>'), ganha funil_id +
--     probabilidade (aditivo). NÃO se cria crm_funil_etapa (seria duplicata).
--   * erp_motivo_perda (company_id, nome — já usada por orçamento/pedido) → REUSADA como cadastro de motivo de perda.
--   * erp_clientes (conta pessoa/empresa, tipo_pessoa) → REUSADA como "Empresas"; erp_contatos (entidade_tipo/entidade_id)
--     → REUSADA como "Contatos" (entidade_tipo='cliente'). Nada de crm_empresa/crm_contato novos.
--   * NOVAS (não existem genéricas): crm_funil, crm_origem, crm_campo_custom, crm_tarefa, crm_evento_saida.
--
-- Fronteira: o CRM para no GANHO (não escreve dinheiro). Se a empresa também tem a Gestão Empresarial, o ganho grava um
-- evento em crm_evento_saida (destino 'ge', status 'pendente') para a GE consumir — opcional, não é pré-requisito.
--
-- Plano "CRM" (v15_crm, vertical 'crm'): o seletor de áreas mostra só a área CRM (+ o Admin de sempre). A Gestão
-- Empresarial deixa de ser "base universal" APENAS para empresa cujas assinaturas ativas são todas do CRM
-- (fn__crm_empresa_standalone). Para qualquer outra empresa o seletor fica idêntico ao de hoje.
--
-- Carteira (vendedor vê só o que é dele): papel crm_vendedor em user_scope.papel_slug. Leitura: policy RESTRICTIVE nas
-- tabelas do CRM (no-op para quem não tem o papel — nenhum usuário do Hub/P&M muda). Escrita: gatilho que recusa o
-- vendedor mexer em oportunidade/lead de outro (vale também para as RPCs SECURITY DEFINER).
--
-- Aditiva: nenhum DROP de objeto existente, nenhum UPDATE/DELETE em dado de cliente. Funções existentes reescritas
-- (CREATE OR REPLACE, lidas vivas com pg_get_functiondef em 16/11): fn_listar_areas_visiveis, fn_crm_oport_historico_trg,
-- fn_crm_oport_notificar_etapa — mudança mínima, comentada em cada uma.

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 1) Catálogo: grupo 'crm', subgrupos RBAC, módulos, plano, área do menu
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.module_catalog DROP CONSTRAINT module_catalog_grupo_check;
ALTER TABLE public.module_catalog ADD CONSTRAINT module_catalog_grupo_check CHECK (grupo = ANY (ARRAY[
  'erp_core','erp_ext','industrial','assessor','contador','wealth','admin','dev','hub','oficina',
  'compliance','pm','services','commerce','fiscal','agro','bpo','custeio_a','custeio_b',
  'gestao_empresarial','odonto','medica','revenda_veiculos','ecommerce','crm']::text[]));

INSERT INTO public.rbac_subgrupo_catalogo (slug, grupo, nome, descricao, ativo) VALUES
  ('crm_pipeline',   'crm', 'Funil de vendas',   'O que fazer hoje, quadro do funil, oportunidades e leads', true),
  ('crm_cadastros',  'crm', 'Cadastros do CRM',  'Empresas e contatos', true),
  ('crm_propostas',  'crm', 'Propostas',         'Propostas e aceite do cliente (Onda 3)', true),
  ('crm_relatorios', 'crm', 'Relatórios do CRM', 'Conversão, tempo por etapa, ranking e motivo de perda', true),
  ('crm_admin',      'crm', 'Configurar o CRM',  'Funis, etapas, origens, motivos de perda e campos próprios', true)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.module_catalog (id, nome, grupo, icone, rota, ordem, ativo, descricao, is_shared, legacy, subgrupo, surface_in_groups)
VALUES
  ('crm',            'O que fazer hoje', 'crm', 'Sun',        '/dashboard/crm',            10, true, 'Tarefas do dia, negócios parados, propostas aguardando e leads sem dono', false, false, 'crm_pipeline',   ARRAY[]::text[]),
  ('crm_pipeline',   'Funil de vendas',  'crm', 'Target',     '/dashboard/crm/pipeline',   20, true, 'Quadro do funil: arraste o negócio para mudar de etapa', false, false, 'crm_pipeline',   ARRAY[]::text[]),
  ('crm_leads',      'Leads',            'crm', 'Inbox',      '/dashboard/crm/leads',      30, true, 'Entrada e qualificação de leads', false, false, 'crm_pipeline',   ARRAY[]::text[]),
  ('crm_empresas',   'Empresas',         'crm', 'Building2',  '/dashboard/crm/empresas',   40, true, 'Contas (pessoa ou empresa) atendidas pelo comercial', false, false, 'crm_cadastros',  ARRAY[]::text[]),
  ('crm_contatos',   'Contatos',         'crm', 'Users',      '/dashboard/crm/contatos',   50, true, 'Pessoas de contato de cada empresa', false, false, 'crm_cadastros',  ARRAY[]::text[]),
  ('crm_relatorios', 'Relatórios',       'crm', 'BarChart3',  '/dashboard/crm/relatorios', 60, true, 'Conversão do funil, tempo por etapa, ranking e motivos de perda', false, false, 'crm_relatorios', ARRAY[]::text[]),
  ('crm_funis',      'Funis e cadastros','crm', 'Settings',   '/dashboard/crm/funis',      70, true, 'Funis, etapas, origens, motivos de perda e campos próprios', false, false, 'crm_admin',      ARRAY[]::text[])
ON CONFLICT (id) DO NOTHING;

-- Admin de sempre aparece também na área CRM (ramo "compartilhado" do fn_modulos_sidebar_por_area).
UPDATE public.module_catalog SET surface_in_groups = array_append(COALESCE(surface_in_groups, ARRAY[]::text[]), 'crm')
 WHERE id IN ('admin_painel','admin_dados_empresa','admin_notificacoes_celular','admin_trilha_auditoria')
   AND NOT ('crm' = ANY (COALESCE(surface_in_groups, ARRAY[]::text[])));

INSERT INTO public.area_secao_ordem (area_slug, secao, ordem, ativo) VALUES
  ('crm', 'CRM_PIPELINE', 0, true), ('crm', 'CRM_CADASTROS', 1, true), ('crm', 'CRM_RELATORIOS', 2, true),
  ('crm', 'CRM_ADMIN', 3, true), ('crm', 'ADMINISTRACAO', 9, true)
ON CONFLICT (area_slug, secao) DO NOTHING;

-- Plano vendável. Preço em branco (decisão comercial do CEO, RD-25) — padrão Revenda/Odonto.
INSERT INTO public.plan_catalog
  (id, nome, vertical, descricao, ativo, legacy, preco_min, preco_max, sla_level, plan_group, max_empresas, max_usuarios,
   billing_model, is_replacement, prioridade_comercial)
VALUES
  ('v15_crm', 'CRM', 'crm',
   'CRM WhatsApp-first vendável sozinho: leads, empresas e contatos, funil 100% cadastrável por tipo de negócio, quadro com tempo na etapa e semáforo, tarefas do dia e relatórios. Só Admin + CRM: não inclui financeiro, fiscal nem estoque.',
   true, false, NULL, NULL, 'basic', 'recorrente_leve', 1, 10, 'mensal_fixo', false, 16)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.plan_modules (plan_id, module_id, is_default_active, minimum_sla, legacy)
SELECT 'v15_crm', m.id, true, 'basic', false
FROM public.module_catalog m
WHERE m.id IN ('crm','crm_pipeline','crm_leads','crm_empresas','crm_contatos','crm_relatorios','crm_funis',
               'admin_painel','admin_dados_empresa','admin_notificacoes_celular','admin_trilha_auditoria')
  AND NOT EXISTS (SELECT 1 FROM public.plan_modules d WHERE d.plan_id = 'v15_crm' AND d.module_id = m.id);

INSERT INTO public.area_menu_config
  (id, area_slug, ordem, nome_menu, icone, rota_raiz, status_comercial, visivel_sempre, plano_principal_id,
   descricao_curta, pct_evolucao_atual, ativo)
VALUES
  ('crm', 'crm', 14, 'CRM', 'Target', '/dashboard/crm', 'piloto', false, 'v15_crm',
   'Funil de vendas · WhatsApp-first', 25, true)
ON CONFLICT (id) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 2) Papéis do CRM (RD-52: rbac_papel + rbac_papel_acesso por subgrupo)
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
INSERT INTO public.rbac_papel (slug, vertical, camada, area, nome, descricao, pode_liberar_ate, exige_registro, ativo) VALUES
  ('crm_diretor',  'crm', 'direcao',      'comercial', 'Diretor Comercial', 'Vê e configura tudo do CRM: funis, metas, equipe e relatórios.', 'gerencia', false, true),
  ('crm_gerente',  'crm', 'gerencia',     'comercial', 'Gerente Comercial', 'Vê a carteira de toda a equipe, redistribui leads e acompanha os relatórios.', 'operacao', false, true),
  ('crm_vendedor', 'crm', 'operacao',     'comercial', 'Vendedor',          'Vê e trabalha só a PRÓPRIA carteira (oportunidades e leads dele, mais os leads sem dono).', NULL, false, true),
  ('crm_consulta', 'crm', 'especialista', 'comercial', 'Consulta',          'Só leitura do funil e dos relatórios.', NULL, false, true)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.rbac_papel_acesso (papel_slug, subgrupo, nivel)
SELECT v.papel, v.subgrupo, v.nivel FROM (VALUES
  ('crm_diretor','crm_pipeline','aprovar'), ('crm_diretor','crm_cadastros','aprovar'), ('crm_diretor','crm_propostas','aprovar'),
  ('crm_diretor','crm_relatorios','aprovar'), ('crm_diretor','crm_admin','aprovar'),
  ('crm_gerente','crm_pipeline','aprovar'), ('crm_gerente','crm_cadastros','editar'), ('crm_gerente','crm_propostas','aprovar'),
  ('crm_gerente','crm_relatorios','ver'), ('crm_gerente','crm_admin','ver'),
  ('crm_vendedor','crm_pipeline','filtrar'), ('crm_vendedor','crm_cadastros','editar'), ('crm_vendedor','crm_propostas','editar'),
  ('crm_vendedor','crm_relatorios','filtrar'),
  ('crm_consulta','crm_pipeline','ver'), ('crm_consulta','crm_cadastros','ver'), ('crm_consulta','crm_relatorios','ver')
) AS v(papel, subgrupo, nivel)
ON CONFLICT ON CONSTRAINT rbac_papel_acesso_unq DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 3) Tabelas novas + colunas aditivas nas existentes
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.crm_funil (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  nome          text NOT NULL,
  tipo_negocio  text,
  padrao        boolean NOT NULL DEFAULT false,
  ativo         boolean NOT NULL DEFAULT true,
  ordem         integer NOT NULL DEFAULT 0,
  criado_por    uuid DEFAULT auth.uid(),
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_funil_company_idx ON public.crm_funil (company_id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_funil_padrao_unq ON public.crm_funil (company_id) WHERE padrao AND ativo;

ALTER TABLE public.funil_etapa ADD COLUMN IF NOT EXISTS funil_id uuid REFERENCES public.crm_funil(id) ON DELETE CASCADE;
ALTER TABLE public.funil_etapa ADD COLUMN IF NOT EXISTS probabilidade integer;
ALTER TABLE public.funil_etapa DROP CONSTRAINT IF EXISTS funil_etapa_probabilidade_chk;
ALTER TABLE public.funil_etapa ADD CONSTRAINT funil_etapa_probabilidade_chk CHECK (probabilidade IS NULL OR probabilidade BETWEEN 0 AND 100);
CREATE INDEX IF NOT EXISTS funil_etapa_funil_idx ON public.funil_etapa (funil_id) WHERE funil_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.crm_origem (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  nome       text NOT NULL,
  ordem      integer NOT NULL DEFAULT 0,
  ativo      boolean NOT NULL DEFAULT true,
  criado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS crm_origem_nome_unq ON public.crm_origem (company_id, lower(nome));

CREATE TABLE IF NOT EXISTS public.crm_campo_custom (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  entidade    text NOT NULL CHECK (entidade IN ('oportunidade','lead')),
  chave       text NOT NULL CHECK (chave ~ '^[a-z0-9_]+$'),
  rotulo      text NOT NULL,
  tipo        text NOT NULL DEFAULT 'texto' CHECK (tipo IN ('texto','numero','data','lista','sim_nao')),
  opcoes      text[] NOT NULL DEFAULT ARRAY[]::text[],
  obrigatorio boolean NOT NULL DEFAULT false,
  ordem       integer NOT NULL DEFAULT 0,
  ativo       boolean NOT NULL DEFAULT true,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, entidade, chave)
);

CREATE TABLE IF NOT EXISTS public.crm_tarefa (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  oportunidade_id uuid REFERENCES public.erp_crm_oportunidade(id) ON DELETE CASCADE,
  lead_id         uuid REFERENCES public.erp_crm_lead(id) ON DELETE CASCADE,
  tipo            text NOT NULL DEFAULT 'tarefa' CHECK (tipo IN ('ligacao','whatsapp','reuniao','visita','email','tarefa')),
  titulo          text NOT NULL,
  vence_em        timestamptz NOT NULL DEFAULT now(),
  responsavel_id  uuid REFERENCES public.users(id),
  concluida_em    timestamptz,
  concluida_por   uuid,
  criado_por      uuid DEFAULT auth.uid(),
  criado_em       timestamptz NOT NULL DEFAULT now(),
  excluida_em     timestamptz
);
CREATE INDEX IF NOT EXISTS crm_tarefa_company_vence_idx ON public.crm_tarefa (company_id, vence_em) WHERE concluida_em IS NULL AND excluida_em IS NULL;
CREATE INDEX IF NOT EXISTS crm_tarefa_oport_idx ON public.crm_tarefa (oportunidade_id);

CREATE TABLE IF NOT EXISTS public.crm_evento_saida (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  oportunidade_id uuid NOT NULL REFERENCES public.erp_crm_oportunidade(id) ON DELETE CASCADE,
  tipo            text NOT NULL CHECK (tipo IN ('ganho')),
  destino         text NOT NULL CHECK (destino IN ('ge')),
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','consumido','ignorado')),
  criado_em       timestamptz NOT NULL DEFAULT now(),
  consumido_em    timestamptz,
  UNIQUE (oportunidade_id, tipo, destino)
);

ALTER TABLE public.erp_crm_oportunidade ADD COLUMN IF NOT EXISTS funil_id uuid REFERENCES public.crm_funil(id);
ALTER TABLE public.erp_crm_oportunidade ADD COLUMN IF NOT EXISTS funil_etapa_id uuid REFERENCES public.funil_etapa(id);
ALTER TABLE public.erp_crm_oportunidade ADD COLUMN IF NOT EXISTS etapa_desde timestamptz;
ALTER TABLE public.erp_crm_oportunidade ADD COLUMN IF NOT EXISTS origem_id uuid REFERENCES public.crm_origem(id);
ALTER TABLE public.erp_crm_oportunidade ADD COLUMN IF NOT EXISTS motivo_perda_id uuid REFERENCES public.erp_motivo_perda(id);
ALTER TABLE public.erp_crm_oportunidade ADD COLUMN IF NOT EXISTS contato_id uuid REFERENCES public.erp_contatos(id) ON DELETE SET NULL;
ALTER TABLE public.erp_crm_oportunidade ADD COLUMN IF NOT EXISTS campos_custom jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS erp_crm_oport_funil_idx ON public.erp_crm_oportunidade (company_id, funil_id) WHERE funil_id IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE public.erp_crm_lead ADD COLUMN IF NOT EXISTS empresa text;
ALTER TABLE public.erp_crm_lead ADD COLUMN IF NOT EXISTS origem_id uuid REFERENCES public.crm_origem(id);
ALTER TABLE public.erp_crm_lead ADD COLUMN IF NOT EXISTS campos_custom jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.erp_crm_lead ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- RLS das tabelas novas: por empresa (mesmo molde das erp_crm_*)
ALTER TABLE public.crm_funil        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_origem       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_campo_custom ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_tarefa       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_evento_saida ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crm_funil_rls ON public.crm_funil;
CREATE POLICY crm_funil_rls ON public.crm_funil FOR ALL TO authenticated
  USING (is_admin() OR company_id IN (SELECT get_user_company_ids())) WITH CHECK (is_admin() OR company_id IN (SELECT get_user_company_ids()));
DROP POLICY IF EXISTS crm_origem_rls ON public.crm_origem;
CREATE POLICY crm_origem_rls ON public.crm_origem FOR ALL TO authenticated
  USING (is_admin() OR company_id IN (SELECT get_user_company_ids())) WITH CHECK (is_admin() OR company_id IN (SELECT get_user_company_ids()));
DROP POLICY IF EXISTS crm_campo_custom_rls ON public.crm_campo_custom;
CREATE POLICY crm_campo_custom_rls ON public.crm_campo_custom FOR ALL TO authenticated
  USING (is_admin() OR company_id IN (SELECT get_user_company_ids())) WITH CHECK (is_admin() OR company_id IN (SELECT get_user_company_ids()));
DROP POLICY IF EXISTS crm_tarefa_rls ON public.crm_tarefa;
CREATE POLICY crm_tarefa_rls ON public.crm_tarefa FOR ALL TO authenticated
  USING (is_admin() OR company_id IN (SELECT get_user_company_ids())) WITH CHECK (is_admin() OR company_id IN (SELECT get_user_company_ids()));
DROP POLICY IF EXISTS crm_evento_saida_sel ON public.crm_evento_saida;
CREATE POLICY crm_evento_saida_sel ON public.crm_evento_saida FOR SELECT TO authenticated
  USING (is_admin() OR company_id IN (SELECT get_user_company_ids()));
REVOKE ALL ON public.crm_funil, public.crm_origem, public.crm_campo_custom, public.crm_tarefa, public.crm_evento_saida FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_funil, public.crm_origem, public.crm_campo_custom, public.crm_tarefa TO authenticated;
GRANT SELECT ON public.crm_evento_saida TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 4) Quem é quem no CRM (carteira) e guarda de empresa
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Empresas em que o usuário logado é SÓ vendedor do CRM (vê a própria carteira). Dono/gerente da empresa e equipe PS
-- nunca entram. Conjunto (SETOF) para a policy avaliar uma vez por consulta (hashed subplan), não por linha.
CREATE OR REPLACE FUNCTION public.fn_crm_empresas_so_carteira()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT us.company_id
    FROM public.user_scope us
   WHERE us.user_id = auth.uid() AND us.ativo AND us.papel_slug = 'crm_vendedor'
     AND NOT EXISTS (SELECT 1 FROM public.tenant_user_roles tur
                      WHERE tur.user_id = auth.uid() AND tur.company_id = us.company_id AND tur.is_active
                        AND tur.role IN ('CLIENT_OWNER','CLIENT_MANAGER'))
     AND NOT EXISTS (SELECT 1 FROM public.users u
                      WHERE u.id = auth.uid() AND u.system_role IN ('PS_ADMIN','PS_ADMIN_CVM','PS_SUPPORT'));
$function$;
REVOKE ALL ON FUNCTION public.fn_crm_empresas_so_carteira() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_crm_empresas_so_carteira() TO authenticated, service_role;

-- Papel efetivo do usuário logado no CRM da empresa: diretor | gerente | vendedor | consulta.
-- Sem papel do CRM: dono/gerente da empresa e equipe PS = diretor; os demais = gerente (compatível com o que já veem hoje).
CREATE OR REPLACE FUNCTION public.fn_crm_papel(p_company_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN 'diretor'
    WHEN EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.system_role IN ('PS_ADMIN','PS_ADMIN_CVM','PS_SUPPORT')) THEN 'diretor'
    WHEN EXISTS (SELECT 1 FROM public.tenant_user_roles tur WHERE tur.user_id = auth.uid() AND tur.company_id = p_company_id
                  AND tur.is_active AND tur.role IN ('CLIENT_OWNER','CLIENT_MANAGER')) THEN 'diretor'
    ELSE COALESCE((SELECT replace(us.papel_slug, 'crm_', '') FROM public.user_scope us
                    WHERE us.user_id = auth.uid() AND us.company_id = p_company_id AND us.ativo AND us.papel_slug LIKE 'crm\_%'
                    ORDER BY array_position(ARRAY['crm_diretor','crm_gerente','crm_vendedor','crm_consulta'], us.papel_slug) LIMIT 1),
                  'gerente')
  END;
$function$;
REVOKE ALL ON FUNCTION public.fn_crm_papel(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_crm_papel(uuid) TO authenticated, service_role;

-- Guarda única das RPCs do CRM: a empresa tem de ser do usuário (serviço/cron passa). p_gerir = exige diretor/gerente.
CREATE OR REPLACE FUNCTION public.fn__crm_acesso(p_company_id uuid, p_gerir boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  IF p_company_id IS NULL OR (NOT public.is_admin() AND p_company_id NOT IN (SELECT public.get_user_company_ids())) THEN
    RAISE EXCEPTION 'Você não tem acesso a esta empresa.' USING ERRCODE = '42501';
  END IF;
  IF p_gerir AND public.fn_crm_papel(p_company_id) NOT IN ('diretor','gerente') THEN
    RAISE EXCEPTION 'Só o diretor ou o gerente comercial pode alterar esta configuração.' USING ERRCODE = '42501';
  END IF;
END $function$;
REVOKE ALL ON FUNCTION public.fn__crm_acesso(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn__crm_acesso(uuid, boolean) TO authenticated, service_role;

-- Leitura da carteira: RESTRICTIVE (soma com a policy por empresa que já existe). Para quem não é "só vendedor" em
-- nenhuma empresa, fn_crm_empresas_so_carteira() é vazio e a condição é sempre verdadeira (Hub/P&M não mudam).
DROP POLICY IF EXISTS crm_oport_carteira ON public.erp_crm_oportunidade;
CREATE POLICY crm_oport_carteira ON public.erp_crm_oportunidade AS RESTRICTIVE FOR ALL TO authenticated
  USING (company_id NOT IN (SELECT public.fn_crm_empresas_so_carteira()) OR responsavel_id = auth.uid())
  WITH CHECK (company_id NOT IN (SELECT public.fn_crm_empresas_so_carteira()) OR responsavel_id = auth.uid());
DROP POLICY IF EXISTS crm_lead_carteira ON public.erp_crm_lead;
CREATE POLICY crm_lead_carteira ON public.erp_crm_lead AS RESTRICTIVE FOR ALL TO authenticated
  USING (company_id NOT IN (SELECT public.fn_crm_empresas_so_carteira()) OR responsavel_id = auth.uid() OR responsavel_id IS NULL)
  WITH CHECK (company_id NOT IN (SELECT public.fn_crm_empresas_so_carteira()) OR responsavel_id = auth.uid());
DROP POLICY IF EXISTS crm_tarefa_carteira ON public.crm_tarefa;
CREATE POLICY crm_tarefa_carteira ON public.crm_tarefa AS RESTRICTIVE FOR ALL TO authenticated
  USING (company_id NOT IN (SELECT public.fn_crm_empresas_so_carteira()) OR responsavel_id = auth.uid() OR criado_por = auth.uid())
  WITH CHECK (company_id NOT IN (SELECT public.fn_crm_empresas_so_carteira()) OR responsavel_id = auth.uid() OR criado_por = auth.uid());

-- Escrita da carteira + relógio da etapa (BEFORE): vale também para RPC SECURITY DEFINER (auth.uid() é o do usuário).
CREATE OR REPLACE FUNCTION public.tg_crm_oport_carteira_etapa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.company_id IN (SELECT public.fn_crm_empresas_so_carteira()) THEN
    IF TG_OP = 'UPDATE' AND OLD.responsavel_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Este negócio é da carteira de outro vendedor.' USING ERRCODE = '42501';
    END IF;
    IF NEW.responsavel_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'O vendedor só pode ser responsável pelos próprios negócios.' USING ERRCODE = '42501';
    END IF;
  END IF;
  -- tempo na etapa: zera ao entrar numa etapa nova (ou ao nascer)
  IF TG_OP = 'INSERT' THEN
    NEW.etapa_desde := COALESCE(NEW.etapa_desde, now());
  ELSIF NEW.etapa IS DISTINCT FROM OLD.etapa OR NEW.funil_etapa_id IS DISTINCT FROM OLD.funil_etapa_id THEN
    NEW.etapa_desde := now();
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.tg_crm_oport_carteira_etapa() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS trg_crm_oport_carteira_etapa ON public.erp_crm_oportunidade;
CREATE TRIGGER trg_crm_oport_carteira_etapa BEFORE INSERT OR UPDATE ON public.erp_crm_oportunidade
  FOR EACH ROW EXECUTE FUNCTION public.tg_crm_oport_carteira_etapa();

CREATE OR REPLACE FUNCTION public.tg_crm_lead_carteira()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.company_id IN (SELECT public.fn_crm_empresas_so_carteira()) THEN
    -- vendedor pode pegar lead sem dono, nunca mexer no de outro nem passar o dele para outro
    IF TG_OP = 'UPDATE' AND OLD.responsavel_id IS NOT NULL AND OLD.responsavel_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Este lead é da carteira de outro vendedor.' USING ERRCODE = '42501';
    END IF;
    IF NEW.responsavel_id IS NOT NULL AND NEW.responsavel_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'O vendedor só pode ser responsável pelos próprios leads.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.tg_crm_lead_carteira() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS trg_crm_lead_carteira ON public.erp_crm_lead;
CREATE TRIGGER trg_crm_lead_carteira BEFORE INSERT OR UPDATE ON public.erp_crm_lead
  FOR EACH ROW EXECUTE FUNCTION public.tg_crm_lead_carteira();

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 5) Plano CRM sozinho: o seletor de áreas não força a Gestão Empresarial
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn__crm_empresa_standalone(p_company_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p_company_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.tenant_subscriptions ts JOIN public.plan_catalog p ON p.id = ts.plan_id
                  WHERE ts.company_id = p_company_id AND ts.status = 'active' AND p.vertical = 'crm')
     AND NOT EXISTS (SELECT 1 FROM public.tenant_subscriptions ts JOIN public.plan_catalog p ON p.id = ts.plan_id
                      WHERE ts.company_id = p_company_id AND ts.status = 'active' AND p.vertical IS DISTINCT FROM 'crm');
$function$;
REVOKE ALL ON FUNCTION public.fn__crm_empresa_standalone(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn__crm_empresa_standalone(uuid) TO authenticated, service_role;

-- Reescrita da definição viva (16/11). ÚNICA mudança: 'gestao_empresarial' deixa de ser base universal quando a
-- empresa só tem o plano CRM (fn__crm_empresa_standalone). Equipe PS (v_super) segue vendo tudo.
CREATE OR REPLACE FUNCTION public.fn_listar_areas_visiveis(p_company_id uuid DEFAULT NULL::uuid, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(ordem integer, area_slug text, nome_menu text, icone text, rota_raiz text, descricao_curta text, status_comercial text, cor_destaque text, empresa_tem_acesso boolean, motivo_acesso text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_restrito boolean := false;
  v_areas text[];
  v_super boolean := false;
  v_so_crm boolean := false;
BEGIN
  p_user_id := COALESCE(p_user_id, auth.uid());

  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT uaa.restricted, uaa.areas_allowed INTO v_restrito, v_areas
  FROM user_areas_allowed uaa WHERE uaa.user_id = p_user_id;
  SELECT (u.system_role IN ('PS_ADMIN','PS_ADMIN_CVM')) INTO v_super FROM users u WHERE u.id = p_user_id;
  v_so_crm := public.fn__crm_empresa_standalone(p_company_id);

  RETURN QUERY
  SELECT amc.ordem::int, amc.area_slug, amc.nome_menu, amc.icone, amc.rota_raiz,
    COALESCE(amc.descricao_curta, '') AS descricao_curta, amc.status_comercial, amc.cor_destaque,
    ( p_company_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM tenant_subscriptions ts JOIN plan_catalog p ON p.id = ts.plan_id
        WHERE ts.company_id = p_company_id AND ts.status = 'active'
          AND p.vertical = (SELECT vertical FROM plan_catalog WHERE id = amc.plano_principal_id)
    ) ) AS empresa_tem_acesso,
    CASE
      WHEN p_company_id IS NULL THEN 'sem_empresa'
      WHEN amc.area_slug = 'gestao_empresarial' AND NOT v_so_crm THEN 'base_universal'
      WHEN EXISTS (
        SELECT 1 FROM tenant_subscriptions ts JOIN plan_catalog p ON p.id = ts.plan_id
        WHERE ts.company_id = p_company_id AND ts.status = 'active'
          AND p.vertical = (SELECT vertical FROM plan_catalog WHERE id = amc.plano_principal_id)
      ) THEN 'contratada'
      WHEN COALESCE(v_super, false) THEN 'super_admin'
      ELSE 'nao_contratada'
    END AS motivo_acesso
  FROM area_menu_config amc
  WHERE amc.ativo
    AND (
      COALESCE(v_super, false)
      OR p_company_id IS NULL
      OR (amc.area_slug = 'gestao_empresarial' AND NOT v_so_crm)
      OR EXISTS (SELECT 1 FROM tenant_subscriptions ts JOIN plan_catalog p ON p.id = ts.plan_id
                 WHERE ts.company_id = p_company_id AND ts.status = 'active'
                   AND p.vertical = (SELECT vertical FROM plan_catalog WHERE id = amc.plano_principal_id))
    )
    AND ( COALESCE(v_super, false)
          OR NOT COALESCE(v_restrito, false)
          OR amc.area_slug = ANY(COALESCE(v_areas, ARRAY[]::text[])) )
  ORDER BY amc.ordem;
END;
$function$;
-- check-fn-guards: CREATE OR REPLACE de SECURITY DEFINER reafirma a ACL (idempotente).
REVOKE ALL ON FUNCTION public.fn_listar_areas_visiveis(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_listar_areas_visiveis(uuid, uuid) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 6) Histórico e aviso com o NOME da etapa cadastrada (antes: só a chave fixa do Hub)
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Rótulo da etapa: cadastrada (funil_etapa) quando houver, senão o rótulo fixo do Hub (comportamento de hoje).
CREATE OR REPLACE FUNCTION public.fn__crm_rotulo_etapa(p_etapa_id uuid, p_chave text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT fe.rotulo FROM public.funil_etapa fe WHERE fe.id = p_etapa_id), public.fn_crm_etapa_rotulo(p_chave));
$function$;
REVOKE ALL ON FUNCTION public.fn__crm_rotulo_etapa(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn__crm_rotulo_etapa(uuid, text) TO authenticated, service_role;

-- Reescrita da definição viva (16/11). Mudança: o texto "detalhe" usa o rótulo da etapa cadastrada quando a oportunidade
-- é do CRM (funil_etapa_id); oportunidade do Hub (sem funil) grava exatamente o mesmo texto de antes.
CREATE OR REPLACE FUNCTION public.fn_crm_oport_historico_trg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_autor uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO erp_crm_oportunidade_historico(company_id,oportunidade_id,acao,para_etapa,valor_depois,autor_id,detalhe)
    VALUES (NEW.company_id, NEW.id, 'criada', NEW.etapa, NEW.valor_estimado, v_autor,
      'Oportunidade criada · etapa '||COALESCE(CASE WHEN NEW.funil_etapa_id IS NOT NULL THEN public.fn__crm_rotulo_etapa(NEW.funil_etapa_id, NEW.etapa) END, NEW.etapa,'—'));
    RETURN NEW;
  END IF;

  IF NEW.etapa IS DISTINCT FROM OLD.etapa OR NEW.funil_etapa_id IS DISTINCT FROM OLD.funil_etapa_id THEN
    INSERT INTO erp_crm_oportunidade_historico(company_id,oportunidade_id,acao,de_etapa,para_etapa,autor_id,detalhe)
    VALUES (NEW.company_id, NEW.id,
      CASE WHEN NEW.etapa='ganho' THEN 'ganha'
           WHEN NEW.etapa='perdido' THEN 'perdida'
           WHEN OLD.etapa IN ('ganho','perdido') THEN 'retornou_funil'
           ELSE 'etapa_mudou' END,
      OLD.etapa, NEW.etapa, v_autor,
      'Etapa: '||COALESCE(CASE WHEN OLD.funil_etapa_id IS NOT NULL THEN public.fn__crm_rotulo_etapa(OLD.funil_etapa_id, OLD.etapa) END, OLD.etapa,'—')
        ||' → '||COALESCE(CASE WHEN NEW.funil_etapa_id IS NOT NULL THEN public.fn__crm_rotulo_etapa(NEW.funil_etapa_id, NEW.etapa) END, NEW.etapa,'—'));
  END IF;

  IF COALESCE(NEW.valor_estimado,0) IS DISTINCT FROM COALESCE(OLD.valor_estimado,0) THEN
    INSERT INTO erp_crm_oportunidade_historico(company_id,oportunidade_id,acao,valor_antes,valor_depois,campo,autor_id,detalhe)
    VALUES (NEW.company_id, NEW.id,'editada',OLD.valor_estimado,NEW.valor_estimado,'valor_estimado',v_autor,
      'Valor estimado: '||COALESCE(OLD.valor_estimado::text,'—')||' → '||COALESCE(NEW.valor_estimado::text,'—'));
  END IF;

  IF COALESCE(NEW.valor_proposta,0) IS DISTINCT FROM COALESCE(OLD.valor_proposta,0) THEN
    INSERT INTO erp_crm_oportunidade_historico(company_id,oportunidade_id,acao,valor_antes,valor_depois,campo,autor_id,detalhe)
    VALUES (NEW.company_id, NEW.id,'editada',OLD.valor_proposta,NEW.valor_proposta,'valor_proposta',v_autor,
      'Valor proposta: '||COALESCE(OLD.valor_proposta::text,'—')||' → '||COALESCE(NEW.valor_proposta::text,'—'));
  END IF;

  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.fn_crm_oport_historico_trg() FROM PUBLIC, anon;

-- Reescrita da definição viva (16/11). Mudanças: rótulos da etapa cadastrada e link para a ficha do CRM quando a
-- oportunidade é do CRM (funil_id). Oportunidade do Hub: mesmo texto e mesmo link de antes.
CREATE OR REPLACE FUNCTION public.fn_crm_oport_notificar_etapa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_autor    uuid := auth.uid();
  v_vendedor uuid;
  v_de       text;
  v_para     text;
  v_nome     text;
  v_quem     text;
  v_dest     uuid;
BEGIN
  IF NEW.etapa IS NOT DISTINCT FROM OLD.etapa OR NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.orcamento_id IS NOT NULL THEN
    SELECT o.vendedor_id INTO v_vendedor FROM public.erp_orcamentos o WHERE o.id = NEW.orcamento_id;
  END IF;
  v_vendedor := COALESCE(v_vendedor, NEW.created_by);

  v_de   := CASE WHEN OLD.funil_etapa_id IS NOT NULL THEN public.fn__crm_rotulo_etapa(OLD.funil_etapa_id, OLD.etapa) ELSE public.fn_crm_etapa_rotulo(OLD.etapa) END;
  v_para := CASE WHEN NEW.funil_etapa_id IS NOT NULL THEN public.fn__crm_rotulo_etapa(NEW.funil_etapa_id, NEW.etapa) ELSE public.fn_crm_etapa_rotulo(NEW.etapa) END;
  SELECT COALESCE(NULLIF(btrim(c.nome_fantasia), ''), c.razao_social) INTO v_nome
    FROM public.erp_clientes c WHERE c.id = NEW.cliente_id;
  v_nome := COALESCE(NULLIF(btrim(v_nome), ''), NULLIF(btrim(NEW.titulo), ''), 'Oportunidade');
  SELECT COALESCE(NULLIF(btrim(u.full_name), ''), u.email) INTO v_quem FROM public.users u WHERE u.id = v_autor;

  FOR v_dest IN
    SELECT DISTINCT d FROM unnest(ARRAY[NEW.responsavel_id, v_vendedor]) AS d
     WHERE d IS NOT NULL
       AND d IS DISTINCT FROM v_autor
       AND (EXISTS (SELECT 1 FROM public.user_companies uc WHERE uc.user_id = d AND uc.company_id = NEW.company_id)
            OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = d AND u.system_role IN ('PS_ADMIN', 'PS_ADMIN_CVM')))
  LOOP
    INSERT INTO public.erp_notificacao_usuario
      (company_id, destinatario_id, tipo, titulo, mensagem, link, origem_tipo, origem_id, autor_id)
    VALUES
      (NEW.company_id, v_dest, 'oportunidade_etapa',
       v_nome || ' · ' || v_para,
       'Etapa: ' || v_de || ' → ' || v_para || COALESCE(' · por ' || v_quem, ''),
       CASE WHEN NEW.funil_id IS NOT NULL THEN '/dashboard/crm/oportunidade/' ELSE '/dashboard/projetos/oportunidades/' END || NEW.id,
       'erp_crm_oportunidade', NEW.id, v_autor);
  END LOOP;

  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.fn_crm_oport_notificar_etapa() FROM PUBLIC, anon;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 7) Funis cadastráveis (RD-51: nada fixo de um negócio) + cadastros de origem / motivo / campos próprios
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Semente genérica (serve a qualquer tipo de negócio, editável). Uso interno: só chamada pelas RPCs abaixo.
CREATE OR REPLACE FUNCTION public.fn__crm_semear(p_company_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_funil uuid;
BEGIN
  PERFORM public.fn__crm_acesso(p_company_id);
  IF NOT EXISTS (SELECT 1 FROM public.crm_funil WHERE company_id = p_company_id) THEN
    INSERT INTO public.crm_funil (company_id, nome, tipo_negocio, padrao, ordem)
    VALUES (p_company_id, 'Vendas', 'Geral', true, 0) RETURNING id INTO v_funil;
    INSERT INTO public.funil_etapa (company_id, tipo_funil, funil_id, chave, rotulo, ordem, cor, tipo_etapa, probabilidade)
    SELECT p_company_id, 'crm:' || v_funil, v_funil, d.chave, d.rotulo, d.ordem, d.cor, d.tipo, d.prob
    FROM (VALUES
      ('crm_novo_contato', 'Novo contato', 10, '#F0E9DE', 'normal', 10),
      ('crm_qualificacao', 'Qualificação', 20, '#FCE9C2', 'normal', 25),
      ('crm_proposta',     'Proposta',     30, '#F4B860', 'normal', 50),
      ('crm_negociacao',   'Negociação',   40, '#E8A93A', 'normal', 75),
      ('ganho',            'Ganho',        90, '#DCEFD7', 'ganho', 100),
      ('perdido',          'Perdido',      99, '#F4D6D6', 'perda',   0)
    ) AS d(chave, rotulo, ordem, cor, tipo, prob)
    ON CONFLICT ON CONSTRAINT funil_etapa_company_id_tipo_funil_chave_key DO NOTHING;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.crm_origem WHERE company_id = p_company_id) THEN
    INSERT INTO public.crm_origem (company_id, nome, ordem)
    SELECT p_company_id, d.nome, d.ordem FROM (VALUES
      ('WhatsApp', 1), ('Indicação', 2), ('Site', 3), ('Instagram', 4), ('Telefone', 5), ('Visita / feira', 6), ('Outro', 9)
    ) AS d(nome, ordem)
    ON CONFLICT DO NOTHING;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.erp_motivo_perda WHERE company_id = p_company_id) THEN
    INSERT INTO public.erp_motivo_perda (company_id, nome, exige_descricao, ordem) VALUES
      (p_company_id, 'Preço', false, 1), (p_company_id, 'Escolheu outro fornecedor', false, 2),
      (p_company_id, 'Sem retorno do cliente', false, 3), (p_company_id, 'Sem orçamento agora', false, 4),
      (p_company_id, 'Prazo não atende', false, 5), (p_company_id, 'Outro', true, 9)
    ON CONFLICT (company_id, nome) DO NOTHING;
  END IF;
END $function$;
REVOKE ALL ON FUNCTION public.fn__crm_semear(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn__crm_semear(uuid) TO service_role;

-- Tudo que as telas precisam para montar filtros, formulários e o quadro: funis+etapas, origens, motivos, campos, equipe, papel.
CREATE OR REPLACE FUNCTION public.fn_crm_config(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn__crm_acesso(p_company_id);
  PERFORM public.fn__crm_semear(p_company_id);
  RETURN jsonb_build_object(
    'papel', public.fn_crm_papel(p_company_id),
    'eu', auth.uid(),
    'tem_ge', EXISTS (SELECT 1 FROM tenant_subscriptions ts JOIN plan_catalog p ON p.id = ts.plan_id
                      WHERE ts.company_id = p_company_id AND ts.status = 'active' AND p.vertical = 'gestao_empresarial'),
    'funis', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', f.id, 'nome', f.nome, 'tipo_negocio', f.tipo_negocio, 'padrao', f.padrao, 'ativo', f.ativo, 'ordem', f.ordem,
        'etapas', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', e.id, 'chave', e.chave, 'rotulo', e.rotulo, 'ordem', e.ordem,
                    'cor', e.cor, 'tipo_etapa', e.tipo_etapa, 'probabilidade', e.probabilidade) ORDER BY e.ordem, e.rotulo)
                    FROM funil_etapa e WHERE e.funil_id = f.id AND e.ativo), '[]'::jsonb),
        'abertas', (SELECT count(*) FROM erp_crm_oportunidade o WHERE o.funil_id = f.id AND o.deleted_at IS NULL AND o.etapa NOT IN ('ganho','perdido'))
      ) ORDER BY f.padrao DESC, f.ordem, f.nome) FROM crm_funil f WHERE f.company_id = p_company_id), '[]'::jsonb),
    'origens', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', o.id, 'nome', o.nome, 'ativo', o.ativo, 'ordem', o.ordem) ORDER BY o.ordem, o.nome)
                FROM crm_origem o WHERE o.company_id = p_company_id), '[]'::jsonb),
    'motivos', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'nome', m.nome, 'ativo', m.ativo, 'exige_descricao', m.exige_descricao) ORDER BY m.ordem, m.nome)
                FROM erp_motivo_perda m WHERE m.company_id = p_company_id), '[]'::jsonb),
    'campos', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'entidade', c.entidade, 'chave', c.chave, 'rotulo', c.rotulo, 'tipo', c.tipo,
                'opcoes', c.opcoes, 'obrigatorio', c.obrigatorio, 'ordem', c.ordem, 'ativo', c.ativo) ORDER BY c.entidade, c.ordem, c.rotulo)
                FROM crm_campo_custom c WHERE c.company_id = p_company_id), '[]'::jsonb),
    'equipe', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', u.id, 'nome', COALESCE(NULLIF(btrim(u.full_name), ''), u.email)) ORDER BY u.full_name NULLS LAST)
                FROM user_companies uc JOIN users u ON u.id = uc.user_id
               WHERE uc.company_id = p_company_id AND COALESCE(u.is_active, true)), '[]'::jsonb)
  );
END $function$;
REVOKE ALL ON FUNCTION public.fn_crm_config(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_crm_config(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_crm_funil_salvar(p_company_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid := NULLIF(p_dados->>'id', '')::uuid;
  v_nome text := NULLIF(btrim(p_dados->>'nome'), '');
  v_padrao boolean := COALESCE((p_dados->>'padrao')::boolean, false);
BEGIN
  PERFORM public.fn__crm_acesso(p_company_id, true);
  IF v_nome IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Dê um nome ao funil.'); END IF;
  IF v_padrao THEN
    UPDATE crm_funil SET padrao = false WHERE company_id = p_company_id AND padrao AND id IS DISTINCT FROM v_id;
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO crm_funil (company_id, nome, tipo_negocio, padrao, ordem)
    VALUES (p_company_id, v_nome, NULLIF(btrim(p_dados->>'tipo_negocio'), ''), v_padrao,
            COALESCE((SELECT max(ordem) + 1 FROM crm_funil WHERE company_id = p_company_id), 0))
    RETURNING id INTO v_id;
    -- todo funil nasce com Ganho e Perdido (fecham o negócio) e uma etapa inicial — o resto a empresa cadastra
    INSERT INTO funil_etapa (company_id, tipo_funil, funil_id, chave, rotulo, ordem, cor, tipo_etapa, probabilidade) VALUES
      (p_company_id, 'crm:' || v_id, v_id, 'crm_novo_contato', 'Novo contato', 10, '#F0E9DE', 'normal', 10),
      (p_company_id, 'crm:' || v_id, v_id, 'ganho', 'Ganho', 90, '#DCEFD7', 'ganho', 100),
      (p_company_id, 'crm:' || v_id, v_id, 'perdido', 'Perdido', 99, '#F4D6D6', 'perda', 0);
  ELSE
    UPDATE crm_funil SET nome = v_nome, tipo_negocio = NULLIF(btrim(p_dados->>'tipo_negocio'), ''), padrao = v_padrao,
           ativo = COALESCE((p_dados->>'ativo')::boolean, ativo), atualizado_em = now()
     WHERE id = v_id AND company_id = p_company_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Funil não encontrado.'); END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;
REVOKE ALL ON FUNCTION public.fn_crm_funil_salvar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_crm_funil_salvar(uuid, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_crm_funil_etapa_salvar(p_company_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid := NULLIF(p_dados->>'id', '')::uuid;
  v_funil uuid := NULLIF(p_dados->>'funil_id', '')::uuid;
  v_rotulo text := NULLIF(btrim(p_dados->>'rotulo'), '');
  v_prob int := NULLIF(p_dados->>'probabilidade', '')::int;
  v_slug text; v_base text; v_i int := 1; v_row funil_etapa%ROWTYPE;
BEGIN
  PERFORM public.fn__crm_acesso(p_company_id, true);
  IF v_prob IS NOT NULL AND (v_prob < 0 OR v_prob > 100) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'A probabilidade vai de 0 a 100%.');
  END IF;
  IF v_id IS NOT NULL THEN
    SELECT * INTO v_row FROM funil_etapa WHERE id = v_id AND company_id = p_company_id AND funil_id IS NOT NULL;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Etapa não encontrada.'); END IF;
    -- o tipo (normal/ganho/perda) não muda depois de criado: ganho e perdido fecham o negócio e têm chave própria
    UPDATE funil_etapa SET rotulo = COALESCE(v_rotulo, rotulo),
           ordem = COALESCE(NULLIF(p_dados->>'ordem', '')::int, ordem),
           cor = COALESCE(NULLIF(btrim(p_dados->>'cor'), ''), cor),
           probabilidade = COALESCE(v_prob, probabilidade)
     WHERE id = v_id;
    RETURN jsonb_build_object('ok', true, 'id', v_id);
  END IF;

  IF v_funil IS NULL OR NOT EXISTS (SELECT 1 FROM crm_funil WHERE id = v_funil AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Funil não encontrado.');
  END IF;
  IF v_rotulo IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Dê um nome à etapa.'); END IF;
  -- chave com prefixo crm_: não colide com as chaves fixas do Hub (ex.: visita_feita, que dispara orçamento lá)
  v_slug := lower(translate(v_rotulo, 'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'));
  v_slug := 'crm_' || COALESCE(NULLIF(btrim(regexp_replace(v_slug, '[^a-z0-9]+', '_', 'g'), '_'), ''), 'etapa');
  v_base := v_slug;
  WHILE EXISTS (SELECT 1 FROM funil_etapa WHERE company_id = p_company_id AND tipo_funil = 'crm:' || v_funil AND chave = v_slug) LOOP
    v_i := v_i + 1; v_slug := v_base || '_' || v_i;
  END LOOP;
  INSERT INTO funil_etapa (company_id, tipo_funil, funil_id, chave, rotulo, ordem, cor, tipo_etapa, probabilidade)
  VALUES (p_company_id, 'crm:' || v_funil, v_funil, v_slug, v_rotulo,
          COALESCE(NULLIF(p_dados->>'ordem', '')::int,
                   (SELECT COALESCE(max(ordem), 0) + 5 FROM funil_etapa WHERE funil_id = v_funil AND tipo_etapa = 'normal')),
          COALESCE(NULLIF(btrim(p_dados->>'cor'), ''), '#F0E9DE'), 'normal', COALESCE(v_prob, 50))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'chave', v_slug);
END $function$;
REVOKE ALL ON FUNCTION public.fn_crm_funil_etapa_salvar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_crm_funil_etapa_salvar(uuid, jsonb) TO authenticated, service_role;

-- Reordena as etapas normais (ganho/perdido ficam sempre no fim).
CREATE OR REPLACE FUNCTION public.fn_crm_funil_etapas_ordenar(p_company_id uuid, p_funil_id uuid, p_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn__crm_acesso(p_company_id, true);
  UPDATE funil_etapa e SET ordem = x.pos::int  -- 1..n: fica sempre antes de Ganho (90) e Perdido (99)
    FROM unnest(p_ids) WITH ORDINALITY AS x(id, pos)
   WHERE e.id = x.id AND e.funil_id = p_funil_id AND e.company_id = p_company_id AND e.tipo_etapa = 'normal';
  RETURN jsonb_build_object('ok', true);
END $function$;
REVOKE ALL ON FUNCTION public.fn_crm_funil_etapas_ordenar(uuid, uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_crm_funil_etapas_ordenar(uuid, uuid, uuid[]) TO authenticated, service_role;

-- "Excluir" etapa = desativar (RD-30). Recusa se ainda há negócio aberto nela, ou se é Ganho/Perdido.
CREATE OR REPLACE FUNCTION public.fn_crm_funil_etapa_desativar(p_company_id uuid, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_row funil_etapa%ROWTYPE; v_qtd int;
BEGIN
  PERFORM public.fn__crm_acesso(p_company_id, true);
  SELECT * INTO v_row FROM funil_etapa WHERE id = p_id AND company_id = p_company_id AND funil_id IS NOT NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Etapa não encontrada.'); END IF;
  IF v_row.tipo_etapa <> 'normal' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Ganho e Perdido fecham o negócio e não podem sair do funil. Você pode renomeá-los.');
  END IF;
  SELECT count(*) INTO v_qtd FROM erp_crm_oportunidade WHERE funil_etapa_id = p_id AND deleted_at IS NULL;
  IF v_qtd > 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', format('Há %s negócio(s) nesta etapa. Mova-os para outra etapa antes de retirá-la.', v_qtd), 'qtd', v_qtd);
  END IF;
  UPDATE funil_etapa SET ativo = false WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END $function$;
REVOKE ALL ON FUNCTION public.fn_crm_funil_etapa_desativar(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_crm_funil_etapa_desativar(uuid, uuid) TO authenticated, service_role;

-- Cadastros simples: origem | motivo | campo. Desativar = ativo false (nunca apaga — RD-30).
CREATE OR REPLACE FUNCTION public.fn_crm_cadastro_salvar(p_company_id uuid, p_tipo text, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid := NULLIF(p_dados->>'id', '')::uuid;
  v_nome text := NULLIF(btrim(COALESCE(p_dados->>'nome', p_dados->>'rotulo')), '');
  v_ativo boolean := COALESCE((p_dados->>'ativo')::boolean, true);
  v_chave text;
BEGIN
  PERFORM public.fn__crm_acesso(p_company_id, true);
  IF v_nome IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Preencha o nome.'); END IF;
  IF p_tipo = 'origem' THEN
    IF v_id IS NULL THEN
      INSERT INTO crm_origem (company_id, nome, ordem) VALUES (p_company_id, v_nome,
        COALESCE((SELECT max(ordem) + 1 FROM crm_origem WHERE company_id = p_company_id), 1)) RETURNING id INTO v_id;
    ELSE
      UPDATE crm_origem SET nome = v_nome, ativo = v_ativo WHERE id = v_id AND company_id = p_company_id;
    END IF;
  ELSIF p_tipo = 'motivo' THEN
    IF v_id IS NULL THEN
      INSERT INTO erp_motivo_perda (company_id, nome, exige_descricao, ordem) VALUES (p_company_id, v_nome,
        COALESCE((p_dados->>'exige_descricao')::boolean, false),
        COALESCE((SELECT max(ordem) + 1 FROM erp_motivo_perda WHERE company_id = p_company_id), 1)) RETURNING id INTO v_id;
    ELSE
      UPDATE erp_motivo_perda SET nome = v_nome, ativo = v_ativo,
             exige_descricao = COALESCE((p_dados->>'exige_descricao')::boolean, exige_descricao)
       WHERE id = v_id AND company_id = p_company_id;
    END IF;
  ELSIF p_tipo = 'campo' THEN
    IF COALESCE(p_dados->>'entidade', '') NOT IN ('oportunidade','lead') THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'Escolha onde o campo aparece: negócio ou lead.');
    END IF;
    IF v_id IS NULL THEN
      v_chave := lower(translate(v_nome, 'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'));
      v_chave := COALESCE(NULLIF(btrim(regexp_replace(v_chave, '[^a-z0-9]+', '_', 'g'), '_'), ''), 'campo');
      IF EXISTS (SELECT 1 FROM crm_campo_custom WHERE company_id = p_company_id AND entidade = p_dados->>'entidade' AND chave = v_chave) THEN
        v_chave := v_chave || '_' || substr(md5(random()::text), 1, 4);
      END IF;
      INSERT INTO crm_campo_custom (company_id, entidade, chave, rotulo, tipo, opcoes, obrigatorio, ordem)
      VALUES (p_company_id, p_dados->>'entidade', v_chave, v_nome, COALESCE(NULLIF(p_dados->>'tipo', ''), 'texto'),
              COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_dados->'opcoes', '[]'::jsonb))), ARRAY[]::text[]),
              COALESCE((p_dados->>'obrigatorio')::boolean, false),
              COALESCE((SELECT max(ordem) + 1 FROM crm_campo_custom WHERE company_id = p_company_id), 1))
      RETURNING id INTO v_id;
    ELSE
      UPDATE crm_campo_custom SET rotulo = v_nome, ativo = v_ativo,
             tipo = COALESCE(NULLIF(p_dados->>'tipo', ''), tipo),
             opcoes = COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_dados->'opcoes')), opcoes),
             obrigatorio = COALESCE((p_dados->>'obrigatorio')::boolean, obrigatorio)
       WHERE id = v_id AND company_id = p_company_id;
    END IF;
  ELSE
    RETURN jsonb_build_object('ok', false, 'erro', 'Tipo de cadastro desconhecido.');
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'erro', 'Já existe um cadastro com esse nome.');
END $function$;
REVOKE ALL ON FUNCTION public.fn_crm_cadastro_salvar(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_crm_cadastro_salvar(uuid, text, jsonb) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 8) Oportunidade: criar (RPC — fim do insert direto), mover, editar, ficha
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_crm_oportunidade_criar(p_company_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_titulo text := NULLIF(btrim(p_dados->>'titulo'), '');
  v_funil uuid := NULLIF(p_dados->>'funil_id', '')::uuid;
  v_etapa funil_etapa%ROWTYPE;
  v_resp uuid := NULLIF(p_dados->>'responsavel_id', '')::uuid;
  v_lead uuid := NULLIF(p_dados->>'lead_id', '')::uuid;
  v_cli uuid := NULLIF(p_dados->>'cliente_id', '')::uuid;
  v_id uuid;
BEGIN
  PERFORM public.fn__crm_acesso(p_company_id);
  IF public.fn_crm_papel(p_company_id) = 'consulta' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Seu acesso ao CRM é só de consulta.');
  END IF;
  PERFORM public.fn__crm_semear(p_company_id);
  IF v_titulo IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Dê um nome ao negócio (ex.: "Reforma da loja – Ana").'); END IF;

  IF v_funil IS NULL THEN
    SELECT id INTO v_funil FROM crm_funil WHERE company_id = p_company_id AND ativo ORDER BY padrao DESC, ordem LIMIT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM crm_funil WHERE id = v_funil AND company_id = p_company_id AND ativo) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Funil não encontrado.');
  END IF;
  IF NULLIF(p_dados->>'etapa_id', '') IS NOT NULL THEN
    SELECT * INTO v_etapa FROM funil_etapa WHERE id = (p_dados->>'etapa_id')::uuid AND funil_id = v_funil AND ativo AND tipo_etapa = 'normal';
  ELSE
    SELECT * INTO v_etapa FROM funil_etapa WHERE funil_id = v_funil AND ativo AND tipo_etapa = 'normal' ORDER BY ordem LIMIT 1;
  END IF;
  IF v_etapa.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'O funil não tem etapa aberta. Cadastre uma em Funis.'); END IF;

  -- vendedor é sempre o responsável do que cria
  IF v_resp IS NULL OR public.fn_crm_papel(p_company_id) = 'vendedor' THEN v_resp := auth.uid(); END IF;
  IF v_cli IS NOT NULL AND NOT EXISTS (SELECT 1 FROM erp_clientes WHERE id = v_cli AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Empresa não encontrada.');
  END IF;

  INSERT INTO erp_crm_oportunidade (company_id, cliente_id, contato_id, titulo, etapa, funil_id, funil_etapa_id, probabilidade,
         valor_estimado, origem_id, origem, responsavel_id, responsavel_nome, data_prevista_fechamento, observacoes,
         campos_custom, etapa_desde, created_by)
  VALUES (p_company_id, v_cli, NULLIF(p_dados->>'contato_id', '')::uuid, v_titulo, v_etapa.chave, v_funil, v_etapa.id,
         COALESCE(v_etapa.probabilidade, 50), NULLIF(p_dados->>'valor_estimado', '')::numeric,
         NULLIF(p_dados->>'origem_id', '')::uuid,
         (SELECT nome FROM crm_origem WHERE id = NULLIF(p_dados->>'origem_id', '')::uuid AND company_id = p_company_id),
         v_resp, (SELECT COALESCE(NULLIF(btrim(full_name), ''), email) FROM users WHERE id = v_resp),
         NULLIF(p_dados->>'data_prevista_fechamento', '')::date, NULLIF(btrim(p_dados->>'observacoes'), ''),
         COALESCE(p_dados->'campos_custom', '{}'::jsonb), now(), auth.uid())
  RETURNING id INTO v_id;

  IF v_lead IS NOT NULL THEN
    UPDATE erp_crm_lead SET status = 'convertido', oportunidade_id = v_id, cliente_id = COALESCE(v_cli, cliente_id), updated_at = now()
     WHERE id = v_lead AND company_id = p_company_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;
REVOKE ALL ON FUNCTION public.fn_crm_oportunidade_criar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_crm_oportunidade_criar(uuid, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_crm_oportunidade_mover(p_id uuid, p_etapa_id uuid, p_motivo_perda_id uuid DEFAULT NULL, p_motivo_texto text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_op erp_crm_oportunidade%ROWTYPE; v_et funil_etapa%ROWTYPE; v_motivo text;
BEGIN
  SELECT * INTO v_op FROM erp_crm_oportunidade WHERE id = p_id AND deleted_at IS NULL;
  IF v_op.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Negócio não encontrado.'); END IF;
  PERFORM public.fn__crm_acesso(v_op.company_id);
  IF public.fn_crm_papel(v_op.company_id) = 'consulta' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Seu acesso ao CRM é só de consulta.');
  END IF;
  SELECT * INTO v_et FROM funil_etapa WHERE id = p_etapa_id AND funil_id = v_op.funil_id AND ativo;
  IF v_et.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Esta etapa não é do funil deste negócio.'); END IF;
  IF v_op.funil_etapa_id = v_et.id THEN RETURN jsonb_build_object('ok', true, 'sem_mudanca', true); END IF;

  IF v_et.tipo_etapa = 'perda' THEN
    SELECT nome INTO v_motivo FROM erp_motivo_perda WHERE id = p_motivo_perda_id AND company_id = v_op.company_id;
    v_motivo := NULLIF(btrim(concat_ws(' · ', v_motivo, NULLIF(btrim(p_motivo_texto), ''))), '');
    IF v_motivo IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'motivo_obrigatorio', 'orientacao', 'Para marcar como perdido, escolha o motivo da perda.');
    END IF;
  END IF;

  UPDATE erp_crm_oportunidade SET
    etapa = v_et.chave, funil_etapa_id = v_et.id,
    probabilidade = COALESCE(v_et.probabilidade, probabilidade),
    data_fechamento = CASE WHEN v_et.tipo_etapa IN ('ganho','perda') THEN now()::date ELSE NULL END,
    motivo_perda = CASE WHEN v_et.tipo_etapa = 'perda' THEN v_motivo ELSE NULL END,
    motivo_perda_id = CASE WHEN v_et.tipo_etapa = 'perda' THEN p_motivo_perda_id ELSE NULL END,
    updated_at = now()
  WHERE id = p_id;

  -- [→GE] o CRM para no ganho; com a Gestão Empresarial contratada, deixa o evento para a GE (opcional)
  IF v_et.tipo_etapa = 'ganho' AND EXISTS (
       SELECT 1 FROM tenant_subscriptions ts JOIN plan_catalog p ON p.id = ts.plan_id
        WHERE ts.company_id = v_op.company_id AND ts.status = 'active' AND p.vertical = 'gestao_empresarial') THEN
    INSERT INTO crm_evento_saida (company_id, oportunidade_id, tipo, destino, payload)
    VALUES (v_op.company_id, p_id, 'ganho', 'ge', jsonb_build_object('cliente_id', v_op.cliente_id, 'titulo', v_op.titulo,
            'valor', COALESCE(v_op.valor_proposta, v_op.valor_estimado), 'responsavel_id', v_op.responsavel_id))
    ON CONFLICT (oportunidade_id, tipo, destino) DO NOTHING;
  END IF;
  RETURN jsonb_build_object('ok', true, 'etapa', v_et.chave, 'tipo_etapa', v_et.tipo_etapa);
END $function$;
REVOKE ALL ON FUNCTION public.fn_crm_oportunidade_mover(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_crm_oportunidade_mover(uuid, uuid, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_crm_oportunidade_atualizar(p_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_op erp_crm_oportunidade%ROWTYPE; v_resp uuid;
BEGIN
  SELECT * INTO v_op FROM erp_crm_oportunidade WHERE id = p_id AND deleted_at IS NULL;
  IF v_op.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Negócio não encontrado.'); END IF;
  PERFORM public.fn__crm_acesso(v_op.company_id);
  IF public.fn_crm_papel(v_op.company_id) = 'consulta' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Seu acesso ao CRM é só de consulta.');
  END IF;
  v_resp := CASE WHEN p_dados ? 'responsavel_id' THEN NULLIF(p_dados->>'responsavel_id', '')::uuid ELSE v_op.responsavel_id END;
  IF (p_dados ? 'cliente_id') AND NULLIF(p_dados->>'cliente_id', '') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM erp_clientes WHERE id = (p_dados->>'cliente_id')::uuid AND company_id = v_op.company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Empresa não encontrada.');
  END IF;
  UPDATE erp_crm_oportunidade SET
    titulo = COALESCE(NULLIF(btrim(p_dados->>'titulo'), ''), titulo),
    cliente_id = CASE WHEN p_dados ? 'cliente_id' THEN NULLIF(p_dados->>'cliente_id', '')::uuid ELSE cliente_id END,
    contato_id = CASE WHEN p_dados ? 'contato_id' THEN NULLIF(p_dados->>'contato_id', '')::uuid ELSE contato_id END,
    valor_estimado = CASE WHEN p_dados ? 'valor_estimado' THEN NULLIF(p_dados->>'valor_estimado', '')::numeric ELSE valor_estimado END,
    valor_proposta = CASE WHEN p_dados ? 'valor_proposta' THEN NULLIF(p_dados->>'valor_proposta', '')::numeric ELSE valor_proposta END,
    origem_id = CASE WHEN p_dados ? 'origem_id' THEN NULLIF(p_dados->>'origem_id', '')::uuid ELSE origem_id END,
    origem = CASE WHEN p_dados ? 'origem_id' THEN (SELECT nome FROM crm_origem WHERE id = NULLIF(p_dados->>'origem_id', '')::uuid AND company_id = v_op.company_id) ELSE origem END,
    responsavel_id = v_resp,
    responsavel_nome = (SELECT COALESCE(NULLIF(btrim(full_name), ''), email) FROM users WHERE id = v_resp),
    data_prevista_fechamento = CASE WHEN p_dados ? 'data_prevista_fechamento' THEN NULLIF(p_dados->>'data_prevista_fechamento', '')::date ELSE data_prevista_fechamento END,
    observacoes = CASE WHEN p_dados ? 'observacoes' THEN NULLIF(btrim(p_dados->>'observacoes'), '') ELSE observacoes END,
    campos_custom = CASE WHEN p_dados ? 'campos_custom' THEN COALESCE(p_dados->'campos_custom', '{}'::jsonb) ELSE campos_custom END,
    updated_at = now()
  WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END $function$;
REVOKE ALL ON FUNCTION public.fn_crm_oportunidade_atualizar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_crm_oportunidade_atualizar(uuid, jsonb) TO authenticated, service_role;

-- Quadro do funil: colunas = etapas cadastradas; cartão = negócio com dias na etapa e semáforo (crm_alerta_config).
-- Ganho/Perdido mostram só os fechados nos últimos 30 dias. Vendedor recebe só a própria carteira.
CREATE OR REPLACE FUNCTION public.fn_crm_quadro(p_company_id uuid, p_funil_id uuid, p_responsavel_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_so_meu boolean;
BEGIN
  PERFORM public.fn__crm_acesso(p_company_id);
  v_so_meu := public.fn_crm_papel(p_company_id) = 'vendedor';
  RETURN (
    WITH ops AS (
      SELECT o.*, COALESCE(c.nome_fantasia, c.razao_social) AS cliente_nome,
             NULLIF(COALESCE(NULLIF(btrim(ct.whatsapp), ''), NULLIF(btrim(ct.celular), ''), NULLIF(btrim(c.whatsapp), ''), NULLIF(btrim(c.celular), ''), NULLIF(btrim(c.telefone), '')), '') AS fone,
             e.tipo_etapa,
             GREATEST(0, EXTRACT(DAY FROM now() - COALESCE(o.etapa_desde, o.updated_at, o.created_at)))::int AS dias
        FROM erp_crm_oportunidade o
        JOIN funil_etapa e ON e.id = o.funil_etapa_id
        LEFT JOIN erp_clientes c ON c.id = o.cliente_id
        LEFT JOIN erp_contatos ct ON ct.id = o.contato_id
       WHERE o.company_id = p_company_id AND o.funil_id = p_funil_id AND o.deleted_at IS NULL
         AND (NOT v_so_meu OR o.responsavel_id = auth.uid())
         AND (p_responsavel_id IS NULL OR o.responsavel_id = p_responsavel_id)
         AND (e.tipo_etapa = 'normal' OR o.data_fechamento >= current_date - 30)
    ), cfg AS (
      SELECT COALESCE((SELECT dias_amarelo FROM crm_alerta_config WHERE company_id = p_company_id AND funil = 'oportunidade' AND etapa IS NULL AND ativo LIMIT 1), 3) AS am,
             COALESCE((SELECT dias_vermelho FROM crm_alerta_config WHERE company_id = p_company_id AND funil = 'oportunidade' AND etapa IS NULL AND ativo LIMIT 1), 7) AS ve
    )
    SELECT jsonb_build_object(
      'cards', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', o.id, 'titulo', o.titulo, 'cliente', o.cliente_nome, 'cliente_id', o.cliente_id, 'telefone', o.fone,
          'valor', COALESCE(o.valor_proposta, o.valor_estimado), 'probabilidade', o.probabilidade,
          'responsavel_id', o.responsavel_id, 'responsavel_nome', NULLIF(btrim(o.responsavel_nome), ''),
          'etapa_id', o.funil_etapa_id, 'dias_na_etapa', o.dias, 'data_prevista', o.data_prevista_fechamento,
          'motivo_perda', o.motivo_perda,
          'semaforo', CASE WHEN o.tipo_etapa <> 'normal' THEN 'verde'
                           WHEN o.dias >= COALESCE(ac.dias_vermelho, (SELECT ve FROM cfg)) THEN 'vermelho'
                           WHEN o.dias >= COALESCE(ac.dias_amarelo, (SELECT am FROM cfg)) THEN 'amarelo' ELSE 'verde' END
        ) ORDER BY o.ordem, o.etapa_desde DESC NULLS LAST)
        FROM ops o
        LEFT JOIN crm_alerta_config ac ON ac.company_id = p_company_id AND ac.funil = 'oportunidade' AND ac.etapa = o.etapa AND ac.ativo), '[]'::jsonb),
      'resumo', (SELECT jsonb_build_object(
          'abertas', count(*) FILTER (WHERE tipo_etapa = 'normal'),
          'valor_aberto', COALESCE(sum(COALESCE(valor_proposta, valor_estimado)) FILTER (WHERE tipo_etapa = 'normal'), 0),
          'valor_ponderado', COALESCE(sum(COALESCE(valor_proposta, valor_estimado) * COALESCE(probabilidade, 0) / 100.0) FILTER (WHERE tipo_etapa = 'normal'), 0),
          'ganhos_30d', count(*) FILTER (WHERE tipo_etapa = 'ganho'),
          'valor_ganho_30d', COALESCE(sum(COALESCE(valor_proposta, valor_estimado)) FILTER (WHERE tipo_etapa = 'ganho'), 0)
        ) FROM ops)
    )
  );
END $function$;
REVOKE ALL ON FUNCTION public.fn_crm_quadro(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_crm_quadro(uuid, uuid, uuid) TO authenticated, service_role;

-- Ficha do negócio: dados + etapas do funil + linha do tempo (histórico, interações, visitas) + tarefas.
CREATE OR REPLACE FUNCTION public.fn_crm_oportunidade_ficha(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_op erp_crm_oportunidade%ROWTYPE;
BEGIN
  SELECT * INTO v_op FROM erp_crm_oportunidade WHERE id = p_id AND deleted_at IS NULL;
  IF v_op.id IS NULL THEN RETURN NULL; END IF;
  PERFORM public.fn__crm_acesso(v_op.company_id);
  IF public.fn_crm_papel(v_op.company_id) = 'vendedor' AND v_op.responsavel_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Este negócio é da carteira de outro vendedor.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'oportunidade', to_jsonb(v_op) || jsonb_build_object(
        'cliente_nome', (SELECT COALESCE(c.nome_fantasia, c.razao_social) FROM erp_clientes c WHERE c.id = v_op.cliente_id),
        'cliente_fone', (SELECT NULLIF(COALESCE(NULLIF(btrim(c.whatsapp), ''), NULLIF(btrim(c.celular), ''), NULLIF(btrim(c.telefone), '')), '') FROM erp_clientes c WHERE c.id = v_op.cliente_id),
        'contato_nome', (SELECT ct.nome FROM erp_contatos ct WHERE ct.id = v_op.contato_id),
        'contato_fone', (SELECT NULLIF(COALESCE(NULLIF(btrim(ct.whatsapp), ''), NULLIF(btrim(ct.celular), ''), NULLIF(btrim(ct.telefone), '')), '') FROM erp_contatos ct WHERE ct.id = v_op.contato_id),
        'dias_na_etapa', GREATEST(0, EXTRACT(DAY FROM now() - COALESCE(v_op.etapa_desde, v_op.updated_at, v_op.created_at)))::int),
    'etapas', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', e.id, 'rotulo', e.rotulo, 'tipo_etapa', e.tipo_etapa, 'cor', e.cor, 'probabilidade', e.probabilidade) ORDER BY e.ordem)
                FROM funil_etapa e WHERE e.funil_id = v_op.funil_id AND e.ativo), '[]'::jsonb),
    'linha_do_tempo', COALESCE((SELECT jsonb_agg(t ORDER BY t->>'quando' DESC) FROM (
        SELECT jsonb_build_object('tipo', 'historico', 'acao', h.acao, 'texto', h.detalhe, 'quando', h.criado_em,
               'autor', COALESCE(h.autor_nome, (SELECT COALESCE(NULLIF(btrim(u.full_name), ''), u.email) FROM users u WHERE u.id = h.autor_id))) AS t
          FROM erp_crm_oportunidade_historico h WHERE h.oportunidade_id = p_id
        UNION ALL
        SELECT jsonb_build_object('tipo', i.tipo, 'texto', i.descricao, 'quando', COALESCE(i.data_interacao, i.created_at),
               'autor', (SELECT COALESCE(NULLIF(btrim(u.full_name), ''), u.email) FROM users u WHERE u.id = i.autor_id))
          FROM erp_crm_interacao i WHERE i.oportunidade_id = p_id
        UNION ALL
        SELECT jsonb_build_object('tipo', 'visita', 'texto', COALESCE(NULLIF(btrim(v.anotacoes), ''), 'Visita ' || v.status), 'quando', COALESCE(v.data_visita, v.created_at),
               'autor', v.responsavel_nome)
          FROM erp_crm_visita v WHERE v.oportunidade_id = p_id AND v.deleted_at IS NULL
      ) x), '[]'::jsonb),
    'tarefas', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'tipo', t.tipo, 'titulo', t.titulo, 'vence_em', t.vence_em,
                'concluida_em', t.concluida_em, 'responsavel_id', t.responsavel_id) ORDER BY t.concluida_em NULLS FIRST, t.vence_em)
                FROM crm_tarefa t WHERE t.oportunidade_id = p_id AND t.excluida_em IS NULL), '[]'::jsonb),
    'evento_ge', (SELECT jsonb_build_object('status', s.status, 'criado_em', s.criado_em) FROM crm_evento_saida s WHERE s.oportunidade_id = p_id AND s.destino = 'ge' LIMIT 1)
  );
END $function$;
REVOKE ALL ON FUNCTION public.fn_crm_oportunidade_ficha(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_crm_oportunidade_ficha(uuid) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 9) Atividades e tarefas
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_crm_interacao_registrar(p_company_id uuid, p_oportunidade_id uuid, p_lead_id uuid, p_tipo text, p_descricao text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  PERFORM public.fn__crm_acesso(p_company_id);
  IF COALESCE(btrim(p_descricao), '') = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Escreva o que aconteceu.'); END IF;
  IF p_tipo NOT IN ('nota','ligacao','whatsapp','email','reuniao','visita') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Tipo de atividade desconhecido.');
  END IF;
  IF p_oportunidade_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM erp_crm_oportunidade WHERE id = p_oportunidade_id AND company_id = p_company_id
       AND (public.fn_crm_papel(p_company_id) <> 'vendedor' OR responsavel_id = auth.uid())) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Negócio não encontrado.');
  END IF;
  IF p_lead_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM erp_crm_lead WHERE id = p_lead_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Lead não encontrado.');
  END IF;
  INSERT INTO erp_crm_interacao (company_id, oportunidade_id, lead_id, tipo, descricao, data_interacao, autor_id)
  VALUES (p_company_id, p_oportunidade_id, p_lead_id, p_tipo, btrim(p_descricao), now(), auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;
REVOKE ALL ON FUNCTION public.fn_crm_interacao_registrar(uuid, uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_crm_interacao_registrar(uuid, uuid, uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_crm_tarefa_salvar(p_company_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid := NULLIF(p_dados->>'id', '')::uuid;
  v_resp uuid := COALESCE(NULLIF(p_dados->>'responsavel_id', '')::uuid, auth.uid());
BEGIN
  PERFORM public.fn__crm_acesso(p_company_id);
  IF public.fn_crm_papel(p_company_id) = 'vendedor' THEN v_resp := auth.uid(); END IF;
  IF COALESCE(btrim(p_dados->>'titulo'), '') = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Diga o que precisa ser feito.'); END IF;
  IF v_id IS NULL THEN
    INSERT INTO crm_tarefa (company_id, oportunidade_id, lead_id, tipo, titulo, vence_em, responsavel_id)
    VALUES (p_company_id, NULLIF(p_dados->>'oportunidade_id', '')::uuid, NULLIF(p_dados->>'lead_id', '')::uuid,
            COALESCE(NULLIF(p_dados->>'tipo', ''), 'tarefa'), btrim(p_dados->>'titulo'),
            COALESCE(NULLIF(p_dados->>'vence_em', '')::timestamptz, now()), v_resp)
    RETURNING id INTO v_id;
  ELSE
    UPDATE crm_tarefa SET tipo = COALESCE(NULLIF(p_dados->>'tipo', ''), tipo), titulo = btrim(p_dados->>'titulo'),
           vence_em = COALESCE(NULLIF(p_dados->>'vence_em', '')::timestamptz, vence_em), responsavel_id = v_resp
     WHERE id = v_id AND company_id = p_company_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;
REVOKE ALL ON FUNCTION public.fn_crm_tarefa_salvar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_crm_tarefa_salvar(uuid, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_crm_tarefa_concluir(p_id uuid, p_concluida boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid;
BEGIN
  SELECT company_id INTO v_comp FROM crm_tarefa WHERE id = p_id AND excluida_em IS NULL;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Tarefa não encontrada.'); END IF;
  PERFORM public.fn__crm_acesso(v_comp);
  UPDATE crm_tarefa SET concluida_em = CASE WHEN p_concluida THEN now() END, concluida_por = CASE WHEN p_concluida THEN auth.uid() END
   WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END $function$;
REVOKE ALL ON FUNCTION public.fn_crm_tarefa_concluir(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_crm_tarefa_concluir(uuid, boolean) TO authenticated, service_role;

-- "O que fazer hoje": 4 listas curtas, já na carteira do vendedor.
CREATE OR REPLACE FUNCTION public.fn_crm_hoje(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_so_meu boolean; v_ve int;
BEGIN
  PERFORM public.fn__crm_acesso(p_company_id);
  v_so_meu := public.fn_crm_papel(p_company_id) = 'vendedor';
  v_ve := COALESCE((SELECT dias_vermelho FROM crm_alerta_config WHERE company_id = p_company_id AND funil = 'oportunidade' AND etapa IS NULL AND ativo LIMIT 1), 7);
  RETURN jsonb_build_object(
    'tarefas', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'tipo', t.tipo, 'titulo', t.titulo, 'vence_em', t.vence_em,
                 'atrasada', t.vence_em < date_trunc('day', now()), 'oportunidade_id', t.oportunidade_id, 'lead_id', t.lead_id,
                 'oportunidade', o.titulo, 'telefone', COALESCE(NULLIF(btrim(c.whatsapp), ''), NULLIF(btrim(c.celular), ''), NULLIF(btrim(c.telefone), ''), l.telefone)) ORDER BY t.vence_em)
               FROM crm_tarefa t
               LEFT JOIN erp_crm_oportunidade o ON o.id = t.oportunidade_id
               LEFT JOIN erp_clientes c ON c.id = o.cliente_id
               LEFT JOIN erp_crm_lead l ON l.id = t.lead_id
              WHERE t.company_id = p_company_id AND t.concluida_em IS NULL AND t.excluida_em IS NULL
                AND t.vence_em < date_trunc('day', now()) + interval '1 day'
                AND (NOT v_so_meu OR t.responsavel_id = auth.uid())), '[]'::jsonb),
    'paradas', COALESCE((SELECT jsonb_agg(x ORDER BY (x->>'dias')::int DESC) FROM (
               SELECT jsonb_build_object('id', o.id, 'titulo', o.titulo, 'etapa', e.rotulo, 'responsavel_nome', o.responsavel_nome,
                      'valor', COALESCE(o.valor_proposta, o.valor_estimado),
                      'dias', GREATEST(0, EXTRACT(DAY FROM now() - COALESCE(o.etapa_desde, o.updated_at, o.created_at)))::int) AS x
                 FROM erp_crm_oportunidade o JOIN funil_etapa e ON e.id = o.funil_etapa_id AND e.tipo_etapa = 'normal'
                WHERE o.company_id = p_company_id AND o.deleted_at IS NULL
                  AND COALESCE(o.etapa_desde, o.updated_at, o.created_at) < now() - make_interval(days => v_ve)
                  AND (NOT v_so_meu OR o.responsavel_id = auth.uid())
                LIMIT 30) s), '[]'::jsonb),
    'propostas', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', o.id, 'titulo', o.titulo, 'etapa', e.rotulo,
                 'valor', o.valor_proposta, 'responsavel_nome', o.responsavel_nome) ORDER BY o.updated_at)
               FROM erp_crm_oportunidade o JOIN funil_etapa e ON e.id = o.funil_etapa_id AND e.tipo_etapa = 'normal'
              WHERE o.company_id = p_company_id AND o.deleted_at IS NULL AND o.valor_proposta IS NOT NULL
                AND (NOT v_so_meu OR o.responsavel_id = auth.uid())), '[]'::jsonb),
    'leads_sem_dono', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', l.id, 'nome', l.nome, 'empresa', l.empresa, 'telefone', l.telefone,
                 'origem', l.origem, 'criado_em', l.created_at) ORDER BY l.created_at)
               FROM erp_crm_lead l
              WHERE l.company_id = p_company_id AND l.deleted_at IS NULL AND l.status = 'novo' AND l.responsavel_id IS NULL), '[]'::jsonb)
  );
END $function$;
REVOKE ALL ON FUNCTION public.fn_crm_hoje(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_crm_hoje(uuid) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 10) Leads, empresas e contatos
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_crm_lead_salvar(p_company_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid := NULLIF(p_dados->>'id', '')::uuid;
  v_nome text := NULLIF(btrim(p_dados->>'nome'), '');
  v_resp uuid := NULLIF(p_dados->>'responsavel_id', '')::uuid;
  v_origem uuid := NULLIF(p_dados->>'origem_id', '')::uuid;
BEGIN
  PERFORM public.fn__crm_acesso(p_company_id);
  IF public.fn_crm_papel(p_company_id) = 'consulta' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Seu acesso ao CRM é só de consulta.'); END IF;
  IF v_nome IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Preencha o nome de quem procurou.'); END IF;
  IF public.fn_crm_papel(p_company_id) = 'vendedor' THEN v_resp := auth.uid(); END IF;
  IF v_id IS NULL THEN
    INSERT INTO erp_crm_lead (company_id, nome, empresa, telefone, email, origem_id, origem, interesse, cidade, responsavel_id, observacoes, campos_custom, status)
    VALUES (p_company_id, v_nome, NULLIF(btrim(p_dados->>'empresa'), ''), NULLIF(btrim(p_dados->>'telefone'), ''), NULLIF(btrim(p_dados->>'email'), ''),
            v_origem, (SELECT nome FROM crm_origem WHERE id = v_origem AND company_id = p_company_id),
            NULLIF(btrim(p_dados->>'interesse'), ''), NULLIF(btrim(p_dados->>'cidade'), ''), v_resp,
            NULLIF(btrim(p_dados->>'observacoes'), ''), COALESCE(p_dados->'campos_custom', '{}'::jsonb), 'novo')
    RETURNING id INTO v_id;
  ELSE
    UPDATE erp_crm_lead SET nome = v_nome, empresa = NULLIF(btrim(p_dados->>'empresa'), ''),
           telefone = NULLIF(btrim(p_dados->>'telefone'), ''), email = NULLIF(btrim(p_dados->>'email'), ''),
           origem_id = v_origem, origem = (SELECT nome FROM crm_origem WHERE id = v_origem AND company_id = p_company_id),
           interesse = NULLIF(btrim(p_dados->>'interesse'), ''), cidade = NULLIF(btrim(p_dados->>'cidade'), ''),
           responsavel_id = COALESCE(v_resp, responsavel_id), observacoes = NULLIF(btrim(p_dados->>'observacoes'), ''),
           campos_custom = COALESCE(p_dados->'campos_custom', campos_custom), updated_at = now()
     WHERE id = v_id AND company_id = p_company_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Lead não encontrado.'); END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;
REVOKE ALL ON FUNCTION public.fn_crm_lead_salvar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_crm_lead_salvar(uuid, jsonb) TO authenticated, service_role;

-- Ações de 1 toque no lead: pegar (assumir), atribuir (gerente), descartar (com motivo), reabrir.
CREATE OR REPLACE FUNCTION public.fn_crm_lead_acao(p_lead_id uuid, p_acao text, p_valor text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_papel text;
BEGIN
  SELECT company_id INTO v_comp FROM erp_crm_lead WHERE id = p_lead_id AND deleted_at IS NULL;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Lead não encontrado.'); END IF;
  PERFORM public.fn__crm_acesso(v_comp);
  v_papel := public.fn_crm_papel(v_comp);
  IF v_papel = 'consulta' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Seu acesso ao CRM é só de consulta.'); END IF;
  IF p_acao = 'pegar' THEN
    UPDATE erp_crm_lead SET responsavel_id = auth.uid(), status = CASE WHEN status = 'novo' THEN 'em_contato' ELSE status END, updated_at = now() WHERE id = p_lead_id;
  ELSIF p_acao = 'atribuir' THEN
    IF v_papel NOT IN ('diretor','gerente') THEN RETURN jsonb_build_object('ok', false, 'erro', 'Só o gerente distribui leads.'); END IF;
    UPDATE erp_crm_lead SET responsavel_id = NULLIF(p_valor, '')::uuid, updated_at = now() WHERE id = p_lead_id;
  ELSIF p_acao = 'descartar' THEN
    IF COALESCE(btrim(p_valor), '') = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Diga por que o lead foi descartado.'); END IF;
    UPDATE erp_crm_lead SET status = 'descartado', motivo_descarte = btrim(p_valor), updated_at = now() WHERE id = p_lead_id;
  ELSIF p_acao = 'reabrir' THEN
    UPDATE erp_crm_lead SET status = 'em_contato', motivo_descarte = NULL, updated_at = now() WHERE id = p_lead_id AND status = 'descartado';
  ELSIF p_acao = 'excluir' THEN
    UPDATE erp_crm_lead SET deleted_at = now(), updated_at = now() WHERE id = p_lead_id;
  ELSE
    RETURN jsonb_build_object('ok', false, 'erro', 'Ação desconhecida.');
  END IF;
  RETURN jsonb_build_object('ok', true);
END $function$;
REVOKE ALL ON FUNCTION public.fn_crm_lead_acao(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_crm_lead_acao(uuid, text, text) TO authenticated, service_role;

-- Qualificar o lead: vira empresa (se ainda não for) + negócio no funil, num toque.
CREATE OR REPLACE FUNCTION public.fn_crm_lead_qualificar(p_lead_id uuid, p_funil_id uuid DEFAULT NULL, p_cliente_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE l erp_crm_lead%ROWTYPE; v_cli uuid; v_res jsonb;
BEGIN
  SELECT * INTO l FROM erp_crm_lead WHERE id = p_lead_id AND deleted_at IS NULL;
  IF l.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Lead não encontrado.'); END IF;
  PERFORM public.fn__crm_acesso(l.company_id);
  IF l.oportunidade_id IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'id', l.oportunidade_id, 'ja_existia', true); END IF;
  v_cli := COALESCE(p_cliente_id, l.cliente_id);
  IF v_cli IS NOT NULL AND NOT EXISTS (SELECT 1 FROM erp_clientes WHERE id = v_cli AND company_id = l.company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Empresa não encontrada.');
  END IF;
  IF v_cli IS NULL THEN
    INSERT INTO erp_clientes (company_id, nome_fantasia, telefone, whatsapp, email, origem, cidade, tipo_pessoa, vendedor_id)
    VALUES (l.company_id, COALESCE(NULLIF(btrim(l.empresa), ''), l.nome), l.telefone, l.telefone, l.email, l.origem, l.cidade,
            CASE WHEN NULLIF(btrim(l.empresa), '') IS NULL THEN 'F' ELSE 'J' END, COALESCE(l.responsavel_id, auth.uid()))
    RETURNING id INTO v_cli;
    IF NULLIF(btrim(l.empresa), '') IS NOT NULL THEN
      INSERT INTO erp_contatos (company_id, entidade_tipo, entidade_id, nome, telefone, whatsapp, email, principal, ativo)
      VALUES (l.company_id, 'cliente', v_cli, l.nome, l.telefone, l.telefone, l.email, true, true);
    END IF;
  END IF;
  v_res := public.fn_crm_oportunidade_criar(l.company_id, jsonb_build_object(
    'titulo', COALESCE(NULLIF(btrim(l.interesse), ''), COALESCE(NULLIF(btrim(l.empresa), ''), l.nome)),
    'funil_id', p_funil_id, 'cliente_id', v_cli, 'origem_id', l.origem_id,
    'responsavel_id', COALESCE(l.responsavel_id, auth.uid()), 'observacoes', l.observacoes, 'lead_id', l.id));
  RETURN v_res || jsonb_build_object('cliente_id', v_cli);
END $function$;
REVOKE ALL ON FUNCTION public.fn_crm_lead_qualificar(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_crm_lead_qualificar(uuid, uuid, uuid) TO authenticated, service_role;

-- Empresa (conta) do CRM = erp_clientes (o mesmo cadastro da GE quando a empresa tiver as duas).
CREATE OR REPLACE FUNCTION public.fn_crm_empresa_salvar(p_company_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid := NULLIF(p_dados->>'id', '')::uuid; v_nome text := NULLIF(btrim(p_dados->>'nome'), '');
BEGIN
  PERFORM public.fn__crm_acesso(p_company_id);
  IF public.fn_crm_papel(p_company_id) = 'consulta' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Seu acesso ao CRM é só de consulta.'); END IF;
  IF v_nome IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Preencha o nome da empresa ou da pessoa.'); END IF;
  IF v_id IS NULL THEN
    INSERT INTO erp_clientes (company_id, nome_fantasia, razao_social, cpf_cnpj, tipo_pessoa, telefone, whatsapp, email, cidade, uf,
                              segmento, site, observacoes, vendedor_id, origem)
    VALUES (p_company_id, v_nome, NULLIF(btrim(p_dados->>'razao_social'), ''), NULLIF(regexp_replace(COALESCE(p_dados->>'cpf_cnpj', ''), '\D', '', 'g'), ''),
            CASE WHEN length(regexp_replace(COALESCE(p_dados->>'cpf_cnpj', ''), '\D', '', 'g')) = 11 THEN 'F' ELSE 'J' END,
            NULLIF(btrim(p_dados->>'telefone'), ''), NULLIF(btrim(p_dados->>'whatsapp'), ''), NULLIF(btrim(p_dados->>'email'), ''),
            NULLIF(btrim(p_dados->>'cidade'), ''), NULLIF(upper(btrim(p_dados->>'uf')), ''), NULLIF(btrim(p_dados->>'segmento'), ''),
            NULLIF(btrim(p_dados->>'site'), ''), NULLIF(btrim(p_dados->>'observacoes'), ''), auth.uid(), 'crm')
    RETURNING id INTO v_id;
  ELSE
    UPDATE erp_clientes SET nome_fantasia = v_nome, razao_social = NULLIF(btrim(p_dados->>'razao_social'), ''),
           cpf_cnpj = NULLIF(regexp_replace(COALESCE(p_dados->>'cpf_cnpj', ''), '\D', '', 'g'), ''),
           telefone = NULLIF(btrim(p_dados->>'telefone'), ''), whatsapp = NULLIF(btrim(p_dados->>'whatsapp'), ''),
           email = NULLIF(btrim(p_dados->>'email'), ''), cidade = NULLIF(btrim(p_dados->>'cidade'), ''),
           uf = NULLIF(upper(btrim(p_dados->>'uf')), ''), segmento = NULLIF(btrim(p_dados->>'segmento'), ''),
           site = NULLIF(btrim(p_dados->>'site'), ''), observacoes = NULLIF(btrim(p_dados->>'observacoes'), ''), updated_at = now()
     WHERE id = v_id AND company_id = p_company_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Empresa não encontrada.'); END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;
REVOKE ALL ON FUNCTION public.fn_crm_empresa_salvar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_crm_empresa_salvar(uuid, jsonb) TO authenticated, service_role;

-- Contato (pessoa) de uma empresa = erp_contatos (entidade_tipo 'cliente').
CREATE OR REPLACE FUNCTION public.fn_crm_contato_salvar(p_company_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid := NULLIF(p_dados->>'id', '')::uuid; v_cli uuid := NULLIF(p_dados->>'cliente_id', '')::uuid;
BEGIN
  PERFORM public.fn__crm_acesso(p_company_id);
  IF public.fn_crm_papel(p_company_id) = 'consulta' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Seu acesso ao CRM é só de consulta.'); END IF;
  IF COALESCE(btrim(p_dados->>'nome'), '') = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Preencha o nome do contato.'); END IF;
  IF v_cli IS NULL OR NOT EXISTS (SELECT 1 FROM erp_clientes WHERE id = v_cli AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Escolha a empresa do contato.');
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO erp_contatos (company_id, entidade_tipo, entidade_id, nome, cargo, telefone, whatsapp, email, principal, ativo, observacoes)
    VALUES (p_company_id, 'cliente', v_cli, btrim(p_dados->>'nome'), NULLIF(btrim(p_dados->>'cargo'), ''),
            NULLIF(btrim(p_dados->>'telefone'), ''), NULLIF(btrim(p_dados->>'whatsapp'), ''), NULLIF(btrim(p_dados->>'email'), ''),
            COALESCE((p_dados->>'principal')::boolean, false), true, NULLIF(btrim(p_dados->>'observacoes'), ''))
    RETURNING id INTO v_id;
  ELSE
    UPDATE erp_contatos SET entidade_id = v_cli, nome = btrim(p_dados->>'nome'), cargo = NULLIF(btrim(p_dados->>'cargo'), ''),
           telefone = NULLIF(btrim(p_dados->>'telefone'), ''), whatsapp = NULLIF(btrim(p_dados->>'whatsapp'), ''),
           email = NULLIF(btrim(p_dados->>'email'), ''), principal = COALESCE((p_dados->>'principal')::boolean, principal),
           ativo = COALESCE((p_dados->>'ativo')::boolean, ativo), observacoes = NULLIF(btrim(p_dados->>'observacoes'), ''), updated_at = now()
     WHERE id = v_id AND company_id = p_company_id AND entidade_tipo = 'cliente';
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Contato não encontrado.'); END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;
REVOKE ALL ON FUNCTION public.fn_crm_contato_salvar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_crm_contato_salvar(uuid, jsonb) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 11) Relatórios: conversão por etapa, tempo médio por etapa, ranking, motivos de perda
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_crm_relatorio(p_company_id uuid, p_funil_id uuid, p_de date, p_ate date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_so_meu boolean;
BEGIN
  PERFORM public.fn__crm_acesso(p_company_id);
  v_so_meu := public.fn_crm_papel(p_company_id) = 'vendedor';
  RETURN (
    WITH ops AS (
      SELECT o.* FROM erp_crm_oportunidade o
       WHERE o.company_id = p_company_id AND o.funil_id = p_funil_id AND o.deleted_at IS NULL
         AND o.created_at::date BETWEEN p_de AND p_ate
         AND (NOT v_so_meu OR o.responsavel_id = auth.uid())
    ), et AS (
      SELECT e.id, e.chave, e.rotulo, e.ordem, e.tipo_etapa FROM funil_etapa e WHERE e.funil_id = p_funil_id AND e.ativo
    ), alcance AS (  -- maior etapa (pela ordem) que cada negócio já alcançou; ganho alcança todas
      SELECT o.id, CASE WHEN o.etapa = 'ganho' THEN 1000000 ELSE
               GREATEST(COALESCE((SELECT max(e2.ordem) FROM erp_crm_oportunidade_historico h JOIN et e2 ON e2.chave = h.para_etapa AND e2.tipo_etapa = 'normal'
                                   WHERE h.oportunidade_id = o.id), 0),
                        COALESCE((SELECT e3.ordem FROM et e3 WHERE e3.id = o.funil_etapa_id AND e3.tipo_etapa = 'normal'), 0)) END AS max_ordem
        FROM ops o
    ), passagens AS (  -- tempo em cada etapa = da entrada até a próxima mudança (ou agora, se ainda está nela)
      SELECT h.para_etapa,
             EXTRACT(EPOCH FROM (COALESCE(lead(h.criado_em) OVER (PARTITION BY h.oportunidade_id ORDER BY h.criado_em), now()) - h.criado_em)) / 86400.0 AS dias
        FROM erp_crm_oportunidade_historico h
       WHERE h.oportunidade_id IN (SELECT id FROM ops) AND h.para_etapa IS NOT NULL
    )
    SELECT jsonb_build_object(
      'total', (SELECT count(*) FROM ops),
      'ganhos', (SELECT count(*) FROM ops WHERE etapa = 'ganho'),
      'perdidos', (SELECT count(*) FROM ops WHERE etapa = 'perdido'),
      'valor_ganho', (SELECT COALESCE(sum(COALESCE(valor_proposta, valor_estimado)), 0) FROM ops WHERE etapa = 'ganho'),
      'funil', COALESCE((SELECT jsonb_agg(jsonb_build_object('etapa', e.rotulo, 'qtd', (SELECT count(*) FROM alcance a WHERE a.max_ordem >= e.ordem)) ORDER BY e.ordem)
                FROM et e WHERE e.tipo_etapa = 'normal'), '[]'::jsonb),
      'tempo_por_etapa', COALESCE((SELECT jsonb_agg(jsonb_build_object('etapa', t.rotulo, 'dias_medio', t.dias_medio, 'passagens', t.passagens) ORDER BY t.ordem) FROM (
                SELECT e.rotulo, e.ordem, round(avg(p.dias)::numeric, 1) AS dias_medio, count(*) AS passagens
                  FROM et e JOIN passagens p ON p.para_etapa = e.chave WHERE e.tipo_etapa = 'normal' GROUP BY e.rotulo, e.ordem) t), '[]'::jsonb),
      'ranking', COALESCE((SELECT jsonb_agg(r ORDER BY (r->>'valor_ganho')::numeric DESC, (r->>'ganhos')::int DESC) FROM (
                SELECT jsonb_build_object('responsavel', COALESCE(max(o.responsavel_nome), 'Sem responsável'),
                       'ganhos', count(*) FILTER (WHERE o.etapa = 'ganho'), 'perdidos', count(*) FILTER (WHERE o.etapa = 'perdido'),
                       'abertos', count(*) FILTER (WHERE o.etapa NOT IN ('ganho','perdido')),
                       'valor_ganho', COALESCE(sum(COALESCE(o.valor_proposta, o.valor_estimado)) FILTER (WHERE o.etapa = 'ganho'), 0)) AS r
                  FROM ops o GROUP BY o.responsavel_id) x), '[]'::jsonb),
      'motivos_perda', COALESCE((SELECT jsonb_agg(jsonb_build_object('motivo', m.motivo, 'qtd', m.qtd) ORDER BY m.qtd DESC) FROM (
                SELECT COALESCE(mp.nome, NULLIF(btrim(o.motivo_perda), ''), 'Sem motivo') AS motivo, count(*) AS qtd
                  FROM ops o LEFT JOIN erp_motivo_perda mp ON mp.id = o.motivo_perda_id
                 WHERE o.etapa = 'perdido' GROUP BY 1) m), '[]'::jsonb)
    )
  );
END $function$;
REVOKE ALL ON FUNCTION public.fn_crm_relatorio(uuid, uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_crm_relatorio(uuid, uuid, date, date) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 12) Empresa DEMO do plano CRM (só o plano CRM — prova "só Admin + CRM")
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
INSERT INTO public.companies (id, org_id, razao_social, nome_fantasia, is_demo, ambiente_tenant, cnpj, restrita_ps_admin, uf_fiscal)
VALUES ('b0700000-0000-4000-a000-00000000000a', 'c830f980-9be9-40c1-bb46-584cdc92dd65',
        'CRM Modelo Demonstração LTDA', 'CRM Modelo - DEMO', true, 'auditoria', '55500000000576', false, 'SC')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tenant_subscriptions (company_id, plan_id, status, monthly_price_brl, billing_cycle, tier, observacao)
SELECT 'b0700000-0000-4000-a000-00000000000a'::uuid, 'v15_crm', 'active', 0, 'monthly', 'pro', 'Demonstração · PS CRM Onda 1 (plano CRM sozinho)'
WHERE EXISTS (SELECT 1 FROM public.companies WHERE id = 'b0700000-0000-4000-a000-00000000000a')
  AND NOT EXISTS (SELECT 1 FROM public.tenant_subscriptions ts
                   WHERE ts.company_id = 'b0700000-0000-4000-a000-00000000000a' AND ts.plan_id = 'v15_crm');

-- acesso: os mesmos vínculos da demo GE (robô, CEO, equipe PS)
INSERT INTO public.user_companies (user_id, company_id, role, origem)
SELECT uc.user_id, 'b0700000-0000-4000-a000-00000000000a'::uuid, uc.role, uc.origem
FROM public.user_companies uc
WHERE uc.company_id = 'b0700000-0000-4000-a000-000000000004'
  AND EXISTS (SELECT 1 FROM public.companies WHERE id = 'b0700000-0000-4000-a000-00000000000a')
  AND NOT EXISTS (SELECT 1 FROM public.user_companies x WHERE x.user_id = uc.user_id AND x.company_id = 'b0700000-0000-4000-a000-00000000000a');

INSERT INTO public.demo_por_area (area, company_id) VALUES ('crm', 'b0700000-0000-4000-a000-00000000000a')
ON CONFLICT (area) DO UPDATE SET company_id = EXCLUDED.company_id;

-- Dados de demonstração (só na DEMO; idempotente: só semeia se a DEMO ainda não tem negócio do CRM)
DO $demo$
DECLARE
  v_demo constant uuid := 'b0700000-0000-4000-a000-00000000000a';
  v_funil uuid; v_e1 uuid; v_e2 uuid; v_e3 uuid; v_e4 uuid; v_ganho uuid;
  v_c1 uuid; v_c2 uuid; v_c3 uuid; v_c4 uuid; v_op uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = v_demo) THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.erp_crm_oportunidade WHERE company_id = v_demo AND funil_id IS NOT NULL) THEN RETURN; END IF;
  PERFORM public.fn__crm_semear(v_demo);
  SELECT id INTO v_funil FROM public.crm_funil WHERE company_id = v_demo AND padrao;
  SELECT id INTO v_e1 FROM public.funil_etapa WHERE funil_id = v_funil AND chave = 'crm_novo_contato';
  SELECT id INTO v_e2 FROM public.funil_etapa WHERE funil_id = v_funil AND chave = 'crm_qualificacao';
  SELECT id INTO v_e3 FROM public.funil_etapa WHERE funil_id = v_funil AND chave = 'crm_proposta';
  SELECT id INTO v_e4 FROM public.funil_etapa WHERE funil_id = v_funil AND chave = 'crm_negociacao';
  SELECT id INTO v_ganho FROM public.funil_etapa WHERE funil_id = v_funil AND chave = 'ganho';

  INSERT INTO public.erp_clientes (company_id, nome_fantasia, tipo_pessoa, whatsapp, cidade, uf, origem) VALUES
    (v_demo, 'Padaria Bom Grão', 'J', '(48) 99900-1001', 'Florianópolis', 'SC', 'crm') RETURNING id INTO v_c1;
  INSERT INTO public.erp_clientes (company_id, nome_fantasia, tipo_pessoa, whatsapp, cidade, uf, origem) VALUES
    (v_demo, 'Clínica Sorriso Pleno', 'J', '(48) 99900-1002', 'São José', 'SC', 'crm') RETURNING id INTO v_c2;
  INSERT INTO public.erp_clientes (company_id, nome_fantasia, tipo_pessoa, whatsapp, cidade, uf, origem) VALUES
    (v_demo, 'Auto Center Rota 101', 'J', '(48) 99900-1003', 'Palhoça', 'SC', 'crm') RETURNING id INTO v_c3;
  INSERT INTO public.erp_clientes (company_id, nome_fantasia, tipo_pessoa, whatsapp, cidade, uf, origem) VALUES
    (v_demo, 'Marina Costa', 'F', '(48) 99900-1004', 'Florianópolis', 'SC', 'crm') RETURNING id INTO v_c4;
  INSERT INTO public.erp_contatos (company_id, entidade_tipo, entidade_id, nome, cargo, whatsapp, principal, ativo) VALUES
    (v_demo, 'cliente', v_c1, 'Joana Lima', 'Sócia', '(48) 99900-2001', true, true),
    (v_demo, 'cliente', v_c2, 'Dr. Paulo Reis', 'Diretor', '(48) 99900-2002', true, true),
    (v_demo, 'cliente', v_c3, 'Márcio Alves', 'Gerente', '(48) 99900-2003', true, true);

  INSERT INTO public.erp_crm_oportunidade (company_id, cliente_id, titulo, etapa, funil_id, funil_etapa_id, probabilidade, valor_estimado, etapa_desde, data_prevista_fechamento)
  VALUES
    (v_demo, v_c1, 'Sistema de pedidos – Padaria Bom Grão', 'crm_novo_contato', v_funil, v_e1, 10, 4800, now() - interval '1 day', current_date + 30),
    (v_demo, v_c2, 'Contrato anual – Clínica Sorriso Pleno', 'crm_qualificacao', v_funil, v_e2, 25, 18000, now() - interval '5 days', current_date + 20),
    (v_demo, v_c3, 'Pacote de manutenção – Auto Center Rota 101', 'crm_proposta', v_funil, v_e3, 50, 9600, now() - interval '9 days', current_date + 10),
    (v_demo, v_c4, 'Projeto residencial – Marina Costa', 'crm_negociacao', v_funil, v_e4, 75, 32000, now() - interval '2 days', current_date + 7);
  UPDATE public.erp_crm_oportunidade SET valor_proposta = 9200 WHERE company_id = v_demo AND cliente_id = v_c3;
  INSERT INTO public.erp_crm_oportunidade (company_id, cliente_id, titulo, etapa, funil_id, funil_etapa_id, probabilidade, valor_estimado, etapa_desde, data_fechamento)
  VALUES (v_demo, v_c1, 'Treinamento da equipe – Padaria Bom Grão', 'ganho', v_funil, v_ganho, 100, 2400, now() - interval '3 days', current_date - 3)
  RETURNING id INTO v_op;

  INSERT INTO public.erp_crm_lead (company_id, nome, empresa, telefone, origem, origem_id, interesse, status)
  SELECT v_demo, d.nome, d.empresa, d.fone, o.nome, o.id, d.interesse, 'novo'
    FROM (VALUES ('Rafael Souza', 'Mercado Souza', '(48) 99900-3001', 'WhatsApp', 'Quer orçamento para 3 lojas'),
                 ('Carla Mendes', NULL, '(48) 99900-3002', 'Instagram', 'Pediu uma demonstração'),
                 ('Lucas Prado', 'Prado Engenharia', '(48) 99900-3003', 'Indicação', 'Indicado pela Clínica Sorriso Pleno')) AS d(nome, empresa, fone, origem, interesse)
    LEFT JOIN public.crm_origem o ON o.company_id = v_demo AND o.nome = d.origem;

  INSERT INTO public.crm_tarefa (company_id, oportunidade_id, tipo, titulo, vence_em)
  SELECT v_demo, o.id, 'whatsapp', 'Mandar a proposta revisada', date_trunc('day', now()) + interval '10 hours'
    FROM public.erp_crm_oportunidade o WHERE o.company_id = v_demo AND o.cliente_id = v_c3 AND o.funil_id IS NOT NULL;
  INSERT INTO public.crm_tarefa (company_id, oportunidade_id, tipo, titulo, vence_em)
  SELECT v_demo, o.id, 'ligacao', 'Ligar para fechar condições', date_trunc('day', now()) + interval '15 hours'
    FROM public.erp_crm_oportunidade o WHERE o.company_id = v_demo AND o.cliente_id = v_c4 AND o.funil_id IS NOT NULL;
END $demo$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 13) Telas no system_screens (a entrega só conta se o usuário a enxerga) + ajuda "?" de todo campo (RD-95)
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, modulo, estado_real, prioridade_monitoramento, auditavel_robo)
VALUES
  ('S.crm.hoje',         '/dashboard/crm',                  'crm', 'CRM · O que fazer hoje', 'Tarefas do dia, negócios parados, propostas aguardando resposta e leads sem dono.', 'crm', 'pronto', 'alta', true),
  ('S.crm.pipeline',     '/dashboard/crm/pipeline',         'crm', 'CRM · Funil de vendas',  'Quadro do funil cadastrado: arrastar muda a etapa, grava histórico e zera o tempo na etapa.', 'crm_pipeline', 'pronto', 'alta', true),
  ('S.crm.oportunidade', '/dashboard/crm/oportunidade/[id]', 'crm', 'CRM · Ficha do negócio', 'Dados, etapa, linha do tempo (atividades, visitas, histórico) e próximas tarefas.', 'crm_pipeline', 'pronto', 'alta', true),
  ('S.crm.leads',        '/dashboard/crm/leads',            'crm', 'CRM · Leads',            'Entrada e qualificação: pegar, distribuir, descartar e transformar em negócio.', 'crm_leads', 'pronto', 'alta', true),
  ('S.crm.empresas',     '/dashboard/crm/empresas',         'crm', 'CRM · Empresas',         'Contas atendidas pelo comercial (pessoa ou empresa).', 'crm_empresas', 'pronto', 'media', true),
  ('S.crm.contatos',     '/dashboard/crm/contatos',         'crm', 'CRM · Contatos',         'Pessoas de contato de cada empresa, com WhatsApp.', 'crm_contatos', 'pronto', 'media', true),
  ('S.crm.funis',        '/dashboard/crm/funis',            'crm', 'CRM · Funis e cadastros','Funis por tipo de negócio, etapas com probabilidade e cor, origens, motivos de perda e campos próprios.', 'crm_funis', 'pronto', 'alta', true),
  ('S.crm.relatorios',   '/dashboard/crm/relatorios',       'crm', 'CRM · Relatórios',       'Conversão do funil, tempo médio por etapa, ranking de vendedores e motivos de perda.', 'crm_relatorios', 'pronto', 'media', true)
ON CONFLICT (rota) DO NOTHING;

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
 ('crm.hoje.tarefas','/dashboard/crm','Hoje','Tarefas de hoje','Nada a preencher: lista o que vence hoje ou já venceu. Toque no círculo para concluir.','Organiza o dia do vendedor: ninguém esquece um retorno prometido.','"Ligar para a Clínica às 15h" aparece aqui de manhã.','Deixar tarefa vencida acumulando: conclua ou reagende para a lista mostrar só o que importa.','crm',1,'publicado'),
 ('crm.hoje.paradas','/dashboard/crm','Hoje','Negócios parados','Nada a preencher: negócios abertos há mais dias na mesma etapa do que o limite vermelho da empresa.','Mostra onde a venda está esfriando para você agir antes de perder.','Proposta enviada há 9 dias sem resposta.','Ignorar o alerta: um contato rápido pelo WhatsApp costuma destravar.','crm',2,'publicado'),
 ('crm.hoje.propostas','/dashboard/crm','Hoje','Propostas aguardando','Nada a preencher: negócios abertos que já têm valor de proposta.','Lista quem está decidindo — é aqui que o follow-up vale mais.','Auto Center com proposta de R$ 9.200.','Esquecer de mover para Ganho/Perdido quando o cliente responde.','crm',3,'publicado'),
 ('crm.hoje.leads_sem_dono','/dashboard/crm','Hoje','Leads sem dono','Nada a preencher: leads novos que ninguém pegou. Toque em "Pegar" para assumir.','Garante que todo contato que chegou seja atendido rápido.','Mensagem de WhatsApp que chegou ontem à noite.','Deixar o lead esperando: quem responde primeiro costuma vender.','crm',4,'publicado'),
 ('crm.hoje.novo_negocio','/dashboard/crm','Hoje','Novo negócio','Ação: abre o cadastro rápido de negócio (nome, empresa, valor).','Começa uma venda no funil em poucos toques, até do celular.','"Reforma da loja – Ana", R$ 12.000.','Criar negócio sem empresa: dá para preencher depois, mas sem ela não aparece o WhatsApp.','crm',5,'publicado'),
 ('crm.pipeline.funil','/dashboard/crm/pipeline','Funil','Funil','Escolha qual funil ver (cada tipo de negócio pode ter o seu).','Separa vendas diferentes — ex.: "Obras" e "Manutenção" — cada uma com suas etapas.','Funil "Vendas" (padrão da empresa).','Procurar um negócio no funil errado: ele só aparece no funil em que foi criado.','crm',1,'publicado'),
 ('crm.pipeline.responsavel','/dashboard/crm/pipeline','Funil','Responsável','Filtre o quadro pelo vendedor responsável (gerente/diretor).','Ver a carteira de cada pessoa da equipe.','Só os negócios do João.','O vendedor sempre vê só a própria carteira — o filtro não aparece para ele.','crm',2,'publicado'),
 ('crm.pipeline.quadro','/dashboard/crm/pipeline','Funil','Quadro do funil','Arraste o cartão para outra coluna (no celular use "Mover para"). Cada coluna é uma etapa cadastrada.','Mudar de etapa grava o histórico e zera o tempo na etapa. A cor do cartão avisa negócio parado (amarelo/vermelho).','Arrastar "Clínica Sorriso" de Qualificação para Proposta.','Mover para Perdido sem motivo: o sistema pede o motivo, que alimenta o relatório.','crm',3,'publicado'),
 ('crm.pipeline.ponderado','/dashboard/crm/pipeline','Funil','Valor ponderado','Nada a preencher: soma de valor × probabilidade de cada etapa.','Previsão realista do que deve fechar, melhor que somar tudo.','R$ 10.000 em Proposta (50%) contam R$ 5.000.','Probabilidade da etapa errada distorce a previsão — ajuste em Funis.','crm',4,'publicado'),
 ('crm.pipeline.mover','/dashboard/crm/pipeline','Funil','Mover para','Escolha a nova etapa do negócio.','Alternativa ao arrastar, pensada para o celular.','Mover para "Negociação".','—','crm',5,'publicado'),
 ('crm.pipeline.motivo_perda','/dashboard/crm/pipeline','Funil','Motivo da perda','Escolha o motivo cadastrado e, se quiser, complemente.','Alimenta o relatório "por que perdemos" para corrigir preço, prazo ou abordagem.','"Preço" + "concorrente cobrou 15% menos".','Escolher sempre "Outro": o relatório perde o valor.','crm',6,'publicado'),
 ('crm.novo.titulo','/dashboard/crm/pipeline','Novo negócio','Nome do negócio','Um nome curto que identifique a venda.','Aparece no cartão do quadro e nas tarefas.','"Contrato anual – Clínica Sorriso".','Usar só o nome do cliente: com vários negócios do mesmo cliente fica confuso.','crm',10,'publicado'),
 ('crm.novo.empresa','/dashboard/crm/pipeline','Novo negócio','Empresa','Escolha a empresa ou pessoa (cadastro de Empresas).','Liga o negócio ao cliente: mostra WhatsApp e histórico.','Padaria Bom Grão.','Cadastrar a mesma empresa duas vezes: busque antes de criar.','crm',11,'publicado'),
 ('crm.novo.valor','/dashboard/crm/pipeline','Novo negócio','Valor estimado','Quanto deve valer a venda, em reais.','Soma no total do funil e no valor ponderado.','12.000,00','Deixar em branco: o negócio some da previsão.','crm',12,'publicado'),
 ('crm.novo.etapa','/dashboard/crm/pipeline','Novo negócio','Etapa inicial','Em qual etapa o negócio começa (padrão: a primeira).','Negócio que já chegou adiantado não precisa passar por todas as colunas.','Começar direto em "Proposta".','—','crm',13,'publicado'),
 ('crm.novo.origem','/dashboard/crm/pipeline','Novo negócio','Origem','De onde veio o cliente (cadastro de Origens).','Mostra quais canais trazem mais vendas.','WhatsApp, Indicação.','Não preencher: o relatório de canais fica cego.','crm',14,'publicado'),
 ('crm.novo.responsavel','/dashboard/crm/pipeline','Novo negócio','Responsável','Vendedor dono do negócio.','Define a carteira: o vendedor vê só o que é dele.','Maria (vendedora).','—','crm',15,'publicado'),
 ('crm.novo.previsao','/dashboard/crm/pipeline','Novo negócio','Previsão de fechamento','Data em que você espera fechar.','Ajuda a planejar o mês e a cobrar o próximo passo.','30/11.','—','crm',16,'publicado'),
 ('crm.ficha.dados','/dashboard/crm/oportunidade/[id]','Ficha','Dados do negócio','Edite nome, empresa, contato, valores, origem, responsável e previsão.','Mantém o negócio atualizado para o funil e os relatórios.','Atualizar o valor depois da visita.','Esquecer de salvar: toque em "Salvar".','crm',1,'publicado'),
 ('crm.ficha.etapa','/dashboard/crm/oportunidade/[id]','Ficha','Etapa','Toque na etapa para mover o negócio.','Mesmo efeito de arrastar no quadro: grava histórico e zera o tempo.','Tocar em "Negociação".','—','crm',2,'publicado'),
 ('crm.ficha.contato','/dashboard/crm/oportunidade/[id]','Ficha','Contato','A pessoa com quem você fala nesta venda.','O botão WhatsApp usa o número dela.','Joana (sócia).','—','crm',3,'publicado'),
 ('crm.ficha.valor_proposta','/dashboard/crm/oportunidade/[id]','Ficha','Valor da proposta','O valor que você ofereceu ao cliente.','Passa a valer no lugar do estimado e coloca o negócio em "propostas aguardando".','9.200,00','—','crm',4,'publicado'),
 ('crm.ficha.observacoes','/dashboard/crm/oportunidade/[id]','Ficha','Observações','Anotações fixas do negócio.','Contexto para quem pegar o negócio depois.','"Decide com o sócio, só às sextas".','Usar para registrar conversa: para isso use "Registrar atividade".','crm',5,'publicado'),
 ('crm.ficha.campos_custom','/dashboard/crm/oportunidade/[id]','Ficha','Campos da empresa','Campos que a sua empresa criou em Funis › Campos.','Guardar o que é próprio do seu negócio sem precisar de programação.','"Placa do veículo", "Metragem da obra".','—','crm',6,'publicado'),
 ('crm.ficha.atividade','/dashboard/crm/oportunidade/[id]','Ficha','Registrar atividade','Escolha o tipo (WhatsApp, ligação, reunião…) e escreva o que aconteceu.','Fica na linha do tempo: qualquer pessoa entende a negociação.','"WhatsApp: cliente pediu desconto de 5%".','Registrar só no celular pessoal: a empresa perde o histórico.','crm',7,'publicado'),
 ('crm.ficha.tarefa','/dashboard/crm/oportunidade/[id]','Ficha','Próxima tarefa','O próximo passo e quando fazer.','Aparece em "O que fazer hoje" no dia certo.','"Ligar amanhã às 10h".','Negócio aberto sem próxima tarefa costuma esfriar.','crm',8,'publicado'),
 ('crm.ficha.whatsapp','/dashboard/crm/oportunidade/[id]','Ficha','WhatsApp','Ação: abre a conversa com o contato no WhatsApp.','Venda no Brasil acontece no WhatsApp — um toque e você está na conversa.','—','Contato sem número: preencha o WhatsApp no cadastro.','crm',9,'publicado'),
 ('crm.ficha.linha_tempo','/dashboard/crm/oportunidade/[id]','Ficha','Linha do tempo','Nada a preencher: atividades, visitas e mudanças de etapa em ordem.','Conta a história da venda para qualquer pessoa da equipe.','—','—','crm',10,'publicado'),
 ('crm.leads.busca','/dashboard/crm/leads','Leads','Buscar','Nome, empresa ou telefone.','Acha rápido quem mandou mensagem.','"Souza".','—','crm',1,'publicado'),
 ('crm.leads.situacao','/dashboard/crm/leads','Leads','Situação','Filtre por novos, em contato, convertidos ou descartados.','Foco no que precisa de ação.','"Novos".','—','crm',2,'publicado'),
 ('crm.leads.novo','/dashboard/crm/leads','Leads','Novo lead','Ação: registre quem procurou a empresa (nome e WhatsApp bastam).','Nenhum contato se perde, mesmo que ainda não seja um negócio.','Rafael, Mercado Souza, (48) 99900-3001.','—','crm',3,'publicado'),
 ('crm.leads.nome','/dashboard/crm/leads','Leads','Nome','Nome de quem procurou.','Identifica o lead.','Rafael Souza.','—','crm',4,'publicado'),
 ('crm.leads.empresa','/dashboard/crm/leads','Leads','Empresa','Empresa do lead, se houver.','Ao qualificar, vira o cadastro da empresa.','Mercado Souza.','Deixe em branco quando for pessoa física.','crm',5,'publicado'),
 ('crm.leads.telefone','/dashboard/crm/leads','Leads','WhatsApp / telefone','Número com DDD.','Habilita o botão de WhatsApp.','(48) 99900-3001.','Número sem DDD não abre o WhatsApp.','crm',6,'publicado'),
 ('crm.leads.email','/dashboard/crm/leads','Leads','E-mail','E-mail do lead (opcional).','Contato alternativo.','rafael@mercado.com.br','—','crm',7,'publicado'),
 ('crm.leads.origem','/dashboard/crm/leads','Leads','Origem','Canal por onde chegou (cadastro de Origens).','Mostra quais canais funcionam.','Instagram.','—','crm',8,'publicado'),
 ('crm.leads.interesse','/dashboard/crm/leads','Leads','Interesse','O que a pessoa quer, em poucas palavras.','Vira o nome do negócio ao qualificar.','"Orçamento para 3 lojas".','—','crm',9,'publicado'),
 ('crm.leads.responsavel','/dashboard/crm/leads','Leads','Responsável','Quem vai atender (gerente distribui; vendedor usa "Pegar").','Evita dois vendedores no mesmo lead.','Maria.','—','crm',10,'publicado'),
 ('crm.leads.acoes','/dashboard/crm/leads','Leads','Ações do lead','Pegar, Qualificar (vira negócio no funil), Descartar com motivo, WhatsApp.','Cada ação é 1 toque — pensado para o vendedor em campo.','Qualificar → cria a empresa e o negócio.','Descartar sem motivo: o sistema pede o motivo.','crm',11,'publicado'),
 ('crm.empresas.busca','/dashboard/crm/empresas','Empresas','Buscar','Nome, documento ou cidade.','Achar a empresa antes de cadastrar outra igual.','"Padaria".','—','crm',1,'publicado'),
 ('crm.empresas.nome','/dashboard/crm/empresas','Empresas','Nome','Nome pelo qual a empresa é conhecida (ou nome da pessoa).','Aparece nos negócios e no quadro.','Padaria Bom Grão.','—','crm',2,'publicado'),
 ('crm.empresas.razao','/dashboard/crm/empresas','Empresas','Razão social','Nome do contrato social (opcional).','Para propostas e contratos.','Bom Grão Panificadora LTDA.','—','crm',3,'publicado'),
 ('crm.empresas.documento','/dashboard/crm/empresas','Empresas','CPF / CNPJ','Só números (opcional).','Identifica a empresa sem duplicar.','12.345.678/0001-90','—','crm',4,'publicado'),
 ('crm.empresas.whatsapp','/dashboard/crm/empresas','Empresas','WhatsApp','Número com DDD.','Botão de WhatsApp nos negócios desta empresa.','(48) 99900-1001.','—','crm',5,'publicado'),
 ('crm.empresas.telefone','/dashboard/crm/empresas','Empresas','Telefone','Telefone fixo (opcional).','Contato alternativo.','(48) 3333-1000.','—','crm',6,'publicado'),
 ('crm.empresas.email','/dashboard/crm/empresas','Empresas','E-mail','E-mail principal (opcional).','Contato alternativo.','contato@bomgrao.com.br','—','crm',7,'publicado'),
 ('crm.empresas.cidade','/dashboard/crm/empresas','Empresas','Cidade / UF','Onde fica.','Organiza visitas e territórios.','Florianópolis / SC.','—','crm',8,'publicado'),
 ('crm.empresas.segmento','/dashboard/crm/empresas','Empresas','Segmento','Ramo de atividade (opcional).','Mostra em quais ramos você vende mais.','Alimentação.','—','crm',9,'publicado'),
 ('crm.empresas.observacoes','/dashboard/crm/empresas','Empresas','Observações','Anotações gerais da conta.','Contexto para a equipe.','"Compra sempre no fim do mês".','—','crm',10,'publicado'),
 ('crm.contatos.busca','/dashboard/crm/contatos','Contatos','Buscar','Nome, cargo ou telefone.','Achar rápido com quem falar.','"Joana".','—','crm',1,'publicado'),
 ('crm.contatos.empresa','/dashboard/crm/contatos','Contatos','Empresa','Empresa onde a pessoa trabalha.','Liga o contato aos negócios da empresa.','Padaria Bom Grão.','—','crm',2,'publicado'),
 ('crm.contatos.nome','/dashboard/crm/contatos','Contatos','Nome','Nome da pessoa.','Identifica o contato.','Joana Lima.','—','crm',3,'publicado'),
 ('crm.contatos.cargo','/dashboard/crm/contatos','Contatos','Cargo','Função na empresa (opcional).','Saber quem decide.','Sócia.','—','crm',4,'publicado'),
 ('crm.contatos.whatsapp','/dashboard/crm/contatos','Contatos','WhatsApp','Número com DDD.','Botão de WhatsApp direto para a pessoa.','(48) 99900-2001.','—','crm',5,'publicado'),
 ('crm.contatos.email','/dashboard/crm/contatos','Contatos','E-mail','E-mail (opcional).','Contato alternativo.','joana@bomgrao.com.br','—','crm',6,'publicado'),
 ('crm.contatos.principal','/dashboard/crm/contatos','Contatos','Contato principal','Marque a pessoa que mais decide.','É o contato sugerido nos negócios da empresa.','—','—','crm',7,'publicado'),
 ('crm.funis.funil','/dashboard/crm/funis','Funis','Funil','Escolha o funil para editar ou crie um novo.','Cada tipo de negócio pode ter o seu funil, com etapas próprias.','"Obras", "Manutenção", "Revenda".','Criar funis demais: comece com um e só separe quando o caminho de venda for diferente.','crm',1,'publicado'),
 ('crm.funis.nome','/dashboard/crm/funis','Funis','Nome do funil','Como a equipe chama este funil.','Aparece no seletor do quadro.','Vendas.','—','crm',2,'publicado'),
 ('crm.funis.tipo_negocio','/dashboard/crm/funis','Funis','Tipo de negócio','Para que tipo de venda o funil serve (texto livre).','Ajuda a equipe a escolher o funil certo.','Obras residenciais.','—','crm',3,'publicado'),
 ('crm.funis.padrao','/dashboard/crm/funis','Funis','Funil padrão','Marque o funil que abre primeiro no quadro.','Negócio criado sem escolher funil cai nele.','—','—','crm',4,'publicado'),
 ('crm.funis.etapa_nome','/dashboard/crm/funis','Funis','Nome da etapa','Nome da coluna no quadro.','Organiza o caminho da venda do seu jeito.','"Visita técnica".','—','crm',5,'publicado'),
 ('crm.funis.etapa_prob','/dashboard/crm/funis','Funis','Probabilidade (%)','Chance de fechar quando o negócio está nesta etapa, de 0 a 100.','Calcula o valor ponderado (previsão de vendas).','Proposta = 50%.','Colocar 100% antes do ganho infla a previsão.','crm',6,'publicado'),
 ('crm.funis.etapa_cor','/dashboard/crm/funis','Funis','Cor','Cor da coluna.','Leitura rápida do quadro.','—','—','crm',7,'publicado'),
 ('crm.funis.etapa_ordem','/dashboard/crm/funis','Funis','Ordem','Use as setas para subir ou descer a etapa.','Define a ordem das colunas e a conta da conversão.','—','Ganho e Perdido ficam sempre no fim.','crm',8,'publicado'),
 ('crm.funis.etapa_retirar','/dashboard/crm/funis','Funis','Retirar etapa','Ação: tira a etapa do funil (o histórico fica).','Simplificar o funil sem perder dados.','—','Só dá para retirar etapa vazia: mova os negócios antes.','crm',9,'publicado'),
 ('crm.funis.origem','/dashboard/crm/funis','Funis','Origens','Canais por onde os clientes chegam.','Lista do campo "Origem" em leads e negócios.','WhatsApp, Indicação, Feira.','—','crm',10,'publicado'),
 ('crm.funis.motivo','/dashboard/crm/funis','Funis','Motivos de perda','Razões pelas quais um negócio é perdido.','Lista obrigatória ao marcar Perdido; vira relatório.','Preço, Prazo, Sem retorno.','—','crm',11,'publicado'),
 ('crm.funis.campo','/dashboard/crm/funis','Funis','Campos próprios','Crie campos que só a sua empresa usa, em negócios ou leads.','Adapta o CRM ao seu ramo sem programação.','"Placa do veículo" (texto), "Metragem" (número).','—','crm',12,'publicado'),
 ('crm.funis.campo_tipo','/dashboard/crm/funis','Funis','Tipo do campo','Texto, número, data, lista ou sim/não.','Define como o campo é preenchido.','Lista: "Residencial; Comercial".','—','crm',13,'publicado'),
 ('crm.funis.ativo','/dashboard/crm/funis','Funis','Ativo','Desmarque para esconder sem apagar.','Mantém o histórico e tira das listas.','—','—','crm',14,'publicado'),
 ('crm.relatorios.funil','/dashboard/crm/relatorios','Relatórios','Funil','Funil analisado.','Cada funil tem sua conversão.','Vendas.','—','crm',1,'publicado'),
 ('crm.relatorios.periodo','/dashboard/crm/relatorios','Relatórios','Período','Negócios criados entre estas datas.','Compara meses e campanhas.','Último trimestre.','—','crm',2,'publicado'),
 ('crm.relatorios.conversao','/dashboard/crm/relatorios','Relatórios','Conversão do funil','Nada a preencher: quantos negócios chegaram a cada etapa.','Mostra onde a venda trava.','100 contatos → 40 propostas → 12 ganhos.','—','crm',3,'publicado'),
 ('crm.relatorios.tempo','/dashboard/crm/relatorios','Relatórios','Tempo por etapa','Nada a preencher: média de dias que o negócio fica em cada etapa.','Acha o gargalo do processo.','Proposta: 8,5 dias.','—','crm',4,'publicado'),
 ('crm.relatorios.ranking','/dashboard/crm/relatorios','Relatórios','Ranking','Nada a preencher: ganhos, perdidos e valor por vendedor.','Acompanha a equipe.','—','O vendedor vê só os próprios números.','crm',5,'publicado'),
 ('crm.relatorios.motivos','/dashboard/crm/relatorios','Relatórios','Motivos de perda','Nada a preencher: por que os negócios foram perdidos.','Corrige preço, prazo ou abordagem.','Preço: 45%.','—','crm',6,'publicado')
ON CONFLICT (chave) DO NOTHING;
