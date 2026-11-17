-- Hub · Medição ao cliente → conta a receber COM RETENÇÃO (INSS / ISS / IRRF) no líquido
-- SESSÃO DEDICADA 1 (Retenção/INSS/ISS). Espelha o lado subempreiteiro (#5244), agora no RECEBER
-- do cliente: o tomador retém na fonte e paga o líquido; o título a receber nasce pelo líquido.
--
-- ADITIVA e SEGURA (RD-38): os percentuais nascem com DEFAULT 0, logo
--   valor_retido = 0  e  valor_liquido = valor_total  para TODA medição já existente.
-- Com isso NENHUM título já gerado muda (os COALESCE/NEW.valor_liquido devolvem o valor_total).
-- A retenção só altera o título quando o usuário informa um percentual > 0 antes de aprovar.
-- RLS: as colunas herdam a RLS por empresa de projetos_obra_medicao; a RPC nova é SECURITY DEFINER
-- com fn__guarda_empresa; REVOKE anon/public + GRANT authenticated (mesmo padrão das demais RPCs).

-- 1) Percentuais de retenção (cabeçalho da medição). Default 0 = sem retenção.
ALTER TABLE public.projetos_obra_medicao
  ADD COLUMN IF NOT EXISTS inss_pct numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS iss_pct  numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS irrf_pct numeric NOT NULL DEFAULT 0;

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_obra_medicao_retencao_pct') THEN
    ALTER TABLE public.projetos_obra_medicao
      ADD CONSTRAINT chk_obra_medicao_retencao_pct
      CHECK (inss_pct >= 0 AND inss_pct <= 100
         AND iss_pct  >= 0 AND iss_pct  <= 100
         AND irrf_pct >= 0 AND irrf_pct <= 100
         AND (inss_pct + iss_pct + irrf_pct) <= 100);
  END IF;
END $do$;

-- 2) Valores derivados (auto-mantidos). Colunas geradas STORED: dispensam recálculo nas RPCs
--    e acompanham qualquer mudança de valor_total ou dos percentuais.
ALTER TABLE public.projetos_obra_medicao
  ADD COLUMN IF NOT EXISTS valor_retido numeric
    GENERATED ALWAYS AS (round(COALESCE(valor_total, 0) * (inss_pct + iss_pct + irrf_pct) / 100.0, 2)) STORED;

ALTER TABLE public.projetos_obra_medicao
  ADD COLUMN IF NOT EXISTS valor_liquido numeric
    GENERATED ALWAYS AS (COALESCE(valor_total, 0) - round(COALESCE(valor_total, 0) * (inss_pct + iss_pct + irrf_pct) / 100.0, 2)) STORED;

COMMENT ON COLUMN public.projetos_obra_medicao.inss_pct  IS 'Retenção de INSS na fonte (%) que o cliente desconta desta medição.';
COMMENT ON COLUMN public.projetos_obra_medicao.iss_pct   IS 'Retenção de ISS na fonte (%) que o cliente desconta desta medição.';
COMMENT ON COLUMN public.projetos_obra_medicao.irrf_pct  IS 'Retenção de IRRF na fonte (%) que o cliente desconta desta medição.';
COMMENT ON COLUMN public.projetos_obra_medicao.valor_retido  IS 'Soma das retenções (gerado): valor_total * (inss+iss+irrf)/100.';
COMMENT ON COLUMN public.projetos_obra_medicao.valor_liquido IS 'Valor líquido a receber (gerado): valor_total - valor_retido.';

