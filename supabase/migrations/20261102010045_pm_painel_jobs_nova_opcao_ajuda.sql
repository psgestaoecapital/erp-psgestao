-- PDCA P&M · /dashboard/pm/painel-jobs · RD-95: "?" no campo de salvar opção de filtro.
-- Gap (aud8 01/11): o input "Nome da opção" e a ação "Salvar opção" (page.tsx) não tinham AjudaCampo.
-- Esta migration ADITIVA cadastra a chave de ajuda; o front passa a renderar o "?" ao lado do campo.
-- O controle <select multiple> (componente Multi) segue coberto pelo "?" do próprio rótulo do filtro.
-- Idempotente (não recria chave existente).

INSERT INTO public.erp_ajuda_campo
  (rota, chave, grupo, ordem, rotulo, status, versao, vertical, o_que_preencher, para_que_serve, exemplo, erro_comum)
SELECT v.rota, v.chave, v.grupo, v.ordem, v.rotulo, 'publicado', 1, 'pm',
       v.o_que_preencher, v.para_que_serve, v.exemplo, v.erro_comum
FROM (VALUES
  ('/dashboard/pm/painel-jobs', 'pm.painel_jobs.nova_opcao', 'Painel de Jobs', 20, 'Salvar opção',
   'Dê um nome para guardar o conjunto de filtros que está aplicado agora como uma opção reutilizável.',
   'Salva seus filtros favoritos para reaplicar o painel com um clique, sem remontar tudo toda vez.',
   'Salvar "Atrasados do mês" guarda os filtros de situação e prazo para você reusar depois num clique.',
   'Sem um nome preenchido o botão Salvar fica desabilitado — digite um nome antes de salvar a opção.')
) AS v(rota, chave, grupo, ordem, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.chave = v.chave);
