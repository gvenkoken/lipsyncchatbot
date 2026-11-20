param([string]$SourceDirectory = 'C:/Users/koken/Downloads')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$target = Join-Path $PSScriptRoot '../public/mouth-rig'
New-Item -ItemType Directory -Path $target -Force | Out-Null
$main = Get-ChildItem -LiteralPath $SourceDirectory -File | Where-Object { $_.Name -like 'Siyah Arka Planda Temiz T*Portre.png' } | Select-Object -First 1
if (!$main) { throw 'Main portrait not found.' }
$sources = @('01_agiz_kapali.png','02_agiz_konusma.png','03_agiz_konusma.png','04_agiz_konusma.png','05_agiz_konusma.png','06_agiz_01_02_ara.png','07_agiz_01_02_ara.png','08_agiz_02_03_ara.png','09_agiz_03_04_ara.png','10_agiz_03_04_ara.png','11_agiz_04_05_ara.png','12_agiz_04_05_ara.png') | ForEach-Object { Join-Path $SourceDirectory $_ }

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.IO;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
public class MouthFrameReport {
  public int id;
  public string file;
  public int width;
  public int height;
  public int sourceOutsideCropChangedPixels;
  public int outsideCropChangedPixels;
  public int outsideMaskChangedPixels;
  public int insideCropChangedPixels;
  public string alphaHash;
}
public class MouthRigReport {
  public int width;
  public int height;
  public int x=480;
  public int y=520;
  public int cropWidth=184;
  public int cropHeight=104;
  public MouthFrameReport[] frames;
}
public static class MouthRigPreparation {
  static byte[] Read(string path,out int w,out int h) {
    using(var input=new Bitmap(path)) using(var bmp=new Bitmap(input.Width,input.Height,PixelFormat.Format32bppArgb)) {
      w=bmp.Width;h=bmp.Height;
      using(var g=Graphics.FromImage(bmp)){g.CompositingMode=System.Drawing.Drawing2D.CompositingMode.SourceCopy;g.DrawImageUnscaled(input,0,0);}
      var bits=bmp.LockBits(new Rectangle(0,0,w,h),ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb);
      var data=new byte[w*h*4];
      for(int y=0;y<h;y++)Marshal.Copy(IntPtr.Add(bits.Scan0,y*bits.Stride),data,y*w*4,w*4);
      bmp.UnlockBits(bits);return data;
    }
  }
  static void Save(string path,byte[] data,int w,int h) {
    using(var bmp=new Bitmap(w,h,PixelFormat.Format32bppArgb)) {
      var bits=bmp.LockBits(new Rectangle(0,0,w,h),ImageLockMode.WriteOnly,PixelFormat.Format32bppArgb);
      for(int y=0;y<h;y++)Marshal.Copy(data,y*w*4,IntPtr.Add(bits.Scan0,y*bits.Stride),w*4);
      bmp.UnlockBits(bits);bmp.Save(path,ImageFormat.Png);
    }
  }
  public static MouthRigReport Build(string main,string[] sources,string target) {
    int w,h;var reference=Read(main,out w,out h);
    var report=new MouthRigReport{width=w,height=h,frames=new MouthFrameReport[sources.Length]};
    int left=report.x,top=report.y,cw=report.cropWidth,ch=report.cropHeight;
    if(left+cw>w||top+ch>h)throw new Exception("Crop is outside the source portrait.");
    var alpha=new byte[cw*ch];var mask=new byte[cw*ch*4];
    var basePixels=(byte[])reference.Clone();
    for(int y=0;y<ch;y++)for(int x=0;x<cw;x++) {
      double radius=Math.Sqrt(Math.Pow((x-92.0)/90,2)+Math.Pow((y-52.0)/50,2));
      double t=Math.Max(0,Math.Min(1,(radius-.88)/.12));
      byte a=(byte)Math.Round((1-t*t*(3-2*t))*255);
      alpha[y*cw+x]=a;
      int p=(y*cw+x)*4;mask[p]=mask[p+1]=mask[p+2]=255;mask[p+3]=a;
      // An opaque feature always fills the hole. Feathered skin overlaps only
      // untouched skin, so there is no partial-alpha gap or old lip beneath it.
      if(a==255)basePixels[((y+top)*w+x+left)*4+3]=0;
    }
    string hash;
    using(var sha=SHA256.Create())hash=BitConverter.ToString(sha.ComputeHash(alpha)).Replace("-","").ToLowerInvariant();
    Save(Path.Combine(target,"reference.png"),reference,w,h);
    Save(Path.Combine(target,"base.png"),basePixels,w,h);
    Save(Path.Combine(target,"mouth-mask.png"),mask,cw,ch);
    for(int f=0;f<sources.Length;f++) {
      int sw,sh;var source=Read(sources[f],out sw,out sh);
      if(sw!=w||sh!=h)throw new Exception("All input images must have identical dimensions.");
      var layer=new byte[cw*ch*4];var composite=(byte[])reference.Clone();
      for(int y=0;y<ch;y++)for(int x=0;x<cw;x++) {
        int p=((y+top)*w+x+left)*4,q=(y*cw+x)*4;byte a=alpha[y*cw+x];
        for(int c=0;c<3;c++) {
          layer[q+c]=source[p+c];
          composite[p+c]=(byte)Math.Round((source[p+c]*a+reference[p+c]*(255-a))/255.0);
        }
        layer[q+3]=a;
      }
      var frame=new MouthFrameReport{id=f+1,file=String.Format("mouth-{0:00}.png",f+1),width=cw,height=ch,alphaHash=hash};
      for(int y=0;y<h;y++)for(int x=0;x<w;x++) {
        int p=(y*w+x)*4;bool changed=false,sourceChanged=false;
        for(int c=0;c<4;c++){changed|=composite[p+c]!=reference[p+c];sourceChanged|=source[p+c]!=reference[p+c];}
        bool outside=x<left||x>=left+cw||y<top||y>=top+ch;
        if(outside){if(changed)frame.outsideCropChangedPixels++;if(sourceChanged)frame.sourceOutsideCropChangedPixels++;}
        else if(changed){frame.insideCropChangedPixels++;if(alpha[(y-top)*cw+x-left]==0)frame.outsideMaskChangedPixels++;}
      }
      if(frame.outsideCropChangedPixels!=0||frame.outsideMaskChangedPixels!=0)throw new Exception("Pixels outside the mouth changed.");
      Save(Path.Combine(target,frame.file),layer,cw,ch);
      Save(Path.Combine(target,String.Format("composite-{0:00}.png",f+1)),composite,w,h);
      report.frames[f]=frame;
    }
    return report;
  }
}
'@
$report = [MouthRigPreparation]::Build($main.FullName,[string[]]$sources,$target)
$manifest = [ordered]@{
  version = 2
  canvas = @{ width=$report.width; height=$report.height }
  crop = @{ x=$report.x; y=$report.y; width=$report.cropWidth; height=$report.cropHeight }
  base = 'base.png'
  reference = 'reference.png'
  mask = 'mouth-mask.png'
  mainFrames = @(1,2,3,4,5)
  openingOrder = @(1,6,7,2,8,3,9,10,4,11,12,5)
  frames = @($report.frames)
}
$json = $manifest | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText((Join-Path $target 'manifest.json'),$json,(New-Object Text.UTF8Encoding $false))
$report.frames | Select-Object id,width,height,outsideCropChangedPixels,sourceOutsideCropChangedPixels,insideCropChangedPixels | Format-Table
Write-Output ('Prepared fixed mouth crop: '+$report.x+','+$report.y+' / '+$report.cropWidth+' x '+$report.cropHeight)
