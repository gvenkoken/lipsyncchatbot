import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EyeMotion} from '../src/avatar/eyes.ts';

test('automatic blinks stay rare over ten simulated minutes',()=>{
 const motion=new EyeMotion(()=>.5),starts:number[]=[],frames=new Set<number>();
 let blinking=false,lastClosed=0;
 for(let now=0;now<=600000;now+=10){const frame=motion.sample(now,'idle');frames.add(frame);const inBlink=frame>=2&&frame<=4;if(inBlink&&!blinking)starts.push(now);if(frame===4)lastClosed=now;blinking=inBlink;}
 assert.ok(starts.length>=50&&starts.length<=80);
 for(let i=1;i<starts.length;i++)assert.ok(starts[i]-starts[i-1]>=7000);
 assert.ok(frames.has(2)&&frames.has(3)&&frames.has(4));assert.ok(lastClosed>590000);
});
test('a blink returns to the open pose within 260ms',()=>{
 const motion=new EyeMotion(()=>0);assert.equal(motion.sample(0,'idle'),1);
 assert.equal(motion.sample(6999,'idle'),1);assert.equal(motion.sample(7000,'idle'),2);
 assert.equal(motion.sample(7050,'idle'),3);assert.equal(motion.sample(7100,'idle'),4);
 assert.equal(motion.sample(7200,'idle'),2);assert.equal(motion.sample(7260,'idle'),1);
 assert.equal(motion.sample(14000,'idle'),1);
});
test('side glances are separated by at least 16 seconds',()=>{
 const motion=new EyeMotion(()=>.5),starts:number[]=[];let glancing=false;
 for(let now=0;now<180000;now+=10){const eye=motion.sample(now,'speaking');const glance=eye===5||eye===6;if(glance&&!glancing){starts.push(now);glancing=true;}if(eye===1)glancing=false;}
 assert.ok(starts.length>=6&&starts.length<=12);
 for(let i=1;i<starts.length;i++)assert.ok(starts[i]-starts[i-1]>=16000);
});
test('thinking glances up once; a brief TTS preparation does not trigger it',()=>{
 const motion=new EyeMotion(()=>.5);motion.sample(0,'idle');motion.sample(500,'thinking');
 assert.equal(motion.sample(1399,'thinking'),1);assert.equal(motion.sample(1400,'thinking'),7);
 assert.equal(motion.sample(2500,'thinking'),1);assert.equal(motion.sample(4500,'thinking'),1);
 const brief=new EyeMotion(()=>.5);brief.sample(0,'thinking');brief.sample(200,'speaking');assert.equal(brief.sample(1000,'speaking'),1);
});
test('reduced motion and resuming never accumulate blink bursts',()=>{
 const motion=new EyeMotion(()=>0);motion.sample(0,'idle');assert.equal(motion.sample(7000,'idle',false),1);
 assert.equal(motion.sample(60000,'idle',true),1);assert.equal(motion.sample(66999,'idle'),1);
 motion.reset(120000);assert.equal(motion.sample(120000,'idle'),1);assert.equal(motion.sample(126999,'idle'),1);
});
