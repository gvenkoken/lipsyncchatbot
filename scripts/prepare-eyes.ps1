param([string]$SourceDirectory = 'C:/Users/koken/Downloads')
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$target=Join-Path $PSScriptRoot '../web/public/eye-rig'
$mouth=Join-Path $PSScriptRoot '../web/public/mouth-rig'
New-Item -ItemType Directory -Path $target -Force | Out-Null
$stamps=@('12_36_32-1','12_36_33-2','12_36_36-3','12_36_37-4','12_36_38-5','12_36_42-6','12_36_43-7')
$sources=@()
foreach($stamp in $stamps){$file=Get-ChildItem -LiteralPath $SourceDirectory -File | Where-Object {$_.Name -like ('*10 Kas 2026 '+$stamp+'.png')} | Select-Object -First 1;if(!$file){throw ('Eye image missing: '+$stamp)};$sources+=$file.FullName}
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.IO;
using System.Drawing;
using System.Drawing.Imaging;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
public class EyePoseReport {
 public int id; public string file; public int width; public int height;
 public string alphaHash; public int outsideMaskChangedPixels; public int insideChangedPixels;
}
public class EyePreparationReport {
 public int width; public int height; public int x=414; public int y=344; public int cropWidth=324; public int cropHeight=76;
 public double offsetX;public double offsetY;public double anchorMeanError;public double[] skinOffsets;public EyePoseReport[] frames;
}
public static class EyeRigPreparation {
 static byte[] Read(string file,int width,int height) {
  using(var input=new Bitmap(file))using(var bmp=new Bitmap(width,height,PixelFormat.Format32bppArgb)){
   using(var g=Graphics.FromImage(bmp)){g.CompositingMode=CompositingMode.SourceCopy;g.InterpolationMode=InterpolationMode.HighQualityBicubic;g.PixelOffsetMode=PixelOffsetMode.HighQuality;
    if(input.Width==width&&input.Height==height)g.DrawImageUnscaled(input,0,0);else g.DrawImage(input,new Rectangle(0,0,width,height),0,0,input.Width,input.Height,GraphicsUnit.Pixel);}
   var bits=bmp.LockBits(new Rectangle(0,0,width,height),ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb);var p=new byte[width*height*4];
   for(int y=0;y<height;y++)Marshal.Copy(IntPtr.Add(bits.Scan0,y*bits.Stride),p,y*width*4,width*4);bmp.UnlockBits(bits);return p;
  }
 }
 static void Save(string file,byte[] data,int w,int h){using(var b=new Bitmap(w,h,PixelFormat.Format32bppArgb)){var bits=b.LockBits(new Rectangle(0,0,w,h),ImageLockMode.WriteOnly,PixelFormat.Format32bppArgb);for(int y=0;y<h;y++)Marshal.Copy(data,y*w*4,IntPtr.Add(bits.Scan0,y*bits.Stride),w*4);b.UnlockBits(bits);b.Save(file,ImageFormat.Png);}}
 static double Sample(byte[] data,int w,int h,double x,double y,int c){x=Math.Max(0,Math.Min(w-1.001,x));y=Math.Max(0,Math.Min(h-1.001,y));int x0=(int)x,y0=(int)y;double tx=x-x0,ty=y-y0;int p=(y0*w+x0)*4;return (data[p+c]*(1-tx)+data[p+4+c]*tx)*(1-ty)+(data[p+w*4+c]*(1-tx)+data[p+w*4+4+c]*tx)*ty;}
 static double Radius(int x,int y,int eye){double cx=eye==0?487:660;return Math.Sqrt(Math.Pow((x-cx)/69.0,2)+Math.Pow((y-379)/32.0,2));}
 public static EyePreparationReport Build(string referenceFile,string mouthBase,string[] sources,string target){
  int w,h;using(var b=new Bitmap(referenceFile)){w=b.Width;h=b.Height;}
  var reference=Read(referenceFile,w,h);var combinedBase=Read(mouthBase,w,h);var neutral=Read(sources[0],w,h);
  var report=new EyePreparationReport{width=w,height=h,frames=new EyePoseReport[sources.Length]};
  // Fit one shared translation on static forehead/nose/cheek skin. The eye
  // textures themselves never drive registration, and every pose shares it.
  var anchors=new int[,]{{445,250,270,50},{525,430,100,78},{425,450,55,65},{680,450,55,65}};
  double best=double.MaxValue,bx=0,by=0;
  for(int iy=-24;iy<=24;iy++)for(int ix=-16;ix<=16;ix++){
   double dx=ix*.25,dy=iy*.25,total=0;int count=0;
   for(int a=0;a<anchors.GetLength(0);a++)for(int y=anchors[a,1];y<anchors[a,1]+anchors[a,3];y+=4)for(int x=anchors[a,0];x<anchors[a,0]+anchors[a,2];x+=4)for(int c=0;c<3;c++){total+=Math.Abs(Sample(neutral,w,h,x+dx,y+dy,c)-reference[(y*w+x)*4+c]);count++;}
   double score=total/count;if(score<best){best=score;bx=dx;by=dy;}
  }
  report.offsetX=bx;report.offsetY=by;report.anchorMeanError=best;
  int cw=report.cropWidth,ch=report.cropHeight,left=report.x,top=report.y;
  var alpha=new byte[cw*ch];var mask=new byte[cw*ch*4];var offsets=new double[6];var counts=new int[2];
  for(int y=0;y<ch;y++)for(int x=0;x<cw;x++){
   int gx=x+left,gy=y+top;double radius=Math.Min(Radius(gx,gy,0),Radius(gx,gy,1));double t=Math.Max(0,Math.Min(1,(radius-.88)/.12));byte value=(byte)Math.Round((1-t*t*(3-2*t))*255);alpha[y*cw+x]=value;
   int q=(y*cw+x)*4;mask[q]=mask[q+1]=mask[q+2]=255;mask[q+3]=value;if(value==255)combinedBase[(gy*w+gx)*4+3]=0;
   int eye=gx<574?0:1;double r=Radius(gx,gy,eye);if(r>.89&&r<1){for(int c=0;c<3;c++)offsets[eye*3+c]+=reference[(gy*w+gx)*4+c]-Sample(neutral,w,h,gx+bx,gy+by,c);counts[eye]++;}
  }
  for(int e=0;e<2;e++)for(int c=0;c<3;c++)offsets[e*3+c]=Math.Max(-10,Math.Min(10,offsets[e*3+c]/Math.Max(1,counts[e])));
  report.skinOffsets=offsets;
  string hash;using(var sha=SHA256.Create())hash=BitConverter.ToString(sha.ComputeHash(alpha)).Replace("-","").ToLowerInvariant();
  Save(Path.Combine(target,"base.png"),combinedBase,w,h);Save(Path.Combine(target,"eye-mask.png"),mask,cw,ch);
  for(int f=0;f<sources.Length;f++){
   var source=Read(sources[f],w,h);var layer=new byte[cw*ch*4];var composite=(byte[])reference.Clone();
   var frame=new EyePoseReport{id=f+1,file=String.Format("eyes-{0:00}.png",f+1),width=cw,height=ch,alphaHash=hash};
   for(int y=0;y<ch;y++)for(int x=0;x<cw;x++){
    int gx=x+left,gy=y+top,p=(gy*w+gx)*4,q=(y*cw+x)*4,eye=gx<574?0:1;byte a=alpha[y*cw+x];bool changed=false;
    for(int c=0;c<3;c++){byte color=(byte)Math.Round(Math.Max(0,Math.Min(255,Sample(source,w,h,gx+bx,gy+by,c)+offsets[eye*3+c])));layer[q+c]=color;composite[p+c]=(byte)Math.Round((color*a+reference[p+c]*(255-a))/255.0);changed|=composite[p+c]!=reference[p+c];}
    layer[q+3]=a;if(changed){if(a==0)frame.outsideMaskChangedPixels++;else frame.insideChangedPixels++;}
   }
   if(frame.outsideMaskChangedPixels!=0)throw new Exception("Eye preparation changed pixels outside its mask.");
   Save(Path.Combine(target,frame.file),layer,cw,ch);Save(Path.Combine(target,String.Format("composite-{0:00}.png",f+1)),composite,w,h);report.frames[f]=frame;
  }
  return report;
 }
}
'@
$r=[EyeRigPreparation]::Build((Join-Path $mouth 'reference.png'),(Join-Path $mouth 'base.png'),[string[]]$sources,$target)
$manifest=[ordered]@{version=1;canvas=@{width=$r.width;height=$r.height};crop=@{x=$r.x;y=$r.y;width=$r.cropWidth;height=$r.cropHeight};base='base.png';mask='eye-mask.png';frames=@($r.frames);registration=@{offsetX=$r.offsetX;offsetY=$r.offsetY;anchorMeanError=$r.anchorMeanError;skinOffsets=$r.skinOffsets};timing=@{blinkMinMs=7000;blinkMaxMs=11000;gazeMinMs=16000;gazeMaxMs=24000}}
[IO.File]::WriteAllText((Join-Path $target 'manifest.json'),($manifest|ConvertTo-Json -Depth 8),(New-Object Text.UTF8Encoding $false))
$r|Select-Object width,height,offsetX,offsetY,anchorMeanError|Format-List
$r.frames|Select-Object id,width,height,outsideMaskChangedPixels,insideChangedPixels|Format-Table
