-- FIX (#895) · A obra nascia de QUALQUER orçamento aprovado/convertido — mas erp_orcamentos é compartilhado
-- por comércio/oficina/odonto/hub. "Obra" é conceito de CONSTRUÇÃO. Resultado: 12 obras fantasma na KGF
-- (oficina, sem hub_obras). Modelagem correta: obra só nasce em tenant com o módulo hub_obras ATIVO.
-- O gatilho trg_orcamento_gera_obra NÃO muda — a função agora retorna NULL para não-Hub (silencioso).
CREATE OR REPLACE FUNCTION public.fn_obra_criar_de_orcamento(p_orcamento_id uuid)
RETURNS public.projetos_obras
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_orc   public.erp_orcamentos%ROWTYPE;
  v_opp   public.erp_crm_oportunidade%ROWTYPE;
  v_cfg   public.projetos_modulo_config%ROWTYPE;
  v_obra  public.projetos_obras%ROWTYPE;
  v_num   text; v_prefixo text; v_seq integer;
BEGIN
  SELECT * INTO v_orc FROM public.erp_orcamentos WHERE id = p_orcamento_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orçamento % não encontrado', p_orcamento_id; END IF;

  -- ►►► TRAVA: obra só existe para tenant com o módulo hub_obras ativo ◄◄◄
  IF NOT EXISTS (
    SELECT 1 FROM public.fn_get_tenant_modules_active(v_orc.company_id) m
    WHERE m.module_id = 'hub_obras'
  ) THEN
    RETURN NULL;   -- comércio/oficina/etc. não geram obra (a OS os serve)
  END IF;

  -- idempotência
  SELECT * INTO v_obra FROM public.projetos_obras WHERE orcamento_id = p_orcamento_id;
  IF FOUND THEN RETURN v_obra; END IF;

  SELECT * INTO v_opp FROM public.erp_crm_oportunidade WHERE orcamento_id = p_orcamento_id LIMIT 1;

  SELECT * INTO v_cfg FROM public.projetos_modulo_config WHERE company_id = v_orc.company_id;
  v_prefixo := COALESCE(NULLIF(v_cfg.prefixo_obra,''), 'OBRA');
  v_seq     := COALESCE(v_cfg.contador_obra, 0) + 1;
  v_num     := v_prefixo || '-' || to_char(now(),'YYYY') || '-' || lpad(v_seq::text, 4, '0');

  UPDATE public.projetos_modulo_config SET contador_obra = v_seq, updated_at = now()
   WHERE company_id = v_orc.company_id;

  INSERT INTO public.projetos_obras (
    company_id, numero, orcamento_id, oportunidade_id, nome, cliente_id, cliente_nome,
    endereco, cidade, bairro, status, responsavel_id, responsavel_nome,
    valor_previsto, data_inicio, created_by
  ) VALUES (
    v_orc.company_id, v_num, v_orc.id, v_opp.id,
    COALESCE(NULLIF(v_opp.titulo,''), v_orc.cliente_nome, 'Obra ' || v_num),
    v_orc.cliente_id, v_orc.cliente_nome, v_opp.obra_endereco, v_opp.obra_cidade, v_opp.obra_bairro,
    'em_andamento', v_opp.responsavel_id, v_opp.responsavel_nome,
    COALESCE(v_orc.total, 0), CURRENT_DATE, auth.uid()
  ) RETURNING * INTO v_obra;

  RETURN v_obra;
END $$;

-- ── Limpeza RD-55 das obras fantasma (empresas sem hub_obras) — CEO autorizou nesta sessão. ──
-- Backup preservado (não dropar até o CEO confirmar). Idempotente: só afeta empresas sem hub_obras.
CREATE TABLE IF NOT EXISTS public._backup_obras_fantasma_20260807 AS
SELECT o.* FROM public.projetos_obras o
WHERE NOT EXISTS (SELECT 1 FROM public.fn_get_tenant_modules_active(o.company_id) m WHERE m.module_id='hub_obras');

DELETE FROM public.projetos_obras o
WHERE NOT EXISTS (SELECT 1 FROM public.fn_get_tenant_modules_active(o.company_id) m WHERE m.module_id='hub_obras');

-- reseta o contador das empresas afetadas (não-Hub) que haviam avançado
UPDATE public.projetos_modulo_config c SET contador_obra = 0, updated_at = now()
WHERE NOT EXISTS (SELECT 1 FROM public.fn_get_tenant_modules_active(c.company_id) m WHERE m.module_id='hub_obras')
  AND contador_obra > 0;
