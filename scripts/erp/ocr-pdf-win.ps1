# OCR LOCAL e GRATUITO de PDF escaneado (Windows.Data.Pdf renderiza a página; Windows.Media.Ocr pt-BR lê) — sem IA, sem custo, nada sai do computador.
# Entrada: arquivo de texto com um caminho de PDF por linha (-Lista). Saída: um JSON por linha (-Saida): {arq, paginas:[{p, texto}]} ou {arq, erro}.
#   powershell -File ocr-pdf-win.ps1 -Lista lista.txt -Saida ocr-pdf.jsonl [-Largura 2000] [-MaxPaginas 8]
param([string]$Lista, [string]$Saida, [int]$Largura = 2000, [int]$MaxPaginas = 8)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime]
$null = [Windows.Data.Pdf.PdfPageRenderOptions, Windows.Data.Pdf, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
$asTaskAcao = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' })[0]
function Aguardar($op, [Type]$tipo) { $t = $asTask.MakeGenericMethod($tipo).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
function AguardarAcao($op) { $t = $asTaskAcao.Invoke($null, @($op)); $t.Wait(-1) | Out-Null }
$motor = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('pt-BR'))
if (-not $motor) { throw 'OCR pt-BR indisponível' }
$ja = @{}
if (Test-Path $Saida) { foreach ($l in [IO.File]::ReadLines($Saida)) { if ($l -match '"arq":"([^"]+)"') { $ja[$Matches[1]] = 1 } } }
$w = New-Object IO.StreamWriter($Saida, $true, [Text.UTF8Encoding]::new($false))
foreach ($arq in [IO.File]::ReadLines($Lista)) {
  if (-not $arq -or $ja.ContainsKey(($arq -replace '\\', '/'))) { continue }
  try {
    $f = Aguardar ([Windows.Storage.StorageFile]::GetFileFromPathAsync($arq)) ([Windows.Storage.StorageFile])
    $pdf = Aguardar ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($f)) ([Windows.Data.Pdf.PdfDocument])
    $paginas = @()
    $n = [math]::Min($pdf.PageCount, $MaxPaginas)
    for ($i = 0; $i -lt $n; $i++) {
      $pg = $pdf.GetPage($i)
      $op = [Windows.Data.Pdf.PdfPageRenderOptions]::new(); $op.DestinationWidth = [uint32]$Largura
      $ms = [Windows.Storage.Streams.InMemoryRandomAccessStream]::new()
      AguardarAcao ($pg.RenderToStreamAsync($ms, $op))
      $d = Aguardar ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($ms)) ([Windows.Graphics.Imaging.BitmapDecoder])
      $bmp = Aguardar ($d.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
      $r = Aguardar ($motor.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
      $paginas += @{ p = $i + 1; texto = (($r.Lines | ForEach-Object { $_.Text }) -join "`n") }
      $ms.Dispose(); $pg.Dispose()
    }
    $w.WriteLine((@{ arq = ($arq -replace '\\', '/'); paginas = $paginas } | ConvertTo-Json -Depth 5 -Compress)); $w.Flush()
  } catch { $w.WriteLine((@{ arq = ($arq -replace '\\', '/'); erro = $_.Exception.Message } | ConvertTo-Json -Compress)); $w.Flush() }
}
$w.Close()
