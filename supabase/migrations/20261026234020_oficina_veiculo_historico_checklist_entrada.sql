-- Oficina › Veículos: o histórico do veículo passa a trazer o CHECKLIST DE ENTRADA de cada passagem (km, combustível,
-- itens conferidos, avarias, objetos deixados no veículo, observações e quantas fotos) — jordana-code (faixa 20),
-- chamado #4052 (Gean: "um veículo retornou depois de 2 meses e queremos ver tudo que foi registrado na entrada").
-- Os dados já existiam em erp_os_recepcao (1 por OS), só não apareciam em lugar nenhum para consulta.
-- CREATE OR REPLACE da função comum (mesma assinatura, mesmo SECURITY INVOKER/STABLE, mesmo GRANT): só acrescenta a
-- chave 'entrada' em cada OS; nada existente muda. A leitura de erp_os_recepcao segue a RLS da própria tabela.
CREATE OR REPLACE FUNCTION public.fn_oficina_veiculo_historico(p_company_id uuid, p_placa text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
                                WHERE a.os_id = b.id ORDER BY a.created_at DESC LIMIT 1),
            -- #4052: checklist de entrada da passagem (null quando a OS não passou pela recepção)
            'entrada', (SELECT jsonb_build_object(
                          'registrado_em', r.created_at, 'km_entrada', r.km_entrada, 'combustivel', r.combustivel,
                          'checklist', coalesce(r.checklist, '{}'::jsonb), 'avarias', r.avarias,
                          'objetos_veiculo', r.objetos_veiculo, 'observacoes', r.observacoes,
                          'fotos_count', CASE WHEN jsonb_typeof(r.fotos) = 'array' THEN jsonb_array_length(r.fotos) ELSE 0 END)
                        FROM erp_os_recepcao r
                        WHERE r.os_id = b.id AND r.company_id = b.company_id
                        ORDER BY r.created_at DESC LIMIT 1))
          ORDER BY coalesce(b.data_abertura, b.created_at::date) DESC, b.created_at DESC)
          FROM base b), '[]'::jsonb),
    'km_evolucao', coalesce((SELECT jsonb_agg(jsonb_build_object(
            'data', coalesce(b.data_abertura, b.created_at::date), 'km', b.km)
          ORDER BY coalesce(b.data_abertura, b.created_at::date))
          FROM base b WHERE b.km IS NOT NULL AND b.km > 0), '[]'::jsonb)
  );
$function$;

GRANT EXECUTE ON FUNCTION public.fn_oficina_veiculo_historico(uuid, text) TO authenticated;

-- "?" (RD-95) da nova seção da tela /dashboard/oficina/veiculos. ADITIVA (ON CONFLICT DO NOTHING).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/oficina/veiculos', 'oficina', 'publicado'
FROM (VALUES
  ('oficina.veiculos.checklist_entrada', 'Histórico do veículo', 'Checklist de entrada',
   'Não se preenche aqui: é o que foi registrado na Recepção do veículo quando ele chegou (km, combustível, itens conferidos, avarias e objetos deixados). Toque em "Ver checklist de entrada" na passagem que quer consultar.',
   'Mostra como o veículo entrou em cada passagem, para conferir depois — por exemplo quando o cliente volta meses depois ou questiona um risco ou um objeto.',
   'OS-2026-0198 · entrada 12/08: 84.320 km, ½ tanque, pneus ok, estepe ok, avaria "risco na porta traseira esquerda".',
   'Se a passagem não mostra o checklist, a OS foi aberta sem passar pela Recepção do veículo — registre a entrada na Recepção nas próximas.',
   10)
) v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
