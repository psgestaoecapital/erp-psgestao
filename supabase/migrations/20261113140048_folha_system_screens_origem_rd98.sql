-- Folha de Pagamento (Indústria) · /dashboard/industrial/folha
-- RD-98 p3 (origem do dado): o auditor aud8 (70/95) apontou que a rota NÃO estava registrada em
--   system_screens. Esta migration insere a linha com a origem real do dado.
--
-- Fontes conferidas no código (src/app/dashboard/industrial/folha/page.tsx):
--   tabelas (.from): folha_competencia, folha_verba
--   funções (.rpc): fn__pode_ver_folha (guarda de visão da folha)
--
-- Idempotente (ON CONFLICT (id) DO UPDATE). Metadado de tela — NÃO toca dado de cliente, função, RLS
-- nem regra fiscal/financeira. Faixa de segundos do desenvolvedor_4_g (:48).

INSERT INTO public.system_screens
  (id, rota, area, titulo, modulo, estado_real, prioridade_monitoramento,
   descricao_funcional, views_consumidas, rpcs_chamadas, criado_em, atualizado_em)
VALUES
  ('dashboard.industrial_folha',
   '/dashboard/industrial/folha',
   'industrial',
   'Folha de Pagamento',
   'industrial_folha',
   'pronto',
   'media',
   'Importação e consulta da folha de pagamento por competência (verbas por tipo), base do custo de mão de obra por setor.',
   ARRAY['folha_competencia','folha_verba']::text[],
   ARRAY['fn__pode_ver_folha']::text[],
   now(), now())
ON CONFLICT (id) DO UPDATE SET
  rota = EXCLUDED.rota, area = EXCLUDED.area, titulo = EXCLUDED.titulo, modulo = EXCLUDED.modulo,
  descricao_funcional = EXCLUDED.descricao_funcional,
  views_consumidas = EXCLUDED.views_consumidas, rpcs_chamadas = EXCLUDED.rpcs_chamadas,
  atualizado_em = now();
