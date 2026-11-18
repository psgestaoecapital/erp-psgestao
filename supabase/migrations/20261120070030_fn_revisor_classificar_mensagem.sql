-- Governança (CEO 18/11, gargalo do #9800): requer_ok_ceo deve disparar por DECISÃO NOVA de grupo protegido,
-- NÃO por ÁREA. Hoje o Code marca requer_ok_ceo=true por "qualquer coisa no financeiro", então um detalhe de
-- implementação de um spec JÁ DECIDIDO (ex.: #9800 — a receber usa conta_bancaria_id FK; a pagar usa
-- conta_bancaria texto) para no CEO como se fosse decisão nova. O revisor vira o gate inteligente: depois de
-- auditar o PR, classifica a mensagem — libera (requer_ok_ceo=false) o que só implementa spec gravado, ou escala
-- (requer_ok_ceo=true) se achar decisão nova protegida.
--
-- Ponto de controle: fn_revisor_classificar_mensagem (só canal de serviço = o revisor). NUNCA grava ok_ceo_em —
-- esse campo continua EXCLUSIVO do CEO (fn_agente_mensagem_ok_ceo). O pode_executar da fn_agente_caixa deriva de
-- (NOT requer_ok_ceo OR ok_ceo_em IS NOT NULL): ao liberar (false), pode_executar vira true sem OK do CEO; ao
-- escalar (true), continua travado até o CEO. Toda reclassificação fica em acionamento_historico (auditável).
--
-- Provado no dado (RD-38, BEGIN..ROLLBACK, na própria msg cdd5e3bc do #9800): reclassificar(false) → requer_ok_ceo
-- true→false, ok_ceo_em INTACTO (NULL), trilha +1, pode_executar=true. SENSÍVEL (muda o mecanismo de aprovação) →
-- MERGE AUTORIZADO do CEO.

CREATE OR REPLACE FUNCTION public.fn_revisor_classificar_mensagem(
  p_mensagem_id uuid, p_requer_ok_ceo boolean, p_motivo text, p_spec_ref text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE m record;
BEGIN
  -- Só o canal protegido (revisor/serviço). Usuário logado NÃO classifica (igual fn_agente_mensagem_ok_ceo).
  PERFORM public.fn__agente_assert_servico();

  IF p_requer_ok_ceo IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'requer_ok_ceo_obrigatorio'); END IF;
  IF NULLIF(btrim(COALESCE(p_motivo, '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'motivo_obrigatorio'); END IF;

  SELECT * INTO m FROM erp_agente_mensagem WHERE id = p_mensagem_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'mensagem_nao_encontrada'); END IF;

  UPDATE erp_agente_mensagem SET
    requer_ok_ceo = p_requer_ok_ceo,
    -- ao LIBERAR (false): marca a origem como decisão auditada do revisor. ao ESCALAR (true): preserva a origem
    -- (o OK real continua sendo do CEO). NUNCA toca ok_ceo_em.
    ok_ceo_origem = CASE WHEN NOT p_requer_ok_ceo THEN 'revisor:' || btrim(p_motivo) ELSE ok_ceo_origem END,
    atualizado_em = now(),
    acionamento_historico = acionamento_historico || jsonb_build_object(
      'evento', 'revisor_classificar', 'em', now(), 'por', 'revisor',
      'requer_ok_ceo', p_requer_ok_ceo, 'motivo', btrim(p_motivo), 'spec_ref', p_spec_ref)
  WHERE id = p_mensagem_id;

  SELECT * INTO m FROM erp_agente_mensagem WHERE id = p_mensagem_id;
  RETURN jsonb_build_object(
    'ok', true,
    'id', p_mensagem_id,
    'requer_ok_ceo', m.requer_ok_ceo,
    'pode_executar', (NOT m.requer_ok_ceo OR m.ok_ceo_em IS NOT NULL),
    'ok_ceo_origem', m.ok_ceo_origem,
    'classificado', jsonb_build_object('requer_ok_ceo', p_requer_ok_ceo, 'motivo', btrim(p_motivo), 'spec_ref', p_spec_ref));
END;
$function$;

-- ACL explícita (fail-closed): nunca anon; só o canal de serviço (revisor). A guarda interna recusa JWT.
REVOKE ALL ON FUNCTION public.fn_revisor_classificar_mensagem(uuid, boolean, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_revisor_classificar_mensagem(uuid, boolean, text, text) TO service_role;

-- Regra nova no catálogo de RDs. OBS: o SPEC pediu "RD-43", mas 43 já está ocupada (erp_contexto_projeto /
-- draft-até-resposta, vigentes) — registrada como RD-103 (próximo livre) para não sobrescrever regra vigente.
-- O CEO/revisor renumera na revisão se preferir.
INSERT INTO public.erp_rd_catalogo (numero, sufixo, titulo, texto, tier, gate_tipo, gate, status, origem)
SELECT 103, '', 'requer_ok_ceo dispara por DECISÃO NOVA de grupo protegido, não por ÁREA; revisor classifica pós-auditoria',
  'Exige OK do CEO (requer_ok_ceo=true) SOMENTE quando a mudança introduz decisão nova de grupo protegido: ' ||
  '(1) cria/altera conta bancária ou muda COMO o dinheiro se move (baixa, pagamento, transferência, estorno, ' ||
  'rateio de valores); (2) muda acesso/RBAC/papel; (3) toca vault/segredos; (4) muda assinatura/plano ' ||
  '(tenant_subscriptions); (5) adota política fiscal nova com impacto tributário real. NÃO exige (revisor audita ' ||
  'e libera): implementa spec/decisão já gravado; bugfix, leitura/consulta, wiring a coluna/estrutura existente, ' ||
  'refactor, performance, texto/UX, RD-98/RD-95. Teste de ouro: decide algo novo sobre dinheiro/acesso = CEO; ' ||
  'executa o já decidido = revisor. Ponto de controle: fn_revisor_classificar_mensagem (só service_role, pós-auditoria). ' ||
  'ok_ceo_em continua EXCLUSIVO do CEO (fn_agente_mensagem_ok_ceo); o CEO pode sempre forçar requer_ok_ceo=true (override pra cima). ' ||
  'Pedida como "RD-43" no SPEC; 43 estava ocupada, registrada como RD-103.',
  'lei', 'processo', 'fn_revisor_classificar_mensagem + revisao-eng-chefe', 'vigente', 'CEO 18/11 (gargalo #9800)'
WHERE NOT EXISTS (SELECT 1 FROM public.erp_rd_catalogo WHERE numero = 103 AND sufixo = '');
