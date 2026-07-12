import { generateKeyPairSync, sign, verify, createPublicKey, createHash } from "node:crypto";
const REF=process.env.REF_URL||"http://localhost:8871", ACT=process.env.ACT_URL||"http://localhost:8872";
const canon=(o)=>o===null||typeof o!=="object"?JSON.stringify(o):Array.isArray(o)?"["+o.map(canon).join(",")+"]":"{"+Object.keys(o).sort().map(k=>JSON.stringify(k)+":"+canon(o[k])).join(",")+"}";
const sha=(s)=>createHash("sha256").update(s).digest("hex");
const auth=generateKeyPairSync("ed25519");
const authPub=Buffer.from(auth.publicKey.export({format:"jwk"}).x,"base64url").toString("base64");
const authSign=(i)=>({intent:i,sig:sign(null,Buffer.from(canon(i)),auth.privateKey).toString("base64")});
const post=(b,p,body)=>fetch(b+p,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}).then(r=>r.json());
const get=(b,p)=>fetch(b+p).then(r=>r.json());

await post(REF,"/setup",{authorityPub:authPub,policy:{tenant:"acme",allowedTargets:["payout-8841"]}});
const {pubkey}=await get(REF,"/pubkey");
const mkIntent=(o={})=>({actionId:"payout",tenant:"acme",target:"payout-8841",comparator:"canonical-json",expected:{amount:"1284.00",to:"vendor-42"},nonce:"n-"+Math.random().toString(36).slice(2),expiry:Date.now()+60000,...o});
const write=(k,b)=>post(ACT,"/write",{key:k,body:b});
const verify_=(si,k)=>post(ACT,"/verify",{signedIntent:si,key:k});
const cases=[]; const rec=(n,r,exp)=>cases.push({name:n,admit:r.admit,reason:r.reason,expect:exp,ok:r.admit===exp});

{ const i=mkIntent(); await write("payout-8841",{amount:"1284.00",to:"vendor-42"});
  const r=await verify_(authSign(i),"payout-8841");
  let sigOk=false; if(r.sig){const der=Buffer.concat([Buffer.from("302a300506032b6570032100","hex"),Buffer.from(pubkey,"base64")]);
    sigOk=verify(null,Buffer.from(sha(canon(r.verdict))),createPublicKey({key:der,format:"der",type:"spki"}),Buffer.from(r.sig,"base64"));}
  rec("genuine (H01+H02+H03+H04+H07 on KV)",r,true); cases.at(-1).verdictSigValid=sigOk; }
{ const i=mkIntent({nonce:"n-reorder"}); await write("payout-8841",{to:"vendor-42",amount:"1284.00"});
  rec("H07 reordered keys match",await verify_(authSign(i),"payout-8841"),true); }
{ const i=mkIntent({nonce:"n-self",expected:{amount:"12840.00",to:"attacker"}});
  const evil=generateKeyPairSync("ed25519");
  await write("payout-8841",{amount:"12840.00",to:"attacker"});
  rec("H02 actor self-declares intent",await verify_({intent:i,sig:sign(null,Buffer.from(canon(i)),evil.privateKey).toString("base64")},"payout-8841"),false); }
{ const i=mkIntent({nonce:"n-pol",target:"secrets-root"});
  rec("H02 out-of-policy target",await verify_(authSign(i),"payout-8841"),false); }
{ const i=mkIntent({nonce:"n-mm"}); await write("payout-mm",{amount:"99999.00",to:"attacker"});
  rec("outcome mismatch",await verify_(authSign(i),"payout-mm"),false); }
{ const i=mkIntent({nonce:"n-replay"}); await write("payout-8841",{amount:"1284.00",to:"vendor-42"});
  await verify_(authSign(i),"payout-8841"); rec("H04 replay nonce",await verify_(authSign(i),"payout-8841"),false); }
{ const i=mkIntent({nonce:"n-exp",expiry:Date.now()-1});
  rec("H02 expired",await verify_(authSign(i),"payout-8841"),false); }
const atk=await get(ACT,"/attack");
const noKey=!atk.hasSigningKey&&!atk.hasDO&&!atk.bindings.includes("SIGNING")&&!atk.bindings.some(b=>/DO|PRECOMMIT|REFEREE_DO/.test(b));
const allOk=cases.every(c=>c.ok)&&cases[0].verdictSigValid&&noKey;
console.log(JSON.stringify({experiment:"h40-temp-account (local KV pre-check)",cases,actorBindings:atk.bindings,verdictSigValid:cases[0].verdictSigValid,actorCannotReachKeyOrDO:noKey,verdict:allOk?"H40-LOCAL-VERIFIED":"H40-LOCAL-FAILED"},null,2));
process.exit(allOk?0:1);
