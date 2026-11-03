[CmdletBinding()]
param(
    [string]$OwnerName = "Shivan Shop"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$wrangler = Join-Path $root ".wrangler-bootstrap\install\node_modules\.bin\wrangler.cmd"
$config = Join-Path $root "wrangler.toml"
$apiSource = Join-Path $root "functions\api\[[path]].js"
$workDirectory = Join-Path $root ".wrangler-bootstrap"
$sqlFile = Join-Path $workDirectory "provision-owner.sql"
$databaseName = "shivan-shop-db"
$expectedAccountId = "9d76c540342fdbb288b426f195d5c54a"
$previousXdgConfigHome = $env:XDG_CONFIG_HOME
$securePassword = $null
$passwordPointer = [IntPtr]::Zero
$password = $null
$passwordBytes = $null
$saltBytes = $null
$hashBytes = $null
$random = $null
$kdf = $null

function ConvertTo-Base64Url([byte[]]$Value) {
    return [Convert]::ToBase64String($Value).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function ConvertTo-SqlLiteral([string]$Value) {
    return "'" + $Value.Replace("'", "''") + "'"
}

function Get-ProductionOwnerCount([string]$WranglerPath, [string]$ConfigPath, [string]$Database) {
    $output = & $WranglerPath d1 execute $Database --remote --command "SELECT COUNT(*) AS owner_count FROM accounts WHERE role='owner';" --json --config $ConfigPath 2>&1
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) { throw "Could not check the production owner count: $($output -join ' ')" }

    try { $parsed = ConvertFrom-Json -InputObject ($output -join [Environment]::NewLine) -ErrorAction Stop }
    catch { throw "Could not read the production owner count returned by Wrangler." }
    if ($parsed -is [Array]) { $parsed = $parsed[0] }
    if (-not $parsed.success -or @($parsed.results).Count -lt 1) { throw "Wrangler did not return a production owner count." }
    return [int]$parsed.results[0].owner_count
}

try {
    if (-not (Test-Path -LiteralPath $wrangler)) { throw "Local Wrangler is missing at $wrangler." }
    if (-not (Test-Path -LiteralPath $config)) { throw "wrangler.toml is missing from the project folder." }
    if (-not (Test-Path -LiteralPath $apiSource)) { throw "The owner identifier could not be read from the API source." }

    $source = Get-Content -LiteralPath $apiSource -Raw
    $identifierMatch = [regex]::Match($source, '(?m)^const OWNER_IDENTIFIER\s*=\s*"([^"]+)";')
    if (-not $identifierMatch.Success) { throw "The configured owner identifier was not found in the API source." }
    $identifier = $identifierMatch.Groups[1].Value.Trim().ToLowerInvariant()
    $OwnerName = $OwnerName.Trim()
    if (-not $OwnerName) { throw "The owner name cannot be blank." }

    $env:XDG_CONFIG_HOME = Join-Path $workDirectory "config"
    $identity = & $wrangler whoami 2>&1
    $identityExitCode = $LASTEXITCODE
    $identityText = $identity -join [Environment]::NewLine
    if ($identityExitCode -ne 0 -or $identityText -notmatch [regex]::Escape($expectedAccountId)) {
        throw "Wrangler is not authorized to the expected Cloudflare account. No account was inserted."
    }

    $existingOwnerCount = Get-ProductionOwnerCount -WranglerPath $wrangler -ConfigPath $config -Database $databaseName
    if ($existingOwnerCount -gt 0) { throw "Production already has an owner account. No changes were made." }

    $securePassword = Read-Host -Prompt "Enter the new owner password (at least 10 characters)" -AsSecureString
    $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    try { $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer) }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
        $passwordPointer = [IntPtr]::Zero
    }
    if ($password.Length -lt 10) { throw "Use a password with at least 10 characters. No account was inserted." }

    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    $saltBytes = New-Object byte[] 16
    $random.GetBytes($saltBytes)
    $salt = ConvertTo-Base64Url $saltBytes
    $passwordBytes = [Text.Encoding]::UTF8.GetBytes($password)
    $kdf = [Security.Cryptography.Rfc2898DeriveBytes]::new(
        $passwordBytes,
        $saltBytes,
        210000,
        [Security.Cryptography.HashAlgorithmName]::SHA256
    )
    $hashBytes = $kdf.GetBytes(32)
    $passwordHash = ConvertTo-Base64Url $hashBytes
    $accountId = [Guid]::NewGuid().ToString()
    $createdAt = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")

    $sql = @"
INSERT INTO accounts (id, identifier, name, role, password_salt, password_hash, created_at)
SELECT $(ConvertTo-SqlLiteral $accountId), $(ConvertTo-SqlLiteral $identifier), $(ConvertTo-SqlLiteral $OwnerName), 'owner', $(ConvertTo-SqlLiteral $salt), $(ConvertTo-SqlLiteral $passwordHash), $(ConvertTo-SqlLiteral $createdAt)
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE role='owner');
"@
    [System.IO.File]::WriteAllText($sqlFile, $sql, [System.Text.UTF8Encoding]::new($false))

    $insertOutput = & $wrangler d1 execute $databaseName --remote --file $sqlFile --json --config $config 2>&1
    $insertExitCode = $LASTEXITCODE
    if ($insertExitCode -ne 0) { throw "Production owner insertion failed: $($insertOutput -join ' ')" }

    $finalOwnerCount = Get-ProductionOwnerCount -WranglerPath $wrangler -ConfigPath $config -Database $databaseName
    if ($finalOwnerCount -ne 1) { throw "The production account count was unexpected after insertion. Check D1 before trying again." }

    Write-Host "Production owner account created. Sign in at https://shivan-store.pages.dev using the owner identifier configured by the app and the password entered at the prompt."
}
finally {
    if (Test-Path -LiteralPath $sqlFile) { Remove-Item -LiteralPath $sqlFile -Force -ErrorAction SilentlyContinue }
    if ($null -ne $kdf) { $kdf.Dispose() }
    if ($null -ne $random) { $random.Dispose() }
    if ($passwordBytes) { [Array]::Clear($passwordBytes, 0, $passwordBytes.Length) }
    if ($saltBytes) { [Array]::Clear($saltBytes, 0, $saltBytes.Length) }
    if ($hashBytes) { [Array]::Clear($hashBytes, 0, $hashBytes.Length) }
    if ($null -ne $securePassword) { $securePassword.Dispose() }
    $password = $null
    $passwordHash = $null
    if ($null -ne $previousXdgConfigHome) { $env:XDG_CONFIG_HOME = $previousXdgConfigHome }
    else { Remove-Item Env:XDG_CONFIG_HOME -ErrorAction SilentlyContinue }
}
