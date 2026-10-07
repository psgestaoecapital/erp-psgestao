-- ============================================================
-- HUB DE PROJETOS · catálogo PADRÃO de 10 papéis (vertical 'hub') — Decisão CEO 06/10
-- Mesmo modelo da #2057 (pm): aditivo, só INSERT idempotente em rbac_papel / rbac_papel_acesso;
-- nenhuma linha existente é alterada. Padrão da vertical, NÃO por empresa.
-- Subgrupos (vocabulário de acesso, = telas/ações do menu do Hub):
--   hub_obras · hub_orcamentos · hub_crm · hub_medicoes · hub_viagens · hub_mao_obra
--   hub_compras (compras/estoque por obra) · hub_financeiro_obra · hub_campo (diário, presença, fotos) · hub_portal
-- Regras do CEO: NENHUM papel recebe folha/custo-hora aqui (só com direito próprio, #2031);
-- quem monta o orçamento não aprova (comercial fica em 'editar'; aprovar é da gerência/sócio — alçada existente);
-- encarregado/equipe de campo sem valores; comercial vê só a própria comissão (hub_financeiro_obra 'filtrar').
-- 'filtrar' = apenas o que é seu (suas obras/tarefas/lançamentos).
-- ============================================================

INSERT INTO public.rbac_papel (slug, vertical, camada, area, nome, descricao, pode_liberar_ate, exige_registro) VALUES
 ('hub_socio','hub','propriedade',NULL,'Sócio / Diretor',
  'Tudo do Hub: obras, orçamentos, CRM, medições, viagens, compras, financeiro e resultado por obra.','qualquer',false),
 ('hub_gerente_obras','hub','gerencia','obras','Gerente de obras / projetos',
  'Todas as obras, cronograma, equipe, custo e resultado por obra; aprova medições e compras. Sem folha.','supervisao',false),
 ('hub_engenheiro','hub','especialista','obras','Engenheiro / Responsável técnico',
  'Suas obras: escopo, medições, diário de obra, qualidade, documentos técnicos e custo da obra. Sem margem da empresa, outras obras nem folha.',NULL,false),
 ('hub_encarregado','hub','operacao','campo','Encarregado / Mestre de obra',
  'Celular: diário de obra, presença da equipe, pedido de material, fotos, ocorrências e horas. Sem valores.',NULL,false),
 ('hub_comercial','hub','especialista','comercial','Comercial / Orçamentista',
  'CRM, visitas, orçamentos e propostas em PDF, preço e margem do orçamento e a PRÓPRIA comissão. Sem resultado das obras nem financeiro geral.',NULL,false),
 ('hub_compras','hub','especialista','suprimentos','Compras / Suprimentos',
  'Cotações, ordens de compra, recebimento e estoque por obra. Sem receita nem margem.',NULL,false),
 ('hub_administrativo','hub','gerencia','financeiro','Administrativo / Financeiro',
  'Pagar/receber por obra, viagens, medições faturadas, NFS-e e centros de custo. Sem detalhe técnico.','supervisao',false),
 ('hub_equipe_campo','hub','operacao','campo','Equipe de campo (instalador, aplicador, ajudante)',
  'Própria agenda e tarefas, horas e fotos. Sem valores nem outras obras.',NULL,false),
 ('hub_terceiro','hub','operacao','obras','Terceiro / Empreiteiro',
  'Somente as tarefas e medições da obra contratada.',NULL,false),
 ('hub_cliente','hub','operacao','portal','Cliente (portal)',
  'Acompanhar a própria obra, quando o portal existir.',NULL,false)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.rbac_papel_acesso (papel_slug, subgrupo, nivel) VALUES
-- 1 Sócio: tudo
 ('hub_socio','hub_obras','aprovar'),('hub_socio','hub_orcamentos','aprovar'),('hub_socio','hub_crm','aprovar'),
 ('hub_socio','hub_medicoes','aprovar'),('hub_socio','hub_viagens','aprovar'),('hub_socio','hub_mao_obra','aprovar'),
 ('hub_socio','hub_compras','aprovar'),('hub_socio','hub_financeiro_obra','aprovar'),('hub_socio','hub_campo','aprovar'),
 ('hub_socio','hub_portal','aprovar'),
-- 2 Gerente de obras: todas as obras, aprova medições/compras/orçamento; viagens e financeiro da obra só leitura; mão de obra sem folha
 ('hub_gerente_obras','hub_obras','aprovar'),('hub_gerente_obras','hub_orcamentos','aprovar'),
 ('hub_gerente_obras','hub_crm','ver'),('hub_gerente_obras','hub_medicoes','aprovar'),
 ('hub_gerente_obras','hub_viagens','ver'),('hub_gerente_obras','hub_mao_obra','editar'),
 ('hub_gerente_obras','hub_compras','aprovar'),('hub_gerente_obras','hub_financeiro_obra','ver'),
 ('hub_gerente_obras','hub_campo','aprovar'),('hub_gerente_obras','hub_portal','editar'),
-- 3 Engenheiro: só as suas obras; custo da obra em leitura; sem margem da empresa
 ('hub_engenheiro','hub_obras','filtrar'),('hub_engenheiro','hub_medicoes','filtrar'),
 ('hub_engenheiro','hub_campo','filtrar'),('hub_engenheiro','hub_compras','ver'),
 ('hub_engenheiro','hub_financeiro_obra','filtrar'),
-- 4 Encarregado: celular, sem valores; viagem só a dele
 ('hub_encarregado','hub_campo','editar'),('hub_encarregado','hub_obras','filtrar'),
 ('hub_encarregado','hub_compras','filtrar'),('hub_encarregado','hub_viagens','filtrar'),
 ('hub_encarregado','hub_mao_obra','filtrar'),
-- 5 Comercial/Orçamentista: monta mas não aprova; própria comissão via financeiro 'filtrar'
 ('hub_comercial','hub_crm','editar'),('hub_comercial','hub_orcamentos','editar'),
 ('hub_comercial','hub_financeiro_obra','filtrar'),
-- 6 Compras: sem receita e margem (nada em financeiro_obra/orcamentos)
 ('hub_compras','hub_compras','aprovar'),('hub_compras','hub_obras','ver'),
-- 7 Administrativo/Financeiro: lança viagens, vê medições faturadas; sem detalhe técnico
 ('hub_administrativo','hub_financeiro_obra','aprovar'),('hub_administrativo','hub_viagens','editar'),
 ('hub_administrativo','hub_medicoes','ver'),('hub_administrativo','hub_compras','ver'),
-- 8 Equipe de campo: só o que é seu
 ('hub_equipe_campo','hub_campo','filtrar'),('hub_equipe_campo','hub_obras','filtrar'),
-- 9 Terceiro: só a obra contratada
 ('hub_terceiro','hub_obras','filtrar'),('hub_terceiro','hub_medicoes','filtrar'),
-- 10 Cliente/portal: só a própria obra
 ('hub_cliente','hub_portal','filtrar')
ON CONFLICT (papel_slug, subgrupo) DO NOTHING;

COMMENT ON TABLE public.rbac_papel IS
  'Catálogo de papéis por vertical (industria, pm, hub). Padrão da vertical — não é por empresa.';
