-- Cadastro de cliente/fornecedor (/dashboard/cadastros/pessoa) — RD-95 "?" no anexador de contratos
-- ============================================================================
-- GAP (RD-95): o card ClienteArquivos ("Contratos & anexos") tinha o seletor de arquivo SEM "?":
--   nem o rótulo nem a área de upload tinham ajuda. O relatório estático apontava o input oculto
--   como campo sem "?".
-- CORREÇÃO (aditiva, idempotente): 1 chave NOVA para o anexador, na rota do cadastro de pessoa.
-- RD-38: ON CONFLICT (chave) DO UPDATE — re-rodar não duplica.
-- Não toca cálculo, RLS nem dado de cliente: só texto de ajuda num catálogo global.
-- Code: desenvolvedor_4_g
-- ============================================================================

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('cadastros.pessoa.anexos', '/dashboard/cadastros/pessoa', 'Anexos', 'Contratos & anexos',
   'Arraste um arquivo para a área ou clique para escolher: contrato, documento ou foto ligada a este cliente/fornecedor. Aceita PDF, JPG, PNG ou WebP, até 10 MB cada.',
   'Guarda os documentos do cadastro no próprio cliente/fornecedor — contrato assinado, cartão CNPJ, comprovantes — para achar tudo num lugar só, sem procurar em e-mail ou pasta.',
   'contrato-assinado.pdf', 'Arquivo acima de 10 MB ou em formato não aceito (ex.: .docx, .zip) não sobe — converta para PDF ou reduza a imagem antes.', 'gestao_empresarial', 35)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, atualizado_em = now();
