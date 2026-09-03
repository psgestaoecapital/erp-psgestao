import { supabase } from '@/lib/supabase'

// Upload de foto de sugestão/mensagem para o bucket privado (sugestoes-anexos). UMA fonte: o formulário
// de nova sugestão e o compositor de resposta usam o mesmo caminho.
//
// folderOwnerId decide a PASTA (primeiro segmento do path) — e é isso que a RLS do storage lê:
//   sug_anexo_select: split_part(name,'/',1) = auth.uid()  OR  fn_pode_ver_fila_suporte()  OR is_admin()
// Ou seja: quem lê uma foto é o dono da pasta OU o PS. Numa CONVERSA, a foto tem que ser vista pelos
// DOIS lados. Por isso a foto de mensagem vai SEMPRE na pasta do AUTOR do chamado (folderOwnerId =
// autor): o autor lê (é a pasta dele) e o PS lê (fn_pode_ver_fila_suporte). Se a pasta fosse a de quem
// enviou, uma foto que o PS mandasse ficaria invisível pro autor — falha silenciosa, o bug que a gente
// combate. O INSERT do PS em pasta alheia é permitido (a policy libera via fn_pode_ver_fila_suporte).
export async function uploadFotoSugestao(file: File, folderOwnerId: string): Promise<string> {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const path = `${folderOwnerId}/${crypto.randomUUID()}/foto.${ext}`
  const up = await supabase.storage.from('sugestoes-anexos').upload(path, file, { upsert: false })
  if (up.error) throw new Error(up.error.message)
  return path
}
