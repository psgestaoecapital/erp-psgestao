-- RD-95 (/dashboard/ehs/funcionarios · Funcionários EHS): o auditor viu "ZERO
-- chaves de ajuda". Causa-raiz provada no dado (RD-38): os 13 textos de ajuda
-- da tela estavam cadastrados com rota='/dashboard/compliance/funcionarios',
-- mas a tela (único page.tsx: src/app/dashboard/ehs/funcionarios) consulta
-- fn_ajuda_campo_listar('/dashboard/ehs/funcionarios') — que filtra por
-- rota EXATA. Resultado: 0 chaves resolviam na tela, então nenhum "?" aparecia
-- apesar do <AjudaCampo> já estar no código (filtros, ações e colunas EHS/Ações).
-- Não existe page em /dashboard/compliance/funcionarios (só a API /api/compliance/*).
--
-- (1) Realinha a rota das 13 chaves existentes para a rota real da tela.
-- (2) Cadastra as 6 colunas que ainda não tinham "?" (Nome, CPF, Vínculo,
--     Cargo/Setor, Empresa, Tomadora) — o page.tsx passa a renderizar <AjudaCampo>.
-- Só metadados de ajuda (erp_ajuda_campo); não toca dado de cliente, RLS nem cálculo.
-- Aditiva/idempotente. Faixa de segundos :45 (desenvolvedor_4_g).
-- Code: desenvolvedor_4_g

-- (1) rota correta para as chaves que já existem
UPDATE public.erp_ajuda_campo
SET rota = '/dashboard/ehs/funcionarios', atualizado_em = now()
WHERE chave LIKE 'compliance.funcionarios.%'
  AND rota = '/dashboard/compliance/funcionarios';

-- (2) colunas da tabela que faltavam "?"
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Colunas', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/ehs/funcionarios', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('compliance.funcionarios.col_nome', 'Nome',
  'Não preenche: é a coluna com o nome completo do funcionário. Clique no nome para abrir a ficha com documentos e matriz de SST.',
  'É o atalho para a ficha individual (EPIs, treinamentos, documentos e pendências da pessoa).',
  'Clique em "João da Silva" para ver os EPIs entregues e os treinamentos vencidos dele.',
  'Procurar pessoa rolando a lista inteira: use o campo Buscar acima (por nome, CPF ou matrícula).', 1),
 ('compliance.funcionarios.col_cpf', 'CPF',
  'Não preenche: mostra o CPF cadastrado do funcionário (dado pessoal, visível só a quem tem acesso à empresa).',
  'Identifica a pessoa sem ambiguidade e é a chave usada no eSocial e nos documentos de SST.',
  '123.456.789-00. Em branco quando o cadastro ainda não tem CPF — complete na ficha.',
  'Cadastrar sem CPF: trava a geração de eventos do eSocial e alguns relatórios legais.', 2),
 ('compliance.funcionarios.col_vinculo', 'Vínculo',
  'Não preenche: mostra o tipo de vínculo do funcionário — próprio (CLT da empresa) ou terceiro (de uma empresa prestadora).',
  'Separa quem é da sua folha de quem é de prestador: a responsabilidade de SST e os documentos exigidos mudam conforme o vínculo.',
  'Próprio = funcionário CLT da empresa. Terceiro = alocado por uma prestadora na obra/tomadora.',
  'Tratar terceiro como próprio: as exigências de documento da prestadora deixam de ser cobradas.', 3),
 ('compliance.funcionarios.col_cargo_setor', 'Cargo / Setor',
  'Não preenche: mostra o cargo e o setor onde a pessoa atua. É daqui que vêm, por herança, os riscos, EPIs e treinamentos exigidos.',
  'O cargo/setor define a matriz de SST da pessoa — sem eles, a herança não calcula o que é obrigatório.',
  'Operador de Máquinas / Produção. Use os filtros Cargo e Setor acima para agrupar.',
  'Pessoa sem cargo/setor: aparece com gap na herança porque não há de onde herdar as exigências.', 4),
 ('compliance.funcionarios.col_empresa', 'Empresa',
  'Não preenche: aparece só quando você vê mais de uma empresa; mostra a qual empresa (CNPJ) o funcionário pertence.',
  'Evita confundir pessoas de empresas diferentes quando a visão é multiempresa.',
  'Aparece "Indústria Matriz" vs "Filial Sul" quando o usuário acessa as duas.',
  'Confundir Empresa (dona do cadastro) com Tomadora (onde o terceiro está alocado): são colunas diferentes.', 5),
 ('compliance.funcionarios.col_tomadora', 'Tomadora',
  'Não preenche: mostra a empresa tomadora (cliente/obra) onde o funcionário — em geral terceiro — está alocado.',
  'Mostra onde a pessoa presta serviço, para cobrar os documentos de SST exigidos por aquela tomadora/obra.',
  'Terceiro da prestadora "Alfa" alocado na tomadora "Obra Centro". Use o filtro Tomadora para ver só uma.',
  'Terceiro sem tomadora: não dá para saber em qual obra as exigências de SST se aplicam.', 6)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
