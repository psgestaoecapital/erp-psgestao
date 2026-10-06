// Semente do BANCO DE TESTES: empresa DEMO (Revenda) + usuário do Playwright (mesmas credenciais dos segredos
// PLAYWRIGHT_USER_EMAIL/PASSWORD). Idempotente. Recusa rodar contra a produção.
import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'node:child_process'

const URL = process.env.TEST_SUPABASE_URL || ''
const KEY = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY || ''
const DB = process.env.TEST_DATABASE_URL || ''
const EMAIL = process.env.PLAYWRIGHT_USER_EMAIL || ''
const PASS = process.env.PLAYWRIGHT_USER_PASSWORD || ''
const DEMO = 'b0700000-0000-4000-a000-000000000003'

if (!URL || !KEY || !DB || !EMAIL || !PASS) throw new Error('Faltam TEST_SUPABASE_URL/SERVICE_ROLE_KEY/DATABASE_URL ou PLAYWRIGHT_USER_*')
if ((URL + DB).includes('horsymhsinqcimflrtjo')) throw new Error('ABORTADO: aponta para a produção')

async function main() {
  const admin = createClient(URL, KEY, { auth: { persistSession: false } })
  let uid: string | undefined
  const { data: criado, error } = await admin.auth.admin.createUser({ email: EMAIL, password: PASS, email_confirm: true })
  if (criado?.user) uid = criado.user.id
  else {
    const { data: lista } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    uid = lista?.users.find(u => u.email?.toLowerCase() === EMAIL.toLowerCase())?.id
    if (!uid) throw new Error('createUser falhou: ' + error?.message)
    await admin.auth.admin.updateUserById(uid, { password: PASS, email_confirm: true })
  }
  const sql = `
    INSERT INTO public.companies (id, razao_social, nome_fantasia, is_demo, is_active)
      VALUES ('${DEMO}', 'Demonstração Revenda', 'Demonstração Revenda', true, true) ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.users (id, email, full_name, role, is_active, is_robo)
      VALUES ('${uid}', '${EMAIL.replace(/'/g, "''")}', 'Robô Playwright', 'admin', true, true) ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.user_companies (user_id, company_id, role)
      SELECT '${uid}', '${DEMO}', 'admin'
      WHERE NOT EXISTS (SELECT 1 FROM public.user_companies WHERE user_id='${uid}' AND company_id='${DEMO}');
    SELECT public.fn_gold_revenda_seed_reparar('${DEMO}');`
  execFileSync('psql', [DB, '-v', 'ON_ERROR_STOP=1', '-qc', sql], { stdio: 'inherit' })
  console.log('semente ok · usuário', uid)
}
main().catch(e => { console.error(e); process.exit(1) })
