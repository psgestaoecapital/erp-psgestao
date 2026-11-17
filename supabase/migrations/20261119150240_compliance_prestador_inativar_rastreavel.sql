-- PDCA Compliance/EHS · /dashboard/ehs/prestadores · aud8claudeps 17/11 (RD-98 p2)
-- Gap: não havia como EXCLUIR/INATIVAR um prestador (só incluir e editar). A API já tinha um
--   DELETE que fazia ativo=false, mas (a) não era rastreável (sem quem/quando/motivo/audit) e
--   (b) não estava exposto na tela. Esta migration dá o trilho durável da inativação; a tela e a
--   rota passam a usá-lo. NUNCA DELETE físico — documentos e histórico do prestador ficam.
-- Aditivo: colunas novas + 1 chave de ajuda (RD-95). Não altera dado de cliente, não mexe em RLS.

ALTER TABLE public.compliance_prestadores
  ADD COLUMN IF NOT EXISTS inativado_em timestamptz,
  ADD COLUMN IF NOT EXISTS inativado_por uuid,
  ADD COLUMN IF NOT EXISTS inativado_motivo text;

-- RD-95: "?" da nova ação de inativar
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES (
  'compliance.prestadores.inativar', '/dashboard/ehs/prestadores', 'Prestadores PJ/MEI', 'Inativar',
  'Nada a preencher aqui: a ação remove o prestador da lista de ativos. Ao usar, informe o motivo da inativação.',
  'Encerra o vínculo com o prestador sem apagar nada: ele sai da lista de ativos, mas os documentos e o histórico ficam guardados e a ação fica registrada (quem, quando e por quê). O prestador pode ser reativado depois.',
  'Inativar um prestador cujo contrato encerrou, informando "contrato encerrado em 11/2026".',
  'Achar que inativar apaga os documentos do prestador — não apaga; é reversível (reativação).',
  'compliance', 10, 1, 'publicado'
)
ON CONFLICT (chave) DO NOTHING;
