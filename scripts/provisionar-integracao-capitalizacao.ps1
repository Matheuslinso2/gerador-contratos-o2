$ErrorActionPreference = 'Stop'

$envFile = Join-Path $PSScriptRoot '..\.env.local'
$line = Get-Content -LiteralPath $envFile |
    Where-Object { $_ -match '^BITRIX_WEBHOOK_URL_USUARIOS=' } |
    Select-Object -First 1
if (-not $line) { throw 'BITRIX_WEBHOOK_URL_USUARIOS nao encontrada.' }
$base = $line.Substring($line.IndexOf('=') + 1).Trim().TrimEnd('/')

function Invoke-Bitrix {
    param([Parameter(Mandatory)] [string] $Method, [hashtable] $Params = @{})
    $json = $Params | ConvertTo-Json -Depth 15 -Compress
    $response = Invoke-RestMethod -Method Post -Uri ($base + '/' + $Method + '.json') `
        -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($json))
    if ($response.error) { throw ($Method + ': ' + $response.error_description) }
    return $response
}

$existing = Invoke-Bitrix 'userfieldconfig.list' @{
    moduleId = 'crm'
    select = @{ '0' = '*'; language = 'br' }
    filter = @{ entityId = 'CRM_14' }
    start = 0
}
$existingNames = @($existing.result.fields | ForEach-Object { $_.fieldName })

$definitions = @(
    @{ name = 'UF_CRM_14_CAP_FORM_RESPONSE_ID'; type = 'string'; label = 'Integração - ID da resposta do formulário'; sort = 900; searchable = 'Y' },
    @{ name = 'UF_CRM_14_CAP_FORM_RESPONSE_URL'; type = 'url'; label = 'Integração - Link da resposta do formulário'; sort = 910; searchable = 'N' },
    @{ name = 'UF_CRM_14_CAP_FORM_SUBMITTED_AT'; type = 'datetime'; label = 'Integração - Enviado em'; sort = 920; searchable = 'N' },
    @{ name = 'UF_CRM_14_CAP_FORM_SOURCE'; type = 'string'; label = 'Integração - Origem técnica'; sort = 930; searchable = 'N' }
)

$created = @()
$kept = @()
foreach ($definition in $definitions) {
    if ($existingNames -contains $definition.name) {
        $kept += $definition.name
        continue
    }
    $null = Invoke-Bitrix 'userfieldconfig.add' @{
        moduleId = 'crm'
        field = @{
            entityId = 'CRM_14'
            fieldName = $definition.name
            userTypeId = $definition.type
            sort = $definition.sort
            multiple = 'N'
            mandatory = 'N'
            showFilter = 'Y'
            showInList = 'N'
            editInList = 'N'
            isSearchable = $definition.searchable
            editFormLabel = @{ br = $definition.label }
        }
    }
    $created += $definition.name
}

[pscustomobject]@{
    created = $created
    alreadyExisted = $kept
} | ConvertTo-Json -Depth 4
