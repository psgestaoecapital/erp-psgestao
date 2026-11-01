-- PDCA Hub VERMELHO · /dashboard/projetos/takeoff/acervo — "acervo não lista plantas" (func 15)
--
-- CAUSA-RAIZ (RD-38, provado no dado): a tela filtrava aps_status IN ('radiografado','traduzindo') e
--   ESCONDIA as plantas com status null. A DEMO Construtora (b0700000-0000-4000-a000-000000000006) tem
--   4 plantas (todas aps_status=null, com analisado_em e orcamento_id) → acervo aparecia VAZIO apesar do
--   dado existir (RD-98 p1, dado_bate_banco=false). Outra empresa: 11 plantas, 9 null → só 2 listadas.
--
-- ESTA MIGRATION (ADITIVA — só texto de ajuda + metadado de origem; sem tabela/RLS/dado de cliente):
--   A tela (page.tsx) passa a listar TODAS as plantas não excluídas e deriva o estado do dado real
--   (analisada/processando/enviada), com busca, filtro por status, contagem e paginação.
--   (1) 4 chaves erp_ajuda_campo (RD-95 "?") dos controles novos: busca, filtro, contagem, ação.
--   (2) system_screens: origem do dado (RD-98 p3) e estado_real='pronto'.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o, v.p, v.e, v.x, v.ordem, '/dashboard/projetos/takeoff/acervo', 'hub', 'publicado'
FROM (VALUES
 ('hub.takeoff.acervo.total', 'Acervo · Contagem', 'Contagem de plantas',
  'Indicador só de leitura: quantas plantas desta empresa estão no acervo e como se dividem por status (analisada, processando, enviada).',
  'Dá o retrato do acervo de relance e confirma que as plantas enviadas estão todas aqui (nenhuma some por status).',
  '4 plantas · 2 analisada(s) · 0 processando · 2 enviada(s).',
  'Achar que o acervo está vazio quando há plantas "enviadas" (sem análise ainda): elas também aparecem na lista.',
  1),
 ('hub.takeoff.acervo.busca', 'Acervo · Busca', 'Buscar planta',
  'Digite parte do nome da planta, do projeto ou do cliente para filtrar a lista.',
  'Encontra rápido uma planta específica no acervo sem rolar a lista inteira.',
  'Digitar "Vista Verde" mostra só as plantas desse projeto/cliente.',
  'Esperar busca por conteúdo do desenho: a busca é pelo nome da planta, do projeto e do cliente.',
  2),
 ('hub.takeoff.acervo.filtro_status', 'Acervo · Filtro', 'Filtrar por status',
  'Escolha um status para ver só as plantas naquele estado: Analisada (já radiografada), Processando (em análise) ou Enviada (ainda sem análise).',
  'Separa o que já está pronto do que ainda depende de processamento, para priorizar o trabalho.',
  'Selecionar "Enviada" mostra só as plantas que ainda não foram analisadas.',
  'Confundir "Enviada" com erro: é uma planta no acervo que ainda não passou pela análise.',
  3),
 ('hub.takeoff.acervo.nova', 'Acervo · Ação', 'Subir nova planta',
  'Ação: leva ao Takeoff para enviar uma nova planta (PDF/DWG) e iniciar a análise.',
  'Começa uma nova medição a partir de uma planta, sem sair do fluxo do acervo.',
  'Clicar abre o Takeoff com o enviador de planta.',
  'Procurar o envio aqui: o upload acontece no Takeoff; o acervo só guarda o que já foi enviado.',
  4)
) AS v(chave, grupo, rotulo, o, p, e, x, ordem)
ON CONFLICT (chave) DO UPDATE SET
  rotulo = EXCLUDED.rotulo, o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem,
  rota = EXCLUDED.rota, vertical = EXCLUDED.vertical, status = EXCLUDED.status;

UPDATE public.system_screens
   SET views_consumidas = ARRAY['erp_obra_planta']::text[],
       rpcs_chamadas = ARRAY[]::text[],
       estado_real = 'pronto'
 WHERE rota = '/dashboard/projetos/takeoff/acervo';
