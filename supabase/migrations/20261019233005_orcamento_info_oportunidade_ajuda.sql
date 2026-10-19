-- #3272 (Tryo, HB2): bloco "Informações da oportunidade" dentro de Editar orçamento (só leitura).
-- Aditiva: só texto do "?" (RD-95). Nenhuma tabela/função muda.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, status)
VALUES
 ('orcamentos.oportunidade.info', '/dashboard/orcamentos', 'Orçamento', 'Informações da oportunidade',
  'Nada a preencher: o bloco mostra os dados da oportunidade que originou este orçamento (cliente, obra, responsável, origem, observações).',
  'Quem elabora o orçamento vê, sem sair da tela, o que foi combinado na visita e na oportunidade.',
  'Oportunidade "Reforma sala 3", obra na Rua X, responsável Maria, observação "cliente quer entrega em 30 dias".',
  'Tentar editar aqui: para mudar esses dados, abra a oportunidade pelo link do bloco.',
  'gestao_empresarial', 'publicado')
ON CONFLICT (chave) DO NOTHING;
