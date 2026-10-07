-- ============================================================
-- HUB DE PROJETOS · catálogo PADRÃO de 11 papéis da vertical 'hub' — Decisão CEO 06/10
-- Mesmo modelo da #2057 (P&M): INSERT idempotente em rbac_papel / rbac_papel_acesso; padrão da vertical, não por empresa.
-- Subgrupos (telas do menu do Hub): hub_obras · hub_orcamentos · hub_crm · hub_medicoes · hub_viagens ·
-- hub_mao_obra · hub_compras (compras/estoque por obra) · hub_financeiro_obra (+ ge_financeiro).
-- Regras: NENHUM papel recebe 'folha'/'custo_hora' fora do direito (#2031); só o RH vê salário/encargos/custo-hora
-- (hub_mao_obra 'aprovar'); quem monta orçamento NÃO aprova (alçada: comercial/orçamentista 'editar', gestor/sócio 'aprovar').
-- Encarregado e equipe de campo: sem valores (só 'filtrar' = o que é seu). Comercial: própria comissão (hub_financeiro_obra 'filtrar').
-- Camadas seguem o CHECK existente.
-- ============================================================

INSERT INTO public.rbac_papel (slug, vertical, camada, area, nome, descricao, pode_liberar_ate, exige_registro) VALUES
 ('hub_socio','hub','propriedade',NULL,'Sócio / Diretor',
  'Tudo do Hub: obras, orçamentos, CRM, medições, viagens, compras, financeiro e margem das obras.','qualquer',false),
 ('hub_gerente_obras','hub','gerencia','obras','Gerente de obras / projetos',
  'Obras, orçamentos (aprova), medições, viagens, compras e mão de obra da obra. Sem salário/custo-hora individual.','supervisao',false),
 ('hub_engenheiro','hub','especialista','obras','Engenheiro / Responsável técnico',
  'Obras, medições e orçamentos técnicos. Sem financeiro geral nem folha.',NULL,false),
 ('hub_orcamentista','hub','especialista','orcamentos','Orçamentista / Engenharia de custos',
  'Monta orçamentos e composições. Não aprova o que monta. Sem folha.',NULL,false),
 ('hub_comercial','hub','especialista','comercial','Comercial',
  'CRM, propostas e a PRÓPRIA comissão. Sem custo de obra nem financeiro geral.',NULL,false),
 ('hub_compras','hub','especialista','suprimentos','Compras / Suprimentos',
  'Compras, cotações e estoque por obra. Sem folha nem margem.',NULL,false),
 ('hub_financeiro','hub','gerencia','financeiro','Administrativo / Financeiro',
  'Financeiro da obra, viagens (prestação de contas) e contas a pagar/receber. Sem salário individual.','supervisao',false),
 ('hub_rh','hub','especialista','rh','RH / Departamento pessoal',
  'Cadastra funções e funcionários; vê salário, encargos e custo da hora (Mão de obra). Sem financeiro geral nem margem das obras.',NULL,false),
 ('hub_encarregado','hub','supervisao','obras','Encarregado / Mestre de obras',
  'Obras e equipe sob sua responsabilidade, apontamento e medição de campo. Sem valores.',NULL,false),
 ('hub_equipe_campo','hub','operacao','obras','Equipe de campo',
  'Somente as tarefas e obras atribuídas. Sem valores.',NULL,false),
 ('hub_viewer','hub','operacao','obras','Consulta / Cliente da obra',
  'Leitura de andamento das obras liberadas. Sem valores.',NULL,false)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.rbac_papel_acesso (papel_slug, subgrupo, nivel) VALUES
-- Sócio: tudo
 ('hub_socio','hub_obras','aprovar'),('hub_socio','hub_orcamentos','aprovar'),('hub_socio','hub_crm','aprovar'),
 ('hub_socio','hub_medicoes','aprovar'),('hub_socio','hub_viagens','aprovar'),('hub_socio','hub_compras','aprovar'),
 ('hub_socio','hub_financeiro_obra','aprovar'),('hub_socio','ge_financeiro','aprovar'),
-- Gerente de obras: aprova orçamento/medição/viagem; sem mão de obra individual (folha)
 ('hub_gerente_obras','hub_obras','aprovar'),('hub_gerente_obras','hub_orcamentos','aprovar'),('hub_gerente_obras','hub_medicoes','aprovar'),
 ('hub_gerente_obras','hub_viagens','aprovar'),('hub_gerente_obras','hub_compras','editar'),('hub_gerente_obras','hub_crm','ver'),
 ('hub_gerente_obras','hub_financeiro_obra','ver'),
-- Engenheiro
 ('hub_engenheiro','hub_obras','editar'),('hub_engenheiro','hub_medicoes','editar'),('hub_engenheiro','hub_orcamentos','editar'),
 ('hub_engenheiro','hub_compras','ver'),
-- Orçamentista: monta, não aprova
 ('hub_orcamentista','hub_orcamentos','editar'),('hub_orcamentista','hub_obras','ver'),('hub_orcamentista','hub_compras','ver'),
-- Comercial: não aprova a própria proposta; própria comissão
 ('hub_comercial','hub_crm','editar'),('hub_comercial','hub_orcamentos','editar'),('hub_comercial','hub_obras','ver'),
 ('hub_comercial','hub_financeiro_obra','filtrar'),
-- Compras
 ('hub_compras','hub_compras','aprovar'),('hub_compras','hub_obras','ver'),
-- Administrativo / Financeiro
 ('hub_financeiro','hub_financeiro_obra','aprovar'),('hub_financeiro','ge_financeiro','aprovar'),('hub_financeiro','hub_viagens','aprovar'),
 ('hub_financeiro','hub_compras','ver'),('hub_financeiro','hub_obras','ver'),
-- RH: folha/custo-hora (único papel com direito); sem financeiro geral nem margem
 ('hub_rh','hub_mao_obra','aprovar'),('hub_rh','hub_obras','ver'),
-- Encarregado: sem valores
 ('hub_encarregado','hub_obras','editar'),('hub_encarregado','hub_medicoes','editar'),('hub_encarregado','hub_viagens','filtrar'),
-- Equipe de campo: só o que é seu
 ('hub_equipe_campo','hub_obras','filtrar'),('hub_equipe_campo','hub_viagens','filtrar'),
-- Consulta
 ('hub_viewer','hub_obras','filtrar')
ON CONFLICT (papel_slug, subgrupo) DO NOTHING;

-- RH passa a ver salário/cadastro na tela Mão de obra (definição viva preservada; só acrescenta 'rh' e 'rh_industrial').
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
