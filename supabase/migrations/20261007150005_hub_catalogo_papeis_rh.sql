-- ============================================================
-- HUB DE PROJETOS · catálogo PADRÃO de 11 papéis (vertical 'hub') — Decisão CEO 06/10 + papel RH (Eng. Chefe 07/10)
-- Mesmo modelo da #2057 (pm). Aditivo e idempotente: INSERT ... ON CONFLICT DO NOTHING.
-- Subgrupos do Hub: hub_obras · hub_orcamentos · hub_crm · hub_medicoes · hub_viagens · hub_mao_obra ·
-- hub_compras (compras/estoque por obra) · hub_financeiro (financeiro da obra, margem/resultado) · hub_portal.
-- Regras: NENHUM papel recebe 'folha'/'custo_hora' fora do direito (#2031) — salário só no RH (hub_mao_obra 'aprovar'
-- + regra fn__mao_obra_pode_ver_individual); quem monta orçamento não aprova (comercial 'editar'; aprovação é do gerente/sócio);
-- 'filtrar' = só o que é seu (obras/tarefas atribuídas); sem hub_financeiro = sem valores.
-- ============================================================

INSERT INTO public.rbac_papel (slug, vertical, camada, area, nome, descricao, pode_liberar_ate, exige_registro) VALUES
 ('hub_socio','hub','propriedade',NULL,'Sócio / Diretor','Tudo do Hub: obras, orçamentos, CRM, medições, viagens, mão de obra, compras e financeiro.','qualquer',false),
 ('hub_gerente_obras','hub','gerencia','obras','Gerente de obras/projetos','Todas as obras, cronograma, equipe, custo e resultado por obra; aprova medições e compras. Sem folha.','supervisao',false),
 ('hub_engenheiro','hub','especialista','obras','Engenheiro / Responsável técnico','Suas obras: escopo, medições, diário, qualidade, documentos técnicos e custo da obra. Sem margem da empresa, outras obras nem folha.',NULL,false),
 ('hub_encarregado','hub','supervisao','obras','Encarregado / Mestre de obra','Celular: diário de obra, presença, pedido de material, fotos, ocorrências e horas. Sem valores.',NULL,false),
 ('hub_comercial','hub','especialista','comercial','Comercial / Orçamentista','CRM, visitas, orçamentos e propostas, preço e margem do orçamento e a PRÓPRIA comissão. Não aprova o que monta. Sem resultado das obras nem financeiro geral.',NULL,false),
 ('hub_compras','hub','especialista','suprimentos','Compras / Suprimentos','Cotações, ordens de compra, recebimento e estoque por obra. Sem receita nem margem.',NULL,false),
 ('hub_administrativo','hub','gerencia','financeiro','Administrativo / Financeiro','Pagar/receber por obra, viagens (lança), medições faturadas, NFS-e e centros de custo. Sem detalhe técnico.','supervisao',false),
 ('hub_equipe_campo','hub','operacao','obras','Equipe de campo (instalador, aplicador, ajudante)','Própria agenda e tarefas, horas e fotos. Sem valores nem outras obras.',NULL,false),
 ('hub_terceiro','hub','operacao','obras','Terceiro / Empreiteiro','Somente tarefas e medições da obra contratada.',NULL,false),
 ('hub_cliente','hub','operacao','portal','Cliente (portal)','Acompanha a própria obra, quando o portal existir.',NULL,false),
 ('hub_rh','hub','gerencia','rh','RH / Departamento pessoal','Cadastra funções e funcionários; vê salário, encargos e custo da hora (Mão de obra). Sem financeiro geral nem margem das obras.',NULL,false)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.rbac_papel_acesso (papel_slug, subgrupo, nivel) VALUES
 ('hub_socio','hub_obras','aprovar'),('hub_socio','hub_orcamentos','aprovar'),('hub_socio','hub_crm','aprovar'),
 ('hub_socio','hub_medicoes','aprovar'),('hub_socio','hub_viagens','aprovar'),('hub_socio','hub_mao_obra','aprovar'),
 ('hub_socio','hub_compras','aprovar'),('hub_socio','hub_financeiro','aprovar'),('hub_socio','hub_portal','aprovar'),
 ('hub_gerente_obras','hub_obras','aprovar'),('hub_gerente_obras','hub_orcamentos','ver'),('hub_gerente_obras','hub_medicoes','aprovar'),
 ('hub_gerente_obras','hub_viagens','ver'),('hub_gerente_obras','hub_mao_obra','editar'),('hub_gerente_obras','hub_compras','aprovar'),
 ('hub_gerente_obras','hub_financeiro','ver'),('hub_gerente_obras','hub_portal','editar'),
 ('hub_engenheiro','hub_obras','filtrar'),('hub_engenheiro','hub_medicoes','editar'),('hub_engenheiro','hub_compras','filtrar'),
 ('hub_engenheiro','hub_financeiro','filtrar'),
 ('hub_encarregado','hub_obras','filtrar'),('hub_encarregado','hub_compras','filtrar'),('hub_encarregado','hub_viagens','filtrar'),
 ('hub_encarregado','hub_mao_obra','filtrar'),
 ('hub_comercial','hub_crm','editar'),('hub_comercial','hub_orcamentos','editar'),('hub_comercial','hub_financeiro','filtrar'),
 ('hub_compras','hub_compras','editar'),('hub_compras','hub_obras','ver'),
 ('hub_administrativo','hub_financeiro','aprovar'),('hub_administrativo','hub_viagens','aprovar'),('hub_administrativo','hub_medicoes','ver'),
 ('hub_equipe_campo','hub_obras','filtrar'),('hub_equipe_campo','hub_mao_obra','filtrar'),
 ('hub_terceiro','hub_obras','filtrar'),('hub_terceiro','hub_medicoes','filtrar'),
 ('hub_cliente','hub_portal','filtrar'),
 ('hub_rh','hub_mao_obra','aprovar')
ON CONFLICT (papel_slug, subgrupo) DO NOTHING;

-- RH enxerga salário/encargos/custo-hora: inclui o papel de RH na regra (definição viva preservada; só acrescenta 2 valores).
CREATE OR REPLACE FUNCTION public.fn__mao_obra_pode_ver_individual(p_company_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NULL OR public.is_admin() OR EXISTS (
    SELECT 1 FROM user_companies uc
     WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id
       AND uc.role IN ('owner', 'socio', 'diretor', 'gerente', 'financeiro', 'admin', 'adm', 'acesso_total', 'rh_industrial', 'hub_rh'))
$function$;

REVOKE ALL ON FUNCTION public.fn__mao_obra_pode_ver_individual(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn__mao_obra_pode_ver_individual(uuid) TO authenticated, service_role;
