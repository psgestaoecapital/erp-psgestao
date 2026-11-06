-- Mapa da Infra · fatia 2 (tela): ajuda "?" (RD-95) + system_screens (RD-50). Só dado novo, aditivo.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Mapa da Infra', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/dev/infra', 'dev', 'publicado'
FROM (VALUES
 ('dev.infra.mapa','Mapa da Infra','Nada a preencher: é a visão geral dos sistemas da esteira.','Mostra cada peça (revisor, fila de merge, crons, Codes) com cor de estado, comparando o desenho esperado com o último batimento real.','Peça verde = rodou dentro da cadência.','Achar que cinza é problema: cinza = peça sem cadência definida.',1),
 ('dev.infra.estado','Estado (verde/amarelo/vermelho)','Indicador calculado, não editável.','Verde: batimento dentro da cadência. Amarelo: passou da cadência mas dentro da tolerância. Vermelho: passou da tolerância ou nunca bateu. O CEO é avisado no vermelho.','Cadência 5 min + tolerância 10 min: amarelo até 15 min, vermelho depois.','Confundir tolerância com cadência.',2),
 ('dev.infra.batimento','Último batimento','Indicador calculado.','Momento em que a peça registrou a última rodada (cron.job_run_details para crons; batimento gravado para revisor e Codes).','"há 3 min".','Estranhar "sem batimento" numa peça nova: ainda não rodou.',3),
 ('dev.infra.cadencia','Cadência (min)','De quantos em quantos minutos a peça deve rodar.','Define o limite do verde.','5 para o revisor; 60 para a aceitação da main.','Pôr em horas em vez de minutos.',4),
 ('dev.infra.tolerancia','Tolerância (min)','Minutos extras aceitos além da cadência antes de ficar vermelho.','Evita alarme falso por atraso pequeno; some ao limite do amarelo.','10.','Zerar: qualquer atraso vira vermelho.',5)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

INSERT INTO public.system_screens (id, rota, area, modulo, titulo, descricao_funcional, estado_real, prioridade_monitoramento,
  rpcs_chamadas, componentes_principais, features_relacionadas)
VALUES ('dev_infra', '/dashboard/dev/infra', 'dev', 'dev_infra', 'Mapa da Infra',
  'Fluxograma do desenho esperado da esteira (revisor, fila, crons, Codes, vagas de teste) com cor de estado, último batimento e configuração de cadência/tolerância (PS_ADMIN).',
  'parcial', 'media', ARRAY['fn_infra_mapa','fn_infra_no_configurar']::text[], ARRAY['InfraMapa']::text[], ARRAY[]::text[])
ON CONFLICT (id) DO UPDATE SET titulo = EXCLUDED.titulo, descricao_funcional = EXCLUDED.descricao_funcional,
  rpcs_chamadas = EXCLUDED.rpcs_chamadas, atualizado_em = now();
