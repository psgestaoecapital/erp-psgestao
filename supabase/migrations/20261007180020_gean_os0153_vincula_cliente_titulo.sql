-- Chamado #1356 (Jordana, item 1) · Gean Auto Mecânica — título da OS-2026-0153 não aparece na Renegociação/Acerto.
--
-- PROVADO NO DADO (RD-38): o título existe em erp_receber (fdf9f6ed…, R$ 850,00, aberto, venc. 03/10/2026,
-- forma cartao_credito) — não há "dois caminhos de dados". O que falta é o VÍNCULO: o título e a OS têm só
-- cliente_nome = 'Eduardo machado' e cliente_id NULO. A OS foi aberta na Recepção com o nome digitado, sem
-- escolher o cliente da lista — e o cliente EDUARDO MACHADO já existia no cadastro (c6c4b780…, desde 23/04).
-- A Renegociação filtra por cliente_id (fn_renegociacao_titulos_abertos: r.cliente_id = p_cliente), então o
-- título não aparece ao escolher o cliente; o "Completar cadastro" do boleto também vem daí (título sem cliente).
-- Completar o cadastro do cliente não liga o título a ele — por isso o teste do Rodrigo não mudou nada.
--
-- Alcance: na Gean, este é o ÚNICO título aberto/vencido sem cliente_id (varredura em 07/10).
--
-- CORREÇÃO (dado de UMA empresa, título NÃO pago): liga o título e a OS ao cliente já cadastrado.
-- Só cliente_id muda. Idempotente (só toca o que ainda está nulo e com o nome esperado).
-- Reversível: espelho em bkp_1356_gean_os0153_20261007 (RLS ligada, sem acesso para anon/authenticated).
-- RD-52 (arquivo = ledger; aplica no push à main).

CREATE TABLE IF NOT EXISTS public.bkp_1356_gean_os0153_20261007 AS
SELECT 'erp_receber'::text AS tabela, r.id, r.cliente_id AS cliente_id_antigo, r.cliente_nome, now() AS espelhado_em
  FROM public.erp_receber r
 WHERE r.id = 'fdf9f6ed-f370-44b0-b0a4-12a4e5978a47'
   AND r.company_id = 'a462e13f-0f51-4c54-abe8-4474b591633b'
   AND r.cliente_id IS NULL
UNION ALL
SELECT 'erp_os', o.id, o.cliente_id, o.cliente_nome, now()
  FROM public.erp_os o
 WHERE o.company_id = 'a462e13f-0f51-4c54-abe8-4474b591633b'
   AND o.numero = 'OS-2026-0153'
   AND o.cliente_id IS NULL;

ALTER TABLE public.bkp_1356_gean_os0153_20261007 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bkp_1356_gean_os0153_20261007 FROM PUBLIC, anon, authenticated;

UPDATE public.erp_receber r
   SET cliente_id = c.id
  FROM public.erp_clientes c
 WHERE r.id = 'fdf9f6ed-f370-44b0-b0a4-12a4e5978a47'
   AND r.company_id = 'a462e13f-0f51-4c54-abe8-4474b591633b'
   AND r.cliente_id IS NULL
   AND r.status IN ('aberto', 'vencido')
   AND upper(trim(r.cliente_nome)) = 'EDUARDO MACHADO'
   AND c.id = 'c6c4b780-e398-4cfe-a464-598165d8ddbf'
   AND c.company_id = r.company_id;

UPDATE public.erp_os o
   SET cliente_id = c.id
  FROM public.erp_clientes c
 WHERE o.company_id = 'a462e13f-0f51-4c54-abe8-4474b591633b'
   AND o.numero = 'OS-2026-0153'
   AND o.cliente_id IS NULL
   AND upper(trim(o.cliente_nome)) = 'EDUARDO MACHADO'
   AND c.id = 'c6c4b780-e398-4cfe-a464-598165d8ddbf'
   AND c.company_id = o.company_id;

-- Prova na própria aplicação: se o título existe (produção), ele tem que sair daqui ligado ao cliente e
-- elegível para a Renegociação. Em banco sem esse título (testes/local), não há o que conferir.
DO $$
DECLARE v_ok boolean;
BEGIN
  IF EXISTS (SELECT 1 FROM public.erp_receber WHERE id = 'fdf9f6ed-f370-44b0-b0a4-12a4e5978a47' AND status IN ('aberto', 'vencido')) THEN
    SELECT EXISTS (
      SELECT 1 FROM public.erp_receber r
       WHERE r.id = 'fdf9f6ed-f370-44b0-b0a4-12a4e5978a47'
         AND r.company_id = 'a462e13f-0f51-4c54-abe8-4474b591633b'
         AND r.deleted_at IS NULL AND r.renegociacao_id IS NULL
         AND r.cliente_id = 'c6c4b780-e398-4cfe-a464-598165d8ddbf'
    ) INTO v_ok;
    IF NOT v_ok THEN
      RAISE EXCEPTION '#1356: título da OS-2026-0153 não ficou ligado ao cliente EDUARDO MACHADO';
    END IF;
  END IF;
END $$;
