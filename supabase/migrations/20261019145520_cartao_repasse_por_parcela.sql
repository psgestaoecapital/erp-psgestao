-- Chamado #3740 (Jordana · piloto Gean, vale para TODAS as empresas) · recebimento em cartão → títulos da operadora.
-- Antes: a baixa por cartão quitava o título do cliente e não gerava o recebível da operadora (0 repasses no banco);
-- o crédito "CIELO CRÉDITO" do extrato ficava pendente na conciliação e o saldo/fluxo mostravam o dinheiro no dia da
-- venda. A F2 (fn_cartao_registrar_recebimento) existia, mas gerava UM recebível só, pelo LÍQUIDO, sem as colunas do
-- cartão (bandeira, modalidade, parcelas, taxa, líquido, data de repasse).
--
-- Agora:
--  1) fn_cartao_registrar_recebimento (mesma assinatura): exige bandeira, modalidade e parcelas (débito = 1x); baixa o
--     cliente (baixa com forma cartao_<modalidade>, sem conta → não entra no saldo no dia da venda) e gera N títulos
--     da operadora, um por parcela: valor = BRUTO da parcela, com valor_taxa / valor_liquido / data_repasse nas
--     colunas próprias; repasse da parcela i = venda + prazo do cadastro + 30·(i−1). Cada parcela tem a sua taxa como
--     conta a pagar (taxa_pagar_id), vencendo no repasse. DRE: o repasse fica fora da receita por competência (F4) e
--     bruto − taxa = o líquido que cai no banco.
--  2) a conciliação reconhece o LÍQUIDO do repasse como valor possível (fn_receber_valor_referencia e
--     fn_conciliacao_sugerir_match_lote), então o crédito CIELO do extrato sugere o título de repasse certo.
--  3) ao conciliar o repasse com o crédito líquido, o gatilho fecha o título em BRUTO (baixa "taxa_cartao" do
--     resíduo, no mesmo movimento) e quita a taxa da parcela no mesmo movimento — saldo = líquido do extrato.
-- Recebimentos antigos não mudam (nenhum UPDATE em dado existente).

