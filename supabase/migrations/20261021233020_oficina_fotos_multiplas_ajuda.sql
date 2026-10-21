-- #135 (Triches) item 6 · ajuste 21/10: várias fotos de uma vez em todas as telas de foto da oficina (recepção,
-- diagnóstico e Ordem de Serviço). ADITIVA: só os textos do "?" (RD-95) dos controles novos. Sem tabela, função ou dado
-- de cliente (o envio usa o bucket oficina-recepcao e as RPCs já existentes fn_oficina_registro_salvar,
-- fn_oficina_registro_listar e fn_os_foto_excluir).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Oficina', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/os', 'oficina', 'publicado'
FROM (VALUES
  ('oficina.fotos.enviar_varias', 'Escolher fotos / Câmera',
   'Clique em "Escolher fotos" e marque várias de uma vez (no computador segure Ctrl ou Shift; no celular toque em várias na galeria). Em "Câmera" o celular abre a câmera.',
   'As fotos sobem juntas (até 3 ao mesmo tempo), já reduzidas para subir rápido sem perder a leitura. Cada uma mostra a sua barra; as salvas ficam ligadas à OS e aparecem na impressão.',
   'Selecionar as 10 fotos do caminhão na galeria de uma vez: a barra de cada uma vai até "salva" e as miniaturas aparecem na OS.',
   'Fechar a tela antes de todas ficarem "salva". Se uma foto aparecer como "não subiu", as outras já estão salvas: envie de novo só a que faltou.',
   1),
  ('oficina.fotos.legenda', 'Legenda (opcional)',
   'Um texto curto que vai junto das fotos que você enviar agora. Pode deixar em branco.',
   'Ajuda a lembrar o que a foto mostra e aparece embaixo da miniatura e na impressão da OS. Em branco, a foto entra como "Foto da OS".',
   'Peça trocada · antes do serviço · vazamento no cárter.',
   'Escrever a legenda depois de escolher as fotos: ela vale para as fotos escolhidas DEPOIS de preenchida.',
   2),
  ('oficina.fotos.excluir', 'Excluir foto',
   'Clique em "excluir" embaixo da miniatura e confirme.',
   'Tira a foto da OS e do histórico fotográfico da impressão, e apaga o arquivo.',
   'Foto tremida ou de outro veículo enviada por engano.',
   'Excluir sem conferir: a foto excluída não volta; se precisar, envie de novo.',
   3)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
