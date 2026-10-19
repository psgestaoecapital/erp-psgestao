-- Chamado #1736 (FC Pisos · conector Banco do Brasil): o formulário de conexão bancária ganhou os campos do BB
-- (chave da aplicação, agência, convênio e carteira). Esta migration só traz o texto do "?" (RD-95) desses campos.
-- Aditiva: INSERT em erp_ajuda_campo com ON CONFLICT DO NOTHING. Sem função, view, policy, UPDATE ou DELETE.

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, status)
VALUES
 ('banco.api_key', '/dashboard/financeiro/conexoes-bancarias', 'Conexões bancárias', 'Chave da aplicação',
  'A chave da aplicação que o banco gera no portal do desenvolvedor. No Banco do Brasil: BB Developers › sua aplicação › Credenciais (developer_application_key).',
  'Identifica a sua aplicação em cada chamada ao banco, junto com o Client ID e o Client Secret. Fica guardada cifrada e nunca volta para a tela.',
  'Uma sequência longa de letras e números copiada do portal, sem espaços.',
  'Colar a chave do ambiente de testes (homologação) numa conexão de produção, ou o Client ID no lugar da chave: o teste de conexão recusa.',
  'financeiro', 'publicado'),
 ('banco.agencia', '/dashboard/financeiro/conexoes-bancarias', 'Conexões bancárias', 'Agência',
  'O número da agência da conta, com ou sem o dígito.',
  'Junto com o número da conta, diz ao banco de qual conta buscar o extrato.',
  '1505-2 ou 1505.',
  'Informar a agência de outra conta da empresa: o extrato vem vazio ou o banco recusa.',
  'financeiro', 'publicado'),
 ('banco.convenio', '/dashboard/financeiro/conexoes-bancarias', 'Conexões bancárias', 'Convênio de cobrança',
  'O número do convênio de cobrança contratado com o banco (7 dígitos no BB). Está no contrato de cobrança ou com o gerente.',
  'Só é usado para emitir boleto. Para buscar o extrato pode ficar em branco.',
  '3128557.',
  'Usar o número da conta no lugar do convênio: o boleto não é registrado.',
  'financeiro', 'publicado'),
 ('banco.carteira', '/dashboard/financeiro/conexoes-bancarias', 'Conexões bancárias', 'Carteira / variação',
  'A carteira e a variação do convênio de cobrança, separadas por barra.',
  'Só é usada para emitir boleto, junto com o convênio.',
  '17/35.',
  'Informar só a carteira, sem a variação: o banco recusa o registro do boleto.',
  'financeiro', 'publicado')
ON CONFLICT (chave) DO NOTHING;
