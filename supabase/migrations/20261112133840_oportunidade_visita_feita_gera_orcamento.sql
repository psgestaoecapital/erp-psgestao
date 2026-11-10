-- Chamado #3268 (Tryo, vídeo 16/10, CEO): oportunidade movida para "Visita feita" segue SOZINHA
-- para a fila do orçamento — cria o orçamento em RASCUNHO ligado à oportunidade, sem ninguém
-- levar à mão, e não duplica se já houver um.
--
-- Hoje o trigger tg_crm_oport_visita_vai_orcar (BEFORE UPDATE em erp_crm_oportunidade) só AVANÇA
-- a etapa para 'orcando' (e exigia uma visita realizada). Ele NÃO cria o orçamento. Esta migração
-- passa o mesmo trigger a CRIAR o rascunho (mesma regra do botão manual gerarOrcamentoDaVisita:
-- cliente da oportunidade, validade do padrão da empresa, observações) e a ligá-lo à oportunidade,
-- dispensando a visita manual. Opt-in por empresa via orcamento_config_empresa.visita_feita_vai_orcar.
--
-- Idempotente: se a oportunidade já tem orcamento_id, só avança a etapa (não cria outro).
-- Seguro: numero é auto-atribuído por tg_orcamento_set_numero; orçamento nasce 'rascunho' (o
-- tg_orcamento_gera_obra só cria obra em 'aprovado'/'convertido', então não há efeito colateral).
-- Não altera config de cliente real: habilita a flag apenas nas empresas DEMO (is_demo).

CREATE OR REPLACE FUNCTION public.tg_crm_oport_visita_vai_orcar()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cli record; v_validade int; v_orc uuid; v_obs text;
BEGIN
  -- Só na ENTRADA em "visita_feita", e só para empresa que optou pelo fluxo.
  IF NEW.etapa = 'visita_feita'
     AND OLD.etapa IS DISTINCT FROM 'visita_feita'
     AND EXISTS (SELECT 1 FROM orcamento_config_empresa c
                  WHERE c.company_id = NEW.company_id AND c.visita_feita_vai_orcar) THEN

    -- Cria o rascunho só se ainda não há orçamento ligado e há cliente definido (idempotente).
    IF NEW.orcamento_id IS NULL AND NEW.cliente_id IS NOT NULL THEN
      SELECT nome_fantasia, razao_social, cpf_cnpj, email, telefone
        INTO v_cli FROM erp_clientes WHERE id = NEW.cliente_id;

      v_validade := COALESCE((SELECT validade_dias FROM orcamento_config_empresa WHERE company_id = NEW.company_id), 15);

      -- Observações: as da oportunidade + localização da obra, se houver (para o orçamento nascer com contexto).
      v_obs := NULLIF(trim(both E'\n' from
        COALESCE(NEW.observacoes, '')
        || CASE WHEN COALESCE(NEW.obra_endereco, NEW.obra_bairro, NEW.obra_cidade) IS NOT NULL
             THEN E'\nLocal da obra: ' || concat_ws(', ', NULLIF(NEW.obra_endereco,''), NULLIF(NEW.obra_bairro,''), NULLIF(NEW.obra_cidade,''))
             ELSE '' END), '');

      INSERT INTO erp_orcamentos (
        company_id, versao, cliente_id, cliente_nome, cliente_cnpj, cliente_email, cliente_telefone,
        data_emissao, data_validade, status, subtotal, total, observacoes
      ) VALUES (
        NEW.company_id, 1, NEW.cliente_id,
        COALESCE(v_cli.nome_fantasia, v_cli.razao_social, ''), v_cli.cpf_cnpj, v_cli.email, v_cli.telefone,
        CURRENT_DATE, CURRENT_DATE + v_validade, 'rascunho', 0, 0, v_obs
      ) RETURNING id INTO v_orc;

      NEW.orcamento_id := v_orc;
    END IF;

    -- A oportunidade segue para a fila do orçamento.
    NEW.etapa := 'orcando';
  END IF;

  RETURN NEW;
END $function$;

-- Habilita o fluxo nas empresas DEMO (jornada demonstrável; NÃO toca config de cliente real).
INSERT INTO orcamento_config_empresa (company_id, visita_feita_vai_orcar)
SELECT c.id, true FROM companies c WHERE c.is_demo = true
ON CONFLICT (company_id) DO UPDATE SET visita_feita_vai_orcar = true;
