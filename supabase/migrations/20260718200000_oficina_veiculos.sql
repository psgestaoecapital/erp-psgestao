-- OFICINA LOTE 5 · VEÍCULOS POR PLACA (histórico do veículo). Operacional — SEM dinheiro-operação.
-- Busca por placa → dados do veículo + histórico completo de OS (data, serviços, peças, km, mecânico,
-- valor de referência já registrado) + evolução do km. RD-26: fonte é erp_os (a placa vive na OS).
-- 🚫 NÃO gera título, NÃO baixa estoque, NÃO abre tela financeira. Leitura consolidada, aditivo puro.
-- RD-45 escopo company_id. Reusa o registro de catálogo oficina_veiculos_fipe (ajusta a rota).

-- 1 · listar veículos (distintos por placa normalizada) com último dado + contagem de OS.
CREATE OR REPLACE FUNCTION public.fn_oficina_veiculos_listar(p_company_id uuid, p_termo text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $$
  WITH base AS (
    SELECT upper(regexp_replace(coalesce(o.placa,''),'[^A-Za-z0-9]','','g')) AS placa_norm, o.*
      FROM erp_os o
      WHERE o.company_id = p_company_id AND coalesce(o.excluida,false) = false
        AND coalesce(o.placa,'') <> ''
        AND (p_company_id IN (SELECT get_user_company_ids()) OR is_admin())
        AND (p_termo IS NULL OR btrim(p_termo) = ''
             OR upper(regexp_replace(coalesce(o.placa,''),'[^A-Za-z0-9]','','g'))
                LIKE '%' || upper(regexp_replace(p_termo,'[^A-Za-z0-9]','','g')) || '%'
             OR o.cliente_nome ILIKE '%' || p_termo || '%')
  ), agg AS (
    SELECT placa_norm,
           (array_agg(placa ORDER BY created_at DESC))[1] AS placa,
           (array_agg(cliente_nome ORDER BY created_at DESC))[1] AS cliente_nome,
           (array_agg(marca ORDER BY created_at DESC))[1] AS marca,
           (array_agg(modelo ORDER BY created_at DESC))[1] AS modelo,
           (array_agg(ano ORDER BY created_at DESC))[1] AS ano,
           (array_agg(km ORDER BY created_at DESC))[1] AS ultimo_km,
           count(*) AS os_count,
           max(coalesce(data_abertura, created_at::date)) AS ultima_data
      FROM base GROUP BY placa_norm
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'placa', placa, 'cliente_nome', cliente_nome, 'marca', marca, 'modelo', modelo,
           'ano', ano, 'ultimo_km', ultimo_km, 'os_count', os_count, 'ultima_data', ultima_data)
         ORDER BY ultima_data DESC NULLS LAST), '[]'::jsonb)
  FROM (SELECT * FROM agg ORDER BY ultima_data DESC NULLS LAST LIMIT 100) x;
$$;

-- 2 · histórico de um veículo (por placa): dados atuais + todas as OS + evolução do km.
CREATE OR REPLACE FUNCTION public.fn_oficina_veiculo_historico(p_company_id uuid, p_placa text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $$
  WITH norm AS (SELECT upper(regexp_replace(coalesce(p_placa,''),'[^A-Za-z0-9]','','g')) AS pn),
  base AS (
    SELECT o.* FROM erp_os o, norm
      WHERE o.company_id = p_company_id AND coalesce(o.excluida,false) = false
        AND upper(regexp_replace(coalesce(o.placa,''),'[^A-Za-z0-9]','','g')) = norm.pn
        AND norm.pn <> ''
        AND (p_company_id IN (SELECT get_user_company_ids()) OR is_admin())
  )
  SELECT jsonb_build_object(
    'veiculo', (SELECT jsonb_build_object('placa', b.placa, 'cliente_nome', b.cliente_nome,
                  'cliente_id', b.cliente_id, 'marca', b.marca, 'modelo', b.modelo, 'ano', b.ano,
                  'chassi', b.chassi, 'ultimo_km', b.km, 'os_count', (SELECT count(*) FROM base))
                FROM base b ORDER BY b.created_at DESC LIMIT 1),
    'os', coalesce((SELECT jsonb_agg(jsonb_build_object(
            'id', b.id, 'numero', b.numero, 'status', b.status,
            'data', coalesce(b.data_abertura, b.created_at::date), 'km', b.km,
            'tecnico_nome', b.tecnico_nome, 'defeito_relatado', b.defeito_relatado,
            'diagnostico', b.diagnostico, 'pecas_utilizadas', b.pecas_utilizadas, 'total', b.total,
            'itens_count', (SELECT count(*) FROM erp_os_diagnostico_item di WHERE di.os_id = b.id),
            'valor_aprovado', (SELECT a.valor_total FROM erp_os_aprovacao a
                                WHERE a.os_id = b.id ORDER BY a.created_at DESC LIMIT 1))
          ORDER BY coalesce(b.data_abertura, b.created_at::date) DESC, b.created_at DESC)
          FROM base b), '[]'::jsonb),
    'km_evolucao', coalesce((SELECT jsonb_agg(jsonb_build_object(
            'data', coalesce(b.data_abertura, b.created_at::date), 'km', b.km)
          ORDER BY coalesce(b.data_abertura, b.created_at::date))
          FROM base b WHERE b.km IS NOT NULL AND b.km > 0), '[]'::jsonb)
  );
$$;

GRANT EXECUTE ON FUNCTION public.fn_oficina_veiculos_listar(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_oficina_veiculo_historico(uuid, text) TO authenticated;

-- 3 · catálogo: reusa o registro oficina_veiculos_fipe (rota vazia) → aponta p/ a tela de Veículos.
UPDATE public.module_catalog
  SET rota = '/dashboard/oficina/veiculos', nome = 'Veículos'
  WHERE id = 'oficina_veiculos_fipe';
INSERT INTO public.system_screens (id, rota, area, modulo, titulo, estado_real)
SELECT gen_random_uuid(), '/dashboard/oficina/veiculos', 'oficina', 'oficina_veiculos_fipe', 'Veículos', 'parcial'
WHERE NOT EXISTS (SELECT 1 FROM public.system_screens WHERE rota='/dashboard/oficina/veiculos');
