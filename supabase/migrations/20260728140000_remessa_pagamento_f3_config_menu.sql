-- REMESSA CNAB 240 · F3 — config do DV da agência (lacuna do perfil) + módulo/menu da tela do operador.
-- RD-51: o DV da agência não existia na config; sem ele não se gera arquivo (validado no mapeador).

ALTER TABLE public.erp_banco_provider_config
  ADD COLUMN IF NOT EXISTS agencia_dv text;   -- DV da agência/cooperativa p/ o header CNAB (confirmar na homologação)

COMMENT ON COLUMN public.erp_banco_provider_config.agencia_dv IS
  'Dígito verificador da agência/cooperativa para a remessa CNAB 240. Preencher e validar em homologação antes de gerar arquivo.';

-- Módulo da tela de remessa de pagamento (grupo financeiro).
INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, layer, icone, rota, ordem, ativo, is_shared, descricao)
VALUES ('financeiro_remessa_pagamento', 'Remessa de Pagamento', 'gestao_empresarial', 'financeiro', '2_operational',
        '💸', '/dashboard/financeiro/remessa-pagamento', 240, true, true,
        'Pagamento em lote via arquivo de remessa CNAB 240 (Sicoob): seleção de títulos, confirmação e geração do .rem.')
ON CONFLICT (id) DO NOTHING;

-- Permissões: quem opera pagamento (gestor/BPO) lê e cria. Ninguém mais por padrão. RLS ainda exige
-- fn_acessos_pode_gerir para gravar (dupla trava — dinheiro saindo).
INSERT INTO public.role_permissions (role, module_id, action, is_allowed)
SELECT r.role, 'financeiro_remessa_pagamento', a.action,
       CASE WHEN r.role IN ('CLIENT_OWNER','CLIENT_MANAGER','PS_ADMIN','PS_SUPPORT') THEN true ELSE false END
FROM (VALUES ('CLIENT_OWNER'),('CLIENT_MANAGER'),('CLIENT_OPERATOR'),('CLIENT_VIEWER'),('PS_ADMIN'),('PS_SUPPORT')) AS r(role)
CROSS JOIN (VALUES ('read'),('create')) AS a(action)
ON CONFLICT DO NOTHING;
