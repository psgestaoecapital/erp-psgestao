-- Revenda R0.5 complemento · 2 OS de preparação na Demonstração Revenda (a fazer / fazendo)
--
-- Completa o que faltou do R0.5 (auditoria RD-70): OS de preparação ligadas a veículos da demo.
-- (As fotos sintéticas dos 8 veículos entram pelo fluxo de UPLOAD — bytes no storage, fora de SQL.)
-- Guard fail-closed por is_demo no WHERE: só insere se a empresa for de demonstração. Idempotente.
-- "a fazer" = status 'aberta'; "fazendo" = status 'em_execucao'. Ligadas via veic_veiculo_id.

INSERT INTO public.erp_os (id, company_id, numero, descricao_servico, status, veic_veiculo_id,
  modelo, data_abertura, prioridade, excluida, snapshot_estimado, km_indisponivel, custo_incompleto)
SELECT x.id, c.id, x.numero, x.descricao, x.status, x.veic, x.modelo,
       (now() - x.dias)::date, x.prioridade, false, false, false, false
FROM (VALUES
  (md5('b0700000-0000-4000-a000-000000000003:r05b:os:1')::uuid, 'OS-DEMO-PREP-1',
   'Preparação para venda: revisão geral + limpeza técnica + polimento', 'aberta',
   'da54642e-612a-4dbc-8d6f-6cbf73e5cc6a'::uuid, 'Gol 1.6', interval '2 days', 'media'),
  (md5('b0700000-0000-4000-a000-000000000003:r05b:os:2')::uuid, 'OS-DEMO-PREP-2',
   'Preparação para venda: troca de pneus dianteiros + reparo do parachoque', 'em_execucao',
   '3f323a73-14fc-4e72-a59c-057de7da9d58'::uuid, 'Kicks', interval '1 day', 'alta')
) AS x(id, numero, descricao, status, veic, modelo, dias, prioridade)
CROSS JOIN public.companies c
WHERE c.id = 'b0700000-0000-4000-a000-000000000003' AND c.is_demo = true
ON CONFLICT (id) DO NOTHING;
