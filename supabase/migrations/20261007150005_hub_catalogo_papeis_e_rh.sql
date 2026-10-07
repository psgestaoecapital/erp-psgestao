-- ============================================================
-- HUB DE PROJETOS · catálogo PADRÃO de 11 papéis (vertical 'hub') — Decisão CEO 06/10 (ctx a2b2d37e) + papel RH (15c9f674)
-- Mesmo modelo da #2057 (pm): INSERT idempotente em rbac_papel / rbac_papel_acesso (nada existente é alterado).
-- Subgrupos da vertical: hub_comercial (CRM, visitas, orçamentos/propostas) · hub_tecnico (engenharia, catálogo, insumos)
-- · hub_obras (obras, diário, acompanhamento) · hub_medicoes · hub_compras (compras/estoque por obra)
-- · hub_viagens · hub_mao_obra (cadastro de funções/funcionários) · hub_financeiro (custo, margem e resultado por obra)
-- · hub_portal (cliente) · ge_financeiro (pagar/receber, NFS-e, centros de custo).
-- Regras do CEO: NENHUM papel recebe 'folha'/'custo_hora' aqui (direito próprio, #2031); quem monta o orçamento não
-- aprova (comercial fica em 'editar' — a aprovação é do gerente/sócio); 'filtrar' = só o que é seu/da sua obra.
-- Parte 2: fn__mao_obra_pode_ver_individual passa a reconhecer o papel de RH (rh, rh_industrial) — o resto fica igual.
-- ============================================================

INSERT INTO public.rbac_papel (slug, vertical, camada, area, nome, descricao, pode_liberar_ate, exige_registro) VALUES
 ('hub_socio','hub','propriedade',NULL,'Sócio / Diretor',
  'Tudo do Hub: obras, orçamentos, medições, compras, financeiro e resultado por obra.','qualquer',false),
 ('hub_gerente_obras','hub','gerencia','obras','Gerente de obras / projetos',
  'Todas as obras, cronograma, equipe, custo e resultado por obra; aprova medições e compras. Sem folha.','supervisao',false),
 ('hub_engenheiro','hub','especialista','engenharia','Engenheiro / Responsável técnico',
  'Suas obras: escopo, medições, diário de obra, qualidade, documentos técnicos e custo da obra. Sem margem da empresa, outras obras nem folha.',NULL,false),
 ('hub_encarregado','hub','supervisao','obras','Encarregado / Mestre de obra',
  'Celular: diário de obra, presença da equipe, pedido de material, fotos, ocorrências, horas e a própria viagem. Sem valores.',NULL,false),
 ('hub_comercial','hub','especialista','comercial','Comercial / Orçamentista',
  'CRM, visitas, orçamentos e propostas em PDF, preço e margem do orçamento e a PRÓPRIA comissão. Não aprova o que monta. Sem resultado das obras nem financeiro geral.',NULL,false),
 ('hub_compras','hub','especialista','compras','Compras / Suprimentos',
  'Cotações, ordens de compra, recebimento e estoque por obra. Sem receita nem margem.',NULL,false),
 ('hub_administrativo','hub','gerencia','financeiro','Administrativo / Financeiro',
  'Pagar/receber por obra, viagens (lança), medições faturadas, NFS-e e centros de custo. Sem detalhe técnico.','supervisao',false),
 ('hub_equipe_campo','hub','operacao','obras','Equipe de campo (instalador, aplicador, ajudante)',
  'Própria agenda e tarefas, horas e fotos. Sem valores nem outras obras.',NULL,false),
 ('hub_terceiro','hub','operacao','obras','Terceiro / Empreiteiro',
  'Somente tarefas e medições da obra contratada.',NULL,false),
 ('hub_cliente','hub','operacao','portal','Cliente (portal)',
  'Acompanha a própria obra, quando o portal existir.',NULL,false),
 ('hub_rh','hub','gerencia','rh','RH / Departamento pessoal',
  'Cadastra funções e funcionários; vê salário, encargos e custo da hora (Mão de obra). Sem financeiro geral nem margem das obras.','supervisao',false)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.rbac_papel_acesso (papel_slug, subgrupo, nivel) VALUES
-- 1 Sócio: tudo
 ('hub_socio','hub_comercial','aprovar'),('hub_socio','hub_tecnico','aprovar'),('hub_socio','hub_obras','aprovar'),
 ('hub_socio','hub_medicoes','aprovar'),('hub_socio','hub_compras','aprovar'),('hub_socio','hub_viagens','aprovar'),
 ('hub_socio','hub_mao_obra','aprovar'),('hub_socio','hub_financeiro','aprovar'),('hub_socio','hub_portal','aprovar'),
 ('hub_socio','ge_financeiro','aprovar'),
-- 2 Gerente de obras: aprova medições e compras; custo e resultado por obra; comercial só leitura; sem folha
 ('hub_gerente_obras','hub_obras','aprovar'),('hub_gerente_obras','hub_tecnico','aprovar'),
 ('hub_gerente_obras','hub_medicoes','aprovar'),('hub_gerente_obras','hub_compras','aprovar'),
 ('hub_gerente_obras','hub_viagens','editar'),('hub_gerente_obras','hub_mao_obra','editar'),
 ('hub_gerente_obras','hub_financeiro','ver'),('hub_gerente_obras','hub_comercial','ver'),('hub_gerente_obras','hub_portal','aprovar'),
-- 3 Engenheiro: só as suas obras (filtrar); custo da obra (hub_financeiro 'filtrar'), sem margem da empresa
 ('hub_engenheiro','hub_obras','filtrar'),('hub_engenheiro','hub_tecnico','editar'),
 ('hub_engenheiro','hub_medicoes','filtrar'),('hub_engenheiro','hub_financeiro','filtrar'),
-- 4 Encarregado: sem valores (nada em hub_financeiro/ge_financeiro); viagem só a dele
 ('hub_encarregado','hub_obras','filtrar'),('hub_encarregado','hub_compras','filtrar'),('hub_encarregado','hub_viagens','filtrar'),
-- 5 Comercial/Orçamentista: monta, não aprova; própria comissão via ge_financeiro 'filtrar'
 ('hub_comercial','hub_comercial','editar'),('hub_comercial','hub_tecnico','ver'),('hub_comercial','ge_financeiro','filtrar'),
-- 6 Compras: sem receita/margem (nada em hub_financeiro/ge_financeiro)
 ('hub_compras','hub_compras','aprovar'),('hub_compras','hub_obras','ver'),
-- 7 Administrativo/Financeiro: lança viagens; sem detalhe técnico
 ('hub_administrativo','ge_financeiro','aprovar'),('hub_administrativo','hub_financeiro','editar'),
 ('hub_administrativo','hub_viagens','aprovar'),('hub_administrativo','hub_medicoes','ver'),
-- 8 Equipe de campo: só o que é seu
 ('hub_equipe_campo','hub_obras','filtrar'),
-- 9 Terceiro: só a obra contratada
 ('hub_terceiro','hub_obras','filtrar'),('hub_terceiro','hub_medicoes','filtrar'),
-- 10 Cliente/portal
 ('hub_cliente','hub_portal','filtrar'),
-- 11 RH: cadastro e custo da mão de obra; sem financeiro geral nem margem
 ('hub_rh','hub_mao_obra','aprovar')
ON CONFLICT (papel_slug, subgrupo) DO NOTHING;

-- Parte 2 · RH vê salário/cadastro da Mão de obra (definição viva preservada; só a lista de papéis cresce)
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
