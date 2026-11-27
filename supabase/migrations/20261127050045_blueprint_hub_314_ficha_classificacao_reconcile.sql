-- RD-38 · Reconciliação de baseline do blueprint vivo — tela 314 (Obra como cadastro central)
-- Dois requisitos de CLASSIFICAÇÃO da ficha da obra já estão IMPLEMENTADOS e PROVADOS no dado,
-- mas seguiam marcados como "parcial". Esta migration só corrige o status_baseline — nada de
-- código novo, nenhuma tabela/coluna, nenhum dado de cliente tocado. Aditiva e idempotente.
--
-- Prova (RD-38, produção, 21/11/2026):
--   Tela /dashboard/projetos/obras/[id]/ficha grava/lê via fn_obra_ficha_salvar / fn_obra_ficha_ler.
--   • projetos_obras.tipo_execucao      -> valores persistidos: propria=1, terceiros=4
--   • projetos_obras.modelo_contratacao -> administracao=1, empreitada_global=2, empreitada_preco_unitario=2
--   Os valores batem exatamente com as opções da tela; fn_obra_ficha_ler retorna os dois campos.
--
-- Requisitos reconciliados (parcial -> atendido):
--   1dd6b44a-a1c0-4b76-99a9-5f34a14bf5e5
--     "Identificar se a obra é própria ou gerenciada para terceiros. [escopo 2]"
--     -> select "Execução da obra": Própria (propria) × Para terceiros (terceiros). Captura completa.
--   0bbdfa1f-c804-4f70-b0be-e9227576cc39
--     "Modelo de contratação da obra (administração, empreitada global, empreitada por preço
--      unitário, outro)..." -> select "Modelo de contratação" com as 4 opções exatas; o valor
--      alimenta o Resultado por obra (v_obra_resultado). Captura completa.
--   773c43c7-f056-4601-800d-922c308fee3d
--     "Tipos de local padrão da estrutura física: pavimento · unidade autônoma · ambiente/área
--      comum · fachada · zona/bloco · equipamento (ex.: elevador). Tabela projetos_local_tipo."
--     -> tabela projetos_local_tipo existe e está semeada com os 6 tipos exatos (ordem 1..6):
--        pavimento, unidade, ambiente, fachada, zona, equipamento. Catálogo completo.

UPDATE public.blueprint_tela_requisito
   SET status_baseline = 'atendido'
 WHERE vertical = 'hub_projetos'
   AND tela_num = 314
   AND id IN (
     '1dd6b44a-a1c0-4b76-99a9-5f34a14bf5e5',
     '0bbdfa1f-c804-4f70-b0be-e9227576cc39',
     '773c43c7-f056-4601-800d-922c308fee3d'
   )
   AND status_baseline IS DISTINCT FROM 'atendido';
