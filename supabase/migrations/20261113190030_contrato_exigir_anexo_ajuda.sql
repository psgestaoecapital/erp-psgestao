-- P2/Pdois · Contrato · item 2 (CEO na P2 11/11) · Code: rodrigo-code
-- RD-95 "?" do toggle "Exigir contrato assinado anexado para ativar" no painel de contratos
-- (/dashboard/contratos). O parâmetro por empresa já existe (erp_contratos_config.exigir_contrato_anexado,
-- migration 20261113163030 / PR #4680 no ar); esta migration só acrescenta o texto de ajuda do controle.
-- Aditiva e idempotente (catálogo global de ajuda, sem company_id, sem dado de cliente).
-- Prova RD-38:
--   antes:  SELECT count(*) FROM public.erp_ajuda_campo WHERE chave='ge.contratos.exigir_anexo';  => 0
--   depois: => 1 (nenhuma outra linha é tocada; ON CONFLICT DO NOTHING preserva o que existir).
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem)
VALUES
  ('ge.contratos.exigir_anexo', '/dashboard/contratos', 'Contratos · Configuração', 'gestao_empresarial',
   'Exigir contrato assinado anexado para ativar',
   'Ligue ou desligue. Ligado (padrão): o contrato só pode ser ativado depois que o contrato assinado for anexado. Desligado: o contrato pode ser ativado sem o anexo — nesse caso ele recebe um aviso permanente "Contrato não anexado", com atalho para anexar, até que alguém anexe.',
   'Define, só para esta empresa, se o anexo do contrato assinado é obrigatório na ativação. Útil para quem fecha o contrato antes de ter o PDF assinado em mãos e não quer travar a operação do financeiro.',
   'Uma produtora que ativa o contrato e começa a faturar no mesmo dia desliga a exigência; o aviso "Contrato não anexado" lembra de anexar depois, sem bloquear.',
   'Desligar não apaga a cobrança do anexo: o aviso continua aparecendo no contrato, na lista e no financeiro até o anexo entrar. Religar volta a exigir o anexo nas próximas ativações, sem mexer nos contratos já ativos.',
   1)
ON CONFLICT (chave) DO NOTHING;
