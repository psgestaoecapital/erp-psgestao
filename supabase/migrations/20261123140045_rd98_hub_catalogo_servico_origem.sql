-- RD-98 p3 (origem do dado) · Hub de Projetos — classifica o catálogo de serviço (detalhe/edição)
-- Rota: /dashboard/projetos/catalogo/[id]  (src/app/dashboard/projetos/catalogo/[id]/page.tsx + BomEditor + ComposicaoCpu)
--
-- Defeito: system_screens dessa rota está estado_real='desconhecida' e a lista de RPCs omite o carregamento
-- principal fn_projetos_servico_completo (a tela e o BomEditor chamam essa RPC; a ComposicaoCpu usa
-- fn_servico_composicao_detalhe; o salvar do BOM usa fn_projetos_atualizar_cache_bom). Sem a origem completa
-- e sem classificação a tela não recebe o selo (pilar 3).
--
-- RD-38 (provado no dado, BEGIN..ROLLBACK): as 3 RPCs existem em pg_proc (1 overload cada); antes a condição
-- casava 1 linha ('desconhecida'); depois 0 linhas casam 'desconhecida' (idempotente).
-- Aditivo: só metadado em system_screens; não toca dado de cliente, RLS, grants nem fiscal. Não rebaixa um
-- 'completo' futuro (guard por estado_real IN desconhecida/parcial).

UPDATE public.system_screens
   SET rpcs_chamadas = ARRAY[
         'fn_projetos_servico_completo',
         'fn_servico_composicao_detalhe',
         'fn_projetos_atualizar_cache_bom'
       ],
       views_consumidas = ARRAY['projetos_servicos','projetos_servicos_bom'],
       estado_real = 'parcial'
 WHERE rota = '/dashboard/projetos/catalogo/[id]'
   AND estado_real IN ('desconhecida','parcial');
