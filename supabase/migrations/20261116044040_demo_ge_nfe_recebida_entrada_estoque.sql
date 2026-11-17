-- PDCA GE (auditor_pdca_2, 2026-11-13) · jornada NF-e RECEBIDAS
-- Tela: /dashboard/compras/documentos-recebidos (alias /dashboard/fiscal/nfe-recebidas)
--
-- GAP (provado no dado, RD-38): no GE DEMO (b0700000-0000-4000-a000-000000000004) as
-- 2.4k NF-e recebidas estavam TODAS com estoque_status='pendente' (0 com entrada efetivada).
-- Causa: os itens nao tinham vinculo com produto cadastrado -> ao lancar, so o "pagar" era
-- gerado e o estoque ficava 'pendente' (pendentes_vinculo). A SEGUNDA metade da cadeia
-- (fiscal -> estoque) nunca aparecia, impossibilitando demonstrar o diferencial da GE:
-- "receber a NF-e e, num clique, gerar a conta a pagar E dar entrada no estoque".
--
-- ESTE SEED (ADITIVO, so DEMO, idempotente): cria 3 NF-e 'completa' no GE DEMO cujos itens
-- mapeiam a produtos REAIS ja cadastrados (CFOP de entrada 1102, entra_estoque=true) e as
-- lanca ponta a ponta usando as MESMAS funcoes oficiais da tela:
--   * conta a pagar: fn_nfe_recebida_gerar_pagar (sem guarda de auth; opera pela nota)
--   * entrada no estoque: fn_movimentar_estoque (mesma chamada de fn_nfe_recebida_dar_entrada_estoque,
--     com fator 1 — unidade do item = unidade do produto — e custo = valor_unitario)
-- Resultado: a cadeia NF-e recebida -> conta a pagar -> entrada no estoque fica visivel
-- (estoque_status='completo', status='lancada', lancado_pagar=true) em >= 3 exemplos.
--
-- NAO toca logica de produto; NAO altera/apaga dado de cliente; so INSERTs aditivos de dado
-- fabricado para a empresa DEMO. Idempotente: reexecucao nao duplica (chave_acesso fixa com
-- UNIQUE(company_id,chave_acesso); itens so entram no estoque se ainda nao movimentados;
-- gerar_pagar retorna ja_lancado se repetido).
--
-- Prova RD-38 (BEGIN..ROLLBACK, producao, 2026-11-14): completo=3  mov=6  pagar_ok=3.

DO $seed$
DECLARE
  c uuid := 'b0700000-0000-4000-a000-000000000004';   -- Demonstracao Comercio GE LTDA
  v_local uuid;
  v_nfe uuid; v_i int; rec record; v_mov uuid;
  v_mov_count int := 0; v_completo int;
  chaves text[] := ARRAY[
    '35261199000000000000000000000000000000000001',
    '35261199000000000000000000000000000000000002',
    '35261199000000000000000000000000000000000003'];
  numeros text[] := ARRAY['900000001','900000002','900000003'];
  cnpjs  text[] := ARRAY['11222333000181','44555666000170','77888999000162'];
  razoes text[] := ARRAY['Distribuidora Alfa Ltda','Atacado Beta Ltda','Suprimentos Gama Ltda'];
  -- 2 itens por nota (indice da nota em it_note), todos produtos REAIS do GE DEMO
  it_note  int[]  := ARRAY[1,1,2,2,3,3];
  it_prod  uuid[] := ARRAY[
    'a8528b0b-7e7e-4ba2-8b64-c59c7be0cc4a',  -- Acessorio 10
    '04a2d517-af7b-4c5a-8e6b-5d37d63b48e0',  -- Acessorio 16
    'f885a9b5-e6e6-4dd2-a5d2-7950c1852116',  -- Acessorio 22
    '1dbcf00c-940f-4e09-9d18-2a0660a8c5df',  -- Componente eletrico 11
    'd9daf824-2820-476b-ae5e-73d3ee8c24ba',  -- Acessorio 28
    'c947f452-eadc-4904-99e2-0711a0c740cd']::uuid[]; -- Componente eletrico 17
  it_qtd   numeric[] := ARRAY[10,5,8,12,6,9];
  it_custo numeric[] := ARRAY[98.00,141.80,185.60,105.30,229.40,149.10];
  it_desc  text[]    := ARRAY['Acessorio 10','Acessorio 16','Acessorio 22',
                              'Componente eletrico 11','Acessorio 28','Componente eletrico 17'];
