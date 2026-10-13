import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// `state` do OAuth ContaAzul, assinado com HMAC-SHA256 (inforjável) e com validade de 10 min.
// Antes era um base64 cru com company_id + client_secret: qualquer um forjava um state e o callback
// gravava tokens na empresa escolhida. O client_secret vai cifrado (AES-256-GCM), não em claro na URL.

const VALIDADE_MS = 10 * 60 * 1000

export type EstadoContaAzul = { cid: string; uid: string; exp: number; ci: string; cs: string }

function segredo(): string {
  const s = process.env.CONTAAZUL_STATE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!s) throw new Error('Segredo do state ContaAzul não configurado')
  return s
}

const b64url = (b: Buffer) => b.toString('base64url')
const assinatura = (dados: string) => createHmac('sha256', segredo()).update(dados).digest()
const chaveCifra = () => createHash('sha256').update('contaazul-cs|' + segredo()).digest()

function cifrar(txt: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', chaveCifra(), iv)
  const enc = Buffer.concat([c.update(txt, 'utf8'), c.final()])
  return b64url(Buffer.concat([iv, c.getAuthTag(), enc]))
}

function decifrar(b64: string): string {
  const buf = Buffer.from(b64, 'base64url')
  const d = createDecipheriv('aes-256-gcm', chaveCifra(), buf.subarray(0, 12))
  d.setAuthTag(buf.subarray(12, 28))
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8')
}

export function assinarEstado(p: { companyId: string; userId: string; clientId: string; clientSecret: string }): string {
  const payload = { cid: p.companyId, uid: p.userId, exp: Date.now() + VALIDADE_MS, ci: p.clientId, cse: cifrar(p.clientSecret) }
  const dados = b64url(Buffer.from(JSON.stringify(payload), 'utf8'))
  return `${dados}.${b64url(assinatura(dados))}`
}

// null = assinatura inválida, expirado ou malformado.
export function verificarEstado(state: string | null): EstadoContaAzul | null {
  if (!state) return null
  try {
    const [dados, sig] = state.split('.')
    if (!dados || !sig) return null
    const esperado = assinatura(dados)
    const recebido = Buffer.from(sig, 'base64url')
    if (recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado)) return null
    const p = JSON.parse(Buffer.from(dados, 'base64url').toString('utf8'))
    if (typeof p?.exp !== 'number' || Date.now() > p.exp) return null
    if (!p.cid || !p.uid || !p.ci || !p.cse) return null
    return { cid: String(p.cid), uid: String(p.uid), exp: p.exp, ci: String(p.ci), cs: decifrar(String(p.cse)) }
  } catch {
    return null
  }
}

// Acesso do usuário à empresa, por userId (o callback não tem JWT): vínculo em user_companies,
// admin legado (users.role) ou PS admin (users.system_role; PS_ADMIN não entra em empresa restrita).
export async function usuarioTemAcessoEmpresa(userId: string, companyId: string): Promise<boolean> {
  const { data: uc } = await supabaseAdmin
    .from('user_companies').select('company_id').eq('user_id', userId).eq('company_id', companyId).limit(1)
  if (uc && uc.length > 0) return true
  const { data: u } = await supabaseAdmin.from('users').select('role, system_role').eq('id', userId).limit(1)
  const usr = (u as { role?: string | null; system_role?: string | null }[] | null)?.[0]
  if (!usr) return false
  if (usr.role === 'adm' || usr.role === 'acesso_total' || usr.system_role === 'PS_ADMIN_CVM') return true
  if (usr.system_role === 'PS_ADMIN') {
    const { data: c } = await supabaseAdmin.from('companies').select('restrita_ps_admin').eq('id', companyId).limit(1)
    const emp = (c as { restrita_ps_admin?: boolean | null }[] | null)?.[0]
    return !!emp && !emp.restrita_ps_admin
  }
  return false
}
