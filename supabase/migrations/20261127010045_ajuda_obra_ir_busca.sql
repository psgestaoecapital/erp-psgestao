-- Hub §30 HB0 (RD-95): chave de ajuda do campo de busca da tela "Ir para a obra"
-- (/dashboard/projetos/obras/ir/[tela]) — o único campo que faltava "?" no gate check-ajuda-campo.
-- Aditiva e idempotente: só insere/atualiza a linha de ajuda; não toca estrutura nem dado de cliente.
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES (
  'projetos.obra_ir.busca',
  '/dashboard/projetos/obras/ir',
  'Obras',
  'Buscar obra',
  'Digite parte do nome da obra, o número dela ou o nome do cliente para filtrar a lista.',
  'Achar rápido a obra que você quer abrir quando há muitas na lista, sem rolar tudo.',
  'Mercado Central, OBR-2026-0003 ou o nome do cliente.',
  'Esperar que a busca procure dentro dos lançamentos da obra — aqui ela filtra só pela obra/número/cliente da lista.',
  'hub_construcao',
  1,
  1,
  'publicado'
)
ON CONFLICT (chave) DO UPDATE SET
  rota            = EXCLUDED.rota,
  grupo           = EXCLUDED.grupo,
  rotulo          = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve  = EXCLUDED.para_que_serve,
  exemplo         = EXCLUDED.exemplo,
  erro_comum      = EXCLUDED.erro_comum,
  vertical        = EXCLUDED.vertical,
  ordem           = EXCLUDED.ordem,
  status          = EXCLUDED.status;
