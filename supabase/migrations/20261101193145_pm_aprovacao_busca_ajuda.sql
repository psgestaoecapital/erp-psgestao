-- RD-95: "?" do campo de busca da fila de Aprovação (P&M · /dashboard/pm/aprovacao).
-- A tela ganhou busca + paginação para a fila não virar parede de linhas; o campo novo precisa da chave de ajuda no banco.
-- Aditiva: só INSERT de texto de ajuda, idempotente (ON CONFLICT na chave única). Sem RLS/policy/grant novos.
INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES (
  'pm.aprovacao.busca',
  '/dashboard/pm/aprovacao',
  'Aprovação · Lista',
  'Buscar',
  'Digite parte do título, número ou cliente do job para filtrar a fila de aprovação sem rolar a lista inteira.',
  'Deixa achar rápido um job específico quando há muitos aguardando o OK do cliente — a busca filtra enquanto você digita.',
  'Buscar "carrossel" → mostra só os jobs com essa palavra no título ou no cliente.',
  'Esperar que a busca traga jobs de outro status: aqui só aparecem os que estão em aprovação.',
  'pm', 3, 1, 'publicado'
)
ON CONFLICT (chave) DO NOTHING;
