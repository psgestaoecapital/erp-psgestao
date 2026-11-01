-- Chamado #5175 · Frota › Manutenções: anexar documento ao registro de manutenção (histórico do veículo).
-- O backend já suportava (coluna erp_hub_frota_manutencao_registro.anexo_path + fn_hub_frota_manutencao_registrar
-- lê p_dados->>'anexo_path' + bucket privado frota-anexos). Faltava só o campo na tela e o "?" (RD-95).
-- Migration ADITIVA: só semeia a chave de ajuda do campo novo. Idempotente (ON CONFLICT).

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
  ('projetos.frota.manutencao_anexo', '/dashboard/projetos/frota', 'Frota', 'Anexo (nota ou laudo)',
   'Arquivo PDF ou imagem da nota, recibo ou laudo da manutenção (até 10 MB).',
   'Guarda o comprovante junto do registro, no histórico do veículo, para consulta depois.',
   'nota-oficina-2041.pdf',
   'Anexar uma foto ilegível: a nota ou laudo precisa estar legível.',
   'hub', 935, 'publicado')
ON CONFLICT (chave) DO NOTHING;
