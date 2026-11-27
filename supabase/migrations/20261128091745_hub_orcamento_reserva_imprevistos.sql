-- Hub · Orçamento por EAP (tela 315) · "Riscos e imprevistos" e "Pós-obra" como % do custo (editável),
-- com reserva e projeção do custo total. Blueprint vivo hub_projetos tela 315 (essencial, estava ausente).
--
-- RD-26: erp_orcamentos é COMPARTILHADO com o Comércio — NÃO acrescentar colunas do Hub nela. A reserva é
-- uma tabela complementar 1:1 do Hub (mesmo padrão de projetos_orcamento_item_eap), guardada por empresa.
-- Aditiva e idempotente (RD-52). Escrita só por RPC (SECURITY DEFINER com guarda de empresa); leitura por RLS.
-- Code: desenvolvedor_4_g

-- 1) Tabela complementar 1:1 do orçamento (reserva/contingência do Hub)
CREATE TABLE IF NOT EXISTS public.projetos_orcamento_reserva (
  orcamento_id uuid PRIMARY KEY REFERENCES public.erp_orcamentos(id) ON DELETE CASCADE,
  company_id   uuid NOT NULL,
  riscos_pct   numeric(6,3) NOT NULL DEFAULT 0 CHECK (riscos_pct >= 0 AND riscos_pct <= 100),
  pos_obra_pct numeric(6,3) NOT NULL DEFAULT 0 CHECK (pos_obra_pct >= 0 AND pos_obra_pct <= 100),
  observacao   text,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.projetos_orcamento_reserva IS
  'Hub/tela 315: reserva do orçamento (riscos e imprevistos, pós-obra) como % do custo. Complemento 1:1 de erp_orcamentos; não altera a tabela compartilhada.';

ALTER TABLE public.projetos_orcamento_reserva ENABLE ROW LEVEL SECURITY;

-- Leitura por empresa (mesmo padrão de projetos_orcamento_item_eap). Sem policy de escrita: grava só pela RPC.
DROP POLICY IF EXISTS orc_reserva_select ON public.projetos_orcamento_reserva;
CREATE POLICY orc_reserva_select ON public.projetos_orcamento_reserva
  FOR SELECT USING (company_id IN (SELECT get_user_company_ids()));

REVOKE ALL ON public.projetos_orcamento_reserva FROM anon;
GRANT SELECT ON public.projetos_orcamento_reserva TO authenticated, service_role;

-- 2) RPC de escrita: upsert da reserva do orçamento, com guarda de empresa idêntica à do _item_eap_salvar.
CREATE OR REPLACE FUNCTION public.fn_projetos_orcamento_reserva_salvar(
  p_orcamento_id uuid,
  p_riscos_pct   numeric,
  p_pos_obra_pct numeric,
  p_observacao   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid;
  v_risc    numeric := COALESCE(p_riscos_pct, 0);
  v_pos     numeric := COALESCE(p_pos_obra_pct, 0);
BEGIN
  -- Guarda de empresa: o orçamento tem de ser da empresa do usuário.
  SELECT o.company_id INTO v_company
  FROM public.erp_orcamentos o
  WHERE o.id = p_orcamento_id
    AND o.company_id IN (SELECT get_user_company_ids());
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'sem acesso ao orçamento %', p_orcamento_id USING ERRCODE = '42501';
  END IF;

  IF v_risc < 0 OR v_risc > 100 OR v_pos < 0 OR v_pos > 100 THEN
    RAISE EXCEPTION 'percentuais devem ficar entre 0 e 100' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.projetos_orcamento_reserva (orcamento_id, company_id, riscos_pct, pos_obra_pct, observacao)
  VALUES (p_orcamento_id, v_company, round(v_risc, 3), round(v_pos, 3), NULLIF(btrim(p_observacao), ''))
  ON CONFLICT (orcamento_id) DO UPDATE
    SET riscos_pct    = EXCLUDED.riscos_pct,
        pos_obra_pct  = EXCLUDED.pos_obra_pct,
        observacao    = EXCLUDED.observacao,
        atualizado_em = now();

  RETURN jsonb_build_object('ok', true, 'riscos_pct', round(v_risc, 3), 'pos_obra_pct', round(v_pos, 3));
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_projetos_orcamento_reserva_salvar(uuid, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_orcamento_reserva_salvar(uuid, numeric, numeric, text) TO authenticated, service_role;

-- 3) RD-95: "?" nos campos novos da tela 315.
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
 ('projetos.orcamento_eap.reserva_riscos',
  '/dashboard/projetos/obras/[id]/orcamento', 'Orçamento por EAP', 'Riscos e imprevistos (%)',
  'O percentual de reserva para riscos e imprevistos, aplicado sobre o custo estruturado pela EAP. Deixe 0 se não quiser reserva.',
  'Cria uma folga no orçamento para o que não dá para prever (retrabalho, variação de preço, condições do terreno), sem inflar o custo dos serviços.',
  '5 (cinco por cento) sobre o custo da obra.',
  'Somar o valor da reserva aos itens do orçamento; ela é uma linha de projeção à parte, não um item.',
  'hub_projetos', 20, 1, 'publicado'),
 ('projetos.orcamento_eap.reserva_pos_obra',
  '/dashboard/projetos/obras/[id]/orcamento', 'Orçamento por EAP', 'Pós-obra (%)',
  'O percentual reservado para a fase de pós-obra (assistência técnica, garantias, reparos), aplicado sobre o custo estruturado pela EAP.',
  'Separa uma verba para o que vem depois da entrega, para não comprometer o resultado da obra com custos de garantia.',
  '2 (dois por cento) sobre o custo da obra.',
  'Confundir pós-obra com os riscos e imprevistos — são duas reservas distintas que somam ao custo total projetado.',
  'hub_projetos', 21, 1, 'publicado'),
 ('projetos.orcamento_eap.total_projetado',
  '/dashboard/projetos/obras/[id]/orcamento', 'Orçamento por EAP', 'Custo total projetado',
  'Indicador calculado: não é digitado. É o custo estruturado pela EAP mais as reservas de riscos e imprevistos e de pós-obra.',
  'Mostra o custo total esperado da obra já com as reservas, para a proposta e a análise de resultado partirem de um número realista.',
  'Custo EAP R$ 100.000 + 5% de riscos + 2% de pós-obra = R$ 107.000 projetados.',
  'Ler o total projetado como se fosse o total do orçamento aprovado — as reservas são projeção, o orçamento aprovado segue o fluxo do Comércio.',
  'hub_projetos', 22, 1, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota            = EXCLUDED.rota,
  grupo           = EXCLUDED.grupo,
  rotulo          = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve  = EXCLUDED.para_que_serve,
  exemplo         = EXCLUDED.exemplo,
  erro_comum      = EXCLUDED.erro_comum,
  vertical        = EXCLUDED.vertical,
  status          = EXCLUDED.status,
  atualizado_em   = now();
