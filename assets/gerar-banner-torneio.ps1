Add-Type -AssemblyName System.Drawing

$width = 1600
$height = 900
$outPath = Join-Path (Get-Location) 'IMAGENS/TORNEIO CAPS ARENA - NOVO FORMATO.png'
$logoPath = Join-Path (Get-Location) 'IMAGENS/Logo dourado CAPS ARENA LOL SEM FUNDO.png'
$logoSource = [System.Drawing.Bitmap]::new($logoPath)

# Trim transparent margins from the supplied mark so it reads cleanly at poster size.
$left = $logoSource.Width; $top = $logoSource.Height; $right = 0; $bottom = 0
for ($y = 0; $y -lt $logoSource.Height; $y++) {
  for ($x = 0; $x -lt $logoSource.Width; $x++) {
    if ($logoSource.GetPixel($x, $y).A -gt 8) {
      if ($x -lt $left) { $left = $x }
      if ($x -gt $right) { $right = $x }
      if ($y -lt $top) { $top = $y }
      if ($y -gt $bottom) { $bottom = $y }
    }
  }
}
$logoRect = [System.Drawing.Rectangle]::new($left, $top, ($right - $left + 1), ($bottom - $top + 1))
$logo = $logoSource.Clone($logoRect, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$logoSource.Dispose()

$bmp = [System.Drawing.Bitmap]::new($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
$gfx.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$gfx.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$gfx.Clear([System.Drawing.Color]::FromArgb(11, 15, 21))

$gold = [System.Drawing.Color]::FromArgb(218, 177, 75)
$goldLight = [System.Drawing.Color]::FromArgb(241, 210, 135)
$white = [System.Drawing.Color]::FromArgb(246, 246, 242)
$muted = [System.Drawing.Color]::FromArgb(172, 177, 181)
$line = [System.Drawing.Color]::FromArgb(56, 61, 65)
$card = [System.Drawing.Color]::FromArgb(18, 23, 29)
$fontFamily = 'Segoe UI'

function New-Font([float]$size, [System.Drawing.FontStyle]$style = [System.Drawing.FontStyle]::Regular) {
  return [System.Drawing.Font]::new($fontFamily, $size, $style, [System.Drawing.GraphicsUnit]::Pixel)
}
function Draw-Text([string]$text, [float]$x, [float]$y, [float]$size, [System.Drawing.Color]$color, [System.Drawing.FontStyle]$style = [System.Drawing.FontStyle]::Regular) {
  $font = New-Font $size $style
  $brush = [System.Drawing.SolidBrush]::new($color)
  $gfx.DrawString($text, $font, $brush, $x, $y)
  $font.Dispose(); $brush.Dispose()
}
function Draw-Line([float]$x1, [float]$y1, [float]$x2, [float]$y2, [System.Drawing.Color]$color, [float]$thickness = 1) {
  $pen = [System.Drawing.Pen]::new($color, $thickness)
  $gfx.DrawLine($pen, $x1, $y1, $x2, $y2)
  $pen.Dispose()
}
function Draw-Card([float]$x, [float]$y, [float]$w, [float]$h) {
  $rect = [System.Drawing.RectangleF]::new($x, $y, $w, $h)
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $r = 18
  $path.AddArc($x, $y, $r, $r, 180, 90)
  $path.AddArc(($x + $w - $r), $y, $r, $r, 270, 90)
  $path.AddArc(($x + $w - $r), ($y + $h - $r), $r, $r, 0, 90)
  $path.AddArc($x, ($y + $h - $r), $r, $r, 90, 90)
  $path.CloseFigure()
  $brush = [System.Drawing.SolidBrush]::new($card)
  $pen = [System.Drawing.Pen]::new($line, 1)
  $gfx.FillPath($brush, $path); $gfx.DrawPath($pen, $path)
  $brush.Dispose(); $pen.Dispose(); $path.Dispose()
}

# Quiet framing and one restrained gold accent.
$accent = [System.Drawing.SolidBrush]::new($gold)
$gfx.FillRectangle($accent, 0, 0, 8, $height)
$accent.Dispose()
$gfx.DrawImage($logo, [System.Drawing.Rectangle]::new(58, 45, 185, 185))

Draw-Text 'TORNEIO CAPS ARENA' 280 66 55 $white ([System.Drawing.FontStyle]::Bold)
Draw-Text 'NOVO FORMATO' 283 139 20 $goldLight ([System.Drawing.FontStyle]::Bold)
Draw-Text 'FASE DE GRUPOS  •  FINAL MD3' 283 174 23 $muted
Draw-Line 58 255 1542 255 $line 2

# Group structure.
Draw-Text 'DOIS GRUPOS. TIMES FIXOS. UMA FINAL.' 60 286 19 $goldLight ([System.Drawing.FontStyle]::Bold)
Draw-Card 60 332 365 300
Draw-Card 455 332 365 300
Draw-Text 'GRUPO' 90 360 17 $muted ([System.Drawing.FontStyle]::Bold)
Draw-Text 'A' 88 386 72 $gold ([System.Drawing.FontStyle]::Bold)
Draw-Line 90 481 395 481 $line 1
Draw-Text '2 A 6 TIMES DE 5' 90 502 24 $white ([System.Drawing.FontStyle]::Bold)
Draw-Text 'Todos contra todos' 90 548 20 $muted
Draw-Text 'somente dentro do grupo' 90 576 17 $muted
Draw-Text 'GRUPO' 485 360 17 $muted ([System.Drawing.FontStyle]::Bold)
Draw-Text 'B' 483 386 72 $gold ([System.Drawing.FontStyle]::Bold)
Draw-Line 485 481 790 481 $line 1
Draw-Text '2 A 6 TIMES DE 5' 485 502 24 $white ([System.Drawing.FontStyle]::Bold)
Draw-Text 'Todos contra todos' 485 548 20 $muted
Draw-Text 'somente dentro do grupo' 485 576 17 $muted

# Final path: group leaders meet only after the group stage.
Draw-Card 60 656 760 142
Draw-Text 'LIDER A' 92 684 20 $white ([System.Drawing.FontStyle]::Bold)
Draw-Text 'VS' 374 686 18 $muted ([System.Drawing.FontStyle]::Bold)
Draw-Text 'LIDER B' 450 684 20 $white ([System.Drawing.FontStyle]::Bold)
Draw-Text 'FINAL MD3' 635 681 23 $gold ([System.Drawing.FontStyle]::Bold)
Draw-Text 'Em data combinada com a staff' 92 733 17 $muted
Draw-Line 205 704 350 704 $gold 2
Draw-Line 408 704 620 704 $gold 2

# Enrollment scenarios in a compact, readable table.
Draw-Card 860 286 682 512
Draw-Text 'COMO O TORNEIO SE ADAPTA' 894 320 21 $white ([System.Drawing.FontStyle]::Bold)
Draw-Text 'INSCRITOS' 894 376 14 $muted ([System.Drawing.FontStyle]::Bold)
Draw-Text 'POR GRUPO' 1080 376 14 $muted ([System.Drawing.FontStyle]::Bold)
Draw-Text 'TIMES / GRUPO' 1278 376 14 $muted ([System.Drawing.FontStyle]::Bold)
Draw-Line 894 406 1508 406 $line 1

$rows = @(
  @('20', '10 + 10', '2'),
  @('30', '15 + 15', '3'),
  @('40', '20 + 20', '4'),
  @('50', '25 + 25', '5'),
  @('60', '30 + 30', '6')
)
$rowY = 425
foreach ($row in $rows) {
  Draw-Text $row[0] 894 $rowY 27 $gold ([System.Drawing.FontStyle]::Bold)
  Draw-Text $row[1] 1080 ($rowY + 2) 23 $white
  Draw-Text $row[2] 1320 ($rowY + 2) 23 $white
  Draw-Text 'times de 5' 1350 ($rowY + 5) 16 $muted
  Draw-Line 894 ($rowY + 52) 1508 ($rowY + 52) $line 1
  $rowY += 68
}
Draw-Text 'Folga prevista quando o grupo tiver numero impar de times.' 894 773 15 $muted

# Rules and call to action.
Draw-Text 'J1: lado sorteado' 62 833 18 $white ([System.Drawing.FontStyle]::Bold)
Draw-Text 'J2: lados invertidos' 340 833 18 $white ([System.Drawing.FontStyle]::Bold)
Draw-Text 'J3: vencedor do J1 escolhe o lado' 665 833 18 $white ([System.Drawing.FontStyle]::Bold)
Draw-Text 'INSCRICOES' 1190 827 14 $muted ([System.Drawing.FontStyle]::Bold)
Draw-Text '!torneio entrar' 1190 849 22 $goldLight ([System.Drawing.FontStyle]::Bold)
Draw-Text 'CAPS ARENA  •  MINIMO 20 INSCRITOS  •  MULTIPLOS DE 10' 62 879 13 $muted ([System.Drawing.FontStyle]::Bold)

$gfx.Dispose()
$bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
$logo.Dispose()
Write-Output $outPath
