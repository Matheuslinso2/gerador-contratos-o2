# OCR LOCAL e GRATUITO (Windows.Media.Ocr, idioma pt-BR) — sem IA, sem custo, nada sai do computador.
# Entrada: arquivo de texto com um caminho de PNG por linha (-Lista). Saída: um JSON por linha (-Saida): {arq, linhas:[{texto, palavras:[{t,x,y,w,h}]}]}.
#   powershell -File ocr-win.ps1 -Lista lista.txt -Saida ocr.jsonl [-Escala 2]
param([string]$Lista, [string]$Saida, [double]$Escala = 1)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Aguardar($op, [Type]$tipo) { $t = $asTask.MakeGenericMethod($tipo).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapTransform, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$motor = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('pt-BR'))
if (-not $motor) { throw 'OCR pt-BR indisponível' }
$ja = @{}
if (Test-Path $Saida) { foreach ($l in [IO.File]::ReadLines($Saida)) { if ($l -match '"arq":"([^"]+)"') { $ja[$Matches[1]] = 1 } } }
$w = New-Object IO.StreamWriter($Saida, $true, [Text.UTF8Encoding]::new($false))
foreach ($arq in [IO.File]::ReadLines($Lista)) {
  if (-not $arq -or $ja.ContainsKey(($arq -replace '\\', '/'))) { continue }
  try {
    $f = Aguardar ([Windows.Storage.StorageFile]::GetFileFromPathAsync(($arq -replace '/', '\'))) ([Windows.Storage.StorageFile])
    $s = Aguardar ($f.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $d = Aguardar ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($s)) ([Windows.Graphics.Imaging.BitmapDecoder])
    if ($Escala -ne 1) {
      $tr = [Windows.Graphics.Imaging.BitmapTransform]::new(); $tr.ScaledWidth = [uint32]($d.PixelWidth * $Escala); $tr.ScaledHeight = [uint32]($d.PixelHeight * $Escala); $tr.InterpolationMode = [Windows.Graphics.Imaging.BitmapInterpolationMode]::Fant
      $bmp = Aguardar ($d.GetSoftwareBitmapAsync($d.BitmapPixelFormat, $d.BitmapAlphaMode, $tr, [Windows.Graphics.Imaging.ExifOrientationMode]::IgnoreExifOrientation, [Windows.Graphics.Imaging.ColorManagementMode]::DoNotColorManage)) ([Windows.Graphics.Imaging.SoftwareBitmap])
    } else { $bmp = Aguardar ($d.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap]) }
    $r = Aguardar ($motor.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
    $linhas = @(foreach ($li in $r.Lines) { @{ texto = $li.Text; palavras = @(foreach ($p in $li.Words) { @{ t = $p.Text; x = [math]::Round($p.BoundingRect.X / $Escala, 1); y = [math]::Round($p.BoundingRect.Y / $Escala, 1); w = [math]::Round($p.BoundingRect.Width / $Escala, 1); h = [math]::Round($p.BoundingRect.Height / $Escala, 1) } }) } })
    $w.WriteLine((@{ arq = ($arq -replace '\\', '/'); linhas = $linhas } | ConvertTo-Json -Depth 6 -Compress)); $w.Flush()
    $s.Dispose()
  } catch { $w.WriteLine((@{ arq = ($arq -replace '\\', '/'); erro = $_.Exception.Message } | ConvertTo-Json -Compress)); $w.Flush() }
}
$w.Close()