BEGIN
  -- so roda se a empresa DEMO existir e os produtos de referencia estiverem cadastrados
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id=c) THEN
    RAISE NOTICE 'seed NF-e->estoque: empresa DEMO ausente, nada a fazer'; RETURN;
  END IF;
  IF (SELECT count(*) FROM erp_produtos WHERE company_id=c AND id = ANY(it_prod)) < 6 THEN
    RAISE NOTICE 'seed NF-e->estoque: produtos de referencia ausentes no GE DEMO, nada a fazer'; RETURN;
  END IF;

  v_local := fn_estoque_local_principal(c);
  IF v_local IS NULL THEN
    RAISE NOTICE 'seed NF-e->estoque: sem local de estoque principal, nada a fazer'; RETURN;
  END IF;

  FOR v_i IN 1..3 LOOP
    SELECT id INTO v_nfe FROM erp_nfe_recebidas WHERE company_id=c AND chave_acesso=chaves[v_i];
    IF v_nfe IS NULL THEN
      INSERT INTO erp_nfe_recebidas(
        company_id,chave_acesso,numero,emitente_cnpj,emitente_razao,emitente_uf,
        status,status_manifestacao,origem,valor_produtos,valor_total)
      VALUES(c,chaves[v_i],numeros[v_i],cnpjs[v_i],razoes[v_i],'SP',
        'completa','confirmada','demo_seed_estoque',
        (SELECT sum(it_qtd[j]*it_custo[j]) FROM generate_series(1,6) j WHERE it_note[j]=v_i),
        (SELECT sum(it_qtd[j]*it_custo[j]) FROM generate_series(1,6) j WHERE it_note[j]=v_i))
      RETURNING id INTO v_nfe;

      INSERT INTO erp_nfe_recebidas_itens(
        nfe_recebida_id,company_id,numero_item,descricao,cfop,cfop_entrada,unidade,
        quantidade,quantidade_recebida,valor_unitario,valor_total,produto_id,entra_estoque,gera_financeiro)
      SELECT v_nfe,c,row_number() OVER(),it_desc[j],'1102','1102','UN',
             it_qtd[j],it_qtd[j],it_custo[j],it_qtd[j]*it_custo[j],it_prod[j],true,true
      FROM generate_series(1,6) j WHERE it_note[j]=v_i;
    END IF;

    -- entrada no estoque (mesma chamada de fn_nfe_recebida_dar_entrada_estoque; fator=1, custo=valor_unitario)
    FOR rec IN
      SELECT * FROM erp_nfe_recebidas_itens
       WHERE nfe_recebida_id=v_nfe AND produto_id IS NOT NULL
         AND COALESCE(entra_estoque,false) AND NOT COALESCE(estoque_movimentado,false)
    LOOP
      v_mov := fn_movimentar_estoque(
        p_produto_id := rec.produto_id, p_local_id := v_local, p_tipo := 'entrada',
        p_quantidade := COALESCE(rec.quantidade_recebida,rec.quantidade),
        p_custo_unitario := rec.valor_unitario,
        p_motivo := 'Entrada NF-e compra',
        p_observacoes := 'NF-e '||numeros[v_i]||' - '||razoes[v_i],
        p_ref_tipo := 'nfe_recebida', p_ref_id := v_nfe, p_ref_numero := numeros[v_i]);
      UPDATE erp_nfe_recebidas_itens SET estoque_movimentado=true, movimentacao_id=v_mov WHERE id=rec.id;
      v_mov_count := v_mov_count + 1;
    END LOOP;

    UPDATE erp_nfe_recebidas
       SET estoque_status='completo', estoque_dado_em=now(), status='lancada', updated_at=now()
     WHERE id=v_nfe;

    -- conta a pagar (funcao oficial; idempotente: ja_lancado se repetido)
    PERFORM fn_nfe_recebida_gerar_pagar(v_nfe);
  END LOOP;

  SELECT count(*) INTO v_completo
    FROM erp_nfe_recebidas
   WHERE company_id=c AND chave_acesso=ANY(chaves) AND estoque_status='completo';
  RAISE NOTICE 'seed NF-e->estoque GE DEMO: % notas completas, % movimentos de entrada', v_completo, v_mov_count;
END $seed$;
