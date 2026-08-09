import { existsSync, readFileSync } from "node:fs";
if (existsSync(".env")) for (const l of readFileSync(".env","utf8").split(/\r?\n/)) { const m=l.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/); if(m) process.env[m[1]] ??= m[2]; }
const { PrismaClient } = await import("@prisma/client");
const p = new PrismaClient();
console.log(JSON.stringify(await p.course.findMany({ include: { tees: true, events: true } }), null, 1));
const e = await p.event.findUnique({ where: { id: process.argv[2] }, select: { customPars:true, customStrokeIndex:true, customYards:true, course:true, courseMode:true } });
console.log(JSON.stringify(e, null, 1));
await p.$disconnect();
