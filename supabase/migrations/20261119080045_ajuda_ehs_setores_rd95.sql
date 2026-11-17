-- RD-95: "?" (AjudaCampo) da tela EHS › Setores (/dashboard/ehs/setores).
-- Contexto (auditoria aud8 17/11, 90/95): a tela tinha ZERO AjudaCampo — colunas (Nome, Slug, Descrição,
-- Empresa, Ações), busca, abas (Globais PS / Meus setores) e ações (Novo/Editar/Desativar) sem orientação.
-- Estas chaves acompanham os "?" adicionados no page.tsx; o texto vem do banco (RD-95), em linguagem do usuário.
-- Aditiva e idempotente: ON CONFLICT (chave) DO NOTHING. Sem UPDATE/DELETE de dado existente.
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('ehs.setores.tab_globais', '/dashboard/ehs/setores', 'EHS · Setores', 'Globais (PS)',
   'Mostra os setores padrão que a PS Gestão já traz prontos. São somente leitura: você não edita nem apaga, mas pode usar em qualquer empresa.',
   'Dá uma base comum de setores para toda empresa começar sem cadastrar do zero; alimenta os vínculos de funcionários e os controles de EHS.',
   'Produção, Manutenção, Administrativo.',
   'Procurar um setor seu nesta aba — o que você criou aparece em "Meus setores", não aqui.',
   'ehs', 1, 1, 'publicado'),

  ('ehs.setores.tab_meus', '/dashboard/ehs/setores', 'EHS · Setores', 'Meus setores',
   'Mostra os setores que a sua empresa criou. Aqui você inclui, edita e desativa os setores próprios.',
   'Permite adaptar a lista de setores à realidade da empresa, além dos padrões da PS; é onde o botão "+ Novo setor" age.',
   'Almoxarifado Central, Expedição Noturna.',
   'Esperar ver os setores globais aqui — esta aba lista só os seus; os da PS ficam em "Globais (PS)".',
   'ehs', 2, 1, 'publicado'),

  ('ehs.setores.busca', '/dashboard/ehs/setores', 'EHS · Setores', 'Buscar',
   'Digite parte do nome ou da descrição do setor para filtrar a lista. A busca age na aba aberta (Globais ou Meus).',
   'Encontra rápido um setor em listas grandes, sem rolar a tabela inteira.',
   'Digitar "manut" para achar "Manutenção".',
   'Buscar um setor seu enquanto a aba "Globais (PS)" está aberta — troque para "Meus setores" antes de buscar.',
   'ehs', 3, 1, 'publicado'),

  ('ehs.setores.empresa_alvo', '/dashboard/ehs/setores', 'EHS · Setores', 'Empresa-alvo para criar setores',
   'Quando você está num grupo de empresas, escolha em qual empresa o novo setor será criado. Aparece só no grupo.',
   'Garante que o setor novo entre na empresa certa; os setores são por empresa (não se misturam entre elas).',
   'Selecionar "Frioeste Matriz" antes de criar "Câmara Fria 2".',
   'Criar o setor na empresa errada por não conferir a empresa-alvo — o setor fica fora da empresa onde você queria.',
   'ehs', 4, 1, 'publicado'),

  ('ehs.setores.col_nome', '/dashboard/ehs/setores', 'EHS · Setores', 'Nome',
   'É o nome do setor como ele aparece nas listas e nos vínculos de funcionários. A etiqueta GLOBAL indica os setores da PS.',
   'Identifica o setor em todo o EHS (funcionários, riscos, EPIs). O nome é o que o usuário reconhece.',
   'Produção, Caldeiraria, RH.',
   'Usar nomes quase iguais ("Prod." e "Produção") para o mesmo setor, o que confunde a lista.',
   'ehs', 5, 1, 'publicado'),

  ('ehs.setores.col_slug', '/dashboard/ehs/setores', 'EHS · Setores', 'Slug',
   'É o código técnico do setor, gerado automaticamente a partir do nome (sem acentos nem espaços). Não é editável.',
   'Serve de identificador estável para integrações e relatórios, mesmo que o nome visível mude.',
   'O nome "Caldeiraria" vira o slug "caldeiraria".',
   'Tentar alterar o slug — ele é fixo; para mudar o rótulo, edite o Nome.',
   'ehs', 6, 1, 'publicado'),

  ('ehs.setores.col_descricao', '/dashboard/ehs/setores', 'EHS · Setores', 'Descrição',
   'Texto livre e opcional que explica o que o setor abrange. Aparece "—" quando não foi preenchido.',
   'Ajuda quem consulta a entender o escopo do setor sem precisar perguntar.',
   '"Montagem e solda de estruturas metálicas".',
   'Deixar descrições genéricas demais que não diferenciam um setor de outro.',
   'ehs', 7, 1, 'publicado'),

  ('ehs.setores.col_empresa', '/dashboard/ehs/setores', 'EHS · Setores', 'Empresa',
   'Mostra a qual empresa do grupo o setor pertence. Aparece só quando você está vendo um grupo de empresas.',
   'Deixa claro de onde é cada setor quando a lista junta várias empresas do grupo.',
   'Frioeste Matriz, Frioeste Filial 2.',
   'Supor que um setor serve a todas as empresas — cada setor próprio é de uma empresa só.',
   'ehs', 8, 1, 'publicado'),

  ('ehs.setores.col_acoes', '/dashboard/ehs/setores', 'EHS · Setores', 'Ações',
   'Reúne os botões para mexer no setor: Editar (mudar nome/descrição) e Desativar (tirar das listas). Só aparece em "Meus setores".',
   'Concentra as operações do setor na própria linha, sem abrir outra tela.',
   'Clicar em Editar para corrigir o nome, ou Desativar para aposentar um setor que não se usa mais.',
   'Procurar Ações nos setores globais — eles são somente leitura e não têm esses botões.',
   'ehs', 9, 1, 'publicado'),

  ('ehs.setores.novo', '/dashboard/ehs/setores', 'EHS · Setores', '+ Novo setor',
   'Abre o formulário para criar um setor próprio da empresa (nome e descrição). Fica ativo na aba "Meus setores".',
   'Cria setores que não existem nos padrões da PS, adaptando o EHS à sua operação.',
   'Criar "Câmara Fria" num frigorífico que a lista global não traz.',
   'Tentar criar na aba "Globais (PS)" — troque para "Meus setores" (e, no grupo, escolha a empresa-alvo).',
   'ehs', 10, 1, 'publicado'),

  ('ehs.setores.editar', '/dashboard/ehs/setores', 'EHS · Setores', 'Editar',
   'Abre o setor para você corrigir o nome e a descrição. O código (slug) não muda. Vale só para os seus setores.',
   'Mantém o cadastro em dia sem recriar o setor, preservando os vínculos de funcionários já feitos.',
   'Trocar "Produção 1" por "Produção - Turno A".',
   'Esperar editar um setor global — só os setores de "Meus setores" podem ser alterados.',
   'ehs', 11, 1, 'publicado'),

  ('ehs.setores.desativar', '/dashboard/ehs/setores', 'EHS · Setores', 'Desativar',
   'Tira o setor das listas sem apagar o histórico. Funcionários já vinculados continuam; o setor some das novas seleções.',
   'Aposenta um setor que não se usa mais sem perder o que já foi registrado nele (soft delete).',
   'Desativar "Expedição Noturna" depois que o turno acabou.',
   'Desativar achando que apaga tudo — é reversível e preserva o histórico; vínculos antigos permanecem.',
   'ehs', 12, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
