-- #3843 (Karol / segurancadotrabalho@frioeste · reaberto 04/11) · Conferência das Pausas Térmicas unificada numa lista só.
-- A aba Conferência ganhou um seletor de MÊS (a auditoria de batidas roda sozinha) e um FILTRO por colaborador.
-- RD-95: todo filtro novo tem "?" — esta migration cadastra as 2 chaves de ajuda desses campos.
-- ADITIVA e idempotente (ON CONFLICT). Não toca dado de cliente. Não altera RLS/grants.

INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
  (
    'compliance.pausas.conferencia.mes',
    '/dashboard/compliance/pausas-tecnicas',
    'Conferência',
    'Mês da conferência',
    'Escolha o mês que você está conferindo. A lista mostra os dias com batida faltando desse mês; as pausas sem hora de saída aparecem de qualquer mês ainda pendente.',
    'A conferência é feita mês a mês antes de fechar. Trocar o mês faz a auditoria de batidas rodar sozinha naquele período — você não precisa mais clicar em "Auditar o mês" à parte.',
    'Para conferir outubro, selecione 2026-10. Para o mês corrente, deixe como está.',
    'Deixar num mês antigo e achar que não há pendência: troque para o mês que você quer fechar.',
    'sst',
    10,
    'publicado'
  ),
  (
    'compliance.pausas.conferencia.filtro_colaborador',
    '/dashboard/compliance/pausas-tecnicas',
    'Conferência',
    'Filtrar por colaborador',
    'Digite parte do nome do colaborador para ver só as pendências dele na conferência do mês.',
    'Permite conferir um colaborador de cada vez e checar se ele tem algo pendente, sem rolar a lista inteira. Limpe o campo para ver todos de novo.',
    'Digite "mari" para ver Maria, Mariana etc.',
    'Esperar que o filtro busque por CPF ou matrícula: ele busca pelo nome que aparece na lista.',
    'sst',
    20,
    'publicado'
  )
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota,
  grupo = EXCLUDED.grupo,
  rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo,
  erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem,
  status = EXCLUDED.status,
  atualizado_em = now();
