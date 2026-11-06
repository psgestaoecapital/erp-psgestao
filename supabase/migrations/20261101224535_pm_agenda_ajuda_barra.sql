-- PDCA P&M · /dashboard/pm/agenda (aud8 90/95) — RD-95 "?" nos controles da BARRA
-- Gap do auditor (31/10): os 11 AjudaCampo da tela estavam TODOS dentro do modal de
-- criar/editar evento. Faltava "?" no toggle "Minha agenda/Equipe", no seletor de
-- período (dia/semana/mês), no botão "+ Novo" e na ação de mudar status no cartão.
-- Aditivo: só INSERT de chaves novas em erp_ajuda_campo (tabela de referência global),
-- idempotente por ON CONFLICT (chave). Nenhum dado de cliente é tocado.
INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('pm.agenda.filtro_quem', '/dashboard/pm/agenda', 'Agenda · Barra',
   'Minha agenda / Equipe',
   'Escolha entre ver só os seus compromissos ("Minha agenda") ou os de todo o time ("Equipe").',
   'Filtra os eventos exibidos no calendário. "Minha agenda" mostra os eventos em que você é o responsável (ou que criou sem responsável); "Equipe" mostra os de todos.',
   'Em "Minha agenda" você vê a sua reunião das 14h; em "Equipe" aparecem também as reuniões dos colegas no mesmo dia.',
   'Achar que a agenda está vazia quando na verdade você está em "Minha agenda" e o evento é de outro responsável — troque para "Equipe".',
   'pm', 10),
  ('pm.agenda.filtro_periodo', '/dashboard/pm/agenda', 'Agenda · Barra',
   'Período (dia / semana / mês)',
   'Escolha a janela de tempo do calendário: um único dia, a semana (seg–dom) ou o mês inteiro.',
   'Define quantos dias o calendário carrega e como os eventos são agrupados. Use as setas ← → ao lado para avançar/voltar no período escolhido.',
   'Em "semana" você vê os 7 dias lado a lado; em "mês" vê a grade do mês com os pontos coloridos por status.',
   'Procurar um evento de outro dia sem trocar o período ou sem usar as setas ← → — o calendário só mostra o período atual.',
   'pm', 11),
  ('pm.agenda.novo_evento', '/dashboard/pm/agenda', 'Agenda · Barra',
   'Novo evento (+ Novo)',
   'Clique para abrir o formulário de um novo compromisso: título, data, horário, cliente/lead, responsável, local e link da reunião.',
   'Cria um agendamento comercial (reunião, visita, call) que passa a aparecer no calendário e pode virar Ordem de Serviço.',
   'Marcar "Reunião de alinhamento" na quinta às 10h, vinculada ao lead "Construtora X".',
   'Clicar em "+ Novo" sem informar o título — o sistema exige o título para salvar.',
   'pm', 12),
  ('pm.agenda.cartao_status', '/dashboard/pm/agenda', 'Agenda · Barra',
   'Status do evento (confirmar / concluir / cancelar)',
   'Use os botões no rodapé do cartão para mudar o andamento do compromisso sem abrir o evento.',
   'Atualiza o status (Agendado → Confirmado → Concluído, ou Cancelado), refletido na cor da borda e no chip do cartão e nos relatórios da agenda.',
   'Depois da reunião acontecer, clique em "concluir"; se o cliente desmarcou, clique em "cancelar".',
   'Marcar "concluir" num evento que ainda não aconteceu — isso distorce os indicadores de agenda do período.',
   'pm', 13)
ON CONFLICT (chave) DO NOTHING;
