-- HB2 · Calculadora de Obra: "?" (RD-95) da estrutura dupla (parede separativa). Aditiva (só ajuda). Faixa 05.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT 'projetos.calculadora.estrutura_dupla', 'Calculadora de Obra', 'Estrutura dupla (parede separativa)',
 'Marque quando a parede tem dois quadros de perfis independentes, um para cada lado (separação entre ambientes).',
 'Dobra guias, montantes e banda acústica; chapas, parafusos, massa e fita não mudam.',
 'Parede de 12,5 m com estrutura dupla → o dobro de guias e montantes', 'Marcar estrutura dupla e esquecer de informar a lã no miolo, que costuma acompanhar esse sistema.', 14,
 '/dashboard/projetos/calculadora', 'hub', 'publicado'
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
