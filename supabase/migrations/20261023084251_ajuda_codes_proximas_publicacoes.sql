-- Ajuda do indicador "Próximas publicações" (RD-95: todo indicador tem "?") — aba Codes, CEO 23/10.
-- Aditiva: só insere uma chave de ajuda; nenhum dado de cliente, RLS ou função é tocado.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
 ('dev.codes.proximas_publicacoes', 'Diagnóstico da esteira', 'Próximas publicações',
  'Indicador de leitura — não se preenche.',
  'Lista VIVA de todas as PRs na fila, da mais próxima de publicar à mais longe. A barra enche da abertura (0%) até publicar (100%), conforme a PR avança (checks → preview → revisor → vez na fila → @pos). Ao publicar, a PR sai daqui e aparece em "Publicações do dia". Vermelho = travada precisando de ação (check/preview/conflito).',
  '#2993 84% — na vez (migration, espera a main)',
  'Achar que o % é tempo: é o estágio no pipeline, não quanto falta em minutos.',
  61, '/dashboard/dev/codes', 'dev', 'publicado')
ON CONFLICT (chave) DO NOTHING;
