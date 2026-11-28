-- Acessos por papéis reais + código do vendedor no cadastro (RD-95: "?" dos campos novos).
-- Só ADITIVA e idempotente: chaves novas em erp_ajuda_campo (ON CONFLICT DO NOTHING).
-- Nenhuma função, policy, grant ou dado de cliente é alterado: as telas reusam o backend que já existe e tem guarda
-- (fn_acessos_papeis_rbac, fn_acessos_definir_papel_rbac, fn_com_vendedor_acesso_listar/_salvar — SECURITY DEFINER,
-- guarda de empresa, sem EXECUTE para anon).

-- Administração › Acessos
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'pessoa', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/admin/acessos', NULL, 'publicado'
FROM (VALUES
 -- já existe no banco (a F3 semeou como acessos_funcao_papel e o banco guarda com ponto); aqui só deixa o repo verdadeiro.
 ('acessos.funcao_papel', 'Papel na empresa (função real)',
  'Escolha a função real da pessoa na empresa (ex.: Supervisor de Abate, Vendedor Comercial, Analista de RH). Em branco = o nível manda.',
  'A função decide QUAIS seções e itens do menu a pessoa enxerga e consegue abrir. Abrir por endereço uma tela fora da função mostra "Acesso restrito à sua função".',
  'Vendedor Comercial → só o Painel comercial e o App de vendas.',
  'Deixar em branco para quem deveria ver só a própria área: o nível libera o menu inteiro.', 10),
 ('acessos.nivel', 'Nível de acesso (teto)',
  'Escolha o nível da pessoa. Ao escolher a função, o sistema sugere o nível coerente com ela.',
  'É o teto do que a pessoa pode fazer (ver, filtrar, editar, aprovar). A função decide QUAIS telas ela vê; o nível limita o quanto ela pode mexer nelas.',
  'Supervisor de Abate → nível Supervisor.',
  'Dar nível de Sócio a um vendedor: a função limita o menu, mas o nível alto libera editar e aprovar.', 11),
 ('acessos.papel_gestao', 'Permissão de gestão',
  'Escolha se a pessoa só usa o sistema (Visualizador/Operador) ou também gere a empresa (Gestor/Master).',
  'Define quem pode convidar pessoas, mudar acessos e administrar a empresa. Não muda o que a pessoa vê no menu — isso é a função.',
  'Vendedor → Visualizador. Diretor que convida a equipe → Gestor.',
  'Dar Gestor para quem só precisa ver os números: ele passa a poder mudar o acesso dos outros.', 12)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;

-- Administração › Vendedores (cadastro usuário → código + coluna Superior)
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Meu painel de vendas', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/admin/vendedores', 'comercial', 'publicado'
FROM (VALUES
 ('com.vendedores.novo_usuario', 'Usuário do PS Gestão',
  'Escolha a pessoa que vai entrar no sistema. Quem ainda não tem usuário é convidado antes em Administração › Acessos.',
  'É o login que passa a enxergar só a carteira do código escolhido ao lado.',
  'joao@empresa.com.br.',
  'Escolher o usuário de outra pessoa: ela passa a ver a carteira errada.', 5),
 ('com.vendedores.novo_codigo', 'Código no ERP de origem',
  'Escolha o código do vendedor, supervisor ou gerente. A lista vem do ERP de origem, com cargo e superior.',
  'Liga o usuário ao código: o vendedor vê só a carteira dele; o supervisor e o gerente veem a equipe abaixo deles.',
  '80008 · Vendedor · superior 86062.',
  'Escolher o código do supervisor para um vendedor: ele passaria a ver a equipe inteira do supervisor.', 6),
 ('com.vendedores.col_superior', 'Superior',
  'Nada a preencher.',
  'A quem o código responde na equipe do ERP de origem. O supervisor e o gerente enxergam a venda de todos os códigos abaixo deles.',
  '86062 · Supervisor.',
  'Achar que o superior precisa de acesso para o vendedor ver a própria carteira: não precisa.', 7)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
