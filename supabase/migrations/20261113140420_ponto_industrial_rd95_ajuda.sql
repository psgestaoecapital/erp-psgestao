-- Indústria · Ponto Eletrônico (/dashboard/industrial/ponto, componente
-- src/components/ponto/PontoView.tsx) · RD-95: a tela não tinha NENHUM "?"
-- (auditor PDCA: "zero AjudaCampo"). Esta PR cobre a 1ª leva — filtros de
-- período, busca, as 3 ações de sincronização/importação e o indicador de
-- "última sync". Colunas das tabelas e abas ficam para a PR seguinte (a nota
-- sobe PR a PR). Code: jordana-code.
--
-- Textos em linguagem do usuário (o que é/preencher · para que serve · exemplo ·
-- erro comum), lidos por fn_ajuda_campo_listar (uma chamada por tela). O
-- componente é compartilhado com a lente Compliance, por isso a ajuda é
-- registrada na rota industrial e lida com rota fixa no PontoView.
--
-- Idempotente (ON CONFLICT (chave) DO UPDATE). Metadado de ajuda — NÃO toca
-- dado de cliente, função, RLS nem regra fiscal/financeira. Faixa :20.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('ponto.filtro_inicio',
   '/dashboard/industrial/ponto', 'Ponto Eletrônico', 'Início do período',
   'Primeiro dia do período que você quer puxar do provedor de ponto.',
   'Define a partir de quando a sincronização busca colaboradores e horas. Junto com o "Fim do período" delimita o intervalo da puxada.',
   '01/11/2026 (para puxar o mês de novembro).',
   'Deixar uma data muito antiga deixa a sincronização lenta; "Sincronizar (período)" puxa no máximo 31 dias por vez.',
   'industrial', 1, 1, 'publicado'),
  ('ponto.filtro_fim',
   '/dashboard/industrial/ponto', 'Ponto Eletrônico', 'Fim do período',
   'Último dia do período que você quer puxar do provedor de ponto.',
   'Fecha o intervalo da sincronização. A puxada traz os dados de "Início do período" até esta data.',
   '30/11/2026 (fechando o mês de novembro).',
   'Fim anterior ao início não traz nada. Para marcação diária acima de 31 dias, use "Sincronizar dia a dia" (fatiado em lotes de 15 dias).',
   'industrial', 2, 1, 'publicado'),
  ('ponto.busca_colaborador',
   '/dashboard/industrial/ponto', 'Ponto Eletrônico', 'Buscar colaborador',
   'Digite parte do nome, matrícula, função, departamento ou CPF para filtrar a lista.',
   'Filtra a tabela de Colaboradores na hora, sem recarregar. Ajuda a achar uma pessoa quando a lista é grande.',
   'Digite "expedição" para ver só quem é do setor de expedição.',
   'Não achou? Confira se o colaborador já foi sincronizado do provedor (botão "Sincronizar") e se o texto está escrito como no cadastro.',
   'industrial', 3, 1, 'publicado'),
  ('ponto.sincronizar_periodo',
   '/dashboard/industrial/ponto', 'Ponto Eletrônico', 'Sincronizar (período)',
   'Ação — puxa do provedor os colaboradores e o TOTAL de horas do período escolhido.',
   'Atualiza a lista de colaboradores e o histórico de horas (total por pessoa). É a puxada principal; limita-se a 31 dias por vez.',
   'Escolha o período e clique para trazer o total de horas do mês.',
   'Período maior que 31 dias não vem completo — reduza o intervalo ou use "Sincronizar dia a dia" para a marcação diária.',
   'industrial', 4, 1, 'publicado'),
  ('ponto.sincronizar_diario',
   '/dashboard/industrial/ponto', 'Ponto Eletrônico', 'Sincronizar dia a dia',
   'Ação — puxa a marcação por DIA (batidas), fatiada em lotes de 15 dias.',
   'Traz o detalhe diário que alimenta o "Painel por dia" e o filtro por dia. Períodos longos (ex.: 60 dias) funcionam porque a puxada é feita em lotes.',
   'Para ver as batidas de 60 dias, informe o período e clique — o sistema divide em lotes automaticamente.',
   'Se aparecer "Parcial (rate limit)", o provedor limitou a quantidade de chamadas; repita para completar o resto.',
   'industrial', 5, 1, 'publicado'),
  ('ponto.importar_compliance',
   '/dashboard/industrial/ponto', 'Ponto Eletrônico', 'Importar pro Compliance',
   'Ação — leva os colaboradores do ponto para a ficha do Compliance (SST).',
   'Completa a ficha de Compliance com os dados do ponto (nome, CPF, função, departamento). Campos preenchidos à mão (RG, endereço, salário, ASO…) NÃO são sobrescritos — só completa o que está vazio.',
   'Depois de sincronizar, clique para criar/atualizar as fichas de Compliance a partir do ponto.',
   'Pessoa sem CPF no provedor é ignorada (o CPF é a chave que amarra ponto e ficha). Preencha o CPF e sincronize de novo.',
   'industrial', 6, 1, 'publicado'),
  ('ponto.ultima_sync',
   '/dashboard/industrial/ponto', 'Ponto Eletrônico', 'Última sync',
   'Indicador — você não preenche.',
   'Mostra a data/hora e o resultado da última sincronização com o provedor. Serve para saber se os dados da tela estão atualizados.',
   '12/11/2026 14:30 (ok) — última puxada bem-sucedida.',
   'Mostra "Nunca"? Então ainda não houve sincronização desta empresa; clique em "Sincronizar (período)".',
   'industrial', 7, 1, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical, ordem = EXCLUDED.ordem, status = EXCLUDED.status,
  atualizado_em = now();
