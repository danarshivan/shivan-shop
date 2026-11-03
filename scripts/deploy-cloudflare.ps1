$ErrorActionPreference = "Stop"

$projectName = "shivan-store"
$databaseName = "shivan-shop-db"
$bucketName = "shivan-shop-images"
$accountId = "9d76c540342fdbb288b426f195d5c54a"
$root = (Get-Location).Path
$nodeExe = "C:\Users\LORD TECHNOLOGY\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$wrangler = Join-Path $root ".wrangler-bootstrap\install\node_modules\.bin\wrangler.cmd"
$wranglerConfigHome = Join-Path $root ".wrangler-bootstrap\config"
$provisionConfig = Join-Path $root ".wrangler-bootstrap\provision.wrangler.toml"
$ownerCodeFile = Join-Path $root ".wrangler-bootstrap\owner-setup-code.txt"
$previousXdgConfigHome = $env:XDG_CONFIG_HOME

if (-not (Test-Path -LiteralPath (Join-Path $root "wrangler.toml"))) { throw "Run this script from the Shivan Shop project folder." }
if (-not (Test-Path -LiteralPath $wrangler)) { throw "The local Wrangler installation is missing." }
if (-not (Test-Path -LiteralPath $nodeExe)) { throw "The bundled Node.js runtime is missing." }
if (Test-Path Env:CLOUDFLARE_API_TOKEN) { throw "Close this terminal and start a fresh PowerShell window before running the deployment." }

$secureFibClientId = $null
$secureFibClientSecret = $null
$fibClientIdText = $null
$fibClientSecretText = $null
$configureFib = $false
$fibEnvironment = $null
$productionBranch = "main"
$r2Enabled = $false
$r2BucketExists = $false
$rng = $null
$bytes = $null

function Get-JsonRows($rawOutput, $description) {
    $jsonText = $rawOutput -join [Environment]::NewLine
    try { $parsed = ConvertFrom-Json -InputObject $jsonText -ErrorAction Stop }
    catch { throw "Could not read the Cloudflare $description list as JSON." }
    if ($parsed -is [System.Array]) { return ,$parsed }
    if ($parsed.result -is [System.Array]) { return ,$parsed.result }
    if ($parsed.result -and $parsed.result.result -is [System.Array]) { return ,$parsed.result.result }
    return ,@($parsed)
}

