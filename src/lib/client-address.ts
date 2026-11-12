import "server-only";
import { headers } from "next/headers";
import { clientAddressFrom } from "@/lib/domain/rate-limit";

/** The calling client's address, read from the request the one way (`clientAddressFrom`). */
export async function clientAddress(): Promise<string | null> {
  const h = await headers();
  return clientAddressFrom((name) => h.get(name));
}
