# Assistente para o Matheus: grava a SENHA de cada login extra dos robôs (R2, R3...) em %USERPROFILE%\.robo-corp\config.json.
# A senha é digitada AQUI, escondida (aparece só como pontos), nunca é mostrada, impressa nem guardada em log. Quem não sabe mexer no arquivo só responde as perguntas.
$cfg = Join-Path $env:USERPROFILE ".robo-corp\config.json"
if (-not (Test-Path $cfg)) { Write-Host "Não achei $cfg" -ForegroundColor Red; exit 1 }
$nomes = & node -e "const c=require(process.argv[1]); console.log((c.logins&&c.logins.lista||[]).map(x=>x.id+'|'+x.usuario).join('\n'))" $cfg
if (-not $nomes) { Write-Host "O config.json não tem a lista de logins (logins.lista)." -ForegroundColor Red; exit 1 }
Write-Host ""
Write-Host "Vou pedir a SENHA de cada login dos robôs. Digite e aperte Enter (a senha aparece só como pontos)." -ForegroundColor Cyan
Write-Host "Se a senha for a mesma para todos, digite a primeira vez e, nos próximos, só aperte Enter para repetir." -ForegroundColor Cyan
$anterior = $null
foreach ($linha in $nomes) {
  $id, $usuario = $linha -split '\|', 2
  $s = Read-Host -AsSecureString "Senha do login '$usuario' ($id)"
  $plano = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
  if (-not $plano -and $anterior) { $plano = $anterior }
  if (-not $plano) { Write-Host "  (em branco: pulei $id)" -ForegroundColor Yellow; continue }
  $env:CORP_NOVA_SENHA = $plano; $env:CORP_LOGIN_ALVO = $id
  & node -e "const fs=require('fs');const p=process.argv[1];const c=JSON.parse(fs.readFileSync(p,'utf8'));const it=c.logins.lista.find(x=>x.id===process.env.CORP_LOGIN_ALVO);it.senha=process.env.CORP_NOVA_SENHA;fs.writeFileSync(p,JSON.stringify(c,null,2));" $cfg
  Remove-Item Env:CORP_NOVA_SENHA, Env:CORP_LOGIN_ALVO -ErrorAction SilentlyContinue
  $anterior = $plano; $plano = $null
  Write-Host "  senha de $id gravada." -ForegroundColor Green
}
$anterior = $null
Write-Host ""
Write-Host "Pronto. Avise o Claude para ele testar os logins (ele não vê as senhas)." -ForegroundColor Green
