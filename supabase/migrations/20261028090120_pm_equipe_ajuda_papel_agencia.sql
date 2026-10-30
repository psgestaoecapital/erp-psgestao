-- P&M · Equipe · "Papel na agência" (#2145): texto do "?" do campo novo (RD-95). Aditivo e idempotente.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
SELECT 'pm.equipe.papel_agencia', '/dashboard/pm/equipe', 'Equipe', 'Papel na agência',
       'Escolha o papel desta pessoa na agência (ex.: gestor de contas, redator). Antes de gravar, a tela mostra o antes e o depois.',
       'Define o que a pessoa pode fazer na agência. Hoje ainda não muda as telas: é o cadastro do papel, para quando as permissões forem ligadas.',
       'Gestor de contas', 'Gravar sem conferir a prévia: o antes e o depois mostram o que muda antes de salvar.', 'pm', 930, 1, 'publicado'
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo WHERE chave = 'pm.equipe.papel_agencia');
