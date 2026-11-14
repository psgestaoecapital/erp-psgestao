-- Tema por usuário (CEO 10/10) — Configurações › Aparência. Cada usuário escolhe a cor de destaque (preset curado) e o
-- modo (claro/escuro/automático). Preferência É DO USUÁRIO, não da empresa: SEM company_id. RLS liga (RD-79): cada um
-- só lê/escreve a SUA linha. Faixa de migration 05 atribuída pelo Eng. Chefe (gilberto-produto). Sem função SECURITY
-- DEFINER: o app usa a tabela direto, a RLS garante o isolamento.
--
-- NÃO afeta: semáforo (verde/amarelo/vermelho) nem documentos cliente-facing (travados na marca — ver globals.css
-- @media print e os templates de documento). A lista de presets vive em src/theme/theme-presets.ts (fonte única).

CREATE TABLE IF NOT EXISTS public.erp_usuario_preferencia (
  user_id       uuid PRIMARY KEY DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  tema          text NOT NULL DEFAULT 'dourado',
  modo          text NOT NULL DEFAULT 'automatico' CHECK (modo IN ('claro', 'escuro', 'automatico')),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.erp_usuario_preferencia IS
  'Preferência visual por usuário (tema de destaque + modo claro/escuro). Sem company_id — é do usuário. RLS: só a própria linha.';

ALTER TABLE public.erp_usuario_preferencia ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_usuario_preferencia FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.erp_usuario_preferencia TO authenticated;

DROP POLICY IF EXISTS erp_usuario_preferencia_sel ON public.erp_usuario_preferencia;
CREATE POLICY erp_usuario_preferencia_sel ON public.erp_usuario_preferencia
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS erp_usuario_preferencia_ins ON public.erp_usuario_preferencia;
CREATE POLICY erp_usuario_preferencia_ins ON public.erp_usuario_preferencia
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS erp_usuario_preferencia_upd ON public.erp_usuario_preferencia;
CREATE POLICY erp_usuario_preferencia_upd ON public.erp_usuario_preferencia
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- RD-95: "?" de cada opção da tela Aparência (textos no banco, editáveis sem deploy). rota = pathname da página.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, status)
VALUES
  ('configuracoes.aparencia.tema', '/dashboard/configuracoes/aparencia', 'Aparência', 'Cor de destaque',
   'Escolha uma cor de destaque da lista.',
   'Muda só o visual do seu painel (títulos, ícones de destaque e as séries dos gráficos). É só para você — não muda nada para os outros usuários nem para a empresa.',
   'Dourado (padrão), Âmbar, Azul…', 'Achar que muda os dados ou os relatórios — muda apenas as cores do painel.', 1, 'publicado'),
  ('configuracoes.aparencia.modo', '/dashboard/configuracoes/aparencia', 'Aparência', 'Claro / Escuro / Automático',
   'Escolha claro, escuro ou automático.',
   'Define o fundo do painel. No Automático, segue o claro/escuro do seu aparelho.',
   'Automático acompanha o celular/computador.', 'Escolher Automático e estranhar que mudou sozinho — é o aparelho trocando de modo.', 2, 'publicado'),
  ('configuracoes.aparencia.semaforo', '/dashboard/configuracoes/aparencia', 'Aparência', 'O semáforo não muda',
   'Nada a preencher — é um aviso.',
   'As cores de status (verde = ok, amarelo = atenção, vermelho = problema) são SEMPRE as mesmas, em qualquer tema, para não confundir a leitura.',
   'Verde continua verde em qualquer tema.', 'Esperar que o tema recolora os status — eles são fixos de propósito.', 3, 'publicado'),
  ('configuracoes.aparencia.documentos', '/dashboard/configuracoes/aparencia', 'Aparência', 'Documentos seguem a marca',
   'Nada a preencher — é um aviso.',
   'PDFs, notas, propostas e o portal do cliente saem SEMPRE na identidade da PS, nunca no seu tema. O cliente nunca vê um documento roxo ou teal.',
   'Uma proposta sai na marca PS mesmo com o seu painel em Roxo.', 'Achar que o tema aparece nos documentos enviados ao cliente — não aparece.', 4, 'publicado')
ON CONFLICT (chave) DO NOTHING;
