-- Chamado #5452 (Pdois/P&M) · Modelos de contrato — slice 2 (tela): ajuda RD-95. Code: desenvolvedor_4_g.
--
-- RD-95: todo campo / filtro / indicador / ação da nova aba "Modelos" de /dashboard/contratos tem o "?"
-- com a chave existente no banco. Esta migration SÓ semeia as linhas de ajuda — não cria/altera tabela
-- nem função (a camada de dados erp_contrato_modelo + fn_contrato_modelo_* já está na main pela #3896).
--
-- Aditiva e idempotente: INSERT ... ON CONFLICT (chave) DO NOTHING. erp_ajuda_campo é catálogo global
-- de ajuda (sem company_id, sem dado de cliente). Não altera nenhuma linha existente.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem)
VALUES
  ('ge.contrato.modelo.novo', '/dashboard/contratos', 'Modelos de contrato', 'gestao_empresarial',
   'Novo modelo',
   'Clique para cadastrar um modelo de contrato reutilizável: dê um nome, uma descrição opcional e escreva o texto do contrato com os campos variáveis entre chaves duplas (ex.: {{cliente_nome}}).',
   'Guarda um texto-padrão de contrato que a empresa reaproveita. Depois, ao gerar um contrato de um cliente, o sistema troca os campos variáveis pelos dados reais — você não reescreve o contrato do zero a cada venda.',
   'Modelo "Prestação de serviços de fee mensal" com o texto padrão usado em todos os clientes recorrentes.',
   'Escrever dados de um cliente específico dentro do modelo: o modelo é genérico; os dados do cliente entram pelos campos variáveis na geração.', 0),

  ('ge.contrato.modelo.nome', '/dashboard/contratos', 'Modelos de contrato', 'gestao_empresarial',
   'Nome do modelo',
   'Um nome curto que identifique o modelo na lista. Obrigatório.',
   'É como o modelo aparece para quem vai escolher qual usar na hora de gerar um contrato.',
   '"Fee mensal — marketing", "Projeto fechado — obra", "Consultoria avulsa".',
   'Deixar o nome em branco ou genérico demais ("Contrato 1"), dificultando achar o modelo depois.', 1),

  ('ge.contrato.modelo.descricao', '/dashboard/contratos', 'Modelos de contrato', 'gestao_empresarial',
   'Descrição',
   'Texto curto e opcional explicando quando usar este modelo.',
   'Ajuda a equipe a escolher o modelo certo sem precisar abrir o texto inteiro.',
   '"Usar para clientes de fee recorrente mensal com reajuste anual."',
   'Confundir a descrição (nota interna) com o texto do contrato (o corpo jurídico que vai ao cliente).', 2),

  ('ge.contrato.modelo.texto', '/dashboard/contratos', 'Modelos de contrato', 'gestao_empresarial',
   'Texto do modelo',
   'Escreva o corpo do contrato. Onde entrar um dado do cliente ou da proposta, use um campo variável entre chaves duplas: {{cliente_nome}}, {{cliente_cnpj}}, {{valor}}, {{data_inicio}}. Na geração do contrato (etapa seguinte) esses campos são substituídos pelos dados reais.',
   'É o conteúdo reaproveitável do contrato. Escrever uma vez com campos variáveis evita redigitar o contrato inteiro a cada novo cliente.',
   '"Pelo presente instrumento, {{cliente_nome}}, inscrita no CNPJ {{cliente_cnpj}}, contrata os serviços no valor mensal de {{valor}}, com início em {{data_inicio}}."',
   'Esquecer as chaves duplas ({{campo}}): sem elas o texto vira fixo e não é preenchido automaticamente.', 3),

  ('ge.contrato.modelo.incluir_inativos', '/dashboard/contratos', 'Modelos de contrato', 'gestao_empresarial',
   'Mostrar inativos',
   'Marque para ver também os modelos que foram inativados (fora de uso). Desmarcado, a lista mostra só os modelos ativos.',
   'Permite reativar ou consultar um modelo antigo sem poluir a lista do dia a dia.',
   'Ative para localizar um modelo descontinuado que você quer voltar a usar.',
   'Achar que um modelo "sumiu" quando na verdade ele foi inativado — marque esta opção para encontrá-lo.', 4),

  ('ge.contrato.modelo.editar', '/dashboard/contratos', 'Modelos de contrato', 'gestao_empresarial',
   'Editar modelo',
   'Clique para alterar o modelo. Ao salvar, o sistema cria uma versão nova e guarda a anterior — os contratos já gerados com a versão antiga não mudam.',
   'Mantém o histórico: você melhora o modelo sem reescrever contratos que já foram emitidos.',
   'Corrigir uma cláusula do modelo de fee: edite e salve; a próxima geração usa a versão nova.',
   'Esperar que editar o modelo altere contratos já emitidos — não altera; cada contrato guarda o texto do momento em que foi gerado.', 5),

  ('ge.contrato.modelo.versao', '/dashboard/contratos', 'Modelos de contrato', 'gestao_empresarial',
   'Versão',
   'Nada a preencher — mostra qual versão do modelo está vigente. Cada edição gera uma versão nova.',
   'Deixa claro que o modelo evoluiu e que contratos antigos foram feitos com versões anteriores.',
   'Um modelo editado duas vezes aparece como "v3".',
   'Confundir a versão do modelo com o número do contrato — são coisas diferentes.', 6),

  ('ge.contrato.modelo.inativar', '/dashboard/contratos', 'Modelos de contrato', 'gestao_empresarial',
   'Inativar modelo',
   'Clique para tirar o modelo de uso e informe o motivo. O modelo não é apagado: fica guardado e pode ser reativado depois.',
   'Descontinua um modelo que não deve mais ser usado em novas gerações, sem perder o histórico.',
   'Inative o modelo "Fee 2024" ao adotar o "Fee 2026", informando "substituído pelo modelo novo".',
   'Inativar para "apagar": o modelo continua no banco (rastreável); para voltar a usá-lo, basta reativar.', 7),

  ('ge.contrato.modelo.reativar', '/dashboard/contratos', 'Modelos de contrato', 'gestao_empresarial',
   'Reativar modelo',
   'Clique para voltar a usar um modelo que estava inativo. Ele reaparece na lista de ativos.',
   'Recupera um modelo descontinuado sem precisar recadastrá-lo.',
   'Reative um modelo sazonal no início da temporada em que ele volta a ser usado.',
   'Não encontrar o botão porque a lista está mostrando só ativos — marque "Mostrar inativos" primeiro.', 8)
ON CONFLICT (chave) DO NOTHING;