-- 3) RPC para definir a retenção de uma medição em RASCUNHO (antes de aprovar/gerar o título).
CREATE OR REPLACE FUNCTION public.fn_obra_medicao_retencao_salvar(
  p_medicao_id uuid,
  p_inss_pct numeric DEFAULT 0,
  p_iss_pct  numeric DEFAULT 0,
  p_irrf_pct numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_med record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;

  SELECT m.id, m.status, m.excluido_em, o.company_id
    INTO v_med
    FROM public.projetos_obra_medicao m
    JOIN public.projetos_obras o ON o.id = m.obra_id
   WHERE m.id = p_medicao_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Medição não encontrada.'); END IF;

  PERFORM public.fn__guarda_empresa(v_med.company_id);

  IF v_med.excluido_em IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Medição excluída não aceita retenção.');
  END IF;
  IF v_med.status <> 'rascunho' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'A retenção só pode ser ajustada enquanto a medição está em rascunho (antes de aprovar e gerar o título).');
  END IF;

  p_inss_pct := COALESCE(p_inss_pct, 0);
  p_iss_pct  := COALESCE(p_iss_pct, 0);
  p_irrf_pct := COALESCE(p_irrf_pct, 0);
  IF p_inss_pct < 0 OR p_inss_pct > 100 OR p_iss_pct < 0 OR p_iss_pct > 100
     OR p_irrf_pct < 0 OR p_irrf_pct > 100 OR (p_inss_pct + p_iss_pct + p_irrf_pct) > 100 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Percentual de retenção inválido (cada um 0–100% e a soma até 100%).');
  END IF;

  UPDATE public.projetos_obra_medicao
     SET inss_pct = p_inss_pct, iss_pct = p_iss_pct, irrf_pct = p_irrf_pct, atualizado_em = now()
   WHERE id = p_medicao_id;

  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
  VALUES (v_med.company_id, auth.uid(), 'projetos_obra_medicao', p_medicao_id::text, 'RETENCAO',
          jsonb_build_object('inss_pct', p_inss_pct, 'iss_pct', p_iss_pct, 'irrf_pct', p_irrf_pct));

  RETURN (SELECT jsonb_build_object(
            'ok', true, 'medicao_id', id,
            'inss_pct', inss_pct, 'iss_pct', iss_pct, 'irrf_pct', irrf_pct,
            'valor_total', valor_total, 'valor_retido', valor_retido, 'valor_liquido', valor_liquido)
          FROM public.projetos_obra_medicao WHERE id = p_medicao_id);
END $function$;

REVOKE ALL ON FUNCTION public.fn_obra_medicao_retencao_salvar(uuid, numeric, numeric, numeric) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_obra_medicao_retencao_salvar(uuid, numeric, numeric, numeric) TO authenticated;

-- 4) listar: devolve os percentuais e os valores derivados (para a tela mostrar o líquido).
CREATE OR REPLACE FUNCTION public.fn_obra_medicao_listar(p_obra_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid;
  v_out jsonb;
BEGIN
  SELECT company_id INTO v_company FROM public.projetos_obras WHERE id = p_obra_id AND deleted_at IS NULL;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Obra não encontrada.'); END IF;
  PERFORM public.fn__guarda_empresa(v_company);

  SELECT COALESCE(jsonb_agg(row_to_json(m)::jsonb ORDER BY (m->>'numero')::int DESC), '[]'::jsonb) INTO v_out
  FROM (
    SELECT md.id, md.numero, md.tipo, md.competencia, md.status, md.valor_total, md.observacoes,
           md.inss_pct, md.iss_pct, md.irrf_pct, md.valor_retido, md.valor_liquido,
           md.aprovada_em, md.criado_em,
           (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                     'obra_item_id', mi.obra_item_id, 'descricao', it.descricao,
                     'percentual', mi.percentual, 'quantidade', mi.quantidade, 'valor', mi.valor,
                     'valor_contratado', COALESCE(it.valor_contratado, COALESCE(it.preco_unitario,0)*COALESCE(it.quantidade_contratada,0))
                   ) ORDER BY it.ordem NULLS LAST), '[]'::jsonb)
              FROM public.projetos_obra_medicao_item mi
              JOIN public.projetos_obra_item it ON it.id = mi.obra_item_id
             WHERE mi.medicao_id = md.id AND mi.excluido_em IS NULL) AS itens
      FROM public.projetos_obra_medicao md
     WHERE md.obra_id = p_obra_id AND md.excluido_em IS NULL
  ) m;

  RETURN jsonb_build_object('ok', true, 'obra_id', p_obra_id, 'medicoes', v_out);
END $function$;

-- Guarda explícita (check_fn_guards): espelha a ACL viva (sem anon/public).
REVOKE ALL ON FUNCTION public.fn_obra_medicao_listar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_medicao_listar(uuid) TO authenticated, service_role;

