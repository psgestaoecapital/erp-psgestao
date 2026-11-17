-- RD-95 "?" nas colunas Código, Nome no ERP e Cargo da tela Administração › Vendedores
-- (/dashboard/admin/vendedores). As demais colunas/ações já têm ajuda (vinculo/salvar/acesso).
-- Aditiva e idempotente: ON CONFLICT (chave) DO NOTHING. Sem UPDATE/DELETE de dado existente.
-- RD-100: nada de nome de sistema de terceiros — usa "ERP de origem" (termo genérico).

INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  (
    'com.vendedores.col_codigo',
    '/dashboard/admin/vendedores',
    'Meu painel de vendas',
    'Código do vendedor',
    'Não se preenche aqui: é o código do vendedor, supervisor ou gerente que chega da integração com o ERP de origem.',
    'Identifica cada pessoa da equipe comercial e é o que liga a venda ao Meu painel de vendas.',
    '80006',
    'Tentar cadastrar o código nesta tela: ele só entra pela integração do ERP de origem, não é digitado aqui.',
    'comercial',
    2,
    1,
    'publicado'
  ),
  (
    'com.vendedores.col_nome',
    '/dashboard/admin/vendedores',
    'Meu painel de vendas',
    'Nome no ERP de origem',
    'Não se preenche: é o nome como a pessoa está cadastrada no ERP de origem.',
    'Ajuda a reconhecer quem é a pessoa antes de ligá-la ao usuário do PS Gestão.',
    'João da Silva',
    'Confundir o nome do ERP de origem com o nome do usuário do PS Gestão — podem ser diferentes.',
    'comercial',
    3,
    1,
    'publicado'
  ),
  (
    'com.vendedores.col_cargo',
    '/dashboard/admin/vendedores',
    'Meu painel de vendas',
    'Cargo na equipe',
    'Não se preenche: vem do ERP de origem (vendedor, supervisor ou gerente).',
    'Define o alcance do painel: vendedor vê só a própria venda; supervisor e gerente veem a equipe abaixo deles.',
    'Supervisor',
    'Esperar que o supervisor veja só a própria venda — ele enxerga toda a equipe subordinada.',
    'comercial',
    4,
    1,
    'publicado'
  )
ON CONFLICT (chave) DO NOTHING;
