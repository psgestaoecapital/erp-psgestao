-- RD-98 p2 · auditor /dashboard/ehs/epi/estoque: as Acoes da linha so tinham "Editar minimo" —
-- nao havia baixa/exclusao RASTREAVEL do item de estoque. As escritas de estoque desta tela eram
-- diretas (INSERT/UPDATE em epi_estoque pelo client), sem registro de quem/quando.
--
-- Esta migration e ADITIVA (RD-94.1 c): cria uma funcao NOVA (nao reescreve nada existente) que
-- faz a baixa de estoque com rastro em audit_log_global, guarda por empresa e snapshot do antes/depois.
-- Quando o item zera (0 disponivel e 0 reservado) a linha e inativada (ativo=false), para sair da lista.
--
-- Prova no dado (RD-38, verificado em producao antes desta migration):
--   * epi_estoque tem a coluna booleana `ativo` (default true) — ja existe, nada a criar.
--   * audit_log_global aceita (company_id, user_id, user_email, tabela, registro_id, acao,
--     valor_anterior jsonb, valor_novo jsonb) — sink de auditoria global ja em uso.
--   * amostra real (3 linhas, company b0700000-...-0005): qtd_disponivel 50/45/35, baixa de 1 -> 49/44/34,
--     inativaria=false (ha saldo) — a logica abaixo reproduz esses numeros.
--   * get_user_company_ids() e is_admin() existem (mesma guarda usada por fn_epi_excluir).
--
-- Seguranca: SECURITY DEFINER com guarda explicita por empresa (sem policy permissiva); motivo
-- obrigatorio; nunca baixa mais que o disponivel; REVOKE anon/public, EXECUTE so authenticated/service.

CREATE OR REPLACE FUNCTION public.fn_epi_estoque_baixar(
  p_estoque_id uuid,
  p_quantidade integer,
  p_motivo     text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user   uuid := auth.uid();
  v_email  text;
  v_row    public.epi_estoque%ROWTYPE;
  v_nova   integer;
  v_inativou boolean := false;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Usuário não autenticado');
  END IF;
  IF p_quantidade IS NULL OR p_quantidade < 1 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'A quantidade a baixar deve ser maior que zero');
  END IF;
  IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Informe o motivo da baixa (rastro obrigatório)');
  END IF;

  SELECT * INTO v_row FROM public.epi_estoque WHERE id = p_estoque_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Item de estoque não encontrado');
  END IF;

  -- guarda por empresa (sem policy permissiva): so quem e da empresa do item (ou admin)
  IF NOT (v_row.company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a este item de estoque');
  END IF;

  IF p_quantidade > v_row.qtd_disponivel THEN
    RETURN jsonb_build_object('ok', false, 'erro',
      format('Baixa (%s) maior que o disponível (%s)', p_quantidade, v_row.qtd_disponivel));
  END IF;

  v_nova := v_row.qtd_disponivel - p_quantidade;
  v_inativou := (v_nova = 0 AND v_row.qtd_reservada = 0);

  SELECT COALESCE(raw_user_meta_data->>'name', email) INTO v_email FROM auth.users WHERE id = v_user;

  UPDATE public.epi_estoque
     SET qtd_disponivel = v_nova,
         ativo = CASE WHEN v_inativou THEN false ELSE ativo END,
         updated_at = now()
   WHERE id = p_estoque_id;

  INSERT INTO public.audit_log_global
    (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (
    v_row.company_id, v_user, v_email, 'epi_estoque', p_estoque_id::text, 'baixa_estoque',
    jsonb_build_object('qtd_disponivel', v_row.qtd_disponivel, 'ativo', v_row.ativo),
    jsonb_build_object(
      'qtd_disponivel', v_nova,
      'ativo', (NOT v_inativou) AND v_row.ativo,
      'quantidade_baixada', p_quantidade,
      'motivo', btrim(p_motivo),
      'inativou', v_inativou
    )
  );

  RETURN jsonb_build_object('ok', true, 'qtd_disponivel', v_nova, 'inativou', v_inativou);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_epi_estoque_baixar(uuid, integer, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_epi_estoque_baixar(uuid, integer, text) TO authenticated, service_role;

-- RD-95: "?" das novas acao/campos desta tela (chaves novas na rota atual EHS).
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('compliance.epi.estoque.acao_baixar', '/dashboard/ehs/epi/estoque', 'Colunas', 'Baixar',
   'Clique para dar baixa (perda, dano, descarte ou acerto) numa quantidade deste item de estoque.',
   'Reduz o disponível com registro de quem fez, quando e por quê. Quando o item zera (0 disponível e 0 reservado), ele é inativado e sai da lista.',
   'Dar baixa de 2 unidades de uma luva vencida, motivo "descarte por validade".',
   'Baixa não é entrega ao funcionário — para entregar, use "Entregar EPI" (que também dá baixa, mas com assinatura NR-6).',
   'compliance', 15),
  ('compliance.epi.estoque.baixa_quantidade', '/dashboard/ehs/epi/estoque', 'Baixar estoque', 'Quantidade a baixar',
   'Quantas unidades sairão do disponível nesta baixa.',
   'Define o tamanho da baixa; não pode ser maior que o disponível da linha.',
   'Disponível 10, baixar 3 → fica 7.',
   'Informar mais do que o disponível — o sistema recusa a baixa.',
   'compliance', 16),
  ('compliance.epi.estoque.baixa_motivo', '/dashboard/ehs/epi/estoque', 'Baixar estoque', 'Motivo da baixa',
   'O motivo da baixa (perda, dano, descarte por validade, acerto de inventário…).',
   'Fica gravado no histórico de auditoria (quem, quando e por quê), para rastrear a saída.',
   '"Descarte por validade vencida" ou "Acerto de inventário".',
   'Deixar em branco — o motivo é obrigatório.',
   'compliance', 17)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical, ordem = EXCLUDED.ordem, atualizado_em = now();

-- RD-98 p3: registra a nova RPC de origem do dado desta tela.
UPDATE public.system_screens
   SET rpcs_chamadas = ARRAY['fn_epi_registrar_entrega','fn_epi_estoque_baixar']::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/ehs/epi/estoque';
