-- ============================================================
-- HUB DE PROJETOS · catálogo PADRÃO de 11 papéis (vertical 'hub') — Decisão CEO 06/10 (+ 11º papel RH/DP, Eng. Chefe 06/10)
-- Mesmo modelo da #2057 (pm_d0). Aditivo: INSERT idempotente em rbac_papel / rbac_papel_acesso.
-- Subgrupos do Hub: hub_obras · hub_orcamentos · hub_crm · hub_medicoes · hub_viagens · hub_mao_obra · hub_compras · hub_financeiro
-- (+ ge_financeiro existente). Regras: salário/custo-hora SÓ com direito próprio (#2031) — nenhum papel recebe 'folha' ou
-- 'custo_hora'; quem monta orçamento NÃO aprova (comercial em 'editar'; aprovação é da gerência/sócio — alçada existente).
-- Também: fn__mao_obra_pode_ver_individual passa a reconhecer o papel de RH (user_companies.role 'rh' / 'rh_industrial').
-- ============================================================

INSERT INTO public.rbac_papel (slug, vertical, camada, area, nome, descricao, pode_liberar_ate, exige_registro) VALUES
 ('hub_socio','hub','propriedade',NULL,'Sócio / Diretor',
  'Tudo do Hub: obras, orçamentos, CRM, medições, viagens, mão de obra, compras e financeiro da obra.','qualquer',false),
 ('hub_gerente_obras','hub','gerencia','obras','Gerente de obras / projetos',
  'Todas as obras, cronograma, equipe, custo e resultado por obra; aprova medições e compras. Sem folha de pagamento.','supervisao',false),
 ('hub_engenheiro','hub','especialista','obras','Engenheiro / Responsável técnico',
  'Suas obras: escopo, medições, diário de obra, qualidade, documentos técnicos e custo da obra. Sem margem da empresa, outras obras nem folha.',NULL,false),
 ('hub_encarregado','hub','operacao','obras','Encarregado / Mestre de obra',
  'Celular: diário de obra, presença da equipe, pedido de material, fotos, ocorrências e horas; só a própria viagem. Sem valores.',NULL,false),
 ('hub_comercial','hub','especialista','comercial','Comercial / Orçamentista',
  'CRM, visitas, orçamentos e propostas em PDF, preço e margem do orçamento e a PRÓPRIA comissão. Não aprova o que monta; sem resultado das obras nem financeiro geral.',NULL,false),
 ('hub_compras','hub','especialista','compras','Compras / Suprimentos',
  'Cotações, ordens de compra, recebimento e estoque por obra. Sem receita nem margem.',NULL,false),
 ('hub_financeiro','hub','gerencia','financeiro','Administrativo / Financeiro',
  'Contas a pagar e receber por obra, viagens (lança), medições faturadas, NFS-e e centros de custo. Sem detalhe técnico.','supervisao',false),
 ('hub_equipe_campo','hub','operacao','obras','Equipe de campo (instalador, aplicador, ajudante)',
  'Própria agenda e tarefas, horas e fotos. Sem valores nem outras obras.',NULL,false),
 ('hub_terceiro','hub','operacao','obras','Terceiro / Empreiteiro',
  'Somente tarefas e medições da obra contratada.',NULL,false),
 ('hub_cliente','hub','operacao','portal','Cliente (portal)',
  'Acompanha a própria obra, quando o portal existir.',NULL,false),
 ('hub_rh_dp','hub','gerencia','rh','RH / Departamento pessoal',
  'Cadastra funções e funcionários; vê salário, encargos e custo da hora (Mão de obra). Sem financeiro geral nem margem das obras.','supervisao',false)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.rbac_papel_acesso (papel_slug, subgrupo, nivel) VALUES
-- 1 Sócio: tudo
 ('hub_socio','hub_obras','aprovar'),('hub_socio','hub_orcamentos','aprovar'),('hub_socio','hub_crm','aprovar'),
 ('hub_socio','hub_medicoes','aprovar'),('hub_socio','hub_viagens','aprovar'),('hub_socio','hub_mao_obra','aprovar'),
 ('hub_socio','hub_compras','aprovar'),('hub_socio','hub_financeiro','aprovar'),('hub_socio','ge_financeiro','aprovar'),
-- 2 Gerente de obras: aprova medições e compras; custo/resultado por obra (hub_financeiro 'ver'); sem folha
 ('hub_gerente_obras','hub_obras','aprovar'),('hub_gerente_obras','hub_orcamentos','aprovar'),('hub_gerente_obras','hub_crm','ver'),
 ('hub_gerente_obras','hub_medicoes','aprovar'),('hub_gerente_obras','hub_viagens','ver'),('hub_gerente_obras','hub_mao_obra','editar'),
 ('hub_gerente_obras','hub_compras','aprovar'),('hub_gerente_obras','hub_financeiro','ver'),
-- 3 Engenheiro: só as suas obras (filtrar); custo da obra (ver)
 ('hub_engenheiro','hub_obras','filtrar'),('hub_engenheiro','hub_medicoes','filtrar'),('hub_engenheiro','hub_compras','ver'),
-- 4 Encarregado: sem valores; viagem só a dele
 ('hub_encarregado','hub_obras','filtrar'),('hub_encarregado','hub_viagens','filtrar'),('hub_encarregado','hub_compras','filtrar'),
-- 5 Comercial: monta, não aprova; própria comissão (filtrar)
 ('hub_comercial','hub_crm','editar'),('hub_comercial','hub_orcamentos','editar'),('hub_comercial','hub_financeiro','filtrar'),
-- 6 Compras: sem receita/margem
 ('hub_compras','hub_compras','editar'),('hub_compras','hub_obras','ver'),
-- 7 Administrativo/Financeiro: lança viagem; sem detalhe técnico
 ('hub_financeiro','hub_financeiro','aprovar'),('hub_financeiro','ge_financeiro','aprovar'),('hub_financeiro','hub_viagens','editar'),
 ('hub_financeiro','hub_medicoes','ver'),
-- 8 Equipe de campo: só o que é seu
 ('hub_equipe_campo','hub_obras','filtrar'),
-- 9 Terceiro: obra contratada
 ('hub_terceiro','hub_obras','filtrar'),('hub_terceiro','hub_medicoes','filtrar'),
-- 10 Cliente/portal
 ('hub_cliente','hub_obras','filtrar'),
-- 11 RH/DP: mão de obra (salário/encargos via fn__mao_obra_pode_ver_individual); sem financeiro geral
 ('hub_rh_dp','hub_mao_obra','aprovar')
ON CONFLICT (papel_slug, subgrupo) DO NOTHING;

-- RH enxerga salário/cadastro de Mão de obra (definição viva preservada; só acrescenta 'rh' e 'rh_industrial')
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

COMMENT ON TABLE public.rbac_papel IS
  'Catálogo de papéis por vertical (industria, pm, hub). Padrão da vertical — não é por empresa.';
