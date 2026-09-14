-- ============================================================
-- Oficina · cadastrar a tela Pós-venda no catálogo (system_screens) — Hub V8
-- ============================================================
-- A tela /dashboard/oficina/pos-venda (Onda 10 B/C) nasceu ÓRFÃ: já está em module_catalog (menu/hub),
-- mas faltava em system_screens — invisível para o auditor Gold e para o monitor visual (mesmo padrão
-- que já mordeu o Cofre e as Pausas Térmicas). Aqui ela entra no catálogo.
--
-- Estado honesto (RD-58): 'pronto' — está no ar e funcional (fila + central de contato). Sem cifrão (R4).

INSERT INTO public.system_screens
  (id, rota, area, titulo, descricao_funcional, modulo, estado_real, prioridade_monitoramento, rpcs_chamadas)
VALUES
  ('oficina_pos_venda', '/dashboard/oficina/pos-venda', 'oficina', 'Pós-venda',
   'Pós-venda por placa: contagem regressiva dos dias que faltam p/ cada veículo entrar na janela + central de contato (Chamar no WhatsApp, registro de desfecho; quem recusa sai da fila). SEM valores (R4).',
   'oficina_pos_venda', 'pronto', 'media',
   ARRAY['fn_oficina_pos_venda_fila','fn_oficina_pos_venda_janela_set','fn_oficina_cliente_contato_obter',
         'fn_oficina_contato_registrar','fn_oficina_contato_desfecho']::text[])
ON CONFLICT (id) DO UPDATE SET
  rota = EXCLUDED.rota, area = EXCLUDED.area, titulo = EXCLUDED.titulo,
  descricao_funcional = EXCLUDED.descricao_funcional, modulo = EXCLUDED.modulo,
  estado_real = EXCLUDED.estado_real, rpcs_chamadas = EXCLUDED.rpcs_chamadas, atualizado_em = now();
