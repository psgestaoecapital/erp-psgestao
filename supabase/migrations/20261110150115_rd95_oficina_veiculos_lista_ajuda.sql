-- RD-95/RD-98: "?" na lista da tela /dashboard/oficina/veiculos.
-- A tela é uma LEITURA consolidada das OS (não há cadastro-mestre de veículo aqui; a placa/dados vivem na OS).
-- O "?" explica os indicadores de cada card (placa, passagens, veículo, cliente, KM) e a ação de tocar para o
-- histórico, e documenta onde se corrige o cadastro (na OS) — atende a recomendação do auditor (RD-98).
-- Aditiva/idempotente; nenhuma mudança em RLS/cálculo/dado de cliente. Faixa dev7claudeps (segundos :15).

INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
  ('oficina.veiculos.lista', '/dashboard/oficina/veiculos', 'Oficina', 'Lista de veículos',
   'Toque num card para abrir o histórico completo do veículo. Cada card mostra a placa, o número de passagens, o veículo, o cliente e o último KM.',
   'Reúne os veículos que já passaram pela oficina (montados a partir das OS com placa preenchida) para consultar histórico, KM e contatos.',
   'Toque no card "ABC1D23 · 3 passagens" para ver todas as OS daquele veículo.',
   'Procurar aqui um "cadastro de veículo" para incluir/excluir — esta tela é consulta; a placa e os dados são mantidos na OS/recepção do veículo.',
   'oficina', 3, 'publicado')
ON CONFLICT (chave) DO NOTHING;
