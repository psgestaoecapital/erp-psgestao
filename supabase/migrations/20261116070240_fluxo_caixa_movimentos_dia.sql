-- Fluxo de Caixa · RD-98 (g): o detalhe (editar/excluir) por linha da tabela de Movimentações.
-- A tabela de Movimentações mostra UM dia por linha (agregado). Esta RPC READ-ONLY devolve os
-- títulos INDIVIDUAIS que compõem o movimento de um dia, para o modal "Movimentos do dia" listar
-- cada um com ação de Editar/Excluir (deep-link para Contas a Receber/Pagar, onde o CRUD já vive).
--
-- Espelha EXATAMENTE os WHERE de fn_fluxo_caixa_diario (mesma guarda de empresa, mesmos filtros de
-- conta/categoria, mesma regra realizado × previsto × vencido-projetado), para a soma dos movimentos
-- do dia bater com o 'movimento_dia' da curva. É só leitura: não altera nenhum dado de cliente.
--
-- Faixa de segundos :35-:44 (code-desenvolvedor-3). Aditiva: cria função nova, não altera existente.

CREATE OR REPLACE FUNCTION public.fn_fluxo_caixa_movimentos_dia(
  p_company_id uuid,
  p_data date,
  p_data_inicio date DEFAULT NULL::date,
  p_conta_id uuid DEFAULT NULL::uuid,
  p_categoria text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_hoje date := CURRENT_DATE;
  v_eh_futuro boolean := (p_data > CURRENT_DATE);
  -- primeiro dia futuro do período (onde os vencidos em aberto são projetados "em atraso");
  -- idêntico ao v_primeiro_futuro de fn_fluxo_caixa_diario quando p_data_inicio é informado.
  v_primeiro_futuro date := GREATEST(CURRENT_DATE + 1, COALESCE(p_data_inicio, CURRENT_DATE + 1));
  v_conta_nome text;
  v_categoria text := NULLIF(btrim(p_categoria), '');  -- '' = sem filtro
  v_rec jsonb := '[]'::jsonb;
  v_pag jsonb := '[]'::jsonb;
  v_trf jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);

  -- Nome da conta (erp_pagar liga a conta por TEXTO, não por id) — mesma leitura do diário.
  IF p_conta_id IS NOT NULL THEN
    SELECT nome INTO v_conta_nome FROM erp_banco_contas WHERE id = p_conta_id AND company_id = p_company_id;
  END IF;

  IF NOT v_eh_futuro THEN
    -- ===== DIA PASSADO/HOJE: movimentos REALIZADOS (por data_pagamento) =====
    SELECT COALESCE(jsonb_agg(m ORDER BY val DESC), '[]'::jsonb) INTO v_rec
    FROM (
      SELECT
        jsonb_build_object(
          'id', er.id, 'tipo', 'receber', 'origem', 'realizado',
          'descricao', COALESCE(NULLIF(btrim(er.descricao), ''), NULLIF(btrim(er.cliente_nome), ''), 'Recebimento'),
          'pessoa', er.cliente_nome,
          'numero_documento', COALESCE(er.numero_documento, er.numero_nf),
          'parcela', er.parcela,
          'categoria', er.categoria,
          'valor', COALESCE(NULLIF(er.valor_pago, 0), er.valor, 0),
          'sinal', 1,
          'status', er.status,
          'data_ref', er.data_pagamento
        ) AS m,
        COALESCE(NULLIF(er.valor_pago, 0), er.valor, 0) AS val
      FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) er
      WHERE er.company_id = p_company_id AND er.data_pagamento = p_data
        AND er.status IN ('pago', 'recebido')
        AND (CASE WHEN p_conta_id IS NOT NULL THEN er.conta_bancaria_id = p_conta_id
                  ELSE NOT EXISTS (SELECT 1 FROM erp_banco_contas b WHERE b.id = er.conta_bancaria_id AND b.incluir_no_fluxo = false) END)
        AND (v_categoria IS NULL OR er.categoria = v_categoria)
    ) q;

    SELECT COALESCE(jsonb_agg(m ORDER BY val DESC), '[]'::jsonb) INTO v_pag
    FROM (
      SELECT
        jsonb_build_object(
          'id', ep.id, 'tipo', 'pagar', 'origem', 'realizado',
          'descricao', COALESCE(NULLIF(btrim(ep.descricao), ''), NULLIF(btrim(ep.fornecedor_nome), ''), 'Pagamento'),
          'pessoa', ep.fornecedor_nome,
          'numero_documento', COALESCE(ep.numero_documento, ep.numero_nf),
          'parcela', ep.parcela,
          'categoria', ep.categoria,
          'valor', COALESCE(NULLIF(ep.valor_pago, 0), ep.valor, 0),
          'sinal', -1,
          'status', ep.status,
          'data_ref', ep.data_pagamento
        ) AS m,
        COALESCE(NULLIF(ep.valor_pago, 0), ep.valor, 0) AS val
      FROM (SELECT * FROM public.erp_pagar WHERE deleted_at IS NULL) ep
      WHERE ep.company_id = p_company_id AND ep.data_pagamento = p_data
        AND ep.status = 'pago'
        AND (CASE WHEN p_conta_id IS NOT NULL THEN lower(ep.conta_bancaria) = lower(v_conta_nome)
                  ELSE NOT EXISTS (SELECT 1 FROM erp_banco_contas b WHERE b.company_id = ep.company_id AND b.incluir_no_fluxo = false AND lower(b.nome) = lower(ep.conta_bancaria)) END)
        AND (v_categoria IS NULL OR ep.categoria = v_categoria)
    ) q;
  ELSE
    -- ===== DIA FUTURO: movimentos PREVISTOS (por data_vencimento, títulos em aberto) =====
    -- No primeiro dia futuro do período entram também os VENCIDOS em aberto (projetados "em atraso").
    SELECT COALESCE(jsonb_agg(m ORDER BY val DESC), '[]'::jsonb) INTO v_rec
    FROM (
      SELECT
        jsonb_build_object(
          'id', er.id, 'tipo', 'receber',
          'origem', CASE WHEN er.data_vencimento < v_hoje THEN 'vencido' ELSE 'previsto' END,
          'descricao', COALESCE(NULLIF(btrim(er.descricao), ''), NULLIF(btrim(er.cliente_nome), ''), 'A receber'),
          'pessoa', er.cliente_nome,
          'numero_documento', COALESCE(er.numero_documento, er.numero_nf),
          'parcela', er.parcela,
          'categoria', er.categoria,
          'valor', COALESCE(NULLIF(er.valor_pago, 0), er.valor, 0),
          'sinal', 1,
          'status', er.status,
          'data_ref', er.data_vencimento
        ) AS m,
        COALESCE(NULLIF(er.valor_pago, 0), er.valor, 0) AS val
      FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) er
      WHERE er.company_id = p_company_id
        AND er.status NOT IN ('pago', 'recebido', 'cancelado', 'renegociado')
        AND (
          er.data_vencimento = p_data
          OR (p_data = v_primeiro_futuro AND er.data_vencimento < v_hoje)
        )
        AND (CASE WHEN p_conta_id IS NOT NULL THEN er.conta_bancaria_id = p_conta_id
                  ELSE NOT EXISTS (SELECT 1 FROM erp_banco_contas b WHERE b.id = er.conta_bancaria_id AND b.incluir_no_fluxo = false) END)
        AND (v_categoria IS NULL OR er.categoria = v_categoria)
    ) q;

    SELECT COALESCE(jsonb_agg(m ORDER BY val DESC), '[]'::jsonb) INTO v_pag
    FROM (
      SELECT
        jsonb_build_object(
          'id', ep.id, 'tipo', 'pagar',
          'origem', CASE WHEN ep.data_vencimento < v_hoje THEN 'vencido' ELSE 'previsto' END,
          'descricao', COALESCE(NULLIF(btrim(ep.descricao), ''), NULLIF(btrim(ep.fornecedor_nome), ''), 'A pagar'),
          'pessoa', ep.fornecedor_nome,
          'numero_documento', COALESCE(ep.numero_documento, ep.numero_nf),
          'parcela', ep.parcela,
          'categoria', ep.categoria,
          'valor', COALESCE(NULLIF(ep.valor_pago, 0), ep.valor, 0),
          'sinal', -1,
          'status', ep.status,
          'data_ref', ep.data_vencimento
        ) AS m,
        COALESCE(NULLIF(ep.valor_pago, 0), ep.valor, 0) AS val
      FROM (SELECT * FROM public.erp_pagar WHERE deleted_at IS NULL) ep
      WHERE ep.company_id = p_company_id
        AND ep.status NOT IN ('pago', 'cancelado')
        AND (
          ep.data_vencimento = p_data
          OR (p_data = v_primeiro_futuro AND ep.data_vencimento < v_hoje)
        )
        AND (CASE WHEN p_conta_id IS NOT NULL THEN lower(ep.conta_bancaria) = lower(v_conta_nome)
                  ELSE NOT EXISTS (SELECT 1 FROM erp_banco_contas b WHERE b.company_id = ep.company_id AND b.incluir_no_fluxo = false AND lower(b.nome) = lower(ep.conta_bancaria)) END)
        AND (v_categoria IS NULL OR ep.categoria = v_categoria)
    ) q;
  END IF;

  -- ===== TRANSFERÊNCIAS: só quando há conta escolhida e sem filtro de categoria (igual ao diário) =====
  IF p_conta_id IS NOT NULL AND v_categoria IS NULL THEN
    SELECT COALESCE(jsonb_agg(m ORDER BY val DESC), '[]'::jsonb) INTO v_trf
    FROM (
      SELECT
        jsonb_build_object(
          'id', t.id, 'tipo', 'transferencia',
          'origem', CASE WHEN t.conta_destino_id = p_conta_id THEN 'transferencia_entrada' ELSE 'transferencia_saida' END,
          'descricao', COALESCE(NULLIF(btrim(t.descricao), ''), 'Transferência entre contas'),
          'pessoa', NULL,
          'numero_documento', NULL,
          'parcela', NULL,
          'categoria', NULL,
          'valor', t.valor,
          'sinal', CASE WHEN t.conta_destino_id = p_conta_id THEN 1 ELSE -1 END,
          'status', 'transferencia',
          'data_ref', t.data
        ) AS m,
        t.valor AS val
      FROM erp_transferencia t
      WHERE t.company_id = p_company_id AND t.data = p_data
        AND (t.conta_destino_id = p_conta_id OR t.conta_origem_id = p_conta_id)
    ) q;
  END IF;

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'data', p_data,
    'eh_futuro', v_eh_futuro,
    'conta_id', p_conta_id,
    'categoria', v_categoria,
    'movimentos', (v_rec || v_pag || v_trf)
  );
