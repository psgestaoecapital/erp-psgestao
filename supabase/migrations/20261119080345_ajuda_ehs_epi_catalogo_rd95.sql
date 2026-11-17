-- RD-95: "?" (AjudaCampo) da tela EHS › EPI › Catálogo (/dashboard/ehs/epi/catalogo).
-- Contexto (auditoria aud8 17/11, 88/95): só 1 chave (inativar_lote) em 763 linhas. Abas (Catálogo Global PS /
-- Meus EPIs), busca, filtro de categoria, empresa-alvo, campos do card (CA, Categoria, Validade do CA, Fabricante)
-- e a ação "Importar para minha empresa" ficavam sem "?".
-- Aditiva e idempotente: ON CONFLICT (chave) DO NOTHING. Sem UPDATE/DELETE de dado existente.
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('epi.catalogo.tab_global', '/dashboard/ehs/epi/catalogo', 'EHS · EPI · Catálogo', 'Catálogo Global PS',
   'Mostra os EPIs padrão que a PS Gestão já traz prontos. São somente leitura: use "Importar" num card para clonar para a sua empresa.',
   'Dá uma base pronta de EPIs para não cadastrar do zero; você importa o que precisa e personaliza.',
   'Capacete classe B, luva de vaqueta, protetor auricular.',
   'Tentar editar um EPI global aqui — ele é só leitura; importe para "Meus EPIs" e edite lá.',
   'ehs', 1, 1, 'publicado'),

  ('epi.catalogo.tab_meus', '/dashboard/ehs/epi/catalogo', 'EHS · EPI · Catálogo', 'Meus EPIs',
   'Mostra os EPIs da sua empresa (criados ou importados do global). Aqui você inclui, edita, atualiza o CA e inativa.',
   'É o catálogo que a empresa realmente usa nas entregas e nos controles de EPI.',
   'Luva importada do global e ajustada com o CA e o fabricante da sua compra.',
   'Procurar os padrões da PS aqui — eles ficam em "Catálogo Global PS".',
   'ehs', 2, 1, 'publicado'),

  ('epi.catalogo.empresa_alvo', '/dashboard/ehs/epi/catalogo', 'EHS · EPI · Catálogo', 'Empresa-alvo',
   'Quando você está num grupo, escolha em qual empresa o EPI novo (ou importado) será criado.',
   'Garante que o EPI entre no catálogo da empresa certa; os EPIs são por empresa.',
   'Selecionar "Frioeste Matriz" antes de importar um capacete do global.',
   'Criar/importar na empresa errada por não conferir a empresa-alvo.',
   'ehs', 3, 1, 'publicado'),

  ('epi.catalogo.busca', '/dashboard/ehs/epi/catalogo', 'EHS · EPI · Catálogo', 'Buscar',
   'Digite parte do nome, do modelo ou do número do CA para filtrar os cards. Age na aba aberta.',
   'Encontra rápido um EPI em catálogos grandes, sem rolar todos os cards.',
   'Digitar "29587" (número do CA) ou "luva" para achar o item.',
   'Buscar um EPI próprio com a aba "Catálogo Global PS" aberta — troque para "Meus EPIs".',
   'ehs', 4, 1, 'publicado'),

  ('epi.catalogo.categoria', '/dashboard/ehs/epi/catalogo', 'EHS · EPI · Catálogo', 'Categoria',
   'Filtra os cards por categoria de EPI (proteção da cabeça, mãos, auditiva, respiratória…). "Todas as categorias" mostra tudo.',
   'Separa os EPIs por tipo de proteção, facilitando achar o grupo certo.',
   'Filtrar por "Proteção das mãos" para ver só luvas.',
   'Achar que faltam EPIs quando na verdade um filtro de categoria está ativo.',
   'ehs', 5, 1, 'publicado'),

  ('epi.catalogo.card_ca', '/dashboard/ehs/epi/catalogo', 'EHS · EPI · Catálogo', 'CA (Certificado de Aprovação)',
   'É o número do Certificado de Aprovação do EPI, emitido pelo Ministério do Trabalho. Todo EPI de uso obrigatório tem um CA.',
   'Comprova que o EPI é homologado; sem CA válido o equipamento não pode ser usado como proteção legal.',
   'CA 29587.',
   'Usar um EPI com CA vencido ou sem CA — ele perde a validade legal como proteção.',
   'ehs', 6, 1, 'publicado'),

  ('epi.catalogo.card_categoria', '/dashboard/ehs/epi/catalogo', 'EHS · EPI · Catálogo', 'Categoria',
   'Tipo de proteção do EPI (cabeça, mãos, auditiva, respiratória…). É a etiqueta mostrada no card.',
   'Classifica o EPI por risco que protege, ajudando a montar a ficha de EPI por função.',
   'Proteção auditiva, Proteção das mãos.',
   'Classificar um EPI na categoria errada, o que atrapalha a ficha e os relatórios por risco.',
   'ehs', 7, 1, 'publicado'),

  ('epi.catalogo.card_validade', '/dashboard/ehs/epi/catalogo', 'EHS · EPI · Catálogo', 'Validade do CA',
   'Mostra a situação do Certificado de Aprovação: válido, vencendo ou vencido, conforme a data de validade cadastrada.',
   'Avisa quando o CA está perto de vencer para você renovar o cadastro antes de usar o EPI fora da validade.',
   'Verde "CA válido"; vermelho "CA vencido".',
   'Continuar entregando um EPI com "CA vencido" — a proteção perde validade legal.',
   'ehs', 8, 1, 'publicado'),

  ('epi.catalogo.card_fabricante', '/dashboard/ehs/epi/catalogo', 'EHS · EPI · Catálogo', 'Fabricante',
   'Nome do fabricante do EPI, conforme o CA e a nota de compra.',
   'Identifica a origem do equipamento e ajuda a conferir o CA junto ao fabricante correto.',
   '3M, Danny, Marluvas.',
   'Deixar o fabricante em branco ou genérico, o que dificulta rastrear o EPI e o CA.',
   'ehs', 9, 1, 'publicado'),

  ('epi.catalogo.importar', '/dashboard/ehs/epi/catalogo', 'EHS · EPI · Catálogo', 'Importar para minha empresa',
   'Clona o EPI do catálogo global para o catálogo da sua empresa (empresa-alvo), onde você pode ajustar CA, fabricante e lote.',
   'Reaproveita o padrão da PS sem recadastrar tudo; depois você personaliza com os dados da sua compra.',
   'Importar "Capacete classe B" e trocar o CA pelo da sua nota.',
   'Importar sem escolher a empresa-alvo certa, criando o EPI na empresa errada.',
   'ehs', 10, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
