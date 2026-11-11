-- Hub · Insumos (#3363): filtro "Tipo" separa Material / Equipamento / EPI, derivado da categoria do insumo
-- (EQUIP -> Equipamento, EPI -> EPI, demais -> Material). Só INSERT de texto de ajuda (RD-95); idempotente.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, vertical, ordem, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum)
VALUES
  ('projetos.insumos.filtro_tipo', '/dashboard/projetos/insumos', 'Insumos', 'hub_projetos', 28, 'Tipo',
   'Material, Equipamento ou EPI — ou Todos. O tipo vem da categoria do insumo (EPI e Equipamentos têm categoria própria).',
   'Só filtra a lista. Ajuda a separar material de consumo da obra dos equipamentos/ferramentas e dos EPIs de segurança.',
   'EPI, para revisar só os itens de segurança', 'Esquecer o filtro em Equipamento e achar que os materiais sumiram da lista.')
ON CONFLICT (chave) DO NOTHING;
