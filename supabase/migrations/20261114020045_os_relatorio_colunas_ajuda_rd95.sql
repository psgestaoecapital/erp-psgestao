-- RD-95: "?" por COLUNA da lista "Ordens do período" em /dashboard/os/relatorio.
-- O auditor (aud8) apontou que as colunas Nº/Data/Cliente/Placa/Situação/Serviços/Peças/Total
-- não tinham AjudaCampo. Aditiva e idempotente: INSERT ... ON CONFLICT (chave) atualiza o texto.
-- Núcleo não tocado; só catálogo de ajuda da vertical oficina.

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, vertical, ordem, o_que_preencher, para_que_serve, exemplo, erro_comum)
VALUES
  ('os.relatorio.col_numero',   '/dashboard/os/relatorio', 'Relatório de OS', 'Nº',        'oficina', 20,
   'Não preenche: é o número da ordem de serviço.',
   'Identifica cada ordem para você localizá-la na tela de Ordens de serviço.',
   'OS-00123',
   'Ordem sem número aparece como "—": ela foi salva como rascunho e ainda não recebeu numeração.'),
  ('os.relatorio.col_data',     '/dashboard/os/relatorio', 'Relatório de OS', 'Data',      'oficina', 21,
   'Não preenche: é a data que decidiu a entrada da ordem no período (abertura, conclusão ou entrega, conforme "Data usada").',
   'Mostra em que dia a ordem caiu no período filtrado.',
   '14/11/2026',
   'Esperar a data de abertura quando o filtro "Data usada" está em conclusão/entrega: troque "Data usada" no topo.'),
  ('os.relatorio.col_cliente',  '/dashboard/os/relatorio', 'Relatório de OS', 'Cliente',   'oficina', 22,
   'Não preenche: é o nome do cliente da ordem.',
   'Permite agrupar mentalmente o faturamento por cliente no período.',
   'Transportadora Silva Ltda',
   'Cliente em branco ("—"): a ordem foi aberta sem cliente vinculado.'),
  ('os.relatorio.col_placa',    '/dashboard/os/relatorio', 'Relatório de OS', 'Placa',     'oficina', 23,
   'Não preenche: é a placa do veículo atendido na ordem.',
   'Ajuda a reconhecer o veículo sem abrir a ordem.',
   'ABC1D23',
   'Placa "—" é normal em serviço que não é de veículo (ex.: venda de peça avulsa).'),
  ('os.relatorio.col_situacao', '/dashboard/os/relatorio', 'Relatório de OS', 'Situação',  'oficina', 24,
   'Não preenche: é o status atual da ordem (Orçamento, Aberta, Em execução, Pronta, Entregue etc.).',
   'Mostra em que etapa a ordem está. Ordens canceladas e excluídas não entram neste relatório.',
   'Entregue',
   'Somar "Total" esperando só o que foi faturado: há situações ainda em aberto (Orçamento/Aberta) no período.'),
  ('os.relatorio.col_servicos', '/dashboard/os/relatorio', 'Relatório de OS', 'Serviços',  'oficina', 25,
   'Não preenche: é a soma dos serviços (mão de obra) daquela ordem.',
   'Separa o quanto veio de mão de obra, sem as peças.',
   'R$ 450,00',
   'Confundir com o Total: Serviços é só a mão de obra; o Total soma serviços + peças.'),
  ('os.relatorio.col_pecas',    '/dashboard/os/relatorio', 'Relatório de OS', 'Peças',     'oficina', 26,
   'Não preenche: é a soma das peças aplicadas naquela ordem.',
   'Separa o quanto veio de peças, sem a mão de obra.',
   'R$ 320,00',
   'Confundir com o Total: Peças é só o material; o Total soma serviços + peças.'),
  ('os.relatorio.col_total',    '/dashboard/os/relatorio', 'Relatório de OS', 'Total',     'oficina', 27,
   'Não preenche: é o total da ordem = serviços + peças.',
   'É o valor cheio de cada ordem no período.',
   'R$ 770,00',
   'O Total pode não bater com o recebido se houver desconto aplicado fora desta tela.')
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, atualizado_em = now();
