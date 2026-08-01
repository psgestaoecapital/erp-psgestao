-- RD-35 · registrar a tela "Solicitações de Peça" (/dashboard/oficina/solicitacoes)
-- em system_screens + link em screen_route_features (não deixar órfã). module_catalog
-- já tem a entrada 'oficina_solicitacoes_peca'. Idempotente.

INSERT INTO public.system_screens
  (id, rota, area, modulo, titulo, descricao_funcional, estado_real, prioridade_monitoramento,
   rpcs_chamadas, componentes_principais, features_relacionadas)
VALUES (
  'oficina_solicitacoes_peca', '/dashboard/oficina/solicitacoes', 'oficina', 'oficina_solicitacoes_peca',
  'Solicitações de Peça',
  'ADM/gerente vê e decide as solicitações de peça dos mecânicos: aprovar/comprar/recusar/marcar trocada. Filtros por OS e status; foto + observação do mecânico. Custo por unidade só aparece p/ papel gerencial (guard OPERATOR do #831). Custo/compra/estoque são de GE — a tela exibe/dispara, não recria.',
  'pronto', 'media',
  ARRAY['fn_oficina_peca_solicitacoes_listar','fn_oficina_peca_decidir','fn_oficina_peca_marcar_trocada','fn_acesso_efetivo']::text[],
  ARRAY['SolicitacoesPecaPage','Card','useAcesso']::text[],
  ARRAY['F.oficina_estoque_pecas.entrada_saida']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  rota = EXCLUDED.rota, area = EXCLUDED.area, modulo = EXCLUDED.modulo, titulo = EXCLUDED.titulo,
  descricao_funcional = EXCLUDED.descricao_funcional, estado_real = EXCLUDED.estado_real,
  prioridade_monitoramento = EXCLUDED.prioridade_monitoramento, rpcs_chamadas = EXCLUDED.rpcs_chamadas,
  componentes_principais = EXCLUDED.componentes_principais, features_relacionadas = EXCLUDED.features_relacionadas,
  atualizado_em = now();

INSERT INTO public.screen_route_features (screen_id, feature_id, peso, visibilidade)
SELECT 'oficina_solicitacoes_peca', 'F.oficina_estoque_pecas.entrada_saida', 1, 'primary'
WHERE NOT EXISTS (
  SELECT 1 FROM public.screen_route_features
  WHERE screen_id = 'oficina_solicitacoes_peca' AND feature_id = 'F.oficina_estoque_pecas.entrada_saida'
);
