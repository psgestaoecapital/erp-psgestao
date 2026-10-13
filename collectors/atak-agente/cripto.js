// DPAPI CurrentUser via PowerShell (embutido no Windows) — substitui o módulo nativo win-dpapi.
// Sem node-gyp / Visual Studio → o `npm install` do CI passa e o `pkg` empacota num .exe único.
// PILAR 2 intacto: a senha continua LOCAL, criptografada, atrelada ao usuário/máquina, nunca vai
// pra PS. Só muda o COMO criptografa (PowerShell no lugar do binding nativo), não o modelo.
//
// A senha trafega por STDIN (nunca na linha de comando) → não aparece no process list / histórico.
const { execFileSync } = require('child_process')

const PS_PROTECT = `
  Add-Type -AssemblyName System.Security
  $in = [Console]::In.ReadToEnd()
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($in)
  $enc = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, 'CurrentUser')
  [Console]::Out.Write([Convert]::ToBase64String($enc))
`
const PS_UNPROTECT = `
  Add-Type -AssemblyName System.Security
  $in = [Console]::In.ReadToEnd()
  $enc = [Convert]::FromBase64String($in)
  $bytes = [System.Security.Cryptography.ProtectedData]::Unprotect($enc, $null, 'CurrentUser')
  [Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($bytes))
`

function ps(script, input) {
  return execFileSync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { input, windowsHide: true },
  ).toString()
}

module.exports = {
  protegerSenha: (senha) => ps(PS_PROTECT, String(senha)), // → base64 pra gravar em cred.dat
  lerSenha: (b64) => ps(PS_UNPROTECT, String(b64)).trim(), // → senha em claro (só em memória)
}
