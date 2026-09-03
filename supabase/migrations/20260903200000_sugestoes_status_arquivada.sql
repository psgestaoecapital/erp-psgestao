-- Central de Melhorias: 'arquivada' vira um status válido (para tirar da fila sem apagar a memória).
--
-- As 11 anotações de abril (antes de a Central existir, sem foto/empresa, que nunca terão análise de
-- IA) poluíam a fila. Apagar perderia backlog de produto real ("modo competência/caixa no financeiro",
-- "Real x orçado no DRE", "integração Conta Azul e Nibo"). Então ARQUIVAR, não apagar: status
-- 'arquivada' sai da fila de atendimento e da lista "Minhas sugestões", mas fica consultável por filtro.
--
-- O CHECK sugestoes_status_fluxo_chk (NOT VALID) não aceitava 'arquivada' — nem 'implementado', que já
-- é usado por uma sugestão entregue (a do Rodrigo, 07/04). Acrescenta os dois. Mantém NOT VALID (não
-- revalida linhas antigas — há status legados grandfathered). A gravação das 10 sugestões pendentes →
-- 'arquivada' é limpeza de dado pontual (feita à mão, com prova rollback e OK do CEO), não migration.
ALTER TABLE public.sugestoes DROP CONSTRAINT IF EXISTS sugestoes_status_fluxo_chk;
ALTER TABLE public.sugestoes ADD CONSTRAINT sugestoes_status_fluxo_chk
  CHECK (status IS NULL OR status = ANY (ARRAY[
    'nova','em_analise','aceita','em_desenvolvimento','concluida','recusada','duplicada',
    'aberta','pendente','em_andamento','concluido','resolvida','implementado','arquivada'
  ]::text[])) NOT VALID;
