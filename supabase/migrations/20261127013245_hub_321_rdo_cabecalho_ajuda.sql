-- Hub §321 (RD-95): chave de ajuda do cabeçalho do Diário de Obra (/dashboard/projetos/obras/[id]/rdo):
-- organização, obra, cliente, endereço e responsável, lidos da ficha da obra.
-- Aditiva e idempotente: só insere/atualiza a linha de ajuda; não toca estrutura nem dado de cliente.
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES (
  'projetos.obra_rdo.cabecalho',
  '/dashboard/projetos/obras/[id]/rdo',
  'Diário de Obra',
  'Cabeçalho do diário',
  'Nada para preencher aqui: o cabeçalho mostra a organização, a obra, o cliente, o endereço e o responsável que estão na ficha da obra.',
  'Identifica de quem é o diário e onde fica a obra, como no Livro de Ordem. Quem lê o diário impresso ou no celular sabe na hora de que obra se trata.',
  'Construtora Modelo · Obra DEMO-OB-001 · Rua Demonstração, 100 — Centro — Chapecó/SC — CEP 89802-000.',
  'Tentar corrigir o endereço por aqui: ajuste na ficha da obra (link "Completar na ficha") e o cabeçalho atualiza sozinho.',
  'projetos',
  5,
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
