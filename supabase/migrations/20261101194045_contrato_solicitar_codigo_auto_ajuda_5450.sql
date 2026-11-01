-- Chamado #5450 (gestao_empresarial) — "geração automática de código identificador"
-- O sistema JÁ gera o código do contrato automaticamente e em sequência por empresa
-- (next_contrato_numero → CTR-<ano>-<nnnn>; usado por fn_contrato_solicitar e pela tela
--  de contratos recorrentes). Prova em produção: a empresa 36b69d77 tem CTR-2026-0001..0010.
--
-- Esta migration só CORRIGE o texto de ajuda ("?") do campo "Código identificador" na tela
-- Solicitar contrato: o texto antigo dizia que era um código interno OPCIONAL digitado pelo
-- usuário (exemplo "FEE-2026-001"), contradizendo a UI (campo somente-leitura, gerado
-- automaticamente). Passa a explicar que é automático e sequencial. Sem mudança de dado de
-- cliente, sem RLS/grants — apenas uma linha de referência global em erp_ajuda_campo.

UPDATE public.erp_ajuda_campo
SET o_que_preencher = 'Nada. O sistema gera o código sozinho, em sequência, ao enviar a solicitação. O campo é somente leitura.',
    para_que_serve  = 'Identifica o contrato de forma única e em ordem (um número por contrato na empresa) para você localizar e referenciar.',
    exemplo         = 'CTR-2026-0001.',
    erro_comum      = 'Tentar digitar o código: ele é automático. O que você nomeia é o Título do contrato.',
    versao          = versao + 1,
    atualizado_em   = now()
WHERE chave = 'pm.solicitar_contrato.codigo';
