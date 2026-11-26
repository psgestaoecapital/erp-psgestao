-- RD-95: "?" dos campos da tela EHS · EPI › Estoque (/dashboard/ehs/epi/estoque).
-- Só ADITIVA e idempotente: chaves novas em erp_ajuda_campo (ON CONFLICT (chave) DO NOTHING).
-- Nenhuma função, policy, grant ou dado de cliente é alterado — a tela já usa o backend existente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/ehs/epi/estoque', 'ehs', 'publicado'
FROM (VALUES
 ('compliance.epi.estoque.entrada_epi', 'Entrada de estoque', 'EPI',
  'Escolha qual EPI vai receber entrada de estoque. A lista traz os EPIs da sua empresa e o Catálogo Global PS, cada um com o número do CA.',
  'Define o item cujo saldo será aumentado. O saldo é controlado por EPI + localização; o lote é registrado depois, na entrega ao funcionário (NR-6).',
  'Luva nitrílica (CA 12345).',
  'Escolher um EPI parecido com CA diferente: o saldo entra no item errado. Confira o número do CA.', 10),
 ('compliance.epi.estoque.entrada_quantidade', 'Entrada de estoque', 'Quantidade',
  'Quantas unidades estão entrando no estoque agora. Número inteiro, a partir de 1.',
  'Soma ao saldo do EPI na localização informada.',
  '50.',
  'Lançar aqui uma saída/entrega: esta tela é só ENTRADA; a baixa é feita na entrega ao funcionário.', 20),
 ('compliance.epi.estoque.entrada_localizacao', 'Entrada de estoque', 'Localização',
  'Onde o EPI fica guardado. O saldo é por EPI + localização, então use sempre o mesmo nome ao repor o mesmo local.',
  'Separa o saldo por depósito/almoxarifado; a mesma localização soma, nomes diferentes criam saldos separados.',
  'Almoxarifado Sede.',
  'Escrever o local de formas diferentes ("Sede" x "Almoxarifado Sede"): o saldo fica dividido em dois lugares.', 30),
 ('compliance.epi.estoque.minimo_alerta', 'Alerta de estoque', 'Quantidade mínima de alerta',
  'Saldo a partir do qual o EPI entra no alerta de estoque baixo. Use 0 para não alertar.',
  'Quando o saldo da localização fica igual ou abaixo deste número, o item aparece como estoque baixo para reposição.',
  '10 — abaixo disso, repor.',
  'Deixar alto demais: tudo fica sempre em alerta e o aviso perde o sentido.', 40)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
