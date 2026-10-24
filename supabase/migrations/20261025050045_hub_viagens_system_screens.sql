-- Hub · Viagens: cadastra a rota em system_screens (o auditor PDCA só enxerga o que está aqui) — gilberto-esteira (faixa 45).
INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, estado_real, prioridade_monitoramento)
VALUES ('dashboard.projetos_viagens', '/dashboard/projetos/viagens', 'hub_construcao', 'Viagens e deslocamento',
        'Viagem da equipe por obra: cupons, adiantamento × saldo e fechamento com título na GE', 'parcial', 'alta')
ON CONFLICT (id) DO NOTHING;
