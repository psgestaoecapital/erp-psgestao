-- Inteligência (BI) · Análise de Dados (/dashboard/inteligencia) · RD-95: o hub NÃO tinha nenhum
-- "?" (auditor aud8claudeps 11/11, nota 82/95, item 2). Esta PR cobre os 2 indicadores do hub:
-- (1) o que é a Análise de dados e por que um card pode não aparecer (escopo); (2) o estado do
-- card (aceso = tem dado / em breve). Code: desenvolvedor_4_g.
--
-- Textos em linguagem do usuário, lidos por fn_ajuda_campo_listar (uma chamada por tela). O hub é
-- tela de consulta (sem campos de formulário), por isso a ajuda cobre os INDICADORES.
--
-- Idempotente (ON CONFLICT (chave) DO UPDATE). Metadado de ajuda — NÃO toca dado de cliente,
-- função, RLS nem regra fiscal/financeira. Faixa :45.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('bi.hub_como_funciona',
   '/dashboard/inteligencia', 'Análise de dados', 'Análise de dados (como funciona)',
   'Não preenche nada aqui — é um painel de leitura. Escolha a empresa no topo e clique no card do indicador que quer abrir.',
   'Reúne os indicadores da sua operação (industrial ou agro) em um só lugar. Cada card abre o detalhe daquele tema. Você vê só os temas que o seu escopo (perfil) permite.',
   'Abrir o card "Abate e carcaça" para ver rendimento e quebra do período.',
   'Se um card esperado não aparece, pode ser escopo do seu perfil (ex.: RH industrial vê só o card de RH) ou a empresa selecionada ainda não ter aquele dado.',
   'industrial', 1, 1, 'publicado'),
  ('bi.card_estado',
   '/dashboard/inteligencia', 'Análise de dados', 'Estado do card (aceso / em breve)',
   'Não preenche — é um sinal de status. O card "acende sozinho" quando a fonte daquele tema já tem dado da empresa.',
   'Mostra, de relance, quais indicadores já têm dado pronto para abrir. "● ativo" = a fonte tem dado; "em breve" = o tema existe mas ainda sem dado para esta empresa.',
   'Card "● ativo" com a métrica no rodapé já pode ser aberto; card "em breve" aguarda o primeiro lançamento.',
   'Ver "em breve" não é erro: lance/importe o dado da origem (ex.: abate, entrada de gado) e o card acende sozinho na próxima abertura.',
   'industrial', 2, 1, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, status = EXCLUDED.status, atualizado_em = now();
