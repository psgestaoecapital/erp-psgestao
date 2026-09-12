-- ============================================================
-- Oficina Onda 1 · 3.4 (fix) — remover o overload ANTIGO de fn_oficina_apontamento_iniciar
-- ============================================================
-- Defeito (RD-38): o #1410 adicionou o parâmetro p_mecanico_id via CREATE OR REPLACE, mas como o
-- parâmetro é NOVO, o Postgres NÃO substituiu a função — criou um SEGUNDO overload. Ficaram dois:
--   (uuid,uuid,uuid,text)         → ANTIGO, ainda grava mecanico_id = auth.uid() (o CLICADOR) ⟵ bug
--   (uuid,uuid,uuid,text,uuid)    → NOVO, executor correto (id do seletor/designado/NULL honesto)
-- Os chamadores atuais (tela de apontamento pré-3.3 e VisaoExecucaoModal) passam 4 args → caíam no
-- ANTIGO, então o bug do clicador seguia VIVO em produção mesmo com o #1410 mergeado.
--
-- Fix: derruba o overload antigo. Com só o de 5 args (todos com default no 4º/5º), uma chamada de 4
-- args resolve sem ambiguidade para a versão nova (p_mecanico_id = NULL → executor vem da designação
-- com id, senão NULL honesto — NUNCA o clicador). Corrige TODOS os chamadores de uma vez, inclusive
-- os que ainda não passam p_mecanico_id.

DROP FUNCTION IF EXISTS public.fn_oficina_apontamento_iniciar(uuid, uuid, uuid, text);
