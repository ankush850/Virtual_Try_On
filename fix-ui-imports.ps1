$root = 'C:\Users\Victus\Desktop\Sudesh Fiverr\packages\ui\src'
$pattern = [regex]::new("(['\"])(\.[^'\"\r\n]+)(\1)")

Get-ChildItem $root -Recurse -File | Where-Object { $_.Extension -in '.ts', '.tsx' } | ForEach-Object {
    $path = $_.FullName
    $text = [System.IO.File]::ReadAllText($path)
    $updated = $pattern.Replace($text, {
        param($m)
        $quote = $m.Groups[1].Value
        $inner = $m.Groups[2].Value
        if ($inner.StartsWith('.') -and -not $inner.EndsWith('.js') -and -not $inner.EndsWith('.json') -and -not $inner.EndsWith('.css')) {
            return "$quote$inner.js$quote"
        }
        return $m.Value
    })

    if ($updated -ne $text) {
        [System.IO.File]::WriteAllText($path, $updated, [System.Text.UTF8Encoding]::new($false))
    }
}

Write-Output 'patched ui imports'
