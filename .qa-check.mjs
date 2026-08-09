import { existsSync, readFileSync } from "node:fs";
if (existsSync(".env")) for (const l of readFileSync(".env","utf8").split(/\r?\n/)) { const m=l.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/); if(m) process.env[m[1]] ??= m[2]; }
const { PrismaClient } = await import("@prisma/client");
const p = new PrismaClient();
const eventId = process.argv[2];
const players = await p.player.findMany({ where: { eventId } });
const groups = await p.group.findMany({ where: { eventId }, orderBy:{position:'asc'} });
const stages = await p.stage.findMany({ where: { eventId }, orderBy:{position:'asc'} });
const matches = await p.match.findMany({ where: { eventId } });
const byId = new Map(players.map(x=>[x.id,x]));
const gName = new Map(groups.map(g=>[g.id,g.name]));
console.log("stages:", stages.map(s=>`${s.position}:${s.type}/${s.format}/${s.holes}h cut=${s.cutEnabled}`).join("  "));
console.log("groups:", groups.map(g=>`${g.name}(${players.filter(x=>x.groupId===g.id).length})`).join(" "));
const byStage = {};
for (const m of matches) (byStage[m.stageId] ??= []).push(m);
for (const s of stages) {
  const ms = byStage[s.id] ?? [];
  console.log(`\nstage ${s.position} (${s.type}) matches=${ms.length}`);
  const bad = ms.filter(m => { const a=byId.get(m.playerAId), b=byId.get(m.playerBId); return !a||!b|| a.groupId!==m.groupId || b.groupId!==m.groupId; });
  if (bad.length) console.log(`  MISMATCHED groupId on ${bad.length} match(es):`, bad.slice(0,6).map(m=>`${byId.get(m.playerAId)?.name}[${gName.get(byId.get(m.playerAId)?.groupId)}] vs ${byId.get(m.playerBId)?.name}[${gName.get(byId.get(m.playerBId)?.groupId)}] in flight ${gName.get(m.groupId)}`));
  const scored = ms.filter(m=>{try{const h=JSON.parse(m.holes);return Array.isArray(h)&&h.some(x=>x!==null)}catch{return false}}).length;
  console.log(`  scored=${scored}  confirmed=${ms.filter(m=>m.scoreStatus==="confirmed").length}`);
}
await p.$disconnect();
