-- RD-100 (CEO 01/11, INEGOCIÁVEL): nenhum nome de sistema de terceiro em texto que o usuário vê.
-- Completa a limpeza das telas /dashboard/pm/importar-siga e /dashboard/pm/pauta, agora no TEXTO DE
-- AJUDA ("?") lido do banco (erp_ajuda_campo). 3 chaves: pm.siga.arquivo, pm.pauta.vazia, pm.pauta.novo_job.
-- Troca SÓ o nome ("SIGA" -> "sistema anterior"; prefixo de arquivo "siga-" removido), preservando o resto.
-- ADITIVA e IDEMPOTENTE. Não toca dado de cliente (só conteúdo de ajuda, global). Backup antes (RD-100).
-- Prova RD-38 no corpo da PR (contagem antes/depois: mesma qtd de linhas, 0 nomes depois).

-- 1) Cópia de segurança ANTES (RD-100), idempotente. Tabela só de backup: RLS ligada, sem policy, sem anon.
CREATE TABLE IF NOT EXISTS public.erp_ajuda_campo_bkp_rd100 (
  chave           text PRIMARY KEY,
  rotulo          text,
  o_que_preencher text,
  para_que_serve  text,
  exemplo         text,
  erro_comum      text,
  salvo_em        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.erp_ajuda_campo_bkp_rd100 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_ajuda_campo_bkp_rd100 FROM anon;

INSERT INTO public.erp_ajuda_campo_bkp_rd100 (chave, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum)
SELECT chave, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum
  FROM public.erp_ajuda_campo
 WHERE chave IN ('pm.siga.arquivo', 'pm.pauta.vazia', 'pm.pauta.novo_job')
ON CONFLICT (chave) DO NOTHING;

-- 2) Troca só o nome. "\ySIGA\y" casa a marca em maiúsculas (não toca "siga"/"siga-" minúsculo),
--    e "siga-" (case-insensitive) limpa o prefixo do exemplo de arquivo. Idempotente: sem marca, nada muda.
UPDATE public.erp_ajuda_campo SET
  rotulo          = regexp_replace(regexp_replace(rotulo,          '\ySIGA\y', 'sistema anterior', 'g'), 'siga-', '', 'gi'),
  o_que_preencher = regexp_replace(regexp_replace(o_que_preencher, '\ySIGA\y', 'sistema anterior', 'g'), 'siga-', '', 'gi'),
  para_que_serve  = regexp_replace(regexp_replace(para_que_serve,  '\ySIGA\y', 'sistema anterior', 'g'), 'siga-', '', 'gi'),
  exemplo         = regexp_replace(regexp_replace(exemplo,         '\ySIGA\y', 'sistema anterior', 'g'), 'siga-', '', 'gi'),
  erro_comum      = regexp_replace(regexp_replace(erro_comum,      '\ySIGA\y', 'sistema anterior', 'g'), 'siga-', '', 'gi')
WHERE chave IN ('pm.siga.arquivo', 'pm.pauta.vazia', 'pm.pauta.novo_job')
  AND (rotulo ~ '\ySIGA\y' OR o_que_preencher ~ '\ySIGA\y' OR para_que_serve ~ '\ySIGA\y'
       OR exemplo ~* 'siga-' OR exemplo ~ '\ySIGA\y' OR erro_comum ~ '\ySIGA\y');
