-- Oficina · tela "Pátio" (/dashboard/oficina/patio) — ajuda de campo "?" (RD-95).
-- Code: jordana-code.
--
-- Contexto: o Pátio mostra os veículos em atendimento e deixa designar mecânico, filtrar
-- por mecânico e remover/cancelar OS do pátio. Três campos da tela ainda não tinham o "?"
-- obrigatório (RD-95): o filtro por mecânico do cabeçalho, o campo de designar mecânico e o
-- motivo do cancelamento ao remover do pátio. Esta fatia semeia só as chaves de ajuda — NÃO
-- cria/altera tabela, função, RLS nem dado de cliente.
--
-- Aditiva e idempotente: INSERT ... ON CONFLICT (chave) DO NOTHING. erp_ajuda_campo é
-- catálogo global de ajuda (sem company_id, sem dado pessoal). Não altera linha existente.
-- RD-100: texto em marca própria, sem nome de sistema de terceiros.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem)
VALUES
  ('oficina.patio.filtro_mecanico', '/dashboard/oficina/patio', 'Filtros', 'oficina',
   'Filtrar por mecânico',
   'Escolha um mecânico para ver só os veículos do pátio em que ele é responsável ou auxiliar. "Todos os mecânicos" mostra o pátio inteiro.',
   'Ajuda cada mecânico (ou o gestor) a focar na própria fila de serviço sem procurar no pátio todo.',
   'Selecione o nome do mecânico para ver apenas os veículos designados a ele.',
   'Achar que o veículo sumiu: ele só está oculto pelo filtro. Volte para "Todos os mecânicos" para ver o pátio completo.', 1),

  ('oficina.patio.designar_mecanico', '/dashboard/oficina/patio', 'Designar mecânico', 'oficina',
   'Mecânico',
   'Escolha um mecânico já cadastrado na lista acima ou digite o nome. Depois clique em "Responsável" (o principal da OS) ou "+ Auxiliar" (quem ajuda).',
   'Define quem executa o serviço e alimenta a fila de cada mecânico e o histórico do veículo.',
   'Clique no nome do mecânico e em "Responsável" para designá-lo como principal da OS.',
   'Digitar um nome livre sem ligar ao cadastro: a fila do mecânico pode não reconhecer. Prefira escolher um nome da lista.', 2),

  ('oficina.patio.remover_motivo', '/dashboard/oficina/patio', 'Remover do pátio', 'oficina',
   'Motivo do cancelamento',
   'Quando a OS já tem lançamento, remover do pátio exige cancelar a OS. Descreva aqui o motivo do cancelamento (texto obrigatório).',
   'Fica registrado junto ao cancelamento, preservando o histórico financeiro e explicando por que o veículo saiu do pátio.',
   'Ex.: "cliente desistiu do serviço" ou "orçamento não aprovado".',
   'Tentar remover sem motivo: o cancelamento da OS com lançamento só é concluído com o motivo preenchido.', 3)
ON CONFLICT (chave) DO NOTHING;
