-- Hub · Orçamento por EAP (tela 315) — terceiro jeito de começar o orçamento (RD-95)
--
-- Blueprint vivo §315 (essencial, parcial): "Três jeitos de começar o orçamento:
--   (1) partir da EAP padrão PS e escolher serviços da biblioteca (333);
--   (2) importar planilha (.xlsx); (3) ...".
-- O estado vazio da tela 315 já oferecia (2) importar e o "+ Item"; faltava o atalho
-- guiado para (1) começar pela Biblioteca padrão PS (aba do Catálogo de Serviços, 333).
-- Esta migration só registra o texto de ajuda "?" (RD-95) do novo atalho, para a tela
-- alterada passar no gate check-ajuda-campo-telas-alteradas.
--
-- Aditiva e idempotente: INSERT guardado por NOT EXISTS na própria chave (re-rodar não
-- duplica). Só conteúdo de ajuda (erp_ajuda_campo), sem RLS/policy/grant, sem dado de
-- cliente.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
SELECT
  'projetos.orcamento_eap.comecar_biblioteca',
  '/dashboard/projetos/obras/[id]/orcamento',
  'Orçamento por EAP',
  'Começar pela Biblioteca padrão PS',
  'Abre a Biblioteca padrão PS (dentro do Catálogo de Serviços) para você escolher serviços prontos, já com EAP e composição, e trazê-los para o seu catálogo. Depois você os adiciona ao orçamento pelo "+ Item".',
  'É um dos três jeitos de montar o orçamento: partir da biblioteca padrão (aqui), importar a planilha .xlsx da obra, ou lançar item a item. Começar pela biblioteca poupa redigitar serviços comuns.',
  'Procure "Alvenaria de vedação" na Biblioteca padrão, use-o no seu catálogo e depois lance-o no orçamento com o local e a quantidade.',
  'A biblioteca é só referência (leitura): o serviço só entra no seu catálogo quando você o "usa". Lançar direto no orçamento sem antes trazer o serviço faz ele não aparecer na lista do "+ Item".',
  'projetos',
  6
WHERE NOT EXISTS (
  SELECT 1 FROM public.erp_ajuda_campo
   WHERE chave = 'projetos.orcamento_eap.comecar_biblioteca'
);
