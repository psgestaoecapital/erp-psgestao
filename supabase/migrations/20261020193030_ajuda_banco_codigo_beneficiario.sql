-- Chamado #3864 (R.R Serviços · Sicoob): a tela de conexão bancária passou a ter o campo próprio "Código do beneficiário",
-- separado do "Convênio de cobrança". Esta migration traz o texto do "?" (RD-95) do campo novo.
-- Aditiva: INSERT em erp_ajuda_campo com ON CONFLICT DO NOTHING. Sem função, view, policy, UPDATE ou DELETE.

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, status)
VALUES
 ('banco.codigo_beneficiario', '/dashboard/financeiro/conexoes-bancarias', 'Conexões bancárias', 'Código do beneficiário',
  'O código do beneficiário da sua cobrança no banco. No Sicoob: internet banking, em Cobrança.',
  'Identifica quem recebe o boleto. No Sicoob é um número diferente do convênio de cobrança, e os dois são usados para emitir boleto.',
  '5795443.',
  'Digitar aqui o número do convênio (ou o contrário): o aviso de campo faltando não some e o boleto não é registrado.',
  'financeiro', 'publicado')
ON CONFLICT (chave) DO NOTHING;
