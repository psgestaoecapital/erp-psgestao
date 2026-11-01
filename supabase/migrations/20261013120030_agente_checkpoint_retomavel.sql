-- Tarefas longas RETOMÁVEIS por checkpoint (CEO 13/10 · rodrigo-code · faixa de segundos 30).
--
-- Problema: os Codes rodam em ciclos curtos e MORREM no meio de tarefas longas (rebase, resolução de conflito, PR
-- multi-arquivo). A tarefa fica "em_andamento" e vira órfã: o despertador (fn_agente_despertador) re-enfileira a mais
-- antiga quando a lease (erp_agente_sessao_lease, 12 min) expira, mas o Code REINICIA do zero porque não há onde guardar
-- o progresso. Esta migration dá um lugar para o progresso e faz a retomada continuar de onde parou.
--
-- É ADITIVA: 2 colunas novas em erp_agente_mensagem + 2 funções novas (só canal protegido) + extensão ADITIVA da
-- fn_agente_caixa (passa a devolver checkpoint/etapa; mesmas chaves de antes + 2). Não cria nem altera função de guarda
-- (RD-91). Sem DROP/DELETE/TRUNCATE. O checkpoint é preservado no re-enfileiramento da órfã por construção: o
-- despertador nunca escreve essas colunas, e gravar o checkpoint conta como PROGRESSO (zera redisparos, mexe
-- atualizado_em), então a tarefa que avança não bate o teto de redisparos.

ALTER TABLE public.erp_agente_mensagem
  ADD COLUMN IF NOT EXISTS checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS etapa text;

COMMENT ON COLUMN public.erp_agente_mensagem.checkpoint IS
  'Progresso de tarefa longa retomável: { etapa, feito:[...], proximo, dados }. Gravado por fn_agente_checkpoint_gravar; preservado quando o despertador re-enfileira a órfã.';
COMMENT ON COLUMN public.erp_agente_mensagem.etapa IS
  'Rótulo curto da etapa atual da tarefa longa, para a retomada continuar do "proximo".';

