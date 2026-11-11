-- RD-95: "?" na LISTA de seleção da tela /dashboard/oficina/diagnostico.
-- Gap do auditor: a tela de seleção (escolher qual OS diagnosticar) tinha "?" só no título, na busca e no
-- selo "já tem laudo"; faltava explicar os indicadores de cada card (placa, objeto, cliente, queixa) e a ação
-- de tocar para abrir o laudo. Aditiva/idempotente; nenhuma mudança em RLS/cálculo/dado de cliente.
-- Faixa dev7claudeps (segundos :15).

INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
  ('oficina.diagnostico.lista', '/dashboard/oficina/diagnostico', 'Oficina', 'Lista de veículos a diagnosticar',
   'Toque num card para abrir o diagnóstico daquele veículo/OS. Cada card mostra a placa, o veículo, o cliente e a queixa relatada.',
   'Escolhe qual OS do pátio receberá o laudo; o selo verde indica que a OS já tem laudo (toque para editar).',
   'Toque no card "ABC1D23 · Fiat Uno" para lançar o diagnóstico dele.',
   'Procurar um veículo que ainda não passou pela recepção — só aparecem aqui as OS ativas no pátio.',
   'oficina', 5, 'publicado')
ON CONFLICT (chave) DO NOTHING;
