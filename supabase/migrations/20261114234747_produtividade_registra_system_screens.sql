-- RD-98 p3 + auditabilidade: a rota /dashboard/produtividade (tela base de Produtividade:
-- setor/cargo/posto/salário base/alocação de pessoas, mapa projetado×real) NÃO estava em
-- system_screens, então fn_disparar_playwright_rota devolvia "tela_nao_encontrada" e o robô
-- aud8 não conseguia fotografá-la. Registra a rota com area='industria' (que já mapeia a
-- DEMO 005), auditável pelo robô, com a origem do dado (views/rpcs) auditada no page.tsx.
-- Aditiva/idempotente: ON CONFLICT (rota) DO NOTHING.
INSERT INTO public.system_screens
  (id, rota, area, titulo, descricao_funcional, modulo, auditavel_robo, prioridade_monitoramento, estado_real, views_consumidas, rpcs_chamadas)
VALUES (
  gen_random_uuid(),
  '/dashboard/produtividade',
  'industria',
  'Produtividade',
  'Cadastro por fluxo da indústria: setores, cargos, postos (com atividade), salário base por cargo e alocação de pessoas ao posto; visão projetado × real por posto.',
  'industrial_produtividade',
  true,
  'media',
  'pronto',
  ARRAY[
    'prod_setor','prod_cargo','prod_cargo_vinculo','prod_posto','prod_posto_turno',
    'prod_salario_base','prod_fluxo','prod_categoria_produto','prod_categoria_item',
    'prod_unidade_medida','folha_competencia','industrial_plants'
  ]::text[],
  ARRAY[
    'fn_prod_fluxo_completo','fn_prod_posto_salvar','fn_prod_posto_excluir',
    'fn_prod_cargo_do_ponto_vincular','fn_prod_sugerir_cargos','fn_prod_salario_salvar',
    'fn_prod_salario_sugerir_da_folha','fn_prod_prontidao','fn_prod_atak_produtos',
    'fn_prod_categoria_item_atribuir','fn_prod_categoria_item_remover','fn_ajuda_campo_listar'
  ]::text[]
)
ON CONFLICT (rota) DO NOTHING;
