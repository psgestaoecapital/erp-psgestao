-- Tarefas e vídeos (Indústria) · /dashboard/produtividade/tarefas
-- RD-98 p3 (origem do dado): o auditor aud8 (66/95) apontou views_consumidas VAZIO (NULL). A tela lê 8
--   tabelas e chama 7 funções + fn_ajuda_campo_listar. Esta migration preenche a origem real e completa
--   as rpcs (faltavam fn_prod_tarefa_cronometro_salvar e fn_ajuda_campo_listar).
--
-- Fontes conferidas no código (src/app/dashboard/produtividade/tarefas/page.tsx):
--   tabelas (.from): industrial_plants, prod_cargo, prod_fluxo, prod_fluxo_etapa, prod_posto,
--                    prod_tarefa_tempo, prod_tarefa_video, prod_video_consentimento
--   funções (.rpc): fn_prod_tarefa_listar, fn_prod_tarefa_salvar, fn_prod_tarefa_arquivar,
--                   fn_prod_tarefa_cronometro_salvar, fn_prod_video_consentimento_salvar,
--                   fn_prod_video_subir, fn_prod_video_acesso_registrar (já registrada), fn_ajuda_campo_listar
--
-- Idempotente (define os arrays exatos) e escopada só a esta rota. Metadado de tela — NÃO toca dado de
-- cliente, função, RLS nem regra fiscal/financeira. Faixa de segundos do desenvolvedor_4_g (:50).

UPDATE public.system_screens
SET views_consumidas = ARRAY['industrial_plants','prod_cargo','prod_fluxo','prod_fluxo_etapa','prod_posto','prod_tarefa_tempo','prod_tarefa_video','prod_video_consentimento']::text[],
    rpcs_chamadas = ARRAY['fn_prod_tarefa_listar','fn_prod_tarefa_salvar','fn_prod_tarefa_arquivar','fn_prod_tarefa_cronometro_salvar','fn_prod_video_consentimento_salvar','fn_prod_video_subir','fn_prod_video_acesso_registrar','fn_ajuda_campo_listar']::text[],
    atualizado_em = now()
WHERE rota = '/dashboard/produtividade/tarefas';
