-- #6728 (rodrigo-code): "?" do rascunho da NF-e avulsa (RD-95). Só acrescenta a chave de ajuda.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES (
  'fiscal.nfe_avulsa.rascunho', 'NF-e avulsa', 'Salvar rascunho',
  'Toque em Salvar rascunho para guardar o que já preencheu (destinatário, CFOP, itens, frete). Ao voltar à tela, use Restaurar.',
  'Evita perder o preenchimento se precisar sair. O rascunho fica só neste navegador e não emite nem envia nada à SEFAZ.',
  'Parou no meio da remessa para conferir o CFOP: salve o rascunho, volte depois e restaure.',
  'Achar que o rascunho é uma nota emitida: ele só guarda os campos, a nota só sai ao tocar em Emitir NF-e.',
  18, '/dashboard/fiscal/nfe/remessa', 'fiscal', 'publicado'
)
ON CONFLICT (chave) DO NOTHING;
