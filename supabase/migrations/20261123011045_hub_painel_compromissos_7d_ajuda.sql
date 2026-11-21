-- Hub · tela 310 (Painel de abertura, bloco "Para hoje"): blueprint §310 (relatório 01 · reunião 20/11)
-- pede o "Bloco do dia: compromissos de hoje e dos próximos 7 dias". O bloco "Para hoje" já trazia
-- aprovações pendentes e orçamentos sem retorno, mas NÃO os compromissos — o código dizia explicitamente
-- "Compromissos/tarefas entram quando a Agenda (§311) chegar". A Agenda comercial do Hub já existe
-- (erp_agendamento origem_modulo='comercial'); esta fatia acrescenta o card "Compromissos (próximos 7 dias)"
-- ao bloco "Para hoje", reaproveitando a MESMA fonte da Agenda (RD-26, não recria). Esta migration apenas
-- semeia o "?" (RD-95) do novo card.
-- Aditiva e idempotente (ON CONFLICT (chave) DO NOTHING); catálogo de ajuda, não toca dado de cliente.
-- RD-100: sem nome de outro sistema. Linguagem do usuário (gestor de obra).
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('projetos.painel.pendencias.compromissos', '/dashboard/projetos', 'Para hoje',
   'Compromissos (próximos 7 dias)',
   'Mostra quantos compromissos da Agenda comercial (visitas, reuniões, vistorias) estão marcados de hoje até os próximos 7 dias nesta empresa.',
   'Dá a visão imediata da semana para não perder reunião ou visita; clique para abrir a Agenda e ver cada compromisso.',
   'Clique para abrir a Agenda já na semana.',
   'Esperar que apareça aqui um compromisso sem data marcada: só entram os agendados com data nos próximos 7 dias.',
   'hub_projetos', 30, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
