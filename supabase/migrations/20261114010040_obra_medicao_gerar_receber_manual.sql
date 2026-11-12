-- Elo "medição aprovada -> conta a receber": ação manual + backfill DEMO.
--
-- Contexto (RD-38): o trigger trg_obra_medicao_gerar_receber / fn_obra_medicao_gerar_receber (#4397,
-- publicado 10/11 17:08Z) só dispara na TRANSIÇÃO para status='aprovada'. Medições aprovadas ANTES
-- do trigger ficaram sem título a receber e a tela (#4398) não tinha ação para gerá-lo. Resultado:
-- a jornada "a obra vira receita" falhava sobre dado já existente.
--
-- Esta migração:
--  1) cria a RPC fn_obra_medicao_gerar_receber_manual(p_medicao_id) — idempotente, com a MESMA guarda
--     do trigger (ref_externa_sistema='obra_medicao' + ref_externa_id; só aprovada/não excluída/valor>0),
--     para o usuário gerar o título da medição aprovada que ficou sem ele. Sem recebível fantasma
--     automático: o usuário decide (clientes que já faturaram por fora não ganham cobrança duplicada).
--  2) faz o backfill SÓ em companies.is_demo=true (idempotente), para a DEMO demonstrar o elo ponta a ponta.
--  3) semeia o "?" (RD-95) da nova ação.
--
-- Segurança: RPC SECURITY DEFINER + fn__guarda_empresa (RLS por empresa). REVOKE anon. Aditiva —
-- nenhum dado de cliente é alterado/apagado; o backfill só INSERE títulos novos para medições DEMO
-- sem título vivo (não toca título pago nem dado de cliente real).

-- 1) RPC manual ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_obra_medicao_gerar_receber_manual(p_medicao_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_med record; v_obra record; v_ref text; v_desc text; v_venc date; v_receber_id uuid;
BEGIN
  SELECT id, obra_id, status, excluido_em, valor_total, numero
    INTO v_med FROM projetos_obra_medicao WHERE id = p_medicao_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Medição não encontrada.');
  END IF;

  SELECT id, company_id, cliente_id, cliente_nome, centro_custo_id, numero, nome
    INTO v_obra FROM projetos_obras WHERE id = v_med.obra_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Obra da medição não encontrada.');
  END IF;

  -- RLS por empresa (exige usuário logado com acesso à empresa da obra).
  PERFORM public.fn__guarda_empresa(v_obra.company_id);

  IF NOT (v_med.status = 'aprovada' AND v_med.excluido_em IS NULL AND COALESCE(v_med.valor_total, 0) > 0) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Só medição aprovada, não excluída e com valor gera conta a receber.');
  END IF;

  v_ref := v_med.id::text;

  -- IDEMPOTENTE: já existe título vivo para esta medição?
  SELECT id INTO v_receber_id FROM erp_receber
   WHERE ref_externa_sistema = 'obra_medicao' AND ref_externa_id = v_ref
     AND deleted_at IS NULL AND status <> 'cancelado'
   LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'ja_existia', true, 'receber_id', v_receber_id);
  END IF;

  v_venc := CURRENT_DATE + 30;  -- mesmo prazo do trigger: 30 dias
  v_desc := format('Medição %s - Obra %s', COALESCE(v_med.numero::text, '?'), COALESCE(v_obra.nome, v_obra.numero, 'obra'));

  INSERT INTO erp_receber (
    company_id, cliente_id, cliente_nome, descricao, categoria, valor,
    data_emissao, data_vencimento, data_competencia, status, centro_custo_id,
    origem_recebivel_id, ref_externa_id, ref_externa_sistema, observacoes, created_at
  ) VALUES (
    v_obra.company_id, v_obra.cliente_id, v_obra.cliente_nome, v_desc, 'Medição de obra', v_med.valor_total,
    CURRENT_DATE, v_venc, date_trunc('month', v_venc)::date, 'aberto', v_obra.centro_custo_id,
    v_med.id, v_ref, 'obra_medicao',
    format('Gerado manualmente da medição %s (obra %s) em %s', COALESCE(v_med.numero::text, '?'), COALESCE(v_obra.numero, '?'), now()::date),
    now()
  ) RETURNING id INTO v_receber_id;

  RETURN jsonb_build_object('ok', true, 'ja_existia', false, 'receber_id', v_receber_id);
