-- RD-95 (CEO 08/10): "?" em TODO campo/filtro/ação. Auditoria PDCA (19/11) em
-- /dashboard/contador/plano-depara: a tela (PR#5579) foi entregue com ZERO
-- AjudaCampo. Esta migração popula o texto de ajuda das chaves usadas na tela
-- (importar o plano do contador, filtro "só pendentes", ação Vincular e as duas
-- colunas conta do contador x conta do plano PS), no padrão das demais chaves de
-- ajuda. Aditiva e idempotente (ON CONFLICT (chave) DO UPDATE); só catálogo de
-- ajuda, não toca dado de cliente nem estrutura, não mexe em RLS/fiscal/financeiro.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('contabil.depara.colar_plano',
   '/dashboard/contador/plano-depara', 'Plano de contas do contador', 'Colar o plano exportado',
   'Cole aqui as linhas do plano de contas que o seu contador exporta (do sistema fiscal dele). O separador — tabulação, ponto-e-vírgula ou vírgula — é detectado automaticamente.',
   'É a fonte das contas do contador: cada linha vira uma conta no de-para, para o sistema casar com o plano gerencial do PS pelo código.',
   'Ex.: colar "142  1.01.01  Clientes Diversos  A" (uma conta por linha, com código, descrição e tipo).',
   'Colar só uma parte do plano (ex.: só o grupo de receitas): importe o plano inteiro de uma vez para o de-para ficar completo.',
   'gestao_empresarial', 1),

  ('contabil.depara.tem_cabecalho',
   '/dashboard/contador/plano-depara', 'Plano de contas do contador', 'A primeira linha é cabeçalho',
   'Marque se a primeira linha colada é o cabeçalho (os nomes das colunas, como "Código", "Descrição") e não uma conta de verdade.',
   'Faz o sistema pular a primeira linha na importação e usar os nomes dela para sugerir o que é cada coluna.',
   'Ex.: marque quando a primeira linha é "Reduzido | Classificação | Descrição | Tipo".',
   'Deixar marcado quando NÃO há cabeçalho: a primeira conta de verdade seria ignorada.',
   'gestao_empresarial', 2),

  ('contabil.depara.mapear_coluna',
   '/dashboard/contador/plano-depara', 'Plano de contas do contador', 'Dizer o que é cada coluna',
   'Para cada coluna do plano colado, escolha o que ela representa: código do contador, código estruturado do PS, descrição ou analítica/sintética. O que não interessa, deixe em "ignorar".',
   'O sistema só sabe importar depois de saber qual coluna é o código do contador (obrigatório) e, se houver, o código estruturado para casar com o plano do PS.',
   'Ex.: a coluna "Reduzido" = Código do contador; "Classificação" = Código estruturado do PS; "Nome" = Descrição.',
   'Esquecer de marcar a coluna do código do contador: sem ela o botão Importar fica bloqueado.',
   'gestao_empresarial', 3),

  ('contabil.depara.importar',
   '/dashboard/contador/plano-depara', 'Plano de contas do contador', 'Importar o plano do contador',
   'Clique para carregar as contas coladas no de-para. O sistema casa automaticamente só o que tem código idêntico ao plano do PS; o resto entra como pendente, nomeado, para você vincular depois.',
   'Traz o vocabulário fiscal do contador para dentro do sistema sem digitação, criando o ponto de partida do de-para (nunca inventa uma conta padrão para o que não casou).',
   'Ex.: importar 300 contas → 40 casam pelo código e 260 ficam pendentes para vincular manualmente.',
   'Reimportar o mesmo plano esperando apagar o anterior: a importação é por código do contador e por empresa — confira a empresa selecionada no topo.',
   'gestao_empresarial', 4),

  ('contabil.depara.so_pendentes',
   '/dashboard/contador/plano-depara', 'Plano de contas do contador', 'Só pendentes',
   'Marque para a lista mostrar apenas as contas do contador que ainda NÃO foram vinculadas a uma conta do plano do PS.',
   'Ajuda a focar no que falta resolver: as contas pendentes são as que ainda precisam de um vínculo manual.',
   'Ex.: marque para ver só as 260 contas pendentes e ir vinculando uma a uma.',
   'Achar que a lista está vazia porque não há contas: com o filtro ligado, ela mostra vazio quando TUDO já foi vinculado — desmarque para ver todas.',
   'gestao_empresarial', 5),

  ('contabil.depara.conta_contador',
   '/dashboard/contador/plano-depara', 'Plano de contas do contador', 'Conta do contador',
   'É a conta como vem do plano do seu contador: o código reduzido (ex.: 142) e a descrição dele. Esta coluna você não edita — ela é o que foi importado.',
   'Identifica a conta de origem no de-para, para você saber a qual conta do contador está ligando uma conta do plano do PS.',
   'Ex.: "142 — Clientes Diversos" é uma conta do contador aguardando vínculo.',
   'Procurar editar o código do contador aqui: ele reflete o plano importado; para corrigir, ajuste o arquivo e reimporte.',
   'gestao_empresarial', 6),

  ('contabil.depara.conta_ps',
   '/dashboard/contador/plano-depara', 'Plano de contas do contador', 'Conta do plano PS',
   'É a conta do plano gerencial do PS (código estruturado, ex.: 1.01.01) à qual a conta do contador foi vinculada. Só contas analíticas (que aceitam lançamento) podem ser escolhidas.',
   'Fecha o de-para: diz para onde a conta do contador aponta no plano do PS, base para a classificação contábil futura por regras de evento.',
   'Ex.: a conta do contador "142" vinculada à conta do PS "1.01.01 — Clientes".',
   'Tentar vincular a uma conta totalizadora (sintética): o sistema só oferece contas analíticas, porque só elas recebem lançamento.',
   'gestao_empresarial', 7),

  ('contabil.depara.vincular',
   '/dashboard/contador/plano-depara', 'Plano de contas do contador', 'Vincular / Trocar',
   'Use "Vincular" (conta pendente) ou "Trocar" (conta já vinculada) para buscar a conta do plano do PS por código ou nome e ligar a conta do contador a ela. Há também "desvincular", que volta a conta a pendente.',
   'É a ação que resolve o de-para conta a conta: cada vínculo diz ao sistema como a conta do contador corresponde ao plano do PS.',
   'Ex.: clicar Vincular na conta "142", buscar "clientes" e escolher "1.01.01 — Clientes".',
   'Vincular a conta errada por pressa: confira o código e a descrição antes de confirmar — é possível Trocar ou desvincular depois.',
   'gestao_empresarial', 8)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical, ordem = EXCLUDED.ordem,
  versao = public.erp_ajuda_campo.versao + 1, atualizado_em = now();