-- 1) registrar o recebimento em cartão ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_cartao_registrar_recebimento(p_company_id uuid, p_receber_id uuid, p_adquirente_id uuid,
  p_bandeira text, p_modalidade text, p_parcelas integer, p_data_venda date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r RECORD; calc jsonb; v_adq text; v_pct numeric; v_prazo int; v_total numeric; v_n int; v_mod text; v_band text;
        v_bruto numeric; v_acum numeric := 0; v_taxa numeric; v_liq numeric; v_repasse date; v_novo uuid; v_taxa_pagar uuid;
        v_parcelas jsonb := '[]'::jsonb; v_data date := COALESCE(p_data_venda, CURRENT_DATE); i int;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro','sem_acesso'); END IF;

  v_band := NULLIF(btrim(COALESCE(p_bandeira,'')), '');
  v_mod  := lower(btrim(COALESCE(p_modalidade,'')));
  v_n    := COALESCE(p_parcelas, 0);
  IF v_band IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro','bandeira_obrigatoria'); END IF;
  IF v_mod NOT IN ('debito','credito') THEN RETURN jsonb_build_object('ok', false, 'erro','modalidade_obrigatoria'); END IF;
  IF v_n < 1 OR v_n > 24 OR (v_mod = 'debito' AND v_n <> 1) THEN
    RETURN jsonb_build_object('ok', false, 'erro','parcelas_invalidas'); END IF;
  IF p_adquirente_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro','adquirente_obrigatoria'); END IF;

  SELECT * INTO r FROM erp_receber WHERE id=p_receber_id AND company_id=p_company_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro','conta_nao_encontrada'); END IF;
  IF COALESCE(r.eh_repasse_cartao,false) THEN RETURN jsonb_build_object('ok', false, 'erro','ja_e_repasse'); END IF;
  IF COALESCE(r.valor_pago,0) > 0 OR lower(COALESCE(r.status,'')) IN ('pago','cancelado','renegociado') THEN
    RETURN jsonb_build_object('ok', false, 'erro','titulo_ja_baixado'); END IF;

  v_total := round(COALESCE(r.valor,0) + COALESCE(r.juros,0) + COALESCE(r.multa,0) - COALESCE(r.desconto,0), 2);
  IF v_total <= 0 THEN RETURN jsonb_build_object('ok', false, 'erro','valor_invalido'); END IF;

  calc := fn_cartao_calcular(p_company_id, p_adquirente_id, v_band, v_mod, v_n, v_total, v_data);
  IF NOT (calc->>'ok')::boolean THEN RETURN calc; END IF;
  v_pct   := (calc->>'taxa_percentual')::numeric;
  v_prazo := (calc->>'prazo_repasse_dias')::int;
  SELECT nome INTO v_adq FROM erp_cartao_adquirente WHERE id=p_adquirente_id AND company_id=p_company_id;
  IF v_adq IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro','adquirente_nao_encontrada'); END IF;

  -- cliente quitado pela venda no cartão: a baixa é a fonte (o gatilho soma valor_pago e põe o status);
  -- sem conta bancária → não entra no saldo no dia da venda (o dinheiro entra no repasse)
  INSERT INTO erp_receber_baixa (receber_id, company_id, valor, data, forma, origem, criado_por, observacao)
  VALUES (p_receber_id, p_company_id, v_total, v_data, 'cartao_'||v_mod, 'manual', auth.uid(),
          'Recebido em cartão ('||v_adq||' · '||v_band||' · '||v_mod||' '||v_n||'x). O dinheiro entra no repasse da operadora.');
  UPDATE erp_receber SET forma_pagamento = 'cartao_'||v_mod, data_pagamento = v_data, origem_baixa = 'manual',
         baixado_por = COALESCE(baixado_por, auth.uid()), adquirente_id = p_adquirente_id, bandeira = v_band,
         modalidade_cartao = v_mod, cartao_parcelas = v_n, updated_at = now()
   WHERE id = p_receber_id;

  FOR i IN 1..v_n LOOP
    v_bruto := CASE WHEN i < v_n THEN round(v_total / v_n, 2) ELSE round(v_total - v_acum, 2) END;
    v_acum  := v_acum + v_bruto;
    v_taxa  := round(v_bruto * v_pct / 100, 2);
    v_liq   := round(v_bruto - v_taxa, 2);
    v_repasse := v_data + v_prazo + 30 * (i - 1);

    INSERT INTO erp_receber (company_id, cliente_nome, descricao, valor, data_emissao, data_vencimento,
       data_competencia, status, forma_pagamento, categoria, linha_negocio, centro_custo_id,
       eh_repasse_cartao, origem_recebivel_id, adquirente_id, bandeira, modalidade_cartao, cartao_parcelas,
       taxa_percentual, valor_taxa, valor_liquido, data_repasse, ref_externa_sistema, ref_externa_id)
    VALUES (p_company_id, v_adq,
       'Repasse cartão · '||COALESCE(r.cliente_nome,'venda')||' · '||v_band||'/'||v_mod||' · parcela '||i||'/'||v_n,
       v_bruto, v_data, v_repasse, COALESCE(r.data_competencia, v_data), 'aberto', 'repasse_cartao', 'Recebível de cartão',
       r.linha_negocio, r.centro_custo_id, true, p_receber_id, p_adquirente_id, v_band, v_mod, v_n,
       v_pct, v_taxa, v_liq, v_repasse, 'repasse_cartao', p_receber_id::text||'#'||i)
    RETURNING id INTO v_novo;

    v_taxa_pagar := NULL;
    IF v_taxa > 0 THEN
      INSERT INTO erp_pagar (company_id, descricao, fornecedor_nome, valor, data_emissao, data_vencimento,
         data_competencia, status, forma_pagamento, categoria, linha_negocio, centro_custo_id, ref_externa_sistema, ref_externa_id)
      VALUES (p_company_id, 'Taxa de cartão · '||v_adq||' · '||v_band||'/'||v_mod||' · parcela '||i||'/'||v_n,
         v_adq, v_taxa, v_data, v_repasse, COALESCE(r.data_competencia, v_data), 'aberto', 'taxa_cartao',
         'Taxa de cartão (despesa financeira)', r.linha_negocio, r.centro_custo_id, 'taxa_cartao', v_novo::text)
      RETURNING id INTO v_taxa_pagar;
      UPDATE erp_receber SET taxa_pagar_id = v_taxa_pagar WHERE id = v_novo;
    END IF;

    v_parcelas := v_parcelas || jsonb_build_object('parcela', i, 'id', v_novo, 'valor_bruto', v_bruto, 'valor_taxa', v_taxa,
                    'valor_liquido', v_liq, 'data_repasse', v_repasse, 'taxa_pagar_id', v_taxa_pagar);
  END LOOP;

  RETURN jsonb_build_object('ok', true,
    'cliente_baixado', jsonb_build_object('receber_id', p_receber_id, 'valor', v_total),
    'adquirente', v_adq, 'taxa_percentual', v_pct, 'parcelas', v_parcelas,
    'total_taxa', (SELECT COALESCE(sum((p->>'valor_taxa')::numeric),0) FROM jsonb_array_elements(v_parcelas) p),
    'total_liquido', (SELECT COALESCE(sum((p->>'valor_liquido')::numeric),0) FROM jsonb_array_elements(v_parcelas) p));
END $function$;

REVOKE ALL ON FUNCTION public.fn_cartao_registrar_recebimento(uuid, uuid, uuid, text, text, integer, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_cartao_registrar_recebimento(uuid, uuid, uuid, text, text, integer, date) TO authenticated;

-- abertos por operadora: o total do grupo é o LÍQUIDO que cai no banco (o título guarda o bruto)
CREATE OR REPLACE FUNCTION public.fn_cartao_recebiveis_abertos(p_company_id uuid, p_adquirente_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  RETURN jsonb_build_object('ok',true,'grupos', COALESCE((
    SELECT jsonb_agg(g ORDER BY g->>'data_repasse') FROM (
      SELECT jsonb_build_object(
        'adquirente', a.nome, 'adquirente_id', r.adquirente_id, 'data_repasse', r.data_vencimento,
        'qtd', count(*), 'total_liquido', round(sum(COALESCE(r.valor_liquido, r.valor)),2),
        'recebiveis', jsonb_agg(jsonb_build_object('id',r.id,'descricao',r.descricao,'valor_liquido',COALESCE(r.valor_liquido, r.valor)) ORDER BY r.descricao)
      ) AS g
      FROM erp_receber r JOIN erp_cartao_adquirente a ON a.id=r.adquirente_id
      WHERE r.company_id=p_company_id AND r.eh_repasse_cartao AND r.status IN ('aberto','vencido') AND r.deleted_at IS NULL
        AND (p_adquirente_id IS NULL OR r.adquirente_id=p_adquirente_id)
      GROUP BY a.nome, r.adquirente_id, r.data_vencimento
    ) x),'[]'::jsonb));
END $function$;

REVOKE ALL ON FUNCTION public.fn_cartao_recebiveis_abertos(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_cartao_recebiveis_abertos(uuid, uuid) TO authenticated;

-- 2) conciliação: o líquido do repasse é um valor possível do título --------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_receber_valor_referencia(p_receber_id uuid, p_valor_credito numeric)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT x.v FROM (
    SELECT r.valor AS v FROM public.erp_receber r WHERE r.id = p_receber_id
    UNION ALL
    SELECT round(r.valor + COALESCE(r.juros,0) + COALESCE(r.multa,0) - COALESCE(r.desconto,0) - COALESCE(r.valor_pago,0), 2)
      FROM public.erp_receber r WHERE r.id = p_receber_id AND COALESCE(r.valor_pago,0) > 0
    UNION ALL
    SELECT b.valor FROM public.erp_receber_baixa b
     WHERE b.receber_id = p_receber_id AND b.deleted_at IS NULL AND b.movimento_banco_id IS NULL
    UNION ALL
    -- #3740: repasse de cartão — a operadora deposita o líquido (bruto − taxa)
    SELECT r.valor_liquido FROM public.erp_receber r
     WHERE r.id = p_receber_id AND r.eh_repasse_cartao AND COALESCE(r.valor_liquido,0) > 0 AND COALESCE(r.valor_pago,0) = 0
  ) x
  WHERE x.v > 0
  ORDER BY abs(x.v - abs(p_valor_credito))
  LIMIT 1
$function$;

-- a sugestão em lote usa a mesma regra (injeção exata, idempotente — mesma técnica da F4 de cartão)
DO $mig$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.fn_conciliacao_sugerir_match_lote'::regproc);
  IF d NOT LIKE '%r.eh_repasse_cartao%' THEN
    n := replace(d,
      $q$WHERE b.receber_id = r.id AND b.deleted_at IS NULL AND b.movimento_banco_id IS NULL)::numeric[]$q$,
      $q$WHERE b.receber_id = r.id AND b.deleted_at IS NULL AND b.movimento_banco_id IS NULL
            UNION ALL
            SELECT r.valor_liquido WHERE r.eh_repasse_cartao AND COALESCE(r.valor_liquido,0) > 0 AND COALESCE(r.valor_pago,0) = 0)::numeric[]$q$);
    IF n = d THEN
      RAISE WARNING '#3740: trecho de fn_conciliacao_sugerir_match_lote não encontrado — sugestão em lote segue sem o líquido do repasse';
    ELSE
      -- função SQL: o corpo é validado no CREATE com o search_path da sessão; no banco de testes o pg_trgm
      -- (similarity) não está no search_path do db push. Recria sem validar o corpo (como o pg_dump faz):
      -- a resolução de similarity() em execução continua igual à da função atual.
      PERFORM set_config('check_function_bodies', 'off', true);
      EXECUTE n;
      PERFORM set_config('check_function_bodies', 'on', true);
    END IF;
  END IF;
END $mig$;

-- 3) repasse conciliado com o crédito líquido → fecha em bruto e quita a taxa no mesmo movimento ---------------------
CREATE OR REPLACE FUNCTION public.fn_trg_cartao_repasse_fechar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_mov uuid; v_data date; v_soma numeric; v_res numeric; v_teto numeric;
BEGIN
  IF NOT COALESCE(NEW.eh_repasse_cartao,false) OR NEW.deleted_at IS NOT NULL THEN RETURN NULL; END IF;

  -- o crédito do extrato que pagou este repasse (1:1 no título ou agrupado na baixa da conciliação)
  v_mov := NEW.movimento_banco_id;
  IF v_mov IS NULL THEN
    SELECT b.movimento_banco_id INTO v_mov FROM erp_receber_baixa b
     WHERE b.receber_id = NEW.id AND b.deleted_at IS NULL AND b.movimento_banco_id IS NOT NULL AND b.origem <> 'taxa_cartao'
     ORDER BY b.data DESC, b.criado_em DESC LIMIT 1;
  END IF;
  IF v_mov IS NULL THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_receber_baixa b WHERE b.receber_id = NEW.id AND b.deleted_at IS NULL
                   AND b.movimento_banco_id IS NOT NULL AND b.origem <> 'taxa_cartao') THEN
    RETURN NULL;   -- ainda sem o dinheiro do extrato
  END IF;
  -- idempotência: a taxa deste repasse já foi fechada
  IF EXISTS (SELECT 1 FROM erp_receber_baixa b WHERE b.receber_id = NEW.id AND b.origem = 'taxa_cartao' AND b.deleted_at IS NULL) THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(sum(valor),0) INTO v_soma FROM erp_receber_baixa WHERE receber_id = NEW.id AND deleted_at IS NULL;
  v_res  := round(COALESCE(NEW.valor,0) + COALESCE(NEW.juros,0) + COALESCE(NEW.multa,0) - COALESCE(NEW.desconto,0) - v_soma, 2);
  -- o resíduo só é taxa se couber na taxa da parcela (com folga) — senão é recebimento parcial e fica em aberto
  v_teto := GREATEST(round(COALESCE(NEW.valor_taxa,0) * 1.5, 2), round(COALESCE(NEW.valor,0) * 0.05, 2));
  IF v_res <= 0 OR v_res > v_teto THEN RETURN NULL; END IF;

  SELECT data_transacao INTO v_data FROM conciliacao_movimento WHERE id = v_mov;
  v_data := COALESCE(v_data, NEW.data_pagamento, CURRENT_DATE);

  -- (a) a taxa da parcela, paga no mesmo movimento (a operadora já descontou do depósito)
  IF NEW.taxa_pagar_id IS NOT NULL THEN
    UPDATE erp_pagar SET valor = v_res, valor_pago = v_res, status = 'pago', data_pagamento = v_data,
           forma_pagamento = 'taxa_cartao', conciliado = true, movimento_banco_id = v_mov, origem_baixa = 'conciliacao',
           baixado_por = COALESCE(baixado_por, auth.uid()), updated_at = now()
     WHERE id = NEW.taxa_pagar_id AND company_id = NEW.company_id AND deleted_at IS NULL AND status <> 'pago';
  END IF;

  -- (b) fecha o repasse em BRUTO: o resíduo é a taxa. criado_em = clock_timestamp(): fica DEPOIS da baixa da
  -- conciliação da mesma transação (o default now() empataria), e a sincronização da conciliação, que pega a primeira
  -- baixa do movimento por criado_em, continua achando a do dinheiro do extrato
  INSERT INTO erp_receber_baixa (receber_id, company_id, valor, data, forma, origem, movimento_banco_id, criado_por, criado_em, observacao)
  VALUES (NEW.id, NEW.company_id, v_res, v_data, 'repasse_cartao', 'taxa_cartao', v_mov, auth.uid(), clock_timestamp(),
          'Taxa da operadora descontada no repasse (fecha o título em bruto).');
  RETURN NULL;
