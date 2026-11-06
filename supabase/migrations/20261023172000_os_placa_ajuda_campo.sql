-- "?" (RD-95) do campo Placa na ficha da OS (HB0 item 6). Aditiva: só linha de ajuda.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('os.ficha.placa', 'Ficha da OS', 'Placa do veículo',
 'Placa do veículo atendido, com pelo menos 5 caracteres. Maiúsculas e traço são ajustados sozinhos.',
 'Identifica o veículo na OS, no pátio e no histórico do cliente. Só aparece em empresas do ramo automotivo.', 'ABC1D23', 'Digitar a placa de outro veículo ao abrir a OS; corrija aqui e salve.', 5, '/dashboard/os', 'oficina', 'publicado')
ON CONFLICT (chave) DO NOTHING;