try {
    $env:XDG_CONFIG_HOME = $wranglerConfigHome
    $identityOutput = & $wrangler whoami 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Wrangler is not authorized. First authorize it with the official Cloudflare OAuth flow: .wrangler-bootstrap\install\node_modules\.bin\wrangler.cmd login --use-keyring" }
    $identityText = $identityOutput -join [Environment]::NewLine
    if ($identityText -notmatch [regex]::Escape($accountId)) { throw "Wrangler is not authenticated to the Cloudflare account configured for this shop ($accountId). No resources were created." }
    Write-Host "Cloudflare account verified: $accountId"

    $r2ListOutput = & $wrangler r2 bucket list 2>&1
    $r2ListText = $r2ListOutput -join [Environment]::NewLine
    if ($LASTEXITCODE -eq 0) {
        $r2Enabled = $true
        $r2BucketExists = $r2ListText -match [regex]::Escape($bucketName)
    } elseif ($r2ListText -match 'Please enable R2 through the Cloudflare Dashboard|code:\s*10042') {
        Write-Warning "R2 is not enabled for this account. D1-based text/catalog sync can deploy, but product image uploads will remain unavailable until R2 is enabled."
    } else {
        throw "Could not verify Cloudflare R2 availability: $r2ListText"
    }

    $fibChoice = (Read-Host "Configure FIB payments now? Enter yes or no (no deploys the shop and sync with FIB checkout unavailable until credentials are added)").Trim().ToLowerInvariant()
    if ($fibChoice -notin @("yes", "no")) { throw "Enter yes or no for FIB setup." }
    $configureFib = $fibChoice -eq "yes"
    if ($configureFib) {
        $fibEnvironment = (Read-Host "FIB environment (stage or prod; prod requires production credentials issued by FIB)").Trim().ToLowerInvariant()
        if ($fibEnvironment -notin @("stage", "prod")) { throw "Choose stage or prod to match the FIB credentials you received." }
        $secureFibClientId = Read-Host "FIB client ID (entered securely; use the selected environment's credentials)" -AsSecureString
        $secureFibClientSecret = Read-Host "FIB client secret (entered securely)" -AsSecureString
        if ($secureFibClientId.Length -lt 1 -or $secureFibClientSecret.Length -lt 1) { throw "Both FIB merchant credentials are required to enable real FIB checkout." }
    } else {
        Write-Host "FIB setup is pending. The live site will not accept FIB payments until valid merchant credentials are added."
    }

    $mediaPlan = if ($r2Enabled) { "R2 media storage will be attached." } else { "R2 is disabled; uploaded product images will not sync yet." }
    Write-Host "This will connect the shivan-store Pages project to D1 and the real-time sync Worker, then publish the updated site. $mediaPlan"
    Write-Host "It will store FIB credentials as encrypted Pages secrets only if you choose to configure them."
    $confirmation = Read-Host "Type DEPLOY to continue"
    if ($confirmation -cne "DEPLOY") { throw "Deployment cancelled before any Cloudflare resources were created." }

    if ($configureFib) {
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureFibClientId)
        try { $fibClientIdText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureFibClientSecret)
        try { $fibClientSecretText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    }
    $env:WRANGLER_SEND_METRICS = "false"

    @("name = `"$projectName`"", "account_id = `"$accountId`"", "compatibility_date = `"2026-10-08`"") |
        Set-Content -LiteralPath $provisionConfig -Encoding utf8

    & $nodeExe (Join-Path $root "scripts\build.mjs")
    if ($LASTEXITCODE -ne 0) { throw "The storefront build failed." }

    $databaseId = ""
    $createOutput = & $wrangler d1 create $databaseName --config $provisionConfig 2>&1
    if ($LASTEXITCODE -eq 0) {
        $createText = $createOutput -join [Environment]::NewLine
        $idMatch = [regex]::Match($createText, 'database_id\s*=\s*["'']?([0-9a-fA-F-]{16,})')
        if ($idMatch.Success) { $databaseId = $idMatch.Groups[1].Value }
    }
    if (-not $databaseId) {
        $databaseList = & $wrangler d1 list --json --config $provisionConfig 2>&1
        if ($LASTEXITCODE -ne 0) { throw "D1 creation failed and the existing database could not be listed: $($databaseList -join ' ')" }
        $databaseRows = Get-JsonRows $databaseList "D1 database"
        $existingDatabase = $databaseRows | Where-Object { $_.name -eq $databaseName } | Select-Object -First 1
        if ($existingDatabase) { $databaseId = [string]$existingDatabase.uuid }
        if (-not $databaseId -and $existingDatabase) { $databaseId = [string]$existingDatabase.database_id }
    }
    if (-not $databaseId) { throw "The D1 database is unavailable and Wrangler did not return its ID." }

    $tomlPath = Join-Path $root "wrangler.toml"
    $toml = Get-Content -LiteralPath $tomlPath -Raw
    if ($toml -match 'database_id\s*=\s*"PLACEHOLDER_DATABASE_ID"') {
        $toml = $toml -replace 'database_id\s*=\s*"PLACEHOLDER_DATABASE_ID"', "database_id = `"$databaseId`""
    } elseif ($toml -notmatch ('database_id\s*=\s*"' + [regex]::Escape($databaseId) + '"')) {
        throw "wrangler.toml points to a different D1 database than the configured Shivan Shop database."
    }
    if ($r2Enabled -and $toml -notmatch '(?m)^\[\[r2_buckets\]\]') {
        $toml = $toml.TrimEnd() + "`r`n`r`n[[r2_buckets]]`r`nbinding = `"MEDIA`"`r`nbucket_name = `"$bucketName`"`r`n"
    } elseif (-not $r2Enabled) {
        $toml = [regex]::Replace($toml, '(?m)^\[\[r2_buckets\]\]\r?\nbinding\s*=\s*"MEDIA"\r?\nbucket_name\s*=\s*"[^"]+"\r?\n?', '')
    }
    if ($configureFib) { $toml = $toml -replace 'FIB_ENV\s*=\s*"[^"]+"', "FIB_ENV = `"$fibEnvironment`"" }
    Set-Content -LiteralPath $tomlPath -Value $toml -Encoding utf8

    if ($r2Enabled -and -not $r2BucketExists) {
        $bucketOutput = & $wrangler r2 bucket create $bucketName --config $provisionConfig 2>&1
        if ($LASTEXITCODE -ne 0) {
            $bucketList = & $wrangler r2 bucket list 2>&1
            $bucketListText = $bucketList -join [Environment]::NewLine
            if ($LASTEXITCODE -ne 0 -or $bucketListText -notmatch [regex]::Escape($bucketName)) { throw "R2 bucket creation failed: $($bucketOutput -join ' ')" }
        }
    }

    $projectOutput = & $wrangler pages project create $projectName --production-branch main 2>&1
    if ($LASTEXITCODE -ne 0) {
        $projectList = & $wrangler pages project list --json 2>&1
        if ($LASTEXITCODE -ne 0) { throw "Pages project creation failed and existing projects could not be listed: $($projectOutput -join ' ')" }
        $projectRows = Get-JsonRows $projectList "Pages project"
        $existingProject = $projectRows | Where-Object { ([string]$_.name -eq $projectName) -or ([string]$_.'Project Name' -eq $projectName) } | Select-Object -First 1
        if (-not $existingProject) { throw "Pages project creation failed: $($projectOutput -join ' ')" }
        $configuredBranch = [string]$existingProject.production_branch
        if (-not $configuredBranch) { $configuredBranch = [string]$existingProject.productionBranch }
        if ($configuredBranch) { $productionBranch = $configuredBranch }
        Write-Host "Using existing Pages project $projectName with production branch $productionBranch."
    }

    & $wrangler deploy --config (Join-Path $root "sync-hub\wrangler.toml")
    if ($LASTEXITCODE -ne 0) { throw "The real-time sync Worker deployment failed." }

    & $wrangler d1 migrations apply $databaseName --remote --config $tomlPath
    if ($LASTEXITCODE -ne 0) { throw "The D1 schema migration failed." }

    if ($configureFib) {
        $fibClientIdText | & $wrangler pages secret put FIB_CLIENT_ID --project-name $projectName
        if ($LASTEXITCODE -ne 0) { throw "FIB_CLIENT_ID could not be saved as a Cloudflare Pages secret." }
        $fibClientSecretText | & $wrangler pages secret put FIB_CLIENT_SECRET --project-name $projectName
        if ($LASTEXITCODE -ne 0) { throw "FIB_CLIENT_SECRET could not be saved as a Cloudflare Pages secret." }
    }

    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $bytes = New-Object byte[] 32
    $rng.GetBytes($bytes)
    $ownerCode = [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
    Set-Content -LiteralPath $ownerCodeFile -Value $ownerCode -NoNewline -Encoding ascii
    Get-Content -LiteralPath $ownerCodeFile -Raw | & $wrangler pages secret put OWNER_SETUP_TOKEN --project-name $projectName
    if ($LASTEXITCODE -ne 0) { throw "The owner setup secret could not be saved." }

    & $wrangler pages deploy (Join-Path $root "dist") --project-name $projectName --branch $productionBranch
    if ($LASTEXITCODE -ne 0) { throw "The Pages deployment failed." }

    Write-Host ""
    Write-Host "DEPLOYMENT_URL=https://$projectName.pages.dev"
    if ($r2Enabled) { Write-Host "MEDIA_SETUP=R2 bucket bound" }
    else { Write-Host "MEDIA_SETUP=awaiting R2 activation; image uploads will not sync" }
    if ($configureFib) { Write-Host "FIB_SETUP=$fibEnvironment credentials configured" }
    else { Write-Host "FIB_SETUP=unchanged; no FIB credentials were entered" }
    Write-Host "OWNER_SETUP_CODE=$ownerCode"
    Write-Host "OWNER_SETUP_CODE_EXPIRES=Use once when creating the owner account, then remove OWNER_SETUP_TOKEN from Pages settings."
    Remove-Item -LiteralPath $ownerCodeFile -Force -ErrorAction SilentlyContinue
}
finally {
    Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue
    Remove-Item Env:WRANGLER_SEND_METRICS -ErrorAction SilentlyContinue
    if ($null -ne $previousXdgConfigHome) { $env:XDG_CONFIG_HOME = $previousXdgConfigHome }
    else { Remove-Item Env:XDG_CONFIG_HOME -ErrorAction SilentlyContinue }
    if ($secureFibClientId) { $secureFibClientId.Dispose() }
    if ($secureFibClientSecret) { $secureFibClientSecret.Dispose() }
    if ($rng) { $rng.Dispose() }
    if ($bytes) { [Array]::Clear($bytes, 0, $bytes.Length) }
    $fibClientIdText = $null
    $fibClientSecretText = $null
    $secureFibClientId = $null
    $secureFibClientSecret = $null
    $rng = $null
    $bytes = $null
    Remove-Item -LiteralPath (Join-Path $root ".wrangler-bootstrap\cloudflare-token.txt") -Force -ErrorAction SilentlyContinue
}
