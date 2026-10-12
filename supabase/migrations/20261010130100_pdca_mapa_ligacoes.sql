-- PDCA · MAPA DE LIGAÇÕES entre telas (CEO 09/10, msg 0c4baabe). Fatia 1: catálogo + executor + primeiras ligações Hub e GE.
-- Aditivo: tabelas NOVAS com RLS ligada, sem policy (só service_role/SECURITY DEFINER), REVOKE de anon/authenticated.
-- Cada ligação: origem (tela/ação) → destino (tela) + SQL de conferência. O SQL recebe $1 = company_id da DEMO da
-- vertical e devolve UMA linha (esperado int, encontrado int). Só SELECT; o executor roda com timeout curto.

CREATE TABLE IF NOT EXISTS public.pdca_ligacao (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vertical      text NOT NULL,
  codigo        text NOT NULL,
  origem_rota   text NOT NULL,
  acao          text NOT NULL,
  destino_rota  text NOT NULL,
  deve_aparecer text NOT NULL,
  sql_conferencia text NOT NULL,
  code_dono     text NOT NULL DEFAULT 'gilberto-chamados',
  ativa         boolean NOT NULL DEFAULT true,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vertical, codigo),
  CONSTRAINT pdca_ligacao_sql_select CHECK (sql_conferencia ~* '^\s*select' AND sql_conferencia !~* '\m(insert|update|delete|drop|truncate|alter|grant)\M')
);

