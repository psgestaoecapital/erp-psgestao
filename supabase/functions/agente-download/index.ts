// agente-download — PR C (CEO 28/09): o agente ATAK instalado baixa atualização SEM bucket público.
// Auth: header x-agente-token (o token da empresa, o mesmo que o agente já usa nas RPCs) validado contra
// atak_conexao_config (ativa). verify_jwt fica no padrão (true): o agente manda a chave pública (JWT anon) no
// Authorization, como já faz nas RPCs — sem mexer no config.toml (que redeployaria todas as funções).
// Quem não tem token de agente válido recebe 401 e nada do bucket.
//
//   GET ?arquivo=versao.json      → manifesto do Storage com `url` trocada por URL ASSINADA do .exe (15 min)
//   GET ?arquivo=agente-atak.exe  → 302 para URL assinada (15 min)
//   GET ?arquivo=nssm.exe         → 302 para URL assinada (15 min)
//
// Nada é listado nem aceito fora desses 3 nomes. A leitura do bucket usa o service_role (bucket privado).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const BUCKET = 'agente'
const ARQUIVOS = new Set(['versao.json', 'agente-atak.exe', 'nssm.exe'])
const VALIDADE_S = 15 * 60

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}

Deno.serve(async (req) => {
  if (req.method !== 'GET' && req.method !== 'POST') return json({ erro: 'método não permitido' }, 405)
  const arquivo = new URL(req.url).searchParams.get('arquivo') ?? ''
  if (!ARQUIVOS.has(arquivo)) return json({ erro: 'arquivo inválido' }, 400)

  const token = (req.headers.get('x-agente-token') ?? '').trim()
  if (token.length < 8) return json({ erro: 'token ausente' }, 401)

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: conexao } = await sb.from('atak_conexao_config')
    .select('company_id').eq('agente_token', token).eq('ativo', true).maybeSingle()
  if (!conexao) return json({ erro: 'token inválido' }, 401)

  const assinar = async (nome: string) => {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(nome, VALIDADE_S)
    if (error || !data?.signedUrl) throw new Error(error?.message ?? 'falha ao assinar')
    return data.signedUrl
  }

  try {
    if (arquivo === 'versao.json') {
      const { data, error } = await sb.storage.from(BUCKET).download('versao.json')
      if (error || !data) return json({ erro: 'manifesto indisponível' }, 503)
      const manifesto = JSON.parse(await data.text())
      manifesto.url = await assinar('agente-atak.exe')
      return json(manifesto)
    }
    return new Response(null, { status: 302, headers: { Location: await assinar(arquivo), 'Cache-Control': 'no-store' } })
  } catch (e) {
    return json({ erro: (e as Error).message }, 503)
  }
})