-- 5) Elo automático (trigger): o título a receber nasce pelo LÍQUIDO (valor_total - retenções).
CREATE OR REPLACE FUNCTION public.fn_obra_medicao_gerar_receber()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_obra record; v_desc text; v_venc date; v_ref text; v_valor numeric; v_retido numeric; v_nota text;
BEGIN
  v_ref := NEW.id::text;

  -- ESTORNO: medição excluída ou deixou de estar aprovada -> cancela o título ainda não pago.
  IF (TG_OP = 'UPDATE') AND (
        (NEW.excluido_em IS NOT NULL AND OLD.excluido_em IS NULL)
     OR (OLD.status = 'aprovada' AND NEW.status IS DISTINCT FROM 'aprovada')
     ) THEN
    UPDATE erp_receber SET status = 'cancelado', cancelado_em = now(), updated_at = now()
     WHERE ref_externa_sistema = 'obra_medicao' AND ref_externa_id = v_ref
       AND deleted_at IS NULL AND status IN ('aberto', 'vencido', 'previsto');
    RETURN NEW;
  END IF;

  -- GERAÇÃO: só quando aprovada, não excluída e com valor.
  IF NOT (NEW.status = 'aprovada' AND NEW.excluido_em IS NULL AND COALESCE(NEW.valor_total, 0) > 0) THEN
    RETURN NEW;
  END IF;
  -- só na transição para aprovada (não re-dispara em updates posteriores da mesma aprovação).
  IF TG_OP = 'UPDATE' AND OLD.status = 'aprovada' AND OLD.aprovada_em IS NOT DISTINCT FROM NEW.aprovada_em THEN
    RETURN NEW;
  END IF;
  -- IDEMPOTENTE: já existe título vivo para esta medição?
  IF EXISTS (SELECT 1 FROM erp_receber
              WHERE ref_externa_sistema = 'obra_medicao' AND ref_externa_id = v_ref
                AND deleted_at IS NULL AND status <> 'cancelado') THEN
    RETURN NEW;
  END IF;

  SELECT id, company_id, cliente_id, cliente_nome, centro_custo_id, numero, nome
    INTO v_obra FROM projetos_obras WHERE id = NEW.obra_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  -- Retenção na fonte: o cliente paga o líquido (bruto - INSS/ISS/IRRF). Default 0 => líquido = bruto.
  v_retido := COALESCE(NEW.valor_retido, 0);
  v_valor  := COALESCE(NEW.valor_liquido, NEW.valor_total);

  v_venc := CURRENT_DATE + 30;  -- vencimento padrão: 30 dias da aprovação
  v_desc := format('Medição %s - Obra %s', COALESCE(NEW.numero::text, '?'), COALESCE(v_obra.nome, v_obra.numero, 'obra'));
  v_nota := format('Gerado automaticamente da medição %s (obra %s) em %s', COALESCE(NEW.numero::text, '?'), COALESCE(v_obra.numero, '?'), now()::date);
  IF v_retido > 0 THEN
    v_nota := v_nota || format('. Retenção na fonte: INSS %s%% · ISS %s%% · IRRF %s%% = R$ %s retido sobre o bruto de R$ %s; líquido R$ %s.',
                               NEW.inss_pct, NEW.iss_pct, NEW.irrf_pct, round(v_retido,2), round(COALESCE(NEW.valor_total,0),2), round(v_valor,2));
  END IF;

  INSERT INTO erp_receber (
    company_id, cliente_id, cliente_nome, descricao, categoria, valor,
    data_emissao, data_vencimento, data_competencia, status, centro_custo_id,
    origem_recebivel_id, ref_externa_id, ref_externa_sistema, observacoes, created_at
  ) VALUES (
    v_obra.company_id, v_obra.cliente_id, v_obra.cliente_nome, v_desc, 'Medição de obra', v_valor,
    CURRENT_DATE, v_venc, date_trunc('month', v_venc)::date, 'aberto', v_obra.centro_custo_id,
    NEW.id, v_ref, 'obra_medicao', v_nota, now()
  );
  RETURN NEW;
END
$function$;

-- Guarda explícita (check_fn_guards): função de trigger, não exposta a chamada direta.
REVOKE ALL ON FUNCTION public.fn_obra_medicao_gerar_receber() FROM PUBLIC, anon;

