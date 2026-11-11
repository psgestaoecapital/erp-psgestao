-- Mão de Obra (Indústria) · /dashboard/industrial/mao-obra
-- RD-98 p3 (origem do dado): o auditor aud8 (84/95) apontou que a rota NÃO estava registrada em
--   system_screens (entrega só conta se o usuário a enxerga / se a tela é rastreável). Esta migration
--   insere a linha com a origem real do dado.
--
-- Fontes conferidas no código (src/app/dashboard/industrial/mao-obra/page.tsx):
--   tabelas (.from): folha_competencia, ind_pessoa
--   funções (.rpc): fn__pode_ver_folha (guarda de visão da folha)
--   ajuda (AjudaCampo): fn_ajuda_campo_listar (uma chamada por tela)
--
-- Idempotente (ON CONFLICT DO UPDATE dos metadados). Metadado de tela — NÃO toca dado de cliente,
-- função, RLS nem regra fiscal/financeira. Faixa de segundos do desenvolvedor_4_g (:46).

INSERT INTO public.system_screens
  (id, rota, area, titulo, modulo, estado_real, prioridade_monitoramento,
   descricao_funcional, views_consumidas, rpcs_chamadas, criado_em, atualizado_em)
VALUES
  ('dashboard.industrial_mao_obra',
   '/dashboard/industrial/mao-obra',
   'industrial',
   'Mão de Obra',
   'industrial_mao_obra',
   'pronto',
   'media',
   'Custo da folha de mão de obra por setor e competência, com totais e detalhe por pessoa.',
   ARRAY['folha_competencia','ind_pessoa']::text[],
   ARRAY['fn__pode_ver_folha','fn_ajuda_campo_listar']::text[],
   now(), now())
ON CONFLICT (id) DO UPDATE SET
  rota = EXCLUDED.rota,
  area = EXCLUDED.area,
  titulo = EXCLUDED.titulo,
  modulo = EXCLUDED.modulo,
  descricao_funcional = EXCLUDED.descricao_funcional,
  views_consumidas = EXCLUDED.views_consumidas,
  rpcs_chamadas = EXCLUDED.rpcs_chamadas,
  atualizado_em = now();
