$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$browser='C:/Program Files/Google/Chrome/Application/chrome.exe'
if(!(Test-Path -LiteralPath $browser)){throw 'Chrome executable not found.'}
node (Join-Path $PSScriptRoot 'make-test-tone.mjs')
if($LASTEXITCODE -ne 0){throw 'Test audio could not be created.'}
$profile=Join-Path $root 'artifacts/browser-profile'
$tone=Join-Path $root 'artifacts/qa-tone.wav'
Start-Process -FilePath $browser -ArgumentList @('--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--autoplay-policy=no-user-gesture-required','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',('--use-file-for-fake-audio-capture="'+$tone+'"'),'--remote-debugging-port=9346',('--user-data-dir="'+$profile+'"'),'about:blank') -WindowStyle Hidden
Write-Output 'Local test browser: http://127.0.0.1:9346/json/version'
