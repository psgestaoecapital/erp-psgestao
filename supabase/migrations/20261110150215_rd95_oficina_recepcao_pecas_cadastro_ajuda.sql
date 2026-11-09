-- RD-95: "?" nos campos restantes da recepção /dashboard/oficina/recepcao.
-- O check-in automotivo já tinha "?" em todos os campos; faltavam os campos do ramo PEÇA/RETÍFICA
-- (objeto, material, medidas, quantidade, motor de origem) e os do CADASTRO INLINE do cliente
-- (nome, documento, telefone). Aditiva/idempotente; nenhuma mudança em RLS/cálculo/dado de cliente.
-- Faixa dev7claudeps (segundos :15).

INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
  ('oficina.recepcao.objeto', '/dashboard/oficina/recepcao', 'Oficina', 'Peça/trabalho a receber',
   'Descreva a peça ou o trabalho que está chegando (ex.: cabeçote, bloco, virabrequim).',
   'Identifica o item da OS quando não há veículo com placa (retífica/usinagem); sem isso não dá para abrir a OS nem orçar.',
   'Ex.: "Cabeçote AP 1.8".',
   'Deixar em branco — sem descrever o item, a OS não pode ser aberta.',
   'oficina', 20, 'publicado'),

  ('oficina.recepcao.material', '/dashboard/oficina/recepcao', 'Oficina', 'Material',
   'Informe o material da peça, se souber (alumínio, ferro fundido, aço).',
   'Ajuda a dimensionar o serviço e o tratamento adequado na usinagem.',
   'Ex.: "alumínio".',
   'Confundir material com a marca do motor — aqui é a composição da peça.',
   'oficina', 21, 'publicado'),

  ('oficina.recepcao.medidas', '/dashboard/oficina/recepcao', 'Oficina', 'Medidas / specs',
   'Anote medidas ou especificações relevantes da peça (diâmetro, folga, sobremedida).',
   'Registra os parâmetros técnicos que o mecânico usa na execução e conferência.',
   'Ex.: "Ø 82,00mm".',
   'Misturar vírgula/ponto em medidas — padronize como no instrumento de medição.',
   'oficina', 22, 'publicado'),

  ('oficina.recepcao.quantidade', '/dashboard/oficina/recepcao', 'Oficina', 'Quantidade',
   'Informe quantas peças iguais estão chegando nesta OS.',
   'Permite orçar e controlar o serviço por quantidade (ex.: 4 bielas).',
   'Ex.: "4".',
   'Deixar 1 quando há várias peças — a contagem afeta o orçamento.',
   'oficina', 23, 'publicado'),

  ('oficina.recepcao.motor_origem', '/dashboard/oficina/recepcao', 'Oficina', 'Motor / veículo de origem',
   'Opcional: de qual motor ou veículo veio a peça, para rastreio.',
   'Guarda a origem da peça para histórico e identificação futura.',
   'Ex.: "motor AP 1.8 / Gol G4".',
   'Preencher com o cliente em vez do motor — aqui é a origem da peça.',
   'oficina', 24, 'publicado'),

  ('oficina.recepcao.cad_nome', '/dashboard/oficina/recepcao', 'Oficina', 'Nome / Razão social do novo cliente',
   'Nome completo (pessoa) ou razão social (empresa) do cliente a cadastrar na hora.',
   'Cria o cadastro do cliente sem sair da recepção e já o vincula à OS.',
   'Ex.: "João da Silva" ou "Auto Peças Ltda".',
   'Abreviar o nome — use o nome como no documento para localizar depois.',
   'oficina', 60, 'publicado'),

  ('oficina.recepcao.cad_documento', '/dashboard/oficina/recepcao', 'Oficina', 'Documento do novo cliente',
   'Campo preenchido automaticamente com o CPF/CNPJ que você digitou na busca (somente leitura).',
   'Garante que o cadastro novo use o mesmo documento pesquisado, sem redigitar.',
   'Ex.: "12.345.678/0001-90".',
   'Tentar editar aqui — para trocar o documento, volte e refaça a busca.',
   'oficina', 61, 'publicado'),

  ('oficina.recepcao.cad_telefone', '/dashboard/oficina/recepcao', 'Oficina', 'Telefone do novo cliente',
   'Opcional: telefone/WhatsApp do cliente para contato e avisos da OS.',
   'Permite falar com o cliente e enviar o andamento/histórico depois.',
   'Ex.: "(66) 99999-0000".',
   'Esquecer o DDD — sem ele não dá para discar/enviar WhatsApp corretamente.',
   'oficina', 62, 'publicado')
ON CONFLICT (chave) DO NOTHING;
