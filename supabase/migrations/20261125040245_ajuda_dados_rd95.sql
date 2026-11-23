-- RD-95: ajuda "?" dos campos da tela Entrada de Dados (/dashboard/dados).
-- Aditiva e idempotente: insere só as 2 chaves novas (Empresa e Buscar lançamentos) se ainda não existirem.
-- Não altera estrutura, RLS nem dado de cliente — erp_ajuda_campo é catálogo global de texto de ajuda.
-- Code: jordana-code

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
SELECT v.chave, v.rota, v.grupo, v.rotulo, v.o_que_preencher, v.para_que_serve, v.exemplo, v.erro_comum, v.vertical, v.ordem
FROM (VALUES
  (
    'dados.empresa', '/dashboard/dados', 'Entrada de Dados', 'Empresa',
    'Escolha a empresa (dentro do grupo) para a qual você vai importar ou consultar os lançamentos financeiros.',
    'Direciona a importação e a consulta para a empresa certa; trocar a empresa limpa os lançamentos carregados na tela.',
    'Comércio (GE)',
    'Importar um arquivo com o seletor na empresa errada e misturar os dados de duas empresas.',
    'gestao_empresarial', 10
  ),
  (
    'dados.busca', '/dashboard/dados', 'Entrada de Dados', 'Buscar lançamentos',
    'Digite parte da descrição, categoria ou fornecedor para filtrar a tabela de lançamentos.',
    'Filtra a lista exibida sem alterar os dados; serve para localizar rapidamente um lançamento específico.',
    'energia',
    'Esperar que a busca cadastre ou altere algo — ela só filtra o que já está na tabela.',
    'gestao_empresarial', 20
  )
) AS v(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
WHERE NOT EXISTS (
  SELECT 1 FROM public.erp_ajuda_campo a WHERE a.rota = v.rota AND a.chave = v.chave
);
