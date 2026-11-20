import "server-only";
import { headers } from "next/headers";
import { clientAddressFrom } from "@/lib/domain/rate-limit";

/**
 * The calling client's address, read from the request the one way
 * (`clientAddressFrom`). Null when there is no request to read (a script, a test
 * that stands in for one). The code door counts a null address in ONE shared
 * bucket (`NO_ADDRESS`, `services/code-door.ts`); other callers decide for themselves.
 */
export async function clientAddress(): Promise<string | null> {
  try {
    const h = await headers();
    return clientAddressFrom((name) => h.get(name));
  } catch {
    return null;
  }
}