-- 6) Geração manual (botão da tela): mesmo líquido/nota do elo automático.
CREATE OR REPLACE FUNCTION public.fn_obra_medicao_gerar_receber_manual(p_medicao_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_med record; v_obra record; v_ref text; v_desc text; v_venc date; v_receber_id uuid;
  v_valor numeric; v_retido numeric; v_nota text;
BEGIN
  SELECT id, obra_id, status, excluido_em, valor_total, numero,
         inss_pct, iss_pct, irrf_pct, valor_retido, valor_liquido
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

  v_retido := COALESCE(v_med.valor_retido, 0);
  v_valor  := COALESCE(v_med.valor_liquido, v_med.valor_total);

  v_venc := CURRENT_DATE + 30;  -- mesmo prazo do trigger: 30 dias
  v_desc := format('Medição %s - Obra %s', COALESCE(v_med.numero::text, '?'), COALESCE(v_obra.nome, v_obra.numero, 'obra'));
  v_nota := format('Gerado manualmente da medição %s (obra %s) em %s', COALESCE(v_med.numero::text, '?'), COALESCE(v_obra.numero, '?'), now()::date);
  IF v_retido > 0 THEN
    v_nota := v_nota || format('. Retenção na fonte: INSS %s%% · ISS %s%% · IRRF %s%% = R$ %s retido sobre o bruto de R$ %s; líquido R$ %s.',
                               v_med.inss_pct, v_med.iss_pct, v_med.irrf_pct, round(v_retido,2), round(COALESCE(v_med.valor_total,0),2), round(v_valor,2));
  END IF;

  INSERT INTO erp_receber (
    company_id, cliente_id, cliente_nome, descricao, categoria, valor,
    data_emissao, data_vencimento, data_competencia, status, centro_custo_id,
    origem_recebivel_id, ref_externa_id, ref_externa_sistema, observacoes, created_at
  ) VALUES (
    v_obra.company_id, v_obra.cliente_id, v_obra.cliente_nome, v_desc, 'Medição de obra', v_valor,
    CURRENT_DATE, v_venc, date_trunc('month', v_venc)::date, 'aberto', v_obra.centro_custo_id,
    v_med.id, v_ref, 'obra_medicao', v_nota, now()
  ) RETURNING id INTO v_receber_id;

  RETURN jsonb_build_object('ok', true, 'ja_existia', false, 'receber_id', v_receber_id);
END
$function$;

-- Guarda explícita (check_fn_guards): espelha a ACL viva (sem anon/public).
REVOKE ALL ON FUNCTION public.fn_obra_medicao_gerar_receber_manual(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_medicao_gerar_receber_manual(uuid) TO authenticated, service_role;

-- 7) RD-95: ajuda de campo das novas entradas de retenção.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
 ('projetos.medicao.inss_pct', '/dashboard/projetos/obras/[id]/medicoes', 'Medições', 'INSS retido (%)',
  'Percentual de INSS que o cliente (tomador) retém na fonte desta medição. Deixe 0 se não há retenção.',
  'Reduz o valor do título a receber: o cliente recolhe o INSS e paga a você o líquido. O bruto da medição continua registrado.',
  'Empreitada de mão de obra com 11% de INSS retido: informe 11. Numa medição de R$ 10.000, o título nasce com R$ 8.900.',
  'Informar o valor em reais em vez do percentual, ou somar INSS+ISS+IRRF acima de 100%.',
  'hub_projetos', 7, 'publicado'),
 ('projetos.medicao.iss_pct', '/dashboard/projetos/obras/[id]/medicoes', 'Medições', 'ISS retido (%)',
  'Percentual de ISS que o cliente retém na fonte desta medição (quando o município exige retenção pelo tomador). Deixe 0 se não há.',
  'Desconta o ISS do título a receber: o cliente recolhe o ISS ao município e paga a você o líquido.',
  'Serviço com 5% de ISS retido na fonte: informe 5.',
  'Lançar ISS retido quando quem recolhe é o prestador (aí não é retenção na fonte).',
  'hub_projetos', 8, 'publicado'),
 ('projetos.medicao.irrf_pct', '/dashboard/projetos/obras/[id]/medicoes', 'Medições', 'IRRF retido (%)',
  'Percentual de Imposto de Renda retido na fonte pelo cliente nesta medição. Deixe 0 se não há retenção.',
  'Desconta o IRRF do título a receber; o cliente recolhe e paga a você o líquido.',
  'Serviço sujeito a 1,5% de IRRF: informe 1.5.',
  'Esquecer que a soma de INSS+ISS+IRRF não pode passar de 100% do bruto.',
  'hub_projetos', 9, 'publicado'),
 ('projetos.medicao.valor_liquido', '/dashboard/projetos/obras/[id]/medicoes', 'Medições', 'Líquido a receber',
  'Nada a preencher — é o valor calculado: bruto da medição menos as retenções (INSS+ISS+IRRF).',
  'É exatamente o valor do título que entra no financeiro (contas a receber) quando a medição é aprovada.',
  'Medição de R$ 10.000 com 11% de INSS retido mostra líquido R$ 8.900.',
  'Confundir com o bruto: o acumulado da obra usa o bruto; o título a receber usa o líquido.',
  'hub_projetos', 10, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical, ordem = EXCLUDED.ordem, status = EXCLUDED.status, atualizado_em = now();
