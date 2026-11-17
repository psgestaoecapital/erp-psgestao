-- RD-95: "?" nas AÇÕES da tela Catálogo de EPIs (/dashboard/ehs/epi/catalogo).
-- As abas, a busca, o filtro e os campos dos cards já tinham AjudaCampo; faltava o "?" nas
-- ações principais: "+ Novo EPI", "Importar do estoque" e "Importar para minha empresa"
-- (clonar EPI do catálogo global). Migration ADITIVA e idempotente: só insere as 3 chaves
-- novas em erp_ajuda_campo (ON CONFLICT (chave) DO NOTHING), sem tocar dado de cliente.
-- Faixa de segundos do agente desenvolvedor_4_g (45–54): timestamp :45.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, status)
VALUES
  (
    'epi.catalogo.novo',
    '/dashboard/ehs/epi/catalogo',
    'Catálogo de EPIs',
    'compliance',
    '+ Novo EPI',
    'Clique para cadastrar do zero um EPI da sua empresa (nome, CA, classe, fabricante e validade).',
    'Cria um item no seu catálogo para depois distribuir aos colaboradores e controlar a validade do CA.',
    'Cadastrar uma luva de proteção específica que não está no catálogo global da PS.',
    'Criar um EPI que já existe no Catálogo Global: prefira "Importar para minha empresa" para não duplicar.',
    20,
    'publicado'
  ),
  (
    'epi.catalogo.importar_estoque',
    '/dashboard/ehs/epi/catalogo',
    'Catálogo de EPIs',
    'compliance',
    'Importar do estoque',
    'Clique para trazer, de uma vez, os EPIs que a empresa já tem cadastrados no estoque (Gestão Empresarial / Indústria).',
    'Evita redigitar: aproveita os itens de estoque como EPIs do catálogo de compliance, já com nome e dados básicos.',
    'Puxar as botas e capacetes já lançados no estoque para começar o controle de EPI sem recadastrar.',
    'Esperar que valores de CA/validade venham do estoque: confira e complete esses campos depois de importar.',
    21,
    'publicado'
  ),
  (
    'epi.catalogo.importar_empresa',
    '/dashboard/ehs/epi/catalogo',
    'Catálogo de EPIs',
    'compliance',
    'Importar para minha empresa',
    'Clique para copiar este EPI do Catálogo Global PS para o catálogo da sua empresa.',
    'Clona o item padrão da PS para você poder personalizar (CA, validade, observações) sem alterar o catálogo global, que é somente leitura.',
    'Importar o "Protetor auricular" do catálogo global e ajustar o número do CA que a sua empresa usa.',
    'Importar o mesmo EPI várias vezes: depois de importado ele passa a aparecer em "Meus EPIs"; não reimporte.',
    22,
    'publicado'
  )
ON CONFLICT (chave) DO NOTHING;
