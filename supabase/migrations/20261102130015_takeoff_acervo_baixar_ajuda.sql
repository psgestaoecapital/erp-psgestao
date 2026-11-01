-- RD-95: chave de ajuda "?" da nova ação "Baixar planta" no acervo do Takeoff
-- (/dashboard/projetos/takeoff/acervo). Aditiva e idempotente — só INSERE a chave se ainda não existir;
-- não altera nenhum dado de cliente, RLS, função ou tabela. Faixa de segundos do agente (:15), acima da main.
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
SELECT
  'hub.takeoff.acervo.baixar',
  '/dashboard/projetos/takeoff/acervo',
  'Acervo · Ação',
  'Baixar planta',
  'Baixa para o seu computador o arquivo original da planta (o mesmo que foi enviado).',
  'Permite recuperar o arquivo da planta direto do acervo, sem precisar reabrir a análise. Aparece só quando a planta tem um arquivo salvo.',
  'Da planta "Bloco A", baixar o PDF/DWG original para enviar ao cliente ou arquivar.',
  'Procurar o botão em planta sem arquivo salvo: ele só aparece quando existe arquivo vinculado à planta.',
  'hub',
  23,
  'publicado'
WHERE NOT EXISTS (
  SELECT 1 FROM public.erp_ajuda_campo WHERE chave = 'hub.takeoff.acervo.baixar'
);
