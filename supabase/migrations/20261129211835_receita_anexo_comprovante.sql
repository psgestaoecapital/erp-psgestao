-- Financeiro · Nova receita (/dashboard/financeiro/nova-receita) — ANEXO/COMPROVANTE do recebimento.
-- Recount aud8 23/11 (RD-38): a tela não deixava anexar o recibo/contrato da receita ao lançamento
-- (NovaReceitaForm sem campo de upload; erp_receber sem coluna de anexo). Espelha o anexo já aberto para
-- a nova despesa (erp_pagar.anexo_path / bucket pagar-comprovantes). Esta migration abre o caminho de
-- dados: coluna no título + bucket privado por empresa + texto do "?" (RD-95). A UI entra na mesma PR
-- (NovaReceitaForm + ComprovanteReceber.tsx).
-- Code: code-desenvolvedor-3
--
-- ADITIVA e idempotente: só ACRESCENTA colunas, bucket e policies NOVAS; não toca RLS/grants existentes,
-- não altera/apaga nenhum dado de cliente. REVOKE anon implícito (policies só para 'authenticated').
-- Isolamento por empresa (RD-38): o 1º segmento do path é o company_id; a policy exige que ele esteja
-- entre as empresas do usuário (get_user_company_ids) — ninguém alcança comprovante de outra empresa.
-- Sem policy de DELETE: a exclusão é lógica (erp_receber.anexo_path = NULL), o arquivo fica como trilha.

-- 1 · colunas de referência do anexo no título (NULL = sem comprovante). O arquivo em si fica no storage.
ALTER TABLE public.erp_receber ADD COLUMN IF NOT EXISTS anexo_path text;
ALTER TABLE public.erp_receber ADD COLUMN IF NOT EXISTS anexo_nome text;
COMMENT ON COLUMN public.erp_receber.anexo_path IS 'Caminho no bucket privado receber-comprovantes (<company_id>/<uuid>.<ext>). NULL = sem comprovante.';
COMMENT ON COLUMN public.erp_receber.anexo_nome IS 'Nome original do arquivo do comprovante, só para exibição.';

-- 2 · bucket PRIVADO (public=false), limite 20 MB, só imagem/PDF. Idempotente.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'receber-comprovantes', 'receber-comprovantes', false, 20971520,
  ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- 3 · policies por empresa (1º segmento do path = company_id). SELECT (abrir por link assinado) + INSERT
-- (enviar). Sem UPDATE/DELETE: não há upsert/move e a exclusão é lógica na tabela.
DROP POLICY IF EXISTS receber_comprovantes_select ON storage.objects;
CREATE POLICY receber_comprovantes_select ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'receber-comprovantes' AND (
      is_admin() OR (storage.foldername(name))[1] IN (SELECT get_user_company_ids()::text)
    )
  );

DROP POLICY IF EXISTS receber_comprovantes_insert ON storage.objects;
CREATE POLICY receber_comprovantes_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'receber-comprovantes' AND (
      is_admin() OR (storage.foldername(name))[1] IN (SELECT get_user_company_ids()::text)
    )
  );

-- 4 · textos do "?" (RD-95) dos campos novos (fonte do AjudaCampo / fn_ajuda_campo_listar).
INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
(
  'financeiro.receita.comprovante',
  '/dashboard/financeiro/nova-receita',
  'Receita',
  'Anexo (recibo/contrato/nota)',
  'Opcional. Clique para escolher um arquivo (foto do recibo, contrato, boleto ou nota fiscal da venda). Aceita imagem (JPG, PNG, WEBP, HEIC) ou PDF, até 20 MB. Para trocar, clique em "Trocar"; para tirar, em "Remover".',
  'Guarda a prova da receita junto do lançamento: na hora de conferir o recebimento no banco, na prestação de contas ou numa auditoria, o documento está a um clique, sem procurar em e-mail ou no WhatsApp. O arquivo fica num cofre por empresa — só quem é da sua empresa consegue abrir.',
  'Você fechou uma venda e salvou o contrato/recibo em PDF; anexa aqui. Depois, na lista de receitas, abre o documento quando o contador pedir.',
  'Anexar um arquivo gigante ou de outro tipo (ex.: vídeo). Se passar de 20 MB ou não for imagem/PDF, o envio é recusado — reduza a imagem ou gere um PDF.',
  'gestao_empresarial',
  55
),
(
  'financeiro.receita.ver_comprovante',
  '/dashboard/financeiro/nova-receita',
  'Receita',
  'Ver comprovante',
  'Botão de ação — não se preenche nada. Clique para abrir, numa aba nova, o comprovante já anexado a esta receita.',
  'Confere o documento sem sair do fluxo. O link é temporário (vale alguns minutos) e só funciona para quem é da empresa, para o arquivo não vazar.',
  'Antes de dar baixa na receita, clique em "Ver comprovante" para conferir se o valor e o cliente batem.',
  'Achar que o link pode ser compartilhado por fora. Ele expira e é pessoal — quem receber sem acesso à empresa não consegue abrir.',
  'gestao_empresarial',
  56
)
ON CONFLICT (chave) DO NOTHING;
