-- HB2: ajuda de campo ("?") da tela Nova obra (regra do Hub: todo campo tem ajuda). Só texto novo; nada é alterado.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem)
VALUES
  ('projetos.obra_nova.cliente', '/dashboard/projetos/obras/nova', 'Nova obra', 'Cliente',
   'O nome do cliente dono da obra, como no contrato.',
   'Liga a obra ao cliente: aparece no cockpit, na proposta e na medição.',
   'FC Pisos Industriais', 'Abreviar o nome. Depois a obra não acha o cliente nos relatórios.', 900),
  ('projetos.obra_nova.nome', '/dashboard/projetos/obras/nova', 'Nova obra', 'Nome da obra',
   'Opcional. Se ficar vazio, o sistema usa o endereço.',
   'É o nome que aparece na lista de obras e no cockpit.',
   'Galpão BRF — Rio Verde', 'Repetir o número da obra no nome; o número já é automático.', 901)
ON CONFLICT (chave) DO NOTHING;
