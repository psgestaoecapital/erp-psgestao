-- RD-95: "?" nas AÇÕES da tela Prestadores (/dashboard/ehs/prestadores).
-- As colunas e a busca já tinham AjudaCampo; faltava o "?" na ação de topo "+ Novo Prestador"
-- e na ação de linha "Abrir". Esta migration é ADITIVA e idempotente: só insere as 2 chaves
-- novas em erp_ajuda_campo (ON CONFLICT (chave) DO NOTHING), sem tocar dado de cliente.
-- Faixa de segundos do agente desenvolvedor_4_g (45–54): timestamp :45.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, status)
VALUES
  (
    'compliance.prestadores.novo',
    '/dashboard/ehs/prestadores',
    'Prestadores',
    'compliance',
    '+ Novo Prestador',
    'Clique para cadastrar um prestador de serviço PJ ou MEI (razão social, CNPJ, responsável e tipo de contrato).',
    'Cria a ficha do prestador para você acompanhar a documentação de compliance (ASO, contrato, EHS) e o percentual em dia de cada um.',
    'Cadastrar a empresa terceirizada de limpeza que presta serviço na sua planta.',
    'Cadastrar o mesmo CNPJ duas vezes: busque antes na lista para não duplicar o prestador.',
    10,
    'publicado'
  ),
  (
    'compliance.prestadores.abrir',
    '/dashboard/ehs/prestadores',
    'Prestadores',
    'compliance',
    'Abrir',
    'Clique para abrir a ficha completa do prestador daquela linha.',
    'Leva à tela de detalhe, onde você vê e anexa os documentos de compliance do prestador e acompanha vencimentos.',
    'Abrir o prestador com 50% em dia para ver qual documento está faltando.',
    'Esperar editar valores na lista: a edição e os documentos ficam na ficha, que abre por aqui.',
    11,
    'publicado'
  )
ON CONFLICT (chave) DO NOTHING;
