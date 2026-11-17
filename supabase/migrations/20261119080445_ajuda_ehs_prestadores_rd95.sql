-- RD-95: "?" (AjudaCampo) da tela EHS › Prestadores (/dashboard/ehs/prestadores).
-- Contexto (auditoria aud8 17/11, 86/95): a lista tinha ZERO AjudaCampo — colunas (Razão Social, CNPJ, Tipo,
-- Empresa, Responsável, Valor mensal, EHS, Ações) e a busca sem "?". (O critério "e" — valor cru
-- "prestacao_servico" na coluna Tipo — é corrigido no page.tsx com rótulo humano + fallback que humaniza.)
-- Aditiva e idempotente: ON CONFLICT (chave) DO NOTHING. Sem UPDATE/DELETE de dado existente.
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('ehs.prestadores.busca', '/dashboard/ehs/prestadores', 'EHS · Prestadores', 'Buscar',
   'Digite parte da razão social, do CNPJ ou do nome fantasia para filtrar a lista de prestadores.',
   'Encontra rápido um prestador em listas grandes, sem rolar a tabela inteira.',
   'Digitar "transporte" ou um trecho do CNPJ.',
   'Esperar resultado digitando um dado que não está no cadastro do prestador (ex.: nome de um funcionário dele).',
   'ehs', 1, 1, 'publicado'),

  ('ehs.prestadores.col_razao', '/dashboard/ehs/prestadores', 'EHS · Prestadores', 'Razão Social',
   'Nome jurídico do prestador (empresa terceirizada). O nome fantasia, quando há, aparece abaixo. Clique para abrir a ficha.',
   'Identifica a empresa terceira; é o ponto de entrada para a documentação de EHS dela.',
   'Transportadora Silva Ltda.',
   'Confundir razão social com nome fantasia — a razão social é o nome do CNPJ.',
   'ehs', 2, 1, 'publicado'),

  ('ehs.prestadores.col_cnpj', '/dashboard/ehs/prestadores', 'EHS · Prestadores', 'CNPJ',
   'Número do CNPJ do prestador. Identifica a empresa de forma única.',
   'Evita duplicar prestadores e liga o cadastro à empresa correta nas notas e contratos.',
   '12.345.678/0001-90.',
   'Cadastrar o mesmo prestador duas vezes com e sem pontuação no CNPJ.',
   'ehs', 3, 1, 'publicado'),

  ('ehs.prestadores.col_tipo', '/dashboard/ehs/prestadores', 'EHS · Prestadores', 'Tipo',
   'Tipo de contrato/empresa do prestador (MEI, PJ Simples, PJ Lucro Real, Prestação de serviço).',
   'Ajuda a classificar o prestador e a saber quais documentos e retenções se aplicam.',
   'PJ Simples.',
   'Deixar o tipo em branco — a classificação fica incompleta (aparece "—").',
   'ehs', 4, 1, 'publicado'),

  ('ehs.prestadores.col_empresa', '/dashboard/ehs/prestadores', 'EHS · Prestadores', 'Empresa',
   'Mostra a qual empresa do grupo (tomadora) o prestador está vinculado. Aparece só no grupo.',
   'Deixa claro quem é a tomadora responsável pela conformidade daquele prestador.',
   'Frioeste Matriz.',
   'Supor que um prestador atende todas as empresas — o vínculo é por tomadora.',
   'ehs', 5, 1, 'publicado'),

  ('ehs.prestadores.col_responsavel', '/dashboard/ehs/prestadores', 'EHS · Prestadores', 'Responsável',
   'Nome da pessoa de contato do prestador (quem responde pela empresa terceira).',
   'Agiliza a cobrança de documentos e o contato quando falta algo na conformidade.',
   'Maria Souza (contato da transportadora).',
   'Deixar sem responsável, dificultando a cobrança de documentos vencidos.',
   'ehs', 6, 1, 'publicado'),

  ('ehs.prestadores.col_valor', '/dashboard/ehs/prestadores', 'EHS · Prestadores', 'Valor mensal',
   'Valor mensal do contrato com o prestador, quando informado. Aparece "—" se não houver valor.',
   'Dá a dimensão financeira da terceirização e apoia a gestão de contratos.',
   'R$ 4.500,00.',
   'Digitar o valor anual no campo mensal, distorcendo o acompanhamento.',
   'ehs', 7, 1, 'publicado'),

  ('ehs.prestadores.col_ehs', '/dashboard/ehs/prestadores', 'EHS · Prestadores', 'EHS',
   'Percentual de documentos de EHS do prestador que estão em dia (ASO, NRs, etc.). A barra mostra verde/amarelo/vermelho e "X / Y em dia".',
   'Mostra num relance a saúde da conformidade de cada prestador para priorizar as cobranças.',
   '80% · 4 / 5 em dia.',
   'Liberar um prestador com EHS baixo (documentos vencidos) para atuar na operação.',
   'ehs', 8, 1, 'publicado'),

  ('ehs.prestadores.col_acoes', '/dashboard/ehs/prestadores', 'EHS · Prestadores', 'Ações',
   'Botão "Abrir" para entrar na ficha do prestador, onde ficam os documentos, trabalhadores e o detalhe do contrato.',
   'Leva ao detalhe do prestador para gerenciar a documentação de EHS dele.',
   'Clicar em Abrir para anexar o ASO de um trabalhador do prestador.',
   'Procurar editar o prestador na lista — as ações de detalhe ficam dentro da ficha (Abrir).',
   'ehs', 9, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