END $function$;

REVOKE ALL ON FUNCTION public.fn_trg_cartao_repasse_fechar() FROM PUBLIC, anon, authenticated;

-- o nome "trg_zz_" é de propósito: gatilhos AFTER rodam em ordem alfabética e este precisa rodar DEPOIS do
-- trg_receber_valor_pago_guard (senão o guarda vê o NEW antigo e lança a diferença da taxa como baixa negativa)
DROP TRIGGER IF EXISTS trg_zz_cartao_repasse_fechar ON public.erp_receber;
CREATE TRIGGER trg_zz_cartao_repasse_fechar
  AFTER UPDATE OF conciliado, movimento_banco_id, valor_pago ON public.erp_receber
  FOR EACH ROW WHEN (NEW.eh_repasse_cartao IS TRUE)
  EXECUTE FUNCTION public.fn_trg_cartao_repasse_fechar();

-- "?" (RD-95) da tela "Registrar em cartão"
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Recebimento em cartão', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/financeiro/cartao-recebimento', 'financeiro', 'publicado'
FROM (VALUES
 ('financeiro.cartao_recebimento.adquirente', 'Operadora (adquirente)',
  'Escolha a operadora da maquininha que passou o cartão (Cielo, Sicredi, Stone…).',
  'É em nome dela que o sistema cria os títulos a receber do repasse, com a taxa do cadastro dela.',
  'CIELO.',
  'Escolher a operadora errada: a taxa e a data do repasse saem do cadastro de outra operadora.', 1),
 ('financeiro.cartao_recebimento.bandeira', 'Bandeira',
  'Escolha a bandeira do cartão do cliente (Visa, Master, Elo…). Só aparecem as bandeiras com taxa cadastrada.',
  'A taxa da operadora muda por bandeira; sem ela o líquido e a taxa não são calculados.',
  'Master.',
  'Bandeira sem taxa cadastrada: cadastre em Financeiro › Cartões antes de registrar.', 2),
 ('financeiro.cartao_recebimento.modalidade', 'Modalidade',
  'Débito ou crédito, como foi passado na maquininha.',
  'Débito cai em poucos dias e sempre em 1x; crédito cai em 30 dias por parcela e tem taxa diferente.',
  'Crédito.',
  'Marcar débito numa venda parcelada: débito é sempre à vista.', 3),
 ('financeiro.cartao_recebimento.parcelas', 'Parcelas',
  'Em quantas vezes o cliente parcelou no cartão (débito = 1).',
  'O sistema cria um título da operadora por parcela, cada um com a sua data de repasse e o seu valor líquido.',
  '3 (venda de R$ 900,00 em 3x gera 3 repasses de R$ 300,00 menos a taxa).',
  'Informar as parcelas da OS em vez das do cartão: aqui vale o que foi passado na maquininha.', 4),
 ('financeiro.cartao_recebimento.data_venda', 'Data da venda',
  'O dia em que o cartão foi passado.',
  'É a data em que o cliente fica quitado; os repasses contam a partir dela (débito D+1, crédito D+30 por parcela, conforme o cadastro).',
  '19/10/2026.',
  'Usar a data do depósito da operadora: essa é a do repasse, que o sistema calcula sozinho.', 5),
 ('financeiro.cartao_recebimento.previa', 'Prévia dos repasses',
  'Nada a preencher: confira as parcelas, as datas de repasse, a taxa e o líquido antes de confirmar.',
  'O líquido de cada parcela é o valor que vai aparecer no extrato; a conciliação sugere esse título para o crédito da operadora.',
  'Parcela 1/3 · 18/11/2026 · bruto R$ 300,00 · taxa R$ 6,75 · líquido R$ 293,25.',
  'Esperar o valor cheio no extrato: a operadora deposita o líquido; a taxa vira despesa financeira.', 6)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
