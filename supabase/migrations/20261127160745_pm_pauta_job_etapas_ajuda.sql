-- P&M · tela 135 "Tempo medido sem clique" (CEO 25/11, go-live da agência piloto).
-- Ajuda "?" (RD-95) do bloco "Etapas do job" que aparece no job aberto da Pauta
-- (componente src/components/pm/JobEtapas.tsx; RPCs fn_agency_job_etapas_listar /
-- fn_agency_job_etapa_situacao já na main).
-- Aditiva e idempotente: só insere chaves novas em erp_ajuda_campo (ON CONFLICT DO NOTHING).
-- NÃO altera tabela, função, RLS, grant, trigger ou dado existente.
-- Code: desenvolvedor_4_g

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'pm', 'publicado'
FROM (VALUES
 ('pm.pauta.job_etapas', 'Pauta', 'Etapas do job',
  'As etapas que este job herdou do serviço. O job nasce com elas sozinho — você não precisa redigitar nada.',
  'Cada etapa tem situação própria e, ao mudar para "Em andamento" e "Concluída", o sistema registra entrada e saída pelo calendário. É assim que o tempo do job é medido sem a pessoa cronometrar (base da margem, da produtividade e do preço).',
  'Briefing · Criação · Revisão interna · Aprovação do cliente · Publicação.',
  'Esperar etapas num job cujo serviço ainda não tem modelo de etapas: defina-as antes no Catálogo de Serviços.',
  30, '/dashboard/pm/pauta')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
