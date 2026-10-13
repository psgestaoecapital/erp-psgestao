-- ============================================================
-- Oficina · cadastrar /os/[token] no catálogo (system_screens) — tela pública órfã (Hub V8)
-- ============================================================
-- O portal público do orçamento/DVI da Onda 2 (/os/[token]) nunca entrou em system_screens — órfão
-- pré-existente. O CEO pediu cadastrar junto com o portal do veículo; o #1446 mergeou antes de pegar
-- carona, então vai neste PR curto. Mesma tela pública, mesmo tratamento (auditavel_robo=false):
-- o robô não tem token válido, só veria a página neutra.

INSERT INTO public.system_screens
  (id, rota, area, titulo, descricao_funcional, modulo, estado_real, prioridade_monitoramento, rpcs_chamadas, auditavel_robo, motivo_nao_auditavel)
VALUES
  ('oficina_os_portal', '/os/[token]', 'oficina', 'Orçamento público da OS (DVI)',
   'Portal público por token: o cliente vê o diagnóstico/orçamento e aprova item a item (DVI, Onda 2). Signed URL server-side, noindex, página neutra em token inválido.',
   'oficina_aprovacao_cliente', 'pronto', 'baixa',
   ARRAY['fn_os_publico_obter','fn_os_link_publico_gerar']::text[],
   false, 'Rota pública por token: o robô não tem token válido — só veria a página neutra. Auditoria visual é prova pontual do portal, não do conteúdo.')
ON CONFLICT (id) DO UPDATE SET
  rota = EXCLUDED.rota, area = EXCLUDED.area, titulo = EXCLUDED.titulo,
  descricao_funcional = EXCLUDED.descricao_funcional, modulo = EXCLUDED.modulo,
  estado_real = EXCLUDED.estado_real, rpcs_chamadas = EXCLUDED.rpcs_chamadas,
  auditavel_robo = EXCLUDED.auditavel_robo, motivo_nao_auditavel = EXCLUDED.motivo_nao_auditavel,
  atualizado_em = now();
