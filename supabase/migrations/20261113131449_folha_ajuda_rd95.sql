-- Folha de Pagamento (Indústria) · /dashboard/industrial/folha
-- RD-95 (aud8 70/95): a tela estava com ZERO "?". Adiciona 6 chaves de ajuda (upload, KPIs
--   Funcionários/Custo total/Custo médio-func, cards de competência, tabela Por verba), em
--   linguagem do usuário. Lidas por fn_ajuda_campo_listar (uma chamada por tela).
-- Idempotente (ON CONFLICT (chave) DO UPDATE). Metadado de ajuda — NÃO toca dado de cliente,
-- função, RLS nem regra fiscal/financeira. Faixa de segundos do desenvolvedor_4_g (:49).

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('industrial.folha.upload','/dashboard/industrial/folha','Folha de Pagamento','Subir folha de pagamento',
   'Selecione o arquivo .xls/.xlsx da folha da competência (uma competência por arquivo).',
   'Importa a folha para apurar o custo de mão de obra por verba e por setor. "Pré-visualizar" mostra o que será gravado antes de confirmar; re-upload da mesma competência regrava.',
   'Encargos da Empresa 03/2026.xlsx → Pré-visualizar → Confirmar.',
   'Arquivo de outro formato (PDF/foto) não é lido; exporte a planilha .xls/.xlsx.',
   'industrial', 1, 1, 'publicado'),
  ('industrial.folha.competencias','/dashboard/industrial/folha','Folha de Pagamento','Competências importadas',
   'Indicador — você não preenche; clique para abrir o detalhe.',
   'Lista cada competência já importada (nº de funcionários e custo total). Clique numa competência para ver os KPIs e as verbas.',
   '03/2026 · 48 func · R$ 210 mil',
   'Competência faltando? É porque a folha dela ainda não foi importada acima.',
   'industrial', 2, 1, 'publicado'),
  ('industrial.folha.funcionarios','/dashboard/industrial/folha','Folha de Pagamento','Funcionários',
   'Indicador calculado — você não preenche.',
   'Quantos funcionários têm lançamento na competência selecionada.',
   '48 funcionários',
   'Número diferente do esperado? Confira se a folha importada é da competência certa.',
   'industrial', 3, 1, 'publicado'),
  ('industrial.folha.custo_total','/dashboard/industrial/folha','Folha de Pagamento','Custo total',
   'Indicador calculado — você não preenche.',
   'Soma do total geral (com encargos) de todos os funcionários da competência. É a base do custo de mão de obra por setor.',
   'R$ 210.350,00',
   'Valor baixo? Pode faltar verba/encargo na planilha importada — reimporte o arquivo completo.',
   'industrial', 4, 1, 'publicado'),
  ('industrial.folha.custo_medio','/dashboard/industrial/folha','Folha de Pagamento','Custo médio por funcionário',
   'Indicador calculado — você não preenche.',
   'Custo total dividido pelo nº de funcionários da competência. Ajuda a comparar competências.',
   'R$ 4.382,29',
   'Média distorcida? Verifique admissões/demissões parciais no mês.',
   'industrial', 5, 1, 'publicado'),
  ('industrial.folha.por_verba','/dashboard/industrial/folha','Folha de Pagamento','Por verba',
   'Indicador calculado — você não preenche.',
   'Mostra o total por verba (salário, encargos, descontos). Descontos aparecem em vermelho. Serve para conferir a composição do custo da folha.',
   'Salário base R$ 150 mil · INSS R$ 30 mil · Desconto VT -R$ 2 mil',
   'Verba estranha? O nome vem da planilha de origem; corrija na folha e reimporte.',
   'industrial', 6, 1, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota=EXCLUDED.rota, grupo=EXCLUDED.grupo, rotulo=EXCLUDED.rotulo,
  o_que_preencher=EXCLUDED.o_que_preencher, para_que_serve=EXCLUDED.para_que_serve,
  exemplo=EXCLUDED.exemplo, erro_comum=EXCLUDED.erro_comum,
  vertical=EXCLUDED.vertical, ordem=EXCLUDED.ordem, status=EXCLUDED.status, atualizado_em=now();