CREATE TABLE IF NOT EXISTS public.pdca_ligacao_resultado (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ligacao_id  uuid NOT NULL REFERENCES public.pdca_ligacao(id) ON DELETE CASCADE,
  vertical    text NOT NULL,
  status      text NOT NULL CHECK (status IN ('verde','vermelho','erro','sem_demo')),
  esperado    int,
  encontrado  int,
  diagnostico text,
  avaliado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pdca_ligacao_resultado_lig_idx ON public.pdca_ligacao_resultado (ligacao_id, avaliado_em DESC);

ALTER TABLE public.pdca_ligacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pdca_ligacao_resultado ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pdca_ligacao, public.pdca_ligacao_resultado FROM anon, authenticated;

-- ci-sem-guarda: fn_pdca_ligacoes_executar — só service_role (rotina/robô); lê a DEMO da vertical e grava resultado
CREATE OR REPLACE FUNCTION public.fn_pdca_ligacoes_executar(p_vertical text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  l record; v_demo uuid; v_esp int; v_enc int; v_st text; v_dx text;
  v_verde int := 0; v_verm int := 0; v_outro int := 0;
BEGIN
  SET LOCAL statement_timeout = '10s';
  FOR l IN SELECT * FROM pdca_ligacao WHERE ativa AND (p_vertical IS NULL OR vertical = p_vertical) ORDER BY vertical, codigo LOOP
    v_esp := NULL; v_enc := NULL; v_dx := NULL;
    v_demo := fn_demo_da_area(l.vertical);
    IF v_demo IS NULL THEN
      v_st := 'sem_demo'; v_dx := 'Vertical sem empresa DEMO em demo_por_area.';
    ELSE
      BEGIN
        EXECUTE l.sql_conferencia INTO v_esp, v_enc USING v_demo;
        IF COALESCE(v_enc,0) >= COALESCE(v_esp,1) THEN v_st := 'verde';
        ELSE
          v_st := 'vermelho';
          v_dx := format('Falta desenvolver: %s → %s (%s). Esperado %s, encontrado %s.', l.origem_rota, l.destino_rota, l.acao, v_esp, COALESCE(v_enc,0));
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_st := 'erro'; v_dx := left(SQLERRM, 300);
      END;
    END IF;
    INSERT INTO pdca_ligacao_resultado(ligacao_id, vertical, status, esperado, encontrado, diagnostico)
    VALUES (l.id, l.vertical, v_st, v_esp, v_enc, v_dx);
    IF v_st = 'verde' THEN v_verde := v_verde + 1; ELSIF v_st = 'vermelho' THEN v_verm := v_verm + 1; ELSE v_outro := v_outro + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'verde', v_verde, 'vermelho', v_verm, 'erro_ou_sem_demo', v_outro);
END $function$;
REVOKE ALL ON FUNCTION public.fn_pdca_ligacoes_executar(text) FROM PUBLIC, anon, authenticated;

-- Placar por vertical (último resultado de cada ligação)
CREATE OR REPLACE VIEW public.vw_pdca_ligacao_placar WITH (security_invoker = true) AS
SELECT l.vertical,
       count(*) AS ligacoes,
       count(*) FILTER (WHERE r.status = 'verde') AS verdes,
       count(*) FILTER (WHERE r.status = 'vermelho') AS vermelhas,
       count(*) FILTER (WHERE r.status IN ('erro','sem_demo') OR r.status IS NULL) AS sem_prova,
       round(100.0 * count(*) FILTER (WHERE r.status = 'verde') / NULLIF(count(*),0), 1) AS pct_verde
FROM pdca_ligacao l
LEFT JOIN LATERAL (SELECT status FROM pdca_ligacao_resultado WHERE ligacao_id = l.id ORDER BY avaliado_em DESC LIMIT 1) r ON true
WHERE l.ativa GROUP BY l.vertical;
REVOKE ALL ON public.vw_pdca_ligacao_placar FROM anon, authenticated;

-- Primeiras ligações: Hub (obra) e GE (a pagar)
INSERT INTO public.pdca_ligacao (vertical, codigo, origem_rota, acao, destino_rota, deve_aparecer, sql_conferencia, code_dono) VALUES
('hub','HUB-01','/dashboard/projetos/oportunidades','Marcar oportunidade como ganha','/dashboard/projetos/obras',
 'Toda oportunidade ganha aparece como obra (projetos_obras.oportunidade_id)',
 $q$SELECT count(*)::int, (SELECT count(*) FROM projetos_obras o WHERE o.company_id=$1 AND o.oportunidade_id IN (SELECT id FROM erp_crm_oportunidade WHERE company_id=$1 AND etapa ILIKE 'ganh%' AND deleted_at IS NULL))::int FROM erp_crm_oportunidade WHERE company_id=$1 AND etapa ILIKE 'ganh%' AND deleted_at IS NULL$q$,'gilberto-chamados'),
('hub','HUB-02','/dashboard/projetos/obras','Abrir obra','/dashboard/projetos/obras/[id]',
 'Obra em andamento tem itens contratados (projetos_obra_item)',
 $q$SELECT count(*)::int, (SELECT count(DISTINCT i.obra_id) FROM projetos_obra_item i JOIN projetos_obras o ON o.id=i.obra_id WHERE o.company_id=$1 AND o.status = 'em_andamento')::int FROM projetos_obras WHERE company_id=$1 AND status = 'em_andamento'$q$,'gilberto-chamados'),
('commerce','GE-01','/dashboard/financeiro/pagar','Lançar conta a pagar','/dashboard/financeiro/pagar',
 'Existem contas a pagar na DEMO da GE para a jornada lançar → baixar → conciliar',
 $q$SELECT 1, (SELECT count(*) FROM erp_pagar WHERE company_id=$1 AND deleted_at IS NULL)::int$q$,'gilberto-chamados'),
('commerce','GE-02','/dashboard/financeiro/pagar','Baixar conta a pagar','/dashboard/financeiro/conciliacao',
 'Contas pagas aparecem para conciliação (data_pagamento preenchida)',
 $q$SELECT 1, (SELECT count(*) FROM erp_pagar WHERE company_id=$1 AND deleted_at IS NULL AND data_pagamento IS NOT NULL)::int$q$,'gilberto-chamados')
ON CONFLICT (vertical, codigo) DO NOTHING;
