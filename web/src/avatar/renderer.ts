import { MOUTH_POSES } from './poses';

export const ASSET_PATH = '/mouth-rig/';
export const EYE_ASSET_PATH = '/eye-rig/';
export type MouthManifest = {
  version: number;
  canvas: { width: number; height: number };
  crop: { x: number; y: number; width: number; height: number };
  base: string; reference: string; mask: string;
  mainFrames: number[]; openingOrder: number[];
  frames: { id: number; file: string; width: number; height: number; alphaHash: string; outsideCropChangedPixels: number; sourceOutsideCropChangedPixels: number; insideCropChangedPixels: number }[];
};
export type EyeManifest = {
  version: number; canvas: {width:number;height:number};
  crop: {x:number;y:number;width:number;height:number};base:string;mask:string;
  frames: {id:number;file:string;width:number;height:number;alphaHash:string;outsideMaskChangedPixels:number}[];
};
const image = async (file: string, path = ASSET_PATH) => { const i = new Image(); i.src = path + file; await i.decode(); return i; };

export class MouthRenderer {
  static async load() {
    const response = await fetch(ASSET_PATH + 'manifest.json');
    if (!response.ok) throw new Error('Ağız katmanları bulunamadı.');
    const manifest = await response.json() as MouthManifest;
    const eyesResponse = await fetch(EYE_ASSET_PATH+'manifest.json');
    if(!eyesResponse.ok)throw new Error('Göz katmanları bulunamadı.');
    const eyes=await eyesResponse.json() as EyeManifest;
    const [base, layers, eyeLayers] = await Promise.all([image(eyes.base,EYE_ASSET_PATH), Promise.all(manifest.frames.map(f => image(f.file))),Promise.all(eyes.frames.map(f=>image(f.file,EYE_ASSET_PATH)))]);
    if (base.width !== manifest.canvas.width || base.height !== manifest.canvas.height) throw new Error('Base ölçüleri eşleşmiyor.');
    const ids = new Set(manifest.frames.map(frame => frame.id));
    if (manifest.frames.length !== MOUTH_POSES.length || ids.size !== MOUTH_POSES.length || MOUTH_POSES.some(pose => !ids.has(pose.id)) || manifest.openingOrder?.join(',') !== MOUTH_POSES.map(pose => pose.id).join(',')) throw new Error('Ana ve ara ağız katmanları eksik veya sıraları farklı.');
    const maskHash = manifest.frames[0].alphaHash;
    for (const [index, layer] of layers.entries()) {
      const frame = manifest.frames[index];
      if (layer.width !== manifest.crop.width || layer.height !== manifest.crop.height || frame.alphaHash !== maskHash || frame.outsideCropChangedPixels !== 0) throw new Error('Katmanların ölçüsü veya maskesi eşleşmiyor.');
    }
    if(eyes.frames.length!==7||eyes.canvas.width!==manifest.canvas.width||eyes.canvas.height!==manifest.canvas.height)throw new Error('Göz katmanları base ile eşleşmiyor.');
    for(const [index,layer]of eyeLayers.entries())if(layer.width!==eyes.crop.width||layer.height!==eyes.crop.height||eyes.frames[index].alphaHash!==eyes.frames[0].alphaHash)throw new Error('Göz katmanlarının ölçüsü veya maskesi farklı.');
    return new MouthRenderer(manifest, eyes, base, layers, eyeLayers);
  }
  private constructor(readonly manifest: MouthManifest, readonly eyeManifest:EyeManifest, private base: HTMLImageElement, private layers: HTMLImageElement[],private eyeLayers:HTMLImageElement[]) {}
  render(ctx: CanvasRenderingContext2D, frame: number, baseOnly = false, eyeFrame = 1) {
    const { canvas, crop } = this.manifest;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(this.base, 0, 0);
    if (!baseOnly) {
      const index = this.manifest.frames.findIndex(pose => pose.id === frame);
      ctx.drawImage(this.layers[index >= 0 ? index : 0], crop.x, crop.y);
      const eyeCrop=this.eyeManifest.crop;
      ctx.drawImage(this.eyeLayers[Math.max(0,Math.min(6,eyeFrame-1))],eyeCrop.x,eyeCrop.y);
    }
  }
}
