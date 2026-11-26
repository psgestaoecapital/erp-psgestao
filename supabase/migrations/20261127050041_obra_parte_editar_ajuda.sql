-- 20261128120041 · code-desenvolvedor-3 · Tela 314/partes (aud8 msg 3337db6a) — RD-95: "?" da ação "Editar".
-- A tela de partes da obra passa em a–h (nota 96) e já tem "?" em papel/nome/documento/contato/observação,
-- "+ Adicionar parte" e "Excluir". O ÚNICO gap que retém o selo é a ação "Editar" sem o "?". A tela ganhou o
-- <AjudaCampo chave="projetos.obra_parte.editar" />; esta migration ADITIVA cadastra a chave no banco.
-- Idempotente (ON CONFLICT). Não altera dado de cliente.
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('projetos.obra_parte.editar',
   '/dashboard/projetos/obras/[id]/partes',
   'Partes da obra',
   'Editar',
   'Toque em Editar para abrir o formulário da parte e corrigir papel, nome, CPF/CNPJ, contato ou observação.',
   'Ajusta os dados de uma parte já cadastrada (ex.: corrigir o documento ou o contato do representante) sem precisar excluir e recriar. Não apaga o histórico da obra.',
   'O contato do proprietário mudou → Editar → atualize o telefone/e-mail → Salvar.',
   'Usar Editar para "trocar" a parte por outra pessoa — nesse caso cadastre uma nova parte e, se for o caso, exclua a antiga, preservando o histórico.',
   'hub_projetos', 8, 1, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical, ordem = EXCLUDED.ordem, status = EXCLUDED.status;
