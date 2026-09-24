# Sinh demo.html (che do dung thu tren may, khong can Supabase) tu index.html
# Chay:  powershell -ExecutionPolicy Bypass -File build-demo.ps1
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$h = Get-Content "$root\index.html" -Raw -Encoding UTF8
$h = $h.Replace('<title>Dashboard Phòng Pháp chế - Kiểm tra</title>', '<title>[Dùng thử] Dashboard Phòng Pháp chế - Kiểm tra</title>')
$inject = @'
<!-- CHẾ ĐỘ DÙNG THỬ TRÊN MÁY: dữ liệu lưu trong localStorage của trình duyệt này.
     ?sample=1 nạp dữ liệu mẫu · ?reset=1 xóa hết · ?user=N xem với vai người thứ N trong danh sách -->
<script src="js/config.js?v=11"></script>
<script>
  window.MOCK_USER = +(new URLSearchParams(location.search).get("user") || 1);
  window.APP_CONFIG = Object.assign({}, window.APP_CONFIG, { SUPABASE_URL: "https://local.demo", SUPABASE_ANON_KEY: "local" });
</script>
<script src="js/demo-data.js?v=11"></script>
'@
$h = [regex]::Replace($h, '<script src="https://cdn\.jsdelivr\.net[^"]+"></script>\s*<script src="js/config\.js\?v=11"></script>', $inject.Replace('$', '$$'))
$banner = '<div style="position:fixed;bottom:0;left:12px;background:#fab219;color:#0b0b0b;font-size:12px;font-weight:600;padding:2px 12px;border-radius:8px 8px 0 0;z-index:50">DÙNG THỬ – dữ liệu lưu trên máy này, chưa chia sẻ</div>'
$h = $h.Replace('<div id="toast" class="toast" hidden></div>', "<div id=""toast"" class=""toast"" hidden></div>`n$banner")
[IO.File]::WriteAllText("$root\demo.html", $h, [Text.UTF8Encoding]::new($false))
Write-Host "Da tao $root\demo.html"
