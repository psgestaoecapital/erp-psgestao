-- ============================================================
-- HUB DE PROJETOS · catálogo PADRÃO de 11 papéis (vertical 'hub') — Decisão CEO 06/10 (+ papel RH, Eng. Chefe 06/10)
-- Mesmo modelo da #2057 (vertical 'pm'): INSERT idempotente em rbac_papel / rbac_papel_acesso, padrão da
-- vertical (não por empresa). Nenhuma linha existente é alterada.
-- Subgrupos (menu do Hub): hub_obras · hub_orcamentos (CRM, visitas, orçamento/proposta) · hub_medicoes ·
-- hub_viagens · hub_mao_obra (equipe/presença/horas, SEM valores) · hub_folha (salário, encargos, custo-hora) ·
-- hub_suprimentos (compras + estoque por obra) · hub_resultado (custo e resultado por obra, margem) ·
-- hub_campo (diário de obra, fotos, ocorrências, pedido de material) · hub_portal · ge_financeiro.
-- Regras do CEO: salário/custo-hora só com direito próprio (#2031) -> 'hub_folha' SÓ em Sócio e RH;
-- quem monta o orçamento não aprova (comercial = 'editar'; aprovação é do gerente/sócio — alçada existente);
-- encarregado e equipe de campo NÃO têm hub_resultado/hub_folha/ge_financeiro (sem valores);
-- comercial só a PRÓPRIA comissão (ge_financeiro 'filtrar').
-- Também: RH passa a ver salário na Mão de obra (fn__mao_obra_pode_ver_individual — CREATE OR REPLACE, resto preservado).
-- ============================================================

INSERT INTO public.rbac_papel (slug, vertical, camada, area, nome, descricao, pode_liberar_ate, exige_registro) VALUES
 ('hub_socio','hub','propriedade',NULL,'Sócio / Diretor',
  'Tudo do Hub: obras, orçamentos, medições, viagens, equipe, folha, compras, financeiro e resultado.','qualquer',false),
 ('hub_gerente_obras','hub','gerencia','obras','Gerente de obras / projetos',
  'Todas as obras, cronograma, equipe, custo e resultado por obra; aprova medições, compras e orçamentos. Sem folha.','supervisao',false),
 ('hub_engenheiro','hub','especialista','engenharia','Engenheiro / Responsável técnico',
  'Suas obras: escopo, medições, diário, qualidade, documentos técnicos e custo da obra. Sem margem da empresa, outras obras nem folha.',NULL,false),
 ('hub_encarregado','hub','operacao','campo','Encarregado / Mestre de obra',
  'Celular: diário de obra, presença da equipe, pedido de material, fotos, ocorrências e horas. Sem valores.',NULL,false),
 ('hub_comercial','hub','especialista','comercial','Comercial / Orçamentista',
  'CRM, visitas, orçamentos e propostas (preço e margem do orçamento) e a PRÓPRIA comissão. Não aprova o que monta. Sem resultado das obras nem financeiro geral.',NULL,false),
 ('hub_compras','hub','especialista','suprimentos','Compras / Suprimentos',
  'Cotações, ordens de compra, recebimento e estoque por obra. Sem receita nem margem.',NULL,false),
 ('hub_financeiro','hub','gerencia','financeiro','Administrativo / Financeiro',
  'Pagar/receber por obra, viagens, medições faturadas, NFS-e e centros de custo. Sem detalhe técnico.','supervisao',false),
 ('hub_equipe_campo','hub','operacao','campo','Equipe de campo (instalador, aplicador, ajudante)',
  'Própria agenda e tarefas, horas e fotos. Sem valores nem outras obras.',NULL,false),
 ('hub_terceiro','hub','operacao','campo','Terceiro / Empreiteiro',
  'Somente tarefas e medições da obra contratada.',NULL,false),
 ('hub_cliente','hub','operacao','portal','Cliente (portal)',
  'Acompanha a própria obra, quando o portal existir.',NULL,false),
 ('hub_rh','hub','especialista','rh','RH / Departamento pessoal',
  'Cadastra funções e funcionários; vê salário, encargos e custo da hora (Mão de obra). Sem financeiro geral nem margem das obras.',NULL,false)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.rbac_papel_acesso (papel_slug, subgrupo, nivel) VALUES
-- 1 Sócio: tudo (inclui folha: tem o direito pelo role socio)
 ('hub_socio','hub_obras','aprovar'),('hub_socio','hub_orcamentos','aprovar'),('hub_socio','hub_medicoes','aprovar'),
 ('hub_socio','hub_viagens','aprovar'),('hub_socio','hub_mao_obra','aprovar'),('hub_socio','hub_folha','aprovar'),
 ('hub_socio','hub_suprimentos','aprovar'),('hub_socio','hub_resultado','aprovar'),('hub_socio','hub_campo','aprovar'),
 ('hub_socio','hub_portal','aprovar'),('hub_socio','ge_financeiro','aprovar'),
-- 2 Gerente de obras: sem folha; GE só leitura
 ('hub_gerente_obras','hub_obras','aprovar'),('hub_gerente_obras','hub_orcamentos','aprovar'),
 ('hub_gerente_obras','hub_medicoes','aprovar'),('hub_gerente_obras','hub_viagens','editar'),
 ('hub_gerente_obras','hub_mao_obra','editar'),('hub_gerente_obras','hub_suprimentos','aprovar'),
 ('hub_gerente_obras','hub_resultado','ver'),('hub_gerente_obras','hub_campo','aprovar'),
 ('hub_gerente_obras','hub_portal','editar'),('hub_gerente_obras','ge_financeiro','ver'),
-- 3 Engenheiro: só as suas obras (filtrar); sem resultado da empresa, folha nem GE
 ('hub_engenheiro','hub_obras','filtrar'),('hub_engenheiro','hub_medicoes','filtrar'),
 ('hub_engenheiro','hub_campo','filtrar'),('hub_engenheiro','hub_suprimentos','ver'),
 ('hub_engenheiro','hub_mao_obra','filtrar'),
-- 4 Encarregado: sem valores (nada em resultado/folha/GE); viagem só a dele
 ('hub_encarregado','hub_campo','filtrar'),('hub_encarregado','hub_mao_obra','filtrar'),
 ('hub_encarregado','hub_viagens','filtrar'),('hub_encarregado','hub_obras','filtrar'),
-- 5 Comercial/Orçamentista: monta, não aprova; própria comissão
 ('hub_comercial','hub_orcamentos','editar'),('hub_comercial','ge_financeiro','filtrar'),
-- 6 Compras: sem receita/margem
 ('hub_compras','hub_suprimentos','editar'),('hub_compras','hub_obras','ver'),
-- 7 Administrativo/Financeiro: sem detalhe técnico
 ('hub_financeiro','ge_financeiro','aprovar'),('hub_financeiro','hub_viagens','aprovar'),
 ('hub_financeiro','hub_medicoes','ver'),('hub_financeiro','hub_resultado','ver'),
-- 8 Equipe de campo: só o seu
 ('hub_equipe_campo','hub_campo','filtrar'),('hub_equipe_campo','hub_mao_obra','filtrar'),
-- 9 Terceiro: só a obra contratada
 ('hub_terceiro','hub_campo','filtrar'),('hub_terceiro','hub_medicoes','filtrar'),
-- 10 Cliente/portal: só a própria obra
 ('hub_cliente','hub_portal','filtrar'),
-- 11 RH/DP: cadastra funcionários e vê folha; sem GE nem resultado das obras
 ('hub_rh','hub_mao_obra','aprovar'),('hub_rh','hub_folha','aprovar')
ON CONFLICT (papel_slug, subgrupo) DO NOTHING;

-- RH passa a ver salário/cadastro na Mão de obra: acrescenta 'rh_industrial' (nível já existente) e 'hub_rh'
-- à lista de roles. Definição viva lida em 07/10; só a lista de roles muda.
CREATE OR REPLACE FUNCTION public.fn__mao_obra_pode_ver_individual(p_company_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NULL OR public.is_admin() OR EXISTS (
    SELECT 1 FROM user_companies uc
     WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id
       AND uc.role IN ('owner', 'socio', 'diretor', 'gerente', 'financeiro', 'admin', 'adm', 'acesso_total',
                       'rh_industrial', 'hub_rh'))
$function$;
