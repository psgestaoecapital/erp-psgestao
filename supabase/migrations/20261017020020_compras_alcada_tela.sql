-- #1677 (B1) · Tela "Alçada de compras" (/dashboard/compras/alcada) — menu, inventário e "?" (RD-95).
-- ADITIVA: só linhas novas de catálogo (módulo, feature, tela) e textos de ajuda. Nenhuma função/view/policy muda;
-- a tela usa as RPCs da etapa A (fn_compras_alcada_obter/salvar, guarda Master) e fn_usuarios_da_empresa.

INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, layer, icone, rota, ordem, ativo, is_shared, descricao)
VALUES ('commerce_compras_alcada', 'Alçada de compras', 'commerce', 'compras', NULL, '🛡️',
        '/dashboard/compras/alcada', 187, true, true,
        'Quem aprova as solicitações de compra (principal e substituto), quantos orçamentos cada uma exige e o que libera compra urgente.')
ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome, grupo = EXCLUDED.grupo, subgrupo = EXCLUDED.subgrupo,
  icone = EXCLUDED.icone, rota = EXCLUDED.rota, ordem = EXCLUDED.ordem, ativo = true,
  is_shared = EXCLUDED.is_shared, descricao = EXCLUDED.descricao;

-- Mesmos planos da tela irmã "Config de custo" (compras).
INSERT INTO public.plan_modules (plan_id, module_id)
SELECT pm.plan_id, 'commerce_compras_alcada' FROM public.plan_modules pm
WHERE pm.module_id = 'commerce_custo_config'
  AND NOT EXISTS (SELECT 1 FROM public.plan_modules x WHERE x.plan_id = pm.plan_id AND x.module_id = 'commerce_compras_alcada');

INSERT INTO public.feature_catalog (id, module_id, area, titulo, descricao_executiva, status, percentual_pronto)
VALUES ('F.commerce.compras_alcada', 'commerce_compras_alcada', 'commerce', 'Alçada de compras',
        'Configuração da aprovação de compras por empresa: aprovador principal/substituto, 3 ou 1 orçamento, categorias de compra urgente.',
        'pronto', 100)
ON CONFLICT (id) DO UPDATE SET titulo = EXCLUDED.titulo, descricao_executiva = EXCLUDED.descricao_executiva;

INSERT INTO public.system_screens (id, rota, area, modulo, titulo, descricao_funcional, estado_real, prioridade_monitoramento,
  rpcs_chamadas, componentes_principais, features_relacionadas)
VALUES ('commerce_compras_alcada', '/dashboard/compras/alcada', 'commerce', 'commerce_compras_alcada', 'Alçada de compras',
  'Configuração da alçada de compras da empresa (#1677): aprovador principal e substituto, nº de orçamentos (3 ou 1), categorias liberadas para compra urgente. Só Master grava; demais em leitura.',
  'pronto', 'media',
  ARRAY['fn_compras_alcada_obter','fn_compras_alcada_salvar','fn_usuarios_da_empresa']::text[],
  ARRAY['AlcadaComprasPage']::text[], ARRAY['F.commerce.compras_alcada']::text[])
ON CONFLICT (id) DO UPDATE SET titulo = EXCLUDED.titulo, descricao_funcional = EXCLUDED.descricao_funcional,
  rpcs_chamadas = EXCLUDED.rpcs_chamadas, features_relacionadas = EXCLUDED.features_relacionadas, atualizado_em = now();

INSERT INTO public.screen_route_features (screen_id, feature_id, peso, visibilidade)
SELECT 'commerce_compras_alcada', 'F.commerce.compras_alcada', 1, 'primary'
WHERE NOT EXISTS (SELECT 1 FROM public.screen_route_features WHERE screen_id = 'commerce_compras_alcada' AND feature_id = 'F.commerce.compras_alcada');

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Alçada de compras', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/compras/alcada', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('compras.alcada.aprovador_principal','Aprovador principal','Escolha a pessoa que aprova as solicitações de compra desta empresa.','Toda solicitação de compra fica pendente até essa pessoa aprovar (ou recusar com motivo).','O gerente da oficina.','Escolher quem também faz as solicitações: quem pede não aprova a própria compra.',1),
 ('compras.alcada.aprovador_substituto','Aprovador substituto','Escolha quem aprova quando o principal não está (opcional).','Evita que as compras fiquem paradas nas férias ou ausência do aprovador principal.','O sócio.','Escolher a mesma pessoa do principal: precisam ser diferentes.',2),
 ('compras.alcada.min_orcamentos','Orçamentos exigidos','Marque 3 (padrão) ou 1 orçamento por solicitação.','A solicitação só segue para aprovação com essa quantidade de orçamentos anexados.','3 orçamentos para comparar preços.','Usar 1 sem necessidade: perde-se a comparação de preço.',3),
 ('compras.alcada.urgencia_categorias','Categorias de compra urgente','Lista das categorias de produto que podem ser compradas com urgência, sem esperar os orçamentos.','A compra urgente só é liberada se TODOS os itens forem dessas categorias; o resto passa pela aprovação normal.','Combustível, Lubrificantes.','Deixar categorias amplas demais: a aprovação deixa de valer para elas.',4),
 ('compras.alcada.incluir_categoria','Incluir categoria','Digite ou escolha uma categoria do seu cadastro de produtos e toque em Incluir.','Acrescenta a categoria à lista de compra urgente.','Lubrificantes.','Digitar um nome diferente do cadastro do produto: a categoria precisa ser a mesma.',5),
 ('compras.alcada.salvar','Salvar alçada','Toque para gravar a configuração.','Vale para as próximas solicitações; cada alteração fica no histórico com quem fez e quando.','—','Esquecer de salvar depois de mudar o aprovador.',6)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO UPDATE SET rotulo = EXCLUDED.rotulo, o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve = EXCLUDED.para_que_serve, exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  ordem = EXCLUDED.ordem, rota = EXCLUDED.rota, status = EXCLUDED.status;
