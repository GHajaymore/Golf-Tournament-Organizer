// scripts/prisma-client-check.mjs says whose schema the shared generated Prisma client holds. Prisma
// writes a TIDIED copy of the schema beside the client (comments removed, alignment changed), so the
// check compares normalised schemas. These controls pin that: a re-aligned, comment-stripped copy
// MATCHES; a real change (an added field, a renamed model) DIFFERS; a `//` inside a string survives.
import { describe, expect, it } from "vitest";
import { normaliseSchema } from "../../../scripts/prisma-client-check.mjs";

const original = `// Prisma schema for the app.
datasource db {
  provider  = "postgresql"   // pooled
  url       = env("DATABASE_URL")
}

/// A golfer.
model Player {
  id        String  @id @default(cuid())
  name      String
  handicap  Float?  // exact index
}
`;

// The same schema, as Prisma's tidied copy writes it: no comments, column alignment changed.
const tidied = `datasource db {
  provider = "postgresql"
  url = env("DATABASE_URL")
}
model Player {
  id String @id @default(cuid())
  name     String
  handicap Float?
}
`;

describe("normaliseSchema: what the shared client's copy is compared by", () => {
  it("a re-aligned, comment-stripped copy of the same schema matches", () => {
    expect(normaliseSchema(tidied)).toBe(normaliseSchema(original));
  });

  it("CRLF and LF line endings match", () => {
    expect(normaliseSchema(original.replace(/\n/g, "\r\n"))).toBe(normaliseSchema(original));
  });

  it("an added field differs", () => {
    const withField = original.replace("  name      String\n", "  name      String\n  email     String\n");
    expect(normaliseSchema(withField)).not.toBe(normaliseSchema(original));
  });

  it("a renamed model differs", () => {
    const renamed = original.replace("model Player {", "model Golfer {");
    expect(normaliseSchema(renamed)).not.toBe(normaliseSchema(original));
  });

  it("a changed default differs", () => {
    const changed = original.replace("@default(cuid())", "@default(uuid())");
    expect(normaliseSchema(changed)).not.toBe(normaliseSchema(original));
  });

  it("a // inside a string literal is kept, not taken for a comment", () => {
    const schema = 'model T {\n  a String @default("a // b")\n}\n';
    expect(normaliseSchema(schema)).toContain('@default("a // b")');
    expect(normaliseSchema(schema)).not.toBe(normaliseSchema('model T {\n  a String @default("a")\n}\n'));
  });

  it("whitespace inside a string literal is kept as written", () => {
    const one = 'model T {\n  a String @default("a  b")\n}\n';
    const two = 'model T {\n  a String @default("a b")\n}\n';
    expect(normaliseSchema(one)).not.toBe(normaliseSchema(two));
  });

  it("a multi-line /** */ doc comment is removed and the lines either side stay apart", () => {
    const docced = 'model T {\n  /** Who answered,\n   * by name. */\n  a String\n  b String\n}\n';
    const plain = "model T {\n  a String\n  b String\n}\n";
    expect(normaliseSchema(docced)).toBe(normaliseSchema(plain));
    expect(normaliseSchema(docced)).toContain("model T {\na String\nb String\n}");
  });

  it("a /* inside a string literal is kept", () => {
    const schema = 'model T {\n  a String @default("/* x */")\n}\n';
    expect(normaliseSchema(schema)).toContain('@default("/* x */")');
  });

  it("a trailing comment after a string with an escaped quote is still stripped", () => {
    const withComment = 'model T {\n  a String @default("say \\"hi\\"") // note\n}\n';
    const without = 'model T {\n  a String @default("say \\"hi\\"")\n}\n';
    expect(normaliseSchema(withComment)).toBe(normaliseSchema(without));
  });
});
