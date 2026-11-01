-- Hub · Obras: "?" (RD-95) do selo de pendência fiscal do card (obra sem CNO/código municipal ou sem endereço).
-- Aditiva: só texto de ajuda novo; sem dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'hub_projetos', 'publicado'
FROM (VALUES
 ('projetos.obras.fiscal_pendente', 'Card da obra', 'Pendência fiscal',
  'Toque no aviso e preencha o CNO (ou o código de obra municipal) e o endereço da obra em "Dados fiscais".',
  'A NFS-e de construção exige a identificação da obra e o endereço (E0370). Sem isso a nota não é emitida e o faturado da obra fica zerado.',
  'Obra sem CNO → aviso aparece; após salvar o CNO e o endereço, o aviso some.',
  'Achar que o resultado zerado é erro de cálculo: ele zera porque ainda não há NFS-e autorizada ligada à obra.',
  12, '/dashboard/projetos/obras')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
