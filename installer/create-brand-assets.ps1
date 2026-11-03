$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$assetDir = Join-Path $PSScriptRoot 'installer-assets'
[IO.Directory]::CreateDirectory($assetDir) | Out-Null
function New-RoundPath([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  $p = [Drawing.Drawing2D.GraphicsPath]::new()
  $d = $r * 2
  $p.AddArc($x,$y,$d,$d,180,90); $p.AddArc(($x+$w-$d),$y,$d,$d,270,90)
  $p.AddArc(($x+$w-$d),($y+$h-$d),$d,$d,0,90); $p.AddArc($x,($y+$h-$d),$d,$d,90,90)
  $p.CloseFigure(); return $p
}
function Fill-Round($g, [Drawing.Color]$color, $x, $y, $w, $h, $r) {
  $p = New-RoundPath $x $y $w $h $r; $b = [Drawing.SolidBrush]::new($color)
  $g.FillPath($b,$p); $b.Dispose(); $p.Dispose()
}
function Draw-Text($g, $text, $size, $x, $y, $color, $bold = $false) {
  $style = if ($bold) { [Drawing.FontStyle]::Bold } else { [Drawing.FontStyle]::Regular }
  $font = [Drawing.Font]::new('Segoe UI',[single]$size,$style,[Drawing.GraphicsUnit]::Pixel)
  $brush = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml($color))
  $g.DrawString($text,$font,$brush,[single]$x,[single]$y)
  $brush.Dispose(); $font.Dispose()
}
function Draw-Layers($g, $x, $y, $size) {
  $pen = [Drawing.Pen]::new([Drawing.Color]::White, [single]($size/18)); $pen.LineJoin = 'Round'
  $pts = [Drawing.PointF[]]@([Drawing.PointF]::new(($x+$size/2),$y), [Drawing.PointF]::new(($x+$size),($y+$size*.23)), [Drawing.PointF]::new(($x+$size/2),($y+$size*.46)), [Drawing.PointF]::new($x,($y+$size*.23)))
  $g.DrawPolygon($pen,$pts)
  foreach ($offset in @(.20,.40)) {
    $line = [Drawing.PointF[]]@([Drawing.PointF]::new($x,($y+$size*(.23+$offset))), [Drawing.PointF]::new(($x+$size/2),($y+$size*(.46+$offset))), [Drawing.PointF]::new(($x+$size),($y+$size*(.23+$offset))))
    $g.DrawLines($pen,$line)
  }
  $pen.Dispose()
}
function Save-Asset($bitmap, $name) {
  $bitmap.Save((Join-Path $assetDir ($name+'.png')),[Drawing.Imaging.ImageFormat]::Png)
  $rgb = $bitmap.Clone([Drawing.Rectangle]::new(0,0,$bitmap.Width,$bitmap.Height),[Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $rgb.Save((Join-Path $assetDir ($name+'.bmp')),[Drawing.Imaging.ImageFormat]::Bmp); $rgb.Dispose()
}
$side = [Drawing.Bitmap]::new(492,942)
$g = [Drawing.Graphics]::FromImage($side); $g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'; $g.ScaleTransform(3,3)
$gradient = [Drawing.Drawing2D.LinearGradientBrush]::new([Drawing.Rectangle]::new(0,0,164,314),[Drawing.ColorTranslator]::FromHtml('#15234f'),[Drawing.ColorTranslator]::FromHtml('#475cec'),90)
$g.FillRectangle($gradient,0,0,164,314); $gradient.Dispose()
$arc = [Drawing.Pen]::new([Drawing.Color]::FromArgb(22,255,255,255),1)
foreach ($n in @(0,24,48,72)) { $g.DrawEllipse($arc,(-98-$n),(100-$n),(270+$n*2),(270+$n*2)) }; $arc.Dispose()
Draw-Text $g 'T D  /  W O R K S P A C E' 7 19 22 '#c4d1ff' $true
Fill-Round $g ([Drawing.Color]::FromArgb(30,255,255,255)) 20 57 42 42 11
Draw-Layers $g 30 68 22
Draw-Text $g 'TD Browser' 18 18 111 '#ffffff' $true
Draw-Text $g "Mỗi hồ sơ.`nMột không gian riêng." 11 19 145 '#dce3ff'
Fill-Round $g ([Drawing.Color]::FromArgb(24,255,255,255)) 20 207 124 65 9
foreach ($x in @(30,36,42)) { $b=[Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(150,222,230,255)); $g.FillEllipse($b,$x,216,3,3); $b.Dispose() }
foreach ($y in @(228,241,254)) {
  Fill-Round $g ([Drawing.Color]::FromArgb(60,255,255,255)) 29 $y 7 7 2
  Fill-Round $g ([Drawing.Color]::FromArgb(100,255,255,255)) 43 ($y+1) 55 3 1.5
  Fill-Round $g ([Drawing.Color]::FromArgb(50,255,255,255)) 108 $y 26 7 3
}
Draw-Text $g 'WINDOWS  /  64 BIT' 7.5 19 291 '#dce3ff' $true
Save-Asset $side 'wizard'; $g.Dispose(); $side.Dispose()
$header=[Drawing.Bitmap]::new(450,171); $g=[Drawing.Graphics]::FromImage($header)
$g.Clear([Drawing.Color]::White); $g.SmoothingMode='AntiAlias'; $g.TextRenderingHint='AntiAliasGridFit'; $g.ScaleTransform(3,3)
Fill-Round $g ([Drawing.ColorTranslator]::FromHtml('#4263eb')) 8 15 28 28 8
Draw-Layers $g 15 22 14
Draw-Text $g 'TD Browser' 14 42 13 '#17233b' $true
Draw-Text $g 'HỒ SƠ  /  CLOUD  /  ĐỘI NHÓM' 6.4 43 34 '#748097'
Save-Asset $header 'header'; $g.Dispose(); $header.Dispose()
$frames=@()
foreach ($s in @(16,32,48,64)) {
  $bitmap=[Drawing.Bitmap]::new($s,$s); $g=[Drawing.Graphics]::FromImage($bitmap); $g.SmoothingMode='AntiAlias'; $g.ScaleTransform(($s/64),($s/64))
  Fill-Round $g ([Drawing.ColorTranslator]::FromHtml('#4263eb')) 1 1 62 62 17
  Draw-Layers $g 16 18 32; $g.Dispose()
  $icon=[Drawing.Icon]::FromHandle($bitmap.GetHicon()); $stream=[IO.MemoryStream]::new(); $icon.Save($stream)
  $frames+=,$stream.ToArray(); $stream.Dispose(); $icon.Dispose(); $bitmap.Dispose()
}
$out=[IO.File]::Create((Join-Path $assetDir 'td-browser.ico')); $writer=[IO.BinaryWriter]::new($out)
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$frames.Count)
$offset=6+16*$frames.Count
foreach ($frame in $frames) {
  $size=[BitConverter]::ToUInt32($frame,14)
  $writer.Write([byte[]]$frame[6..17]); $writer.Write([uint32]$offset); $offset+=$size
}
foreach ($frame in $frames) { $start=[BitConverter]::ToUInt32($frame,18); $size=[BitConverter]::ToUInt32($frame,14); $writer.Write([byte[]]$frame[$start..($start+$size-1)]) }
$writer.Dispose(); $out.Dispose()
Write-Output 'Created TD Browser sidebar, header and installer icon.'
