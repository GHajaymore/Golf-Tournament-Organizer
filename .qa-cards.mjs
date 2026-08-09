import { existsSync, readFileSync } from "node:fs";
if (existsSync(".env")) for (const l of readFileSync(".env","utf8").split(/\r?\n/)) { const m=l.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/); if(m) process.env[m[1]] ??= m[2]; }
const { PrismaClient } = await import("@prisma/client");
const p = new PrismaClient();
const eventId = process.argv[2];
const players = new Map((await p.player.findMany({where:{eventId}})).map(x=>[x.id,x.name]));
console.log("MatchScorecard:", (await p.matchScorecard.findMany({where:{eventId}})).map(c=>`${players.get(c.playerId)} m=${c.matchId.slice(-5)} ${c.strokes.slice(0,40)}`));
console.log("Scorecard:", (await p.scorecard.findMany({where:{eventId}})).map(c=>`${players.get(c.playerId)} ${c.strokes.slice(0,40)}`));
await p.$disconnect();