END;
$function$;

COMMENT ON FUNCTION public.fn_fluxo_caixa_movimentos_dia(uuid, date, date, uuid, text) IS
  'Fluxo de Caixa (RD-98 g): movimentos individuais de um dia (realizado/previsto/vencido/transferência), espelhando os WHERE de fn_fluxo_caixa_diario. Somente leitura.';

REVOKE ALL ON FUNCTION public.fn_fluxo_caixa_movimentos_dia(uuid, date, date, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_fluxo_caixa_movimentos_dia(uuid, date, date, uuid, text) TO authenticated;

-- RD-95: "?" dos elementos do modal "Movimentos do dia".
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
 ('ge.fluxo_caixa.movdia.titulo','/dashboard/financeiro/fluxo-caixa','Movimentos do dia','Movimentos do dia','Os lançamentos individuais (recebimentos, pagamentos e transferências) que formam o movimento daquele dia.','Abre o detalhe por trás do número do dia: dá para conferir, editar ou excluir cada título sem sair do fluxo.','Recebimento Cliente X R$ 500,00','Procurar aqui um lançamento de OUTRO dia — cada linha do fluxo abre só o seu dia.','gestao_empresarial',10,'publicado'),
 ('ge.fluxo_caixa.movdia.origem','/dashboard/financeiro/fluxo-caixa','Movimentos do dia','Situação do movimento','Mostra se o valor já aconteceu (Realizado), ainda vai acontecer pelo vencimento (Previsto) ou está em atraso (Vencido).','Separa o que já entrou/saiu de fato do que é só projeção, para você não contar duas vezes.','Previsto','Tratar um "Previsto" como dinheiro em caixa — ele só conta quando for pago.','gestao_empresarial',20,'publicado'),
 ('ge.fluxo_caixa.movdia.valor','/dashboard/financeiro/fluxo-caixa','Movimentos do dia','Valor do movimento','O valor do título: verde entra (recebimento/transferência recebida), vermelho sai (pagamento/transferência enviada).','Mostra o peso de cada lançamento dentro do movimento do dia.','+R$ 500,00','—','gestao_empresarial',30,'publicado'),
 ('ge.fluxo_caixa.movdia.editar','/dashboard/financeiro/fluxo-caixa','Movimentos do dia','Editar','Abre o título em Contas a Receber/Pagar, onde você ajusta os dados (valor, vencimento, categoria, conta).','Corrige um lançamento sem procurar por ele na outra tela.','—','—','gestao_empresarial',40,'publicado'),
 ('ge.fluxo_caixa.movdia.excluir','/dashboard/financeiro/fluxo-caixa','Movimentos do dia','Excluir','Abre o título em Contas a Receber/Pagar para a exclusão rastreável. Título já pago exige desfazer a baixa antes.','Remove um lançamento errado mantendo o histórico financeiro.','—','Excluir um recebimento real só para "sumir" com ele no fluxo — isso descontrola o saldo.','gestao_empresarial',50,'publicado')
ON CONFLICT (chave) DO NOTHING;
