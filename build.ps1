# Build Shardlight: run the rules/AI tests, compile the Rust core to WebAssembly and copy it next
# to the web files.
#   .\build.ps1             build
#   .\build.ps1 -SelfPlay   also run the AI self-play benchmark
param([switch]$SelfPlay)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

cargo test --release --lib --quiet
if ($LASTEXITCODE) { throw 'tests failed' }
if ($SelfPlay) { cargo run --release --quiet --bin selfplay; if ($LASTEXITCODE) { throw 'self-play failed' } }

cargo build --release --lib --target wasm32-unknown-unknown --quiet
if ($LASTEXITCODE) { throw 'wasm build failed' }
Copy-Item target\wasm32-unknown-unknown\release\shardlight.wasm web\shardlight.wasm -Force
"web\shardlight.wasm  $([math]::Round((Get-Item web\shardlight.wasm).Length / 1KB)) KB"