END
$function$;

REVOKE ALL ON FUNCTION public.fn_obra_medicao_gerar_receber_manual(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_obra_medicao_gerar_receber_manual(uuid) TO authenticated;

-- 2) Backfill DEMO (idempotente, SÓ is_demo) ----------------------------------
DO $backfill$
DECLARE v_antes int; v_depois int;
BEGIN
  SELECT count(*) INTO v_antes FROM erp_receber
   WHERE ref_externa_sistema = 'obra_medicao' AND deleted_at IS NULL AND status <> 'cancelado';

  INSERT INTO erp_receber (
    company_id, cliente_id, cliente_nome, descricao, categoria, valor,
    data_emissao, data_vencimento, data_competencia, status, centro_custo_id,
    origem_recebivel_id, ref_externa_id, ref_externa_sistema, observacoes, created_at
  )
  SELECT o.company_id, o.cliente_id, o.cliente_nome,
         format('Medição %s - Obra %s', COALESCE(m.numero::text, '?'), COALESCE(o.nome, o.numero, 'obra')),
         'Medição de obra', m.valor_total,
         CURRENT_DATE, CURRENT_DATE + 30, date_trunc('month', (CURRENT_DATE + 30))::date, 'aberto', o.centro_custo_id,
         m.id, m.id::text, 'obra_medicao',
         format('Backfill DEMO da medição %s (obra %s): elo medição→receber retroativo ao trigger #4397', COALESCE(m.numero::text, '?'), COALESCE(o.numero, '?')),
         now()
  FROM projetos_obra_medicao m
  JOIN projetos_obras o ON o.id = m.obra_id
  JOIN companies c ON c.id = o.company_id AND c.is_demo = true
  WHERE m.status = 'aprovada' AND m.excluido_em IS NULL AND COALESCE(m.valor_total, 0) > 0
    AND NOT EXISTS (
      SELECT 1 FROM erp_receber r
       WHERE r.ref_externa_sistema = 'obra_medicao' AND r.ref_externa_id = m.id::text
         AND r.deleted_at IS NULL AND r.status <> 'cancelado'
    );

  SELECT count(*) INTO v_depois FROM erp_receber
   WHERE ref_externa_sistema = 'obra_medicao' AND deleted_at IS NULL AND status <> 'cancelado';

  RAISE NOTICE 'Backfill DEMO obra_medicao: % -> % titulos vivos', v_antes, v_depois;
END
$backfill$;

-- 3) Ajuda "?" (RD-95) da nova ação -------------------------------------------
INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES (
  'projetos.medicao.gerar_receber',
  '/dashboard/projetos/obras/[id]/medicoes',
  'Medições',
  'Gerar conta a receber',
  'Nada a preencher — é um botão. Aparece na medição aprovada que ainda NÃO tem título a receber (ex.: medições aprovadas antes de o elo automático existir).',
  'Gera, de forma segura e sem duplicar, o título a receber do cliente para aquela medição aprovada, fechando o elo medição → faturamento sem precisar lançar no financeiro à mão.',
  'Medição nº 1 aprovada por R$ 84.500 sem cobrança → clique em "Gerar conta a receber" → aparece "Conta a receber gerada · R$ 84.500,00 · aberto". Clicar de novo não duplica.',
  'Usar em medição ainda em rascunho (só a aprovada gera) ou esperar título automático em medição aprovada antiga: estas precisam do botão uma vez.',
  'hub_projetos',
  13,
  'publicado'
)
ON CONFLICT (chave) DO NOTHING;
