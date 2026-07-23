-- Badges do Hub: 5 módulos estavam "Previsto" (sem linha em feature_catalog) mas são FUNCIONAIS
-- com dado real (Tryo: 10 serviços + 31 insumos + 10 funções de MO + 390 linhas de BOM; Propostas
-- redireciona pro editor de Orçamentos). Cria a linha 'pronto' (mesmo padrão de projetos_oportunidades).
-- "Engenharia" (projetos_engenharia) NÃO entra — é shell de verdade, continua Previsto.

INSERT INTO public.feature_catalog (id, module_id, area, titulo, descricao_executiva, status, percentual_pronto)
VALUES
  ('feat_projetos_catalogo','projetos_catalogo','projetos','Catálogo de Serviços (CPU)','Catálogo de serviços de engenharia com Composição de Preço Unitário e BOM.','pronto',100),
  ('feat_projetos_insumos','projetos_insumos','projetos','Insumos','Cadastro de insumos (materiais) — base das composições de custo.','pronto',100),
  ('feat_projetos_mao_obra','projetos_mao_obra','projetos','Mão de Obra','Cadastro de mão de obra/encargos — base das composições de custo.','pronto',100),
  ('feat_projetos_takeoff','projetos_takeoff','projetos','Takeoff IA (Planta)','Gera itens do orçamento a partir dos ambientes/plantas, já com BDI.','pronto',100),
  ('feat_projetos_propostas','projetos_propostas','projetos','Propostas','Ciclo de vendas com aprovação digital (redireciona para Orçamentos).','pronto',100)
ON CONFLICT (id) DO UPDATE SET status='pronto', percentual_pronto=100, titulo=EXCLUDED.titulo;
