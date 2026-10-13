-- OFICINA LOTE 1 · RECEPÇÃO DE VEÍCULO (check-in). Operacional/técnico (financeiro é da GE).
-- Busca por placa (histórico da OS) → cria OS (reusa fn_os_criar, status 'aberta' = vai pro pátio)
-- + completa veículo + grava checklist de entrada com FOTOS. RD-45 escopo company_id.

-- 1 · tabela da recepção (snapshot de entrada · 1 por OS)
CREATE TABLE IF NOT EXISTS public.erp_os_recepcao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  os_id uuid NOT NULL REFERENCES public.erp_os(id) ON DELETE CASCADE,
  km_entrada integer,
  combustivel text,             -- vazio / 1_4 / meio / 3_4 / cheio
  checklist jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {pneus:ok/avaria, farois:..., ...}
  avarias text,                 -- riscos/avarias na entrada (protege de reclamação)
  objetos_veiculo text,         -- objetos deixados no carro
  observacoes text,
  fotos jsonb NOT NULL DEFAULT '[]'::jsonb,        -- array de storage paths
  criado_por uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_os_recepcao_os ON public.erp_os_recepcao(company_id, os_id);

ALTER TABLE public.erp_os_recepcao ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_os_recepcao_all ON public.erp_os_recepcao;
CREATE POLICY erp_os_recepcao_all ON public.erp_os_recepcao FOR ALL
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- 2 · buscar por placa: puxa o último cliente/veículo daquela placa (prefill do check-in)
CREATE OR REPLACE FUNCTION public.fn_oficina_buscar_placa(p_company_id uuid, p_placa text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'encontrado', true, 'cliente_id', o.cliente_id, 'cliente_nome', o.cliente_nome,
    'cliente_cnpj', o.cliente_cnpj, 'marca', o.marca, 'modelo', o.modelo, 'ano', o.ano,
    'ultimo_km', o.km, 'placa', o.placa, 'os_anteriores',
    (SELECT count(*) FROM erp_os o2 WHERE o2.company_id=p_company_id
       AND upper(regexp_replace(coalesce(o2.placa,''),'[^A-Za-z0-9]','','g')) = upper(regexp_replace(coalesce(p_placa,''),'[^A-Za-z0-9]','','g'))))
  FROM erp_os o
  WHERE o.company_id = p_company_id
    AND upper(regexp_replace(coalesce(o.placa,''),'[^A-Za-z0-9]','','g')) = upper(regexp_replace(coalesce(p_placa,''),'[^A-Za-z0-9]','','g'))
    AND (p_company_id IN (SELECT get_user_company_ids()) OR is_admin())
  ORDER BY o.created_at DESC LIMIT 1;
$$;

-- 3 · criar a recepção: OS (reusa fn_os_criar) + veículo + checklist/fotos. Atômico.
CREATE OR REPLACE FUNCTION public.fn_oficina_recepcao_criar(p_company_id uuid, p_dados jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_res jsonb; v_os_id uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  -- OS (status 'aberta' → pátio). RD-26: reusa o criador canônico.
  v_res := public.fn_os_criar(
    p_company_id,
    coalesce(nullif(btrim(p_dados->>'queixa'), ''), 'Recepção de veículo'),
    nullif(p_dados->>'cliente_id', '')::uuid,
    (p_dados->>'cliente_nome')::varchar,
    (p_dados->>'cliente_cnpj')::varchar,
    NULL::varchar,
    p_dados->>'queixa',
    NULL::uuid, NULL::varchar, coalesce(nullif(p_dados->>'prioridade', ''), 'normal')::varchar,
    (p_dados->>'placa')::varchar, (p_dados->>'modelo')::varchar
  );
  IF NOT coalesce((v_res->>'ok')::boolean, false) THEN RETURN v_res; END IF;
  v_os_id := (v_res->>'os_id')::uuid;
  -- completa o veículo (marca/ano/km/chassi) — colunas reais (RD-44)
  UPDATE erp_os SET
    marca = nullif(p_dados->>'marca', ''),
    ano = nullif(p_dados->>'ano', '')::int,
    km = nullif(p_dados->>'km', '')::int,
    chassi = nullif(p_dados->>'chassi', ''),
    updated_at = now()
  WHERE id = v_os_id AND company_id = p_company_id;
  -- snapshot da recepção
  INSERT INTO erp_os_recepcao (company_id, os_id, km_entrada, combustivel, checklist, avarias, objetos_veiculo, observacoes, fotos, criado_por)
  VALUES (p_company_id, v_os_id, nullif(p_dados->>'km','')::int, nullif(p_dados->>'combustivel',''),
    coalesce(p_dados->'checklist', '{}'::jsonb), nullif(p_dados->>'avarias',''), nullif(p_dados->>'objetos',''),
    nullif(p_dados->>'observacoes',''), coalesce(p_dados->'fotos', '[]'::jsonb), auth.uid());
  RETURN jsonb_build_object('ok', true, 'os_id', v_os_id, 'numero', v_res->>'numero');
END $$;

GRANT EXECUTE ON FUNCTION public.fn_oficina_buscar_placa(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_oficina_recepcao_criar(uuid, jsonb) TO authenticated;

-- 4 · bucket de fotos da recepção (privado) + RLS por company (prefixo do path = company_id)
INSERT INTO storage.buckets (id, name, public) VALUES ('oficina-recepcao', 'oficina-recepcao', false)
  ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS oficina_recepcao_ins ON storage.objects;
CREATE POLICY oficina_recepcao_ins ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id='oficina-recepcao' AND (storage.foldername(name))[1]::uuid IN (SELECT get_user_company_ids()));
DROP POLICY IF EXISTS oficina_recepcao_sel ON storage.objects;
CREATE POLICY oficina_recepcao_sel ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id='oficina-recepcao' AND (storage.foldername(name))[1]::uuid IN (SELECT get_user_company_ids()));

-- 5 · catálogo: liga o menu à rota da Recepção + registra a tela (Screen Watcher; 'parcial' até validar na tela)
UPDATE public.module_catalog SET rota='/dashboard/oficina/recepcao' WHERE id='oficina_recepcao';
INSERT INTO public.system_screens (id, rota, area, modulo, titulo, estado_real)
SELECT gen_random_uuid(), '/dashboard/oficina/recepcao', 'oficina', 'oficina_recepcao', 'Recepção de Veículo', 'parcial'
WHERE NOT EXISTS (SELECT 1 FROM public.system_screens WHERE rota='/dashboard/oficina/recepcao');
