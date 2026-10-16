-- HB2 · Calculadora de Obra: "?" (RD-95) das camadas de chapa por face (parede dupla / corta-fogo). Aditiva (só ajuda). Faixa 05.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT 'projetos.calculadora.camadas', 'Calculadora de Obra', 'Camadas de chapa por face',
 'Escolha 1 para parede simples ou 2 para parede dupla / corta-fogo (duas chapas em cada face).',
 'Multiplica as chapas e os parafusos pela quantidade de camadas; guias, montantes e banda não mudam.',
 'Parede de 33,32 m² com 2 camadas → 65 chapas', 'Escolher 2 camadas e esquecer que a chapa corta-fogo (RF) é outro produto no de-para do estoque.', 13,
 '/dashboard/projetos/calculadora', 'hub', 'publicado'
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
