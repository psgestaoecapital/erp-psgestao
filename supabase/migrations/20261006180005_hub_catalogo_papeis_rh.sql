-- ============================================================
-- HUB DE PROJETOS · catálogo PADRÃO de 11 papéis (vertical 'hub') — Decisão CEO 06/10
-- Mesmo modelo da P&M (#2057): só INSERT idempotente em rbac_papel / rbac_papel_acesso.
-- Subgrupos: hub_obras · hub_comercial · hub_compras · hub_financeiro · hub_campo · hub_portal · hub_mao_obra
-- Regras: salário/custo-hora só com direito (#2031) — só Sócio e RH recebem hub_mao_obra;
-- quem monta o orçamento não aprova (comercial em 'editar'); encarregado/campo/terceiro em 'filtrar' (só o que é seu).
-- 11º papel: RH / Departamento pessoal — cadastra funções e funcionários, vê salário/encargos/custo da hora,
-- sem financeiro geral nem margem das obras.
-- Também: fn__mao_obra_pode_ver_individual passa a reconhecer o RH (CREATE OR REPLACE da definição viva,
-- único acréscimo: 'rh', 'rh_industrial').
-- ============================================================

INSERT INTO public.rbac_papel (slug, vertical, camada, area, nome, descricao, pode_liberar_ate, exige_registro) VALUES
 ('hub_socio','hub','propriedade',NULL,'Sócio / Diretor',
  'Tudo: obras, orçamentos, financeiro, equipe e resultado.','qualquer',false),
 ('hub_gerente_obras','hub','gerencia','obras','Gerente de obras / projetos',
  'Todas as obras, cronograma, equipe, custo e resultado por obra; aprova medições e compras. Sem folha.','supervisao',false),
 ('hub_engenheiro','hub','especialista','obras','Engenheiro / Responsável técnico',
  'Suas obras: escopo, medições, diário de obra, qualidade, documentos técnicos e custo da obra. Sem margem da empresa, outras obras nem folha.',NULL,false),
 ('hub_encarregado','hub','operacao','campo','Encarregado / Mestre de obra',
  'Pelo celular: diário de obra, presença da equipe, pedido de material, fotos, ocorrências e horas. Sem valores.',NULL,false),
 ('hub_comercial','hub','especialista','comercial','Comercial / Orçamentista',
  'CRM, visitas, orçamentos e propostas em PDF, preço e margem do orçamento, própria comissão. Não aprova o que monta.',NULL,false),
 ('hub_compras','hub','especialista','compras','Compras / Suprimentos',
  'Cotações, ordens de compra, recebimento e estoque por obra. Sem receita nem margem.',NULL,false),
 ('hub_financeiro','hub','gerencia','financeiro','Administrativo / Financeiro',
  'Pagar/receber por obra, viagens, medições faturadas, NFS-e e centros de custo. Sem detalhe técnico.','supervisao',false),
 ('hub_campo','hub','operacao','campo','Equipe de campo (instalador, aplicador, ajudante)',
  'Própria agenda e tarefas, horas e fotos. Sem valores nem outras obras.',NULL,false),
 ('hub_terceiro','hub','operacao','obras','Terceiro / Empreiteiro',
  'Somente tarefas e medições da obra contratada.',NULL,false),
 ('hub_cliente','hub','operacao','portal','Cliente (portal)',
  'Acompanha a própria obra, quando o portal existir.',NULL,false),
 ('hub_rh','hub','gerencia','rh','RH / Departamento pessoal',
  'Cadastra funções e funcionários; vê salário, encargos e custo da hora (Mão de obra). Sem financeiro geral nem margem das obras.','supervisao',false)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.rbac_papel_acesso (papel_slug, subgrupo, nivel) VALUES
 ('hub_socio','hub_obras','aprovar'),('hub_socio','hub_comercial','aprovar'),('hub_socio','hub_compras','aprovar'),
 ('hub_socio','hub_financeiro','aprovar'),('hub_socio','hub_campo','aprovar'),('hub_socio','hub_portal','aprovar'),
 ('hub_socio','hub_mao_obra','aprovar'),
 ('hub_gerente_obras','hub_obras','aprovar'),('hub_gerente_obras','hub_compras','aprovar'),
 ('hub_gerente_obras','hub_comercial','ver'),('hub_gerente_obras','hub_financeiro','ver'),
 ('hub_gerente_obras','hub_campo','aprovar'),('hub_gerente_obras','hub_portal','editar'),
 ('hub_engenheiro','hub_obras','filtrar'),('hub_engenheiro','hub_campo','editar'),
 ('hub_encarregado','hub_campo','filtrar'),
 ('hub_comercial','hub_comercial','editar'),('hub_comercial','hub_financeiro','filtrar'),
 ('hub_compras','hub_compras','editar'),('hub_compras','hub_obras','ver'),
 ('hub_financeiro','hub_financeiro','aprovar'),
 ('hub_campo','hub_campo','filtrar'),
 ('hub_terceiro','hub_obras','filtrar'),
 ('hub_cliente','hub_portal','filtrar'),
 ('hub_rh','hub_mao_obra','aprovar')
ON CONFLICT (papel_slug, subgrupo) DO NOTHING;

-- RH enxerga salário/cadastro na Mão de obra (definição viva preservada; só entram 'rh' e 'rh_industrial')
CREATE OR REPLACE FUNCTION public.fn__mao_obra_pode_ver_individual(p_company_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NULL OR public.is_admin() OR EXISTS (
    SELECT 1 FROM user_companies uc
     WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id
       AND uc.role IN ('owner', 'socio', 'diretor', 'gerente', 'financeiro', 'admin', 'adm', 'acesso_total', 'rh', 'rh_industrial'))
$function$;

-- Grants preservados (ACL viva: postgres, authenticated, service_role); anon fora.
REVOKE ALL ON FUNCTION public.fn__mao_obra_pode_ver_individual(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn__mao_obra_pode_ver_individual(uuid) TO authenticated, service_role;
