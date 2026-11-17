-- RD-95: "?" do novo campo "Linha de negócio (opcional)" da tela Nova receita.
-- Contexto (PDCA GE, auditor_pdca_2 16/11): o Resultado por negócio lê erp_receber.linha_negocio, mas o formulário
-- de inclusão de receita nunca pedia a linha -> só ~8% da receita real da DEMO ficava segmentada. O campo foi
-- adicionado ao NovaReceitaForm; esta chave de ajuda acompanha o "?" (texto vem do banco, RD-95).
-- Aditiva e idempotente: ON CONFLICT (chave) DO NOTHING. Sem UPDATE/DELETE de dado existente.
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES (
  'financeiro.receita.linha_negocio',
  '/dashboard/financeiro/nova-receita',
  'Financeiro · Nova receita',
  'Linha de negócio',
  'A qual negócio/produto da empresa esta receita pertence. É uma das linhas que você cadastra em Resultado por negócio. Pode ficar sem.',
  'Separa o faturamento por negócio: alimenta o Resultado por negócio e o DRE por linha, mostrando receita, custo e margem de cada negócio.',
  'Hospedagem',
  'Deixar sem a linha quando a empresa quer ver o resultado por negócio — a receita cai em "Sem negócio" e some da análise segmentada.',
  'gestao_empresarial',
  27,
  1,
  'publicado'
)
ON CONFLICT (chave) DO NOTHING;