-- WRITER: grava o checkpoint e RENOVA a lease (um passo longo não é declarado morto no meio). Só pelo canal protegido.
-- ci-sem-guarda: fn_agente_checkpoint_gravar — escreve só na caixa de agentes (erp_agente_mensagem, sem company_id) e no lease da sessão; canal protegido por fn__agente_assert_servico (auth.uid() IS NULL = conexão de serviço); sem dado de cliente.
CREATE OR REPLACE FUNCTION public.fn_agente_checkpoint_gravar(
  p_mensagem_id uuid, p_agente text, p_etapa text DEFAULT NULL, p_checkpoint jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE m record;
BEGIN
  PERFORM public.fn__agente_assert_servico();
  SELECT * INTO m FROM erp_agente_mensagem WHERE id = p_mensagem_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'mensagem_nao_encontrada'); END IF;
  IF m.para <> p_agente THEN RETURN jsonb_build_object('ok', false, 'erro', 'mensagem_de_outro_agente'); END IF;
  IF m.status IN ('concluida','recusada') THEN RETURN jsonb_build_object('ok', false, 'erro', 'mensagem_encerrada'); END IF;
  IF m.tipo = 'tarefa' AND m.requer_ok_ceo AND m.ok_ceo_em IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'aguarda_ok_ceo');
  END IF;
  UPDATE erp_agente_mensagem SET
    checkpoint     = COALESCE(p_checkpoint, '{}'::jsonb),
    etapa          = NULLIF(btrim(COALESCE(p_etapa, '')), ''),
    status         = 'em_andamento',
    recebida_em    = COALESCE(recebida_em, now()),
    iniciada_em    = COALESCE(iniciada_em, now()),
    redisparos     = 0,            -- checkpoint É progresso: zera o contador de redisparos seguidos sem progresso
    alerta_teto_em = NULL,
    atualizado_em  = now()         -- reinicia o recuo do despertador (gate atualizado_em < now() - recuo)
  WHERE id = p_mensagem_id;
  -- renova a vez da sessão ativa: um passo longo (rebase/arquivo) não pode ser declarado morto no meio
  UPDATE erp_agente_sessao_lease SET renovada_em = now() WHERE agente = p_agente;
  RETURN jsonb_build_object('ok', true, 'id', p_mensagem_id,
    'etapa', NULLIF(btrim(COALESCE(p_etapa, '')), ''), 'checkpoint', COALESCE(p_checkpoint, '{}'::jsonb));
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_agente_checkpoint_gravar(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agente_checkpoint_gravar(uuid, text, text, jsonb) TO service_role;

-- READER: lê o checkpoint para a retomada continuar do "proximo". Só leitura; canal protegido.
CREATE OR REPLACE FUNCTION public.fn_agente_checkpoint_ler(p_mensagem_id uuid, p_agente text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE m record;
BEGIN
  PERFORM public.fn__agente_assert_servico();
  SELECT id, para, status, etapa, checkpoint INTO m
    FROM erp_agente_mensagem WHERE id = p_mensagem_id AND para = p_agente;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'mensagem_nao_encontrada'); END IF;
  RETURN jsonb_build_object('ok', true, 'id', m.id, 'status', m.status, 'etapa', m.etapa,
    'checkpoint', COALESCE(m.checkpoint, '{}'::jsonb),
    'retomar', (m.checkpoint IS NOT NULL AND m.checkpoint <> '{}'::jsonb));
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_agente_checkpoint_ler(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agente_checkpoint_ler(uuid, text) TO service_role;

-- fn_agente_caixa: passa a devolver checkpoint/etapa de cada mensagem → a retomada é automática ao ler a caixa.
-- Re-criação ADITIVA: mesmas chaves de antes + etapa/checkpoint. A ACL é re-aplicada idêntica à de antes
-- (service_role; nunca PUBLIC/anon/authenticated), porque CREATE OR REPLACE reseta o ACL para o padrão.
-- ci-sem-guarda: fn_agente_caixa — lê e marca "recebida" só na caixa de agentes (erp_agente_mensagem, sem company_id); canal protegido por fn__agente_assert_servico; sem dado de cliente.
CREATE OR REPLACE FUNCTION public.fn_agente_caixa(p_agente text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  PERFORM public.fn__agente_assert_servico();
  IF NOT EXISTS (SELECT 1 FROM erp_agente_rotina WHERE agente = p_agente) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'agente_desconhecido');
  END IF;
  UPDATE erp_agente_mensagem SET status = 'recebida', recebida_em = now(), atualizado_em = now()
   WHERE para = p_agente AND status = 'nova' AND NOT arquivada;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', id, 'de', de, 'tipo', tipo, 'assunto', assunto, 'corpo', corpo, 'status', status,
           'requer_ok_ceo', requer_ok_ceo, 'ok_ceo_em', ok_ceo_em, 'ok_ceo_origem', ok_ceo_origem,
           'enviado_por', enviado_por, 'ok_registrado_por', ok_registrado_por,
           -- com OK pendente, o Code NÃO executa: só lê e aguarda
           'pode_executar', (NOT requer_ok_ceo OR ok_ceo_em IS NOT NULL),
           -- tarefa longa retomável: a próxima rodada continua do "proximo" do checkpoint
           'etapa', etapa, 'checkpoint', COALESCE(checkpoint, '{}'::jsonb),
           'criado_em', criado_em) ORDER BY criado_em), '[]'::jsonb)
    INTO v
    FROM erp_agente_mensagem
   WHERE para = p_agente AND status IN ('recebida','em_andamento') AND NOT arquivada;
  RETURN jsonb_build_object('ok', true, 'agente', p_agente, 'mensagens', v);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_agente_caixa(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agente_caixa(text) TO service_role;
