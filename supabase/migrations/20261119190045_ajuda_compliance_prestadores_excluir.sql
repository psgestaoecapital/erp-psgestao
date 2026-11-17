-- RD-95 · nova ação "Excluir" (inativar) na lista /dashboard/ehs/prestadores precisa do "?"
-- com chave cadastrada em erp_ajuda_campo. Espelha a chave irmã 'compliance.prestadores.abrir'
-- (mesma rota, grupo e vertical).
--
-- A ação em si é soft-delete rastreável (ativo=false + audit_log), já existente no back-end
-- (DELETE /api/compliance/prestadores/[id]). Esta migration é aditiva e idempotente: só insere
-- o texto de ajuda; não toca RLS, dado de cliente, nem comportamento.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES (
  'compliance.prestadores.excluir',
  '/dashboard/ehs/prestadores',
  'Prestadores',
  'Excluir',
  'Clique para inativar o prestador daquela linha. O sistema pede um motivo e confirma antes de aplicar.',
  'Inativa (soft-delete) o prestador: ele sai da lista de ativos, mas nada é apagado — o cadastro e o histórico de documentos ficam guardados e podem ser reativados pela ficha. O motivo e quem inativou ficam no registro de auditoria.',
  'Inativar um prestador que encerrou o contrato, informando o motivo "Contrato encerrado em 11/2026".',
  'Usar "Excluir" para esconder um prestador que ainda presta serviço — prefira manter ativo. Inativar não apaga o histórico; para corrigir dados, use "Abrir" e edite.',
  'compliance',
  12,
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
  status          = EXCLUDED.status,
  atualizado_em   = now();
