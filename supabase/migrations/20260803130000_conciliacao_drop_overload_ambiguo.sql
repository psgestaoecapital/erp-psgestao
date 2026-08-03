-- RD-41 · Conciliação — resolver overload AMBÍGUO de fn_conciliacao_aplicar_match.
-- URGENTE (Stephany, 30/07): ao incluir despesa direto na conciliação e conciliar o
-- PIX de R$ 220 (Billy Publicidades, match OURO 105%), a tela deu:
--   "Could not choose the best candidate function between: ...(p_origem) , ...(p_origem, p_motivo)"
--
-- RAIZ (auditada RD-38): coexistem 2 versões de fn_conciliacao_aplicar_match —
--   • ANTIGA (5 params): (..., p_origem text DEFAULT 'manual')
--   • NOVA  (6 params):  (..., p_origem text DEFAULT 'manual', p_motivo text DEFAULT NULL)
-- Ambas têm p_origem com DEFAULT, então uma chamada com 5 args casa nas DUAS →
-- Postgres não escolhe → erro de ambiguidade. Todos os 6 callers do front passam
-- exatamente esses 5 args nomeados (p_origem, sem p_motivo) — logo TODO caminho de
-- conciliação estava sujeito ao erro.
--
-- FIX (decisão 🅰️, cirúrgico · RD-26): dropar SÓ a versão ANTIGA (5 params). A NOVA é
-- SUPERSET dela (auditado: mesma validação/score/UPDATE/aprendizado de regra + registra
-- o motivo em obs + guarda de baixa confiança) e, pelos DEFAULTs, atende chamadas de 5 e
-- 6 args. Nenhuma função é recriada — só se remove a duplicata. Sem perda de comportamento
-- para o fluxo normal (match de alta confiança, ≥70, segue aplicando sem motivo).

-- Remover APENAS a versão antiga (5 parâmetros, sem p_motivo).
DROP FUNCTION IF EXISTS public.fn_conciliacao_aplicar_match(uuid, text, uuid, uuid, text);

-- (A versão NOVA — com p_motivo — permanece, já com GRANT authenticated/anon/service_role.)
