-- ============================================================
-- Onda 7 · dívida técnica — remover o overload ANTIGO de fn_oficina_registro_salvar
-- ============================================================
-- Mesmo mecanismo do #1412: o parâmetro NOVO p_etapa entrou via CREATE OR REPLACE e criou um 2º
-- overload em vez de substituir. Ficaram dois:
--   (uuid,uuid,text,text,text)        → ANTIGO: grava foto SEM etapa
--   (uuid,uuid,text,text,text,text)   → NOVO: grava com etapa (default 'servico', valida recepcao/diagnostico/servico)
-- Chamadores: diagnostico/page.tsx já passa p_etapa='diagnostico' (novo); VisaoExecucaoModal caía no
-- ANTIGO (5 args) — corrigido no mesmo PR pra passar p_etapa='servico'.
-- Com só o de 6 args (p_etapa DEFAULT 'servico'), uma chamada de 5 args resolve sem ambiguidade para
-- o novo (etapa='servico'). Não perde nada: erp_os_registro_foto intacta (RD-61).

DROP FUNCTION IF EXISTS public.fn_oficina_registro_salvar(uuid, uuid, text, text, text);
