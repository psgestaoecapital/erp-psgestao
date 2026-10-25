-- #4052 (Gean) · Histórico do veículo: consultar o checklist de entrada (km, combustível, itens, avarias, objetos e fotos)
-- de cada passagem, sem precisar abrir a OS. Só LEITURA: acrescenta o bloco 'recepcao' em cada OS do histórico.
-- CREATE OR REPLACE da versão viva (pg_get_functiondef em 25/10): mesmas chaves, mesmo filtro de empresa
-- (get_user_company_ids/is_admin), continua SECURITY INVOKER (a RLS de erp_os_recepcao vale para o usuário).
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
            'recepcao', (SELECT jsonb_build_object(
                            'registrado_em', r.created_at, 'km_entrada', r.km_entrada,
                            'combustivel', r.combustivel, 'checklist', coalesce(r.checklist, '{}'::jsonb),
                            'avarias', r.avarias, 'objetos_veiculo', r.objetos_veiculo,
                            'observacoes', r.observacoes, 'fotos', coalesce(r.fotos, '[]'::jsonb))
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

-- "?" (RD-95) do novo bloco da tela de Veículos.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Oficina', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/oficina/veiculos', 'oficina', 'publicado'
FROM (VALUES
  ('oficina.veiculos.checklist_entrada', 'Checklist de entrada',
   'Nada a preencher: é só consulta. Toque em "Ver checklist de entrada" na passagem para ver como o veículo chegou naquele dia.',
   'Guarda o que foi registrado na recepção (km, combustível, itens OK/avaria, avarias, objetos deixados e fotos) para consultar quando o veículo voltar, sem abrir a OS.',
   'O carro voltou 2 meses depois reclamando de um risco → abra a placa, toque na passagem anterior e confira se o risco já estava nas avarias ou nas fotos da entrada.',
   'Procurar o checklist numa OS aberta sem passar pela Recepção: ela não tem checklist e aparece "Sem checklist de entrada".', 1)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
