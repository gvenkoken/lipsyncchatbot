import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'artifacts');fs.mkdirSync(output,{recursive:true});
const rate=48000,count=rate*4,b=Buffer.alloc(44+count*2);
b.write('RIFF',0);b.writeUInt32LE(36+count*2,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(count*2,40);
for(let i=0;i<count;i++){const amplitude=.15+.16*(.5+.5*Math.sin(2*Math.PI*3*i/rate));b.writeInt16LE(Math.round(Math.sin(2*Math.PI*220*i/rate)*amplitude*32767),44+i*2);}
fs.writeFileSync(path.join(output,'qa-tone.wav'),b);
