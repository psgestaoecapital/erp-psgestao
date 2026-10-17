-- Chamado #3242 (Gean): filtro "NF emitida / Falta emitir" nas OS entregues e indicador de NF na OS. Aditivo: só "?" (RD-95).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Ordens de Serviço', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/os', 'oficina', 'publicado'
FROM (VALUES
  ('os.filtro.nota_fiscal', 'Nota fiscal (filtro das entregues)',
   'Com o filtro "Entregue" marcado, escolha: Todas, NF emitida ou Falta emitir.',
   'Mostra quais OS já entregues têm nota fiscal autorizada (NF-e de peças ou NFS-e de serviços) e quais ainda precisam da nota, para nenhuma ficar sem emitir.',
   'Clique em "Falta emitir" para ver as OS entregues sem nota e emitir uma a uma pela ficha da OS.',
   'Nota rejeitada ou cancelada não conta como emitida: a OS continua em "Falta emitir" até a nota ser autorizada. Notas emitidas fora da OS (direto em Notas Fiscais) não aparecem aqui.',
   40),
  ('os.nota_fiscal.situacao', 'Situação da nota fiscal da OS',
   'Não precisa preencher: o sistema mostra sozinho a nota emitida a partir desta OS.',
   'Indica se a OS já tem NF-e (peças) e/ou NFS-e (serviços) autorizada, com o número da nota, ou se ainda falta emitir.',
   '"🧾 NF-e 659 · NFS-e 134" = as duas notas autorizadas. "Sem NF emitida" = use os botões de emissão ao lado.',
   '"⏳ NF processando" ainda está na SEFAZ/prefeitura: aguarde alguns minutos antes de emitir de novo.',
   41)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
