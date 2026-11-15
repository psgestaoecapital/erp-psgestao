-- Contrato (GE) · card "Anexar contrato assinado" (RD-41) — RD-95 "?"
-- ============================================================================
-- GAP (RD-95): o campo de anexo do contrato (src/components/ge/ContratoArquivos.tsx,
--   usado nas telas/modais de contrato em /dashboard/contratos) não tinha "?".
-- CORREÇÃO (aditiva, idempotente): 1 chave NOVA no grupo "Contratos".
-- RD-38: ON CONFLICT (chave) DO UPDATE — re-rodar não duplica.
-- Não toca cálculo, RLS nem dado de cliente: só texto de ajuda num catálogo global.
-- Code: desenvolvedor_4_g
-- ============================================================================

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('ge.contrato.anexo', '/dashboard/contratos', 'Contratos', 'Anexar contrato assinado',
   'O arquivo do contrato assinado. Arraste ou clique para escolher: PDF, JPG, PNG ou WebP, até 10 MB.',
   'Guarda o documento oficial junto do contrato, para consulta e auditoria — e serve de base para a leitura automática (IA) preencher dados do contrato nas próximas fases.',
   'contrato-cliente-assinado.pdf',
   'Enviar foto cortada ou ilegível, ou um arquivo acima de 10 MB — o anexo é recusado; use PDF ou imagem nítida da via assinada.',
   'geral', 9220)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, atualizado_em = now();
