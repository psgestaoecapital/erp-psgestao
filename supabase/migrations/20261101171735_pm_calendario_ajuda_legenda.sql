-- RD-95 (CEO 08/10): "?" na legenda e no contador do Calendário de publicações (P&M) · /dashboard/pm/calendario.
-- Os 4 filtros (Visão, Ir para, Cliente, Situação do post) já tinham "?"; faltava a legenda das cores de situação e o
-- contador de posts. Auditor PDCA (auditor_pdca_2, nota 85) pediu "?" nos filtros e na legenda.
-- Aditivo: só texto em erp_ajuda_campo (sem tabela nova, sem RLS, sem dado de cliente). Idempotente (ON CONFLICT chave).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o, v.p, v.e, v.x, v.ordem, '/dashboard/pm/calendario', 'pm', 'publicado'
FROM (VALUES
 ('pm.calendario.legenda', 'Calendário · Legenda', 'Legenda (cores dos posts)',
  'Nada a preencher: cada cor é uma situação do post (ideia/rascunho, em aprovação, aprovado, publicado etc.); o mesmo ponto aparece em cada post do calendário.',
  'Permite ler o calendário de relance — a cor diz em que etapa o post está sem abrir cada um.',
  'Um dia cheio de pontos "em aprovação" mostra acúmulo na validação do cliente.',
  'Decorar a cor errada: passe o filtro "Situação do post" para isolar uma etapa quando tiver dúvida.',
  20),
 ('pm.calendario.total_posts', 'Calendário · Indicador', 'Contador de posts',
  'Nada a preencher: mostra quantos posts caem no período e no filtro exibidos agora.',
  'Dá a dimensão da carga de conteúdo do período, base para planejar a produção.',
  '"18 post(s)" na visão de mês é o total programado naquele mês com o filtro aplicado.',
  'Esperar o total do cliente inteiro: o número é só do período e do filtro na tela.',
  21)
) AS v(chave, grupo, rotulo, o, p, e, x, ordem)
ON CONFLICT (chave) DO NOTHING;
